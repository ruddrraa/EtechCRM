import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import mongoose, { type Types } from 'mongoose'
import { Readable } from 'node:stream'
import type { Request, Response } from 'express'
import { FileAsset, type FileAssetDocument, type FileOwnerType, type FileVisibility } from '../../models/FileAsset.js'
import { User } from '../../models/User.js'
import { Client } from '../../models/Client.js'
import { Visit } from '../../models/Visit.js'
import { Organization } from '../../models/Organization.js'
import { AppError } from '../../utils/errors.js'
import { recordAudit } from '../audit.js'
import type { AuthUser } from '../../middleware/auth.js'
import { isHeadRole } from '../../middleware/auth.js'
import type { CloudResourceItem, IStorageProvider, SignedUploadParams } from './storage.interface.js'
import { CloudinaryStorageProvider } from './cloudinary.provider.js'
import { MockStorageProvider } from './mock.provider.js'
import {
  ALLOWED_FORMATS_FOR_MIME,
  FILE_SIZE_LIMITS,
  validateFileDescriptor,
  validateUploadedFile,
} from '../../validators/file.js'
import { env } from '../../config/env.js'

function initStorageProvider(): IStorageProvider {
  const isExplicitMock = env.STORAGE_PROVIDER === 'mock'
  const isTestEnv = env.NODE_ENV === 'test' && !env.STORAGE_PROVIDER

  if (isExplicitMock || isTestEnv) {
    console.log('[Storage] Active Provider: MockStorageProvider (Explicit mock mode or test environment)')
    return new MockStorageProvider()
  }

  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    const missing = [
      !env.CLOUDINARY_CLOUD_NAME && 'CLOUDINARY_CLOUD_NAME',
      !env.CLOUDINARY_API_KEY && 'CLOUDINARY_API_KEY',
      !env.CLOUDINARY_API_SECRET && 'CLOUDINARY_API_SECRET',
    ].filter(Boolean).join(', ')

    throw new Error(
      `[Storage] Cloudinary credentials missing (${missing}). Set CLOUDINARY_* environment variables in .env, or set STORAGE_PROVIDER=mock for local mock testing.`
    )
  }

  console.log(`[Storage] Active Provider: CloudinaryStorageProvider (Cloud: ${env.CLOUDINARY_CLOUD_NAME})`)
  return new CloudinaryStorageProvider()
}

let activeProvider: IStorageProvider = initStorageProvider()

export function setStorageProvider(provider: IStorageProvider): void {
  activeProvider = provider
}

export function getStorageProvider(): IStorageProvider {
  return activeProvider
}

export async function verifyStorageConnectivity(): Promise<void> {
  if (typeof activeProvider.ping === 'function') {
    try {
      const res = await activeProvider.ping()
      console.log(`[Storage] Connectivity verified successfully for ${activeProvider.name} (status: ${res.status})`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Storage] Connectivity verification FAILED for ${activeProvider.name}:`, msg)
      if (env.NODE_ENV === 'production') {
        throw new AppError(503, `Storage provider connectivity verification failed: ${msg}`)
      }
    }
  }
}

/**
 * Validates whether the actor has authorized access to the target entity (User, Client, or Visit).
 * Prevents cross-team document/photo access according to CRM RBAC.
 */
export async function verifyEntityAccess(
  actor: AuthUser,
  ownerType: FileOwnerType,
  ownerId: string | Types.ObjectId,
  requiredMode: 'READ' | 'WRITE' = 'READ'
): Promise<void> {
  if (actor.role === 'SUPER_ADMIN') return // Org-wide access

  const idStr = String(ownerId)

  switch (ownerType) {
    case 'USER_AVATAR': {
      if (idStr === actor.id) return // Own avatar
      if (requiredMode === 'WRITE') {
        throw new AppError(403, 'You can only update your own profile avatar')
      }
      // Marketing Head can view avatars of their team members
      if (isHeadRole(actor.role)) {
        const member = await User.findOne({ _id: idStr, reportingTo: actor.id })
        if (member) return
      }
      throw new AppError(403, 'You do not have permission to access this user avatar')
    }

    case 'CLIENT_VISITING_CARD':
    case 'CLIENT_DOCUMENT': {
      const client = await Client.findById(idStr)
      if (!client) throw new AppError(404, 'Client not found')

      // Marketing Executives can view active clients, but cannot upload/delete unless assigned/created
      if (actor.role === 'MARKETING_EXECUTIVE') {
        if (requiredMode === 'WRITE' && String(client.createdBy) !== actor.id) {
          throw new AppError(403, 'Marketing Executives can only manage documents for clients they created')
        }
        return
      }

      // Marketing Head can view/manage clients created by their team
      if (isHeadRole(actor.role)) {
        if (String(client.createdBy) === actor.id) return
        const teamMembers = await User.find({ reportingTo: actor.id }).select('_id').lean()
        const teamIds = teamMembers.map((m) => String(m._id))
        if (teamIds.includes(String(client.createdBy))) return
        // General active clients are readable
        if (requiredMode === 'READ') return
        throw new AppError(403, 'You can only modify documents for clients belonging to your team')
      }
      break
    }

    case 'VISIT_PHOTO':
    case 'VISIT_ATTACHMENT': {
      const visit = await Visit.findById(idStr)
      if (!visit) throw new AppError(404, 'Visit not found')

      // Marketing Executive can only access their own assigned visits
      if (actor.role === 'MARKETING_EXECUTIVE') {
        if (String(visit.assignedTo) !== actor.id) {
          throw new AppError(403, 'You cannot access attachments for visits assigned to another executive')
        }
        return
      }

      // Marketing Head can only access visits assigned to or by their team
      if (isHeadRole(actor.role)) {
        if (String(visit.assignedBy) === actor.id) return
        const executive = await User.findById(visit.assignedTo)
        if (executive && String(executive.reportingTo ?? '') === actor.id) return
        throw new AppError(403, 'Cross-team visit attachments access is denied')
      }
      break
    }

    case 'ORGANIZATION_EXPANDED_LOGO':
    case 'ORGANIZATION_COLLAPSED_LOGO':
      if (requiredMode === 'WRITE') {
        throw new AppError(403, 'Only Super Admin can manage organization branding logos')
      }
      return

    case 'GENERAL':
      if (requiredMode === 'WRITE') {
        throw new AppError(403, 'Only Super Admin can manage general workspace assets')
      }
      return
  }
}

interface UploadIntentTokenPayload {
  purpose: 'FILE_UPLOAD_INTENT'
  intentId: string
  actorId: string
  ownerType: FileOwnerType
  ownerId: string
  originalName: string
  mimeType: string
  expectedSizeBytes: number
  maxAllowedBytes: number
  resourceType: 'image' | 'raw'
  publicId: string
  folder: string
}

const SINGLE_SLOT_OWNER_TYPES = new Set<FileOwnerType>([
  'USER_AVATAR',
  'CLIENT_VISITING_CARD',
  'ORGANIZATION_EXPANDED_LOGO',
  'ORGANIZATION_COLLAPSED_LOGO',
])

export const PENDING_ORGANIZATION_OWNER_ID = '000000000000000000000001'

function isOrganizationLogoType(ownerType: FileOwnerType): boolean {
  return ownerType === 'ORGANIZATION_EXPANDED_LOGO' || ownerType === 'ORGANIZATION_COLLAPSED_LOGO'
}

async function resolveOrganizationOwnerIdForUpload(
  ownerType: FileOwnerType,
  requestedOwnerId: string
): Promise<{ effectiveOwnerId: string; isPendingOrganization: boolean }> {
  if (!isOrganizationLogoType(ownerType)) {
    return { effectiveOwnerId: requestedOwnerId, isPendingOrganization: false }
  }

  const existingOrg = await Organization.findOne({}).select('_id').lean()
  if (existingOrg?._id) {
    const realOrgId = String(existingOrg._id)
    if (requestedOwnerId === realOrgId || requestedOwnerId === PENDING_ORGANIZATION_OWNER_ID) {
      return { effectiveOwnerId: realOrgId, isPendingOrganization: false }
    }
    throw new AppError(404, 'Organization not found for uploaded logo ownerId')
  }

  // Organization document does not exist yet: allow explicit pending placeholder ONLY, never an arbitrary ID
  if (requestedOwnerId !== PENDING_ORGANIZATION_OWNER_ID) {
    throw new AppError(404, 'Organization not found for uploaded logo ownerId')
  }
  return { effectiveOwnerId: PENDING_ORGANIZATION_OWNER_ID, isPendingOrganization: true }
}

const VALID_PREFIX_PATTERN = /^etech_crm\/(user_avatar|client_visiting_card|client_document|visit_photo|visit_attachment|organization_expanded_logo|organization_collapsed_logo|general)\/[a-f\d]{24}\//i

async function findPreviousSingleSlotAssetId(ownerType: FileOwnerType, ownerId: string): Promise<string | null> {
  if (!SINGLE_SLOT_OWNER_TYPES.has(ownerType)) return null

  if (ownerType === 'USER_AVATAR') {
    const user = await User.findById(ownerId).select('avatarAsset').lean()
    return user?.avatarAsset ? String(user.avatarAsset) : null
  }
  if (ownerType === 'CLIENT_VISITING_CARD') {
    const client = await Client.findById(ownerId).select('visitingCardAsset').lean()
    return client?.visitingCardAsset ? String(client.visitingCardAsset) : null
  }
  if (ownerType === 'ORGANIZATION_EXPANDED_LOGO') {
    const org = await Organization.findOne({}).select('expandedLogoAsset').lean()
    return org?.expandedLogoAsset ? String(org.expandedLogoAsset) : null
  }
  if (ownerType === 'ORGANIZATION_COLLAPSED_LOGO') {
    const org = await Organization.findOne({}).select('collapsedLogoAsset').lean()
    return org?.collapsedLogoAsset ? String(org.collapsedLogoAsset) : null
  }
  return null
}

async function updateOwnerEntityReference(
  actorId: string,
  ownerType: FileOwnerType,
  ownerId: string,
  assetId: Types.ObjectId,
  crmViewUrl: string
): Promise<Types.ObjectId | null> {
  if (ownerType === 'USER_AVATAR') {
    await User.findByIdAndUpdate(ownerId, {
      $set: { avatarAsset: assetId, avatar: crmViewUrl },
    })
  } else if (ownerType === 'CLIENT_VISITING_CARD') {
    await Client.findByIdAndUpdate(ownerId, {
      $set: { visitingCardAsset: assetId },
    })
  } else if (ownerType === 'CLIENT_DOCUMENT') {
    await Client.findByIdAndUpdate(ownerId, {
      $addToSet: { documentAssets: assetId },
    })
  } else if (ownerType === 'VISIT_PHOTO') {
    await Visit.findByIdAndUpdate(ownerId, {
      $addToSet: { photoAssets: assetId },
    })
  } else if (ownerType === 'VISIT_ATTACHMENT') {
    await Visit.findByIdAndUpdate(ownerId, {
      $addToSet: { attachmentAssets: assetId },
    })
  } else if (ownerType === 'ORGANIZATION_EXPANDED_LOGO') {
    const org = await Organization.findOneAndUpdate(
      {},
      { $set: { expandedLogoAsset: assetId, expandedLogo: crmViewUrl, updatedBy: actorId } },
      { upsert: true, new: true }
    )
    return org?._id ?? null
  } else if (ownerType === 'ORGANIZATION_COLLAPSED_LOGO') {
    const org = await Organization.findOneAndUpdate(
      {},
      { $set: { collapsedLogoAsset: assetId, collapsedLogo: crmViewUrl, updatedBy: actorId } },
      { upsert: true, new: true }
    )
    return org?._id ?? null
  }
  return null
}

async function rollbackCloudAsset(
  actorId: string,
  publicId: string,
  resourceType: string,
  reason: string
): Promise<void> {
  try {
    await activeProvider.delete(publicId, resourceType)
  } catch (cleanupErr) {
    try {
      await recordAudit(actorId, 'FILE_UPLOAD_ROLLBACK_FAILED', 'FileAsset', publicId, {
        publicId,
        resourceType,
        reason,
        cleanupError: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      })
    } catch {
      // Never mask original error when audit write also fails
    }
  }
}

async function retireReplacedSingleSlotAsset(
  actorId: string,
  oldAssetId: string,
  replacedByAssetId: string
): Promise<void> {
  if (oldAssetId === replacedByAssetId) return
  const oldAsset = await FileAsset.findOne({ _id: oldAssetId, isArchived: false })
  if (!oldAsset) return

  // Only delete cloud object if no other active FileAsset shares the same cloudinaryPublicId
  const sharedCount = await FileAsset.countDocuments({
    cloudinaryPublicId: oldAsset.cloudinaryPublicId,
    _id: { $ne: oldAsset._id },
    isArchived: false,
  })

  let cloudDeleted = false
  let pendingCloudDelete = false
  let deleteError: string | undefined

  if (sharedCount === 0) {
    try {
      await activeProvider.delete(oldAsset.cloudinaryPublicId, oldAsset.cloudinaryResourceType)
      cloudDeleted = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('not found')) {
        cloudDeleted = true
      } else {
        pendingCloudDelete = true
        deleteError = msg
      }
    }
  }

  oldAsset.isArchived = true
  oldAsset.deletedAt = new Date()
  oldAsset.metadata = {
    ...(oldAsset.metadata || {}),
    replacedByAssetId,
    pendingCloudDelete,
    ...(cloudDeleted ? { cloudDeletedAt: new Date() } : {}),
  }
  await oldAsset.save()

  if (pendingCloudDelete) {
    await recordAudit(actorId, 'FILE_ORPHAN_CLEANUP_PENDING', 'FileAsset', String(oldAsset._id), {
      publicId: oldAsset.cloudinaryPublicId,
      ownerType: oldAsset.ownerType,
      ownerId: String(oldAsset.ownerId),
      error: deleteError,
    })
  } else {
    await recordAudit(actorId, 'FILE_REPLACED', 'FileAsset', String(oldAsset._id), {
      replacedByAssetId,
      ownerType: oldAsset.ownerType,
      ownerId: String(oldAsset.ownerId),
      cloudDeleted,
    })
  }
}

async function finalizeAssetPersistence(params: {
  actor: AuthUser
  ownerType: FileOwnerType
  ownerId: string
  visibility: FileVisibility
  sanitizedName: string
  resourceType: 'image' | 'raw'
  mimeType: string
  sizeBytes: number
  cloudinaryPublicId: string
  cloudinaryResourceType: string
  secureStorageReference: string
  metadata?: Record<string, unknown>
}): Promise<{ asset: FileAssetDocument; viewUrl: string; signedUrl: string }> {
  const {
    actor,
    ownerType,
    ownerId,
    visibility,
    sanitizedName,
    resourceType,
    mimeType,
    sizeBytes,
    cloudinaryPublicId,
    cloudinaryResourceType,
    secureStorageReference,
    metadata,
  } = params

  const isPendingOrgLogo = isOrganizationLogoType(ownerType) && ownerId === PENDING_ORGANIZATION_OWNER_ID
  const previousSingleSlotAssetId = await findPreviousSingleSlotAssetId(ownerType, ownerId)
  let createdAsset: FileAssetDocument | null = null

  try {
    createdAsset = await FileAsset.create({
      originalName: sanitizedName,
      resourceType,
      mimeType,
      sizeBytes,
      cloudinaryPublicId,
      cloudinaryResourceType,
      secureStorageReference,
      ownerType,
      ownerId: new mongoose.Types.ObjectId(ownerId),
      uploadedBy: new mongoose.Types.ObjectId(actor.id),
      visibility,
      metadata: {
        ...(metadata || {}),
        ...(isOrganizationLogoType(ownerType)
          ? { ownershipStatus: isPendingOrgLogo ? 'PENDING_ORGANIZATION' : 'ASSIGNED' }
          : {}),
      },
      isArchived: false,
    })

    const crmViewUrl = `/api/files/${createdAsset._id}/view`
    const resolvedOrgId = await updateOwnerEntityReference(actor.id, ownerType, ownerId, createdAsset._id, crmViewUrl)

    // Synchronize pending placeholder ownership to the real Organization _id once upserted
    if (resolvedOrgId && isOrganizationLogoType(ownerType)) {
      const shouldUpdateOwner =
        String(createdAsset.ownerId) !== String(resolvedOrgId) || isPendingOrgLogo
      if (shouldUpdateOwner) {
        await FileAsset.updateOne(
          { _id: createdAsset._id },
          {
            $set: {
              ownerId: resolvedOrgId,
              'metadata.ownershipStatus': 'ASSIGNED',
              'metadata.resolvedFromPlaceholderOwnerId': ownerId,
            },
          }
        )
        createdAsset.ownerId = resolvedOrgId as unknown as typeof createdAsset.ownerId
        createdAsset.metadata = {
          ...(createdAsset.metadata || {}),
          ownershipStatus: 'ASSIGNED',
          resolvedFromPlaceholderOwnerId: ownerId,
        }
      }
    }

    await recordAudit(actor.id, 'FILE_UPLOADED', 'FileAsset', String(createdAsset._id), {
      originalName: sanitizedName,
      ownerType,
      ownerId: String(createdAsset.ownerId),
      sizeBytes,
      mimeType,
    })

    // Retire old single-slot asset ONLY after new FileAsset & owner pointer succeeded
    if (previousSingleSlotAssetId && previousSingleSlotAssetId !== String(createdAsset._id)) {
      await retireReplacedSingleSlotAsset(actor.id, previousSingleSlotAssetId, String(createdAsset._id))
    }

    return { asset: createdAsset, viewUrl: crmViewUrl, signedUrl: crmViewUrl }
  } catch (error) {
    // Roll back ONLY the newly uploaded asset and any unlinked FileAsset doc; preserve old asset untouched
    if (createdAsset) {
      await FileAsset.deleteOne({ _id: createdAsset._id }).catch(() => {})
    }
    await rollbackCloudAsset(
      actor.id,
      cloudinaryPublicId,
      cloudinaryResourceType,
      error instanceof Error ? error.message : String(error)
    )
    throw error
  }
}

export async function createSignedUploadIntent(
  actor: AuthUser,
  input: {
    ownerType: FileOwnerType
    ownerId: string
    originalName: string
    mimeType: string
    sizeBytes: number
    headerHex: string
  }
): Promise<{
  uploadIntentToken: string
  expiresInSeconds: number
  uploadParams: SignedUploadParams
}> {
  if (!mongoose.isValidObjectId(input.ownerId)) {
    throw new AppError(422, 'Invalid owner ID')
  }

  await verifyEntityAccess(actor, input.ownerType, input.ownerId, 'WRITE')
  const { effectiveOwnerId } = await resolveOrganizationOwnerIdForUpload(input.ownerType, input.ownerId)

  const headerBuffer = Buffer.from(input.headerHex, 'hex')
  const { resourceType, sanitizedName } = validateFileDescriptor({
    ownerType: input.ownerType,
    originalName: input.originalName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    headerBuffer,
  })

  if (typeof activeProvider.createSignedUploadParams !== 'function') {
    throw new AppError(501, `Signed direct uploads are not supported by provider "${activeProvider.name}"`)
  }

  const intentId = crypto.randomUUID()
  const randomSuffix = crypto.randomBytes(4).toString('hex')
  const folder = `etech_crm/${input.ownerType.toLowerCase()}/${effectiveOwnerId}`
  const publicId = `${folder}/${Date.now()}_${randomSuffix}`

  const uploadParams = activeProvider.createSignedUploadParams({
    publicId,
    folder,
    resourceType,
    tags: [input.ownerType, `user_${actor.id}`, `owner_${effectiveOwnerId}`],
  })

  const expiresInSeconds = 600
  const tokenPayload: UploadIntentTokenPayload = {
    purpose: 'FILE_UPLOAD_INTENT',
    intentId,
    actorId: actor.id,
    ownerType: input.ownerType,
    ownerId: effectiveOwnerId,
    originalName: sanitizedName,
    mimeType: input.mimeType,
    expectedSizeBytes: input.sizeBytes,
    maxAllowedBytes: FILE_SIZE_LIMITS[input.ownerType] || 25 * 1024 * 1024,
    resourceType,
    publicId,
    folder,
  }

  const uploadIntentToken = jwt.sign(tokenPayload, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  })

  return {
    uploadIntentToken,
    expiresInSeconds,
    uploadParams,
  }
}

export async function registerDirectUpload(
  actor: AuthUser,
  uploadIntentToken: string,
  visibility: FileVisibility = 'PRIVATE'
): Promise<{ asset: FileAssetDocument; viewUrl: string; signedUrl: string; idempotent?: boolean }> {
  let payload: UploadIntentTokenPayload
  try {
    payload = jwt.verify(uploadIntentToken, env.JWT_SECRET, { algorithms: ['HS256'] }) as UploadIntentTokenPayload
  } catch {
    throw new AppError(401, 'Upload authorization token is invalid or expired')
  }

  if (
    !payload ||
    payload.purpose !== 'FILE_UPLOAD_INTENT' ||
    !payload.intentId ||
    !payload.publicId ||
    !mongoose.isValidObjectId(payload.ownerId)
  ) {
    throw new AppError(422, 'Invalid upload authorization payload')
  }

  if (payload.actorId !== actor.id && actor.role !== 'SUPER_ADMIN') {
    throw new AppError(403, 'Upload authorization token does not belong to the current user')
  }

  const expectedPrefix = `etech_crm/${payload.ownerType.toLowerCase()}/${payload.ownerId}/`
  if (!payload.publicId.startsWith(expectedPrefix)) {
    throw new AppError(422, 'Uploaded asset key violates folder ownership boundary')
  }

  await verifyEntityAccess(actor, payload.ownerType, payload.ownerId, 'WRITE')

  // Idempotency guard: safe retries for identical intent/publicId
  const existing = await FileAsset.findOne({
    $or: [{ cloudinaryPublicId: payload.publicId }, { 'metadata.uploadIntentId': payload.intentId }],
    isArchived: false,
  })
  if (existing) {
    const resolvedPlaceholderMatch =
      existing.metadata &&
      (existing.metadata as { resolvedFromPlaceholderOwnerId?: string }).resolvedFromPlaceholderOwnerId === payload.ownerId
    if ((String(existing.ownerId) !== payload.ownerId && !resolvedPlaceholderMatch) || existing.ownerType !== payload.ownerType) {
      throw new AppError(403, 'Asset registration conflict with another entity')
    }
    const crmViewUrl = `/api/files/${existing._id}/view`
    return { asset: existing, viewUrl: crmViewUrl, signedUrl: crmViewUrl, idempotent: true }
  }

  if (typeof activeProvider.getAssetMetadata !== 'function') {
    throw new AppError(501, `Server-side asset verification is not supported by provider "${activeProvider.name}"`)
  }

  const verified = await activeProvider.getAssetMetadata(payload.publicId, payload.resourceType)
  if (!verified) {
    throw new AppError(404, 'Uploaded file could not be verified in cloud storage')
  }

  if (verified.resourceType !== payload.resourceType) {
    await rollbackCloudAsset(actor.id, verified.publicId, verified.resourceType || payload.resourceType, 'RESOURCE_TYPE_MISMATCH')
    throw new AppError(422, 'Uploaded asset resource type does not match signed upload intent')
  }

  const maxAllowed = FILE_SIZE_LIMITS[payload.ownerType] || payload.maxAllowedBytes
  if (verified.bytes <= 0 || verified.bytes > maxAllowed) {
    await rollbackCloudAsset(actor.id, verified.publicId, verified.resourceType, 'SIZE_LIMIT_VIOLATION')
    throw new AppError(422, `Uploaded asset size exceeds allowed limit for ${payload.ownerType}`)
  }

  const allowedFormats = ALLOWED_FORMATS_FOR_MIME[payload.mimeType] || []
  if (verified.format && allowedFormats.length > 0 && !allowedFormats.includes(verified.format.toLowerCase())) {
    await rollbackCloudAsset(actor.id, verified.publicId, verified.resourceType, `INVALID_FORMAT_${verified.format}`)
    throw new AppError(422, `Uploaded file format "${verified.format}" does not match declared type "${payload.mimeType}"`)
  }

  return finalizeAssetPersistence({
    actor,
    ownerType: payload.ownerType,
    ownerId: payload.ownerId,
    visibility,
    sanitizedName: payload.originalName,
    resourceType: payload.resourceType,
    mimeType: payload.mimeType,
    sizeBytes: verified.bytes,
    cloudinaryPublicId: verified.publicId,
    cloudinaryResourceType: verified.resourceType,
    secureStorageReference: verified.secureUrl,
    metadata: {
      format: verified.format || undefined,
      version: verified.version,
      uploadIntentId: payload.intentId,
      directUpload: true,
      declaredSizeBytes: payload.expectedSizeBytes,
    },
  })
}

export async function uploadFileAsset(
  actor: AuthUser,
  file: Express.Multer.File | undefined,
  ownerType: FileOwnerType,
  ownerId: string,
  visibility: FileVisibility = 'PRIVATE'
): Promise<{ asset: FileAssetDocument; viewUrl: string; signedUrl: string }> {
  if (!mongoose.isValidObjectId(ownerId)) {
    throw new AppError(422, 'Invalid owner ID')
  }

  // 1. Authorization & Organization ownerId lifecycle resolution
  await verifyEntityAccess(actor, ownerType, ownerId, 'WRITE')
  const { effectiveOwnerId } = await resolveOrganizationOwnerIdForUpload(ownerType, ownerId)

  // 2. Validate MIME type, size, magic bytes, sanitized filename
  const { resourceType, sanitizedName } = validateUploadedFile(file, ownerType)

  // 3. Generate safe unique Cloudinary public ID
  const randomSuffix = crypto.randomBytes(4).toString('hex')
  const folder = `etech_crm/${ownerType.toLowerCase()}/${effectiveOwnerId}`
  const publicId = `${folder}/${Date.now()}_${randomSuffix}`

  // 4. Upload to storage provider
  const uploadResult = await activeProvider.upload({
    buffer: file!.buffer,
    filename: sanitizedName,
    mimeType: file!.mimetype,
    resourceType,
    folder,
    publicId,
    tags: [ownerType, `user_${actor.id}`, `owner_${effectiveOwnerId}`],
  })

  return finalizeAssetPersistence({
    actor,
    ownerType,
    ownerId: effectiveOwnerId,
    visibility,
    sanitizedName,
    resourceType,
    mimeType: file!.mimetype,
    sizeBytes: file!.size,
    cloudinaryPublicId: uploadResult.publicId,
    cloudinaryResourceType: uploadResult.resourceType,
    secureStorageReference: uploadResult.secureUrl,
    metadata: {
      format: uploadResult.format,
      version: uploadResult.version,
      directUpload: false,
    },
  })
}

export async function getFileAsset(
  actor: AuthUser,
  fileId: string
): Promise<{ asset: FileAssetDocument; viewUrl: string; signedUrl: string; isLegacyMock?: boolean }> {
  if (!mongoose.isValidObjectId(fileId)) {
    throw new AppError(422, 'Invalid file ID')
  }

  const asset = await FileAsset.findOne({ _id: fileId, isArchived: false })
  if (!asset) {
    throw new AppError(404, 'File not found')
  }

  // Authorization check on owner entity
  await verifyEntityAccess(actor, asset.ownerType, String(asset.ownerId), 'READ')

  const isLegacyMock = Boolean(asset.secureStorageReference?.includes('mock-storage.local'))
  const crmViewUrl = `/api/files/${asset._id}/view`

  await recordAudit(actor.id, 'FILE_ACCESSED', 'FileAsset', fileId, {
    ownerType: asset.ownerType,
    ownerId: String(asset.ownerId),
    isLegacyMock,
  })

  return { asset, viewUrl: crmViewUrl, signedUrl: crmViewUrl, isLegacyMock }
}

export async function streamFileAsset(
  actor: AuthUser,
  fileId: string,
  req: Request,
  res: Response
): Promise<void> {
  if (!mongoose.isValidObjectId(fileId)) {
    throw new AppError(422, 'Invalid file ID')
  }

  const asset = await FileAsset.findOne({ _id: fileId, isArchived: false })
  if (!asset) {
    throw new AppError(404, 'File not found')
  }

  // Security: Check RBAC and entity ownership
  await verifyEntityAccess(actor, asset.ownerType, String(asset.ownerId), 'READ')

  // Audit logging for access
  await recordAudit(actor.id, 'FILE_ACCESSED', 'FileAsset', fileId, {
    ownerType: asset.ownerType,
    ownerId: String(asset.ownerId),
    mode: 'STREAM_VIEW',
  })

  // Mandatory security headers: Content-Type, Content-Disposition, nosniff, cache-control
  const safeName = asset.originalName.replace(/["\r\n\\]/g, '_')
  const isDownload = req.query.download === '1' || req.query.download === 'true'
  res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream')
  res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename="${safeName}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate')

  const isMock = !(activeProvider instanceof CloudinaryStorageProvider) || asset.secureStorageReference?.includes('mock-storage.local')

  if (isMock) {
    // Mock environment or legacy mock file (escape XML to prevent stored XSS in SVG preview)
    const escapeXml = (str: string) =>
      str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    if (asset.mimeType?.startsWith('image/')) {
      res.setHeader('Content-Type', 'image/svg+xml')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150">
        <rect width="100%" height="100%" fill="#f1f5f9"/>
        <text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="600" fill="#475569">${escapeXml(asset.originalName)}</text>
        <text x="50%" y="65%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#94a3b8">Mock File Preview (${escapeXml(asset.mimeType)})</text>
      </svg>`
      res.status(200).send(svg)
      return
    }
    res.status(200).send(Buffer.from(`[Preview content for ${asset.originalName} (${asset.mimeType})]`))
    return
  }

  // Cloudinary live streaming via short-lived signed URL
  const signedUrl = await activeProvider.getSignedUrl(asset.cloudinaryPublicId, asset.cloudinaryResourceType, 300)

  const fetchHeaders: Record<string, string> = {}
  if (req.headers.range) {
    fetchHeaders['Range'] = req.headers.range
  }

  const upstream = await fetch(signedUrl, { headers: fetchHeaders })
  if (!upstream.ok && upstream.status !== 206) {
    throw new AppError(upstream.status === 404 ? 404 : 502, `Failed to stream file from storage provider: ${upstream.statusText}`)
  }

  if (upstream.status === 206) {
    res.status(206)
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) res.setHeader('Content-Range', contentRange)
    const contentLength = upstream.headers.get('content-length')
    if (contentLength) res.setHeader('Content-Length', contentLength)
  } else {
    const contentLength = upstream.headers.get('content-length')
    if (contentLength) res.setHeader('Content-Length', contentLength)
  }

  if (upstream.body) {
    const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
    nodeStream.pipe(res)
  } else {
    res.end()
  }
}

export async function listFilesForOwner(
  actor: AuthUser,
  ownerType: FileOwnerType,
  ownerId: string
): Promise<Array<{ asset: FileAssetDocument; viewUrl: string; signedUrl: string; isLegacyMock?: boolean }>> {
  if (!mongoose.isValidObjectId(ownerId)) {
    throw new AppError(422, 'Invalid owner ID')
  }

  await verifyEntityAccess(actor, ownerType, ownerId, 'READ')

  const assets = await FileAsset.find({ ownerType, ownerId, isArchived: false }).sort({ createdAt: -1 })

  const results = assets.map((asset) => {
    const isLegacyMock = Boolean(asset.secureStorageReference?.includes('mock-storage.local'))
    const crmViewUrl = `/api/files/${asset._id}/view`
    return { asset, viewUrl: crmViewUrl, signedUrl: crmViewUrl, isLegacyMock }
  })

  return results
}

export async function deleteFileAsset(
  actor: AuthUser,
  fileId: string
): Promise<{ success: boolean; fileId: string }> {
  if (!mongoose.isValidObjectId(fileId)) {
    throw new AppError(422, 'Invalid file ID')
  }

  const asset = await FileAsset.findOne({ _id: fileId, isArchived: false })
  if (!asset) {
    throw new AppError(404, 'File not found')
  }

  // Verify write permission on the owner entity
  await verifyEntityAccess(actor, asset.ownerType, String(asset.ownerId), 'WRITE')

  // Cloudinary deletion
  try {
    await activeProvider.delete(asset.cloudinaryPublicId, asset.cloudinaryResourceType)
  } catch (err) {
    // If provider delete fails, log audit and bubble up error, unless it was already removed ('not found')
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.toLowerCase().includes('not found')) {
      await recordAudit(actor.id, 'FILE_DELETE_CLOUD_FAILED', 'FileAsset', fileId, {
        publicId: asset.cloudinaryPublicId,
        error: msg,
      }).catch(() => {})
      throw new AppError(502, `Storage provider deletion failed: ${msg}`)
    }
  }

  // Soft deletion in MongoDB
  asset.isArchived = true
  asset.deletedAt = new Date()
  await asset.save()

  // Remove references from owner entity safely
  await clearOwnerEntityReference(asset)

  await recordAudit(actor.id, 'FILE_DELETED', 'FileAsset', fileId, {
    originalName: asset.originalName,
    ownerType: asset.ownerType,
    ownerId: String(asset.ownerId),
  })

  return { success: true, fileId }
}

export async function getStorageDashboardStats(actor: AuthUser): Promise<{
  totalFiles: number
  totalBytes: number
  totalMegabytes: number
  byCategory: Record<string, { count: number; bytes: number }>
  recentUploads: Array<{
    _id: string
    originalName: string
    ownerType: string
    sizeBytes: number
    mimeType: string
    uploadedBy: string
    createdAt: Date
  }>
  storageProvider: string
  isLiveCloudinary: boolean
}> {
  if (actor.role !== 'SUPER_ADMIN') {
    throw new AppError(403, 'Only Super Admin can view storage dashboard')
  }

  const [countResult, categoryResult, recentDocs] = await Promise.all([
    FileAsset.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: null, totalFiles: { $sum: 1 }, totalBytes: { $sum: '$sizeBytes' } } },
    ]),
    FileAsset.aggregate([
      { $match: { isArchived: false } },
      {
        $group: {
          _id: '$ownerType',
          count: { $sum: 1 },
          bytes: { $sum: '$sizeBytes' },
        },
      },
    ]),
    FileAsset.find({ isArchived: false })
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ])

  const totalFiles = countResult[0]?.totalFiles ?? 0
  const totalBytes = countResult[0]?.totalBytes ?? 0

  const byCategory: Record<string, { count: number; bytes: number }> = {}
  for (const cat of categoryResult) {
    byCategory[cat._id] = { count: cat.count, bytes: cat.bytes }
  }

  const recentUploads = recentDocs.map((doc) => ({
    _id: String(doc._id),
    originalName: doc.originalName,
    ownerType: doc.ownerType,
    sizeBytes: doc.sizeBytes,
    mimeType: doc.mimeType,
    uploadedBy: (doc.uploadedBy as { name?: string })?.name || 'Unknown',
    createdAt: doc.createdAt,
  }))

  const isLive = activeProvider instanceof CloudinaryStorageProvider

  return {
    totalFiles,
    totalBytes,
    totalMegabytes: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
    byCategory,
    recentUploads,
    storageProvider: activeProvider.name,
    isLiveCloudinary: isLive,
  }
}

async function clearOwnerEntityReference(asset: {
  _id: Types.ObjectId | unknown
  ownerType: FileOwnerType
  ownerId: Types.ObjectId | unknown
}): Promise<void> {
  if (asset.ownerType === 'USER_AVATAR') {
    await User.updateOne({ _id: asset.ownerId, avatarAsset: asset._id }, { $unset: { avatarAsset: 1, avatar: 1 } })
  } else if (asset.ownerType === 'CLIENT_VISITING_CARD') {
    await Client.updateOne({ _id: asset.ownerId, visitingCardAsset: asset._id }, { $unset: { visitingCardAsset: 1 } })
  } else if (asset.ownerType === 'CLIENT_DOCUMENT') {
    await Client.updateOne({ _id: asset.ownerId }, { $pull: { documentAssets: asset._id } })
  } else if (asset.ownerType === 'VISIT_PHOTO') {
    await Visit.updateOne({ _id: asset.ownerId }, { $pull: { photoAssets: asset._id } })
  } else if (asset.ownerType === 'VISIT_ATTACHMENT') {
    await Visit.updateOne({ _id: asset.ownerId }, { $pull: { attachmentAssets: asset._id } })
  } else if (asset.ownerType === 'ORGANIZATION_EXPANDED_LOGO') {
    await Organization.updateOne({ expandedLogoAsset: asset._id }, { $unset: { expandedLogoAsset: 1, expandedLogo: 1 } })
  } else if (asset.ownerType === 'ORGANIZATION_COLLAPSED_LOGO') {
    await Organization.updateOne({ collapsedLogoAsset: asset._id }, { $unset: { collapsedLogoAsset: 1, collapsedLogo: 1 } })
  }
}

export interface OrphanCleanupReport {
  dryRun: boolean
  minAgeHours: number
  verifyCloud: boolean
  cutoffDate: string
  summary: {
    pendingCloudDeletes: number
    unregisteredCloudAssets: number
    staleDbRecords: number
    cleanedPendingCloudDeletes: number
    cleanedUnregisteredCloudAssets: number
    archivedStaleDbRecords: number
    errors: number
  }
  items: {
    pendingCloudDeletes: Array<{ assetId: string; publicId: string; ownerType: string; ownerId: string }>
    unregisteredCloudAssets: Array<{ publicId: string; resourceType: string; bytes: number; createdAt: string }>
    staleDbRecords: Array<{ assetId: string; publicId: string; ownerType: string; ownerId: string }>
  }
}

export async function auditOrCleanOrphans(
  actor: AuthUser,
  options: { dryRun?: boolean; minAgeHours?: number; verifyCloud?: boolean } = {}
): Promise<OrphanCleanupReport> {
  if (actor.role !== 'SUPER_ADMIN') {
    throw new AppError(403, 'Only Super Admin can audit or clean up orphan storage assets')
  }

  const dryRun = options.dryRun ?? true
  const minAgeHours = Math.max(1, Math.min(720, Math.floor(options.minAgeHours ?? 24)))
  const verifyCloud = options.verifyCloud ?? false
  const cutoffDate = new Date(Date.now() - minAgeHours * 60 * 60 * 1000)

  let cleanedPendingCloudDeletes = 0
  let cleanedUnregisteredCloudAssets = 0
  let archivedStaleDbRecords = 0
  let errors = 0

  // 1. Archived records waiting for deferred cloud deletion (respecting minimum age threshold)
  const pendingDocs = await FileAsset.find({
    isArchived: true,
    'metadata.pendingCloudDelete': true,
    $or: [{ deletedAt: { $lte: cutoffDate } }, { deletedAt: { $exists: false }, updatedAt: { $lte: cutoffDate } }],
  })
    .limit(100)
    .lean()

  const pendingCloudDeletes = pendingDocs.map((doc) => ({
    assetId: String(doc._id),
    publicId: doc.cloudinaryPublicId,
    ownerType: doc.ownerType,
    ownerId: String(doc.ownerId),
  }))

  if (!dryRun) {
    for (const doc of pendingDocs) {
      try {
        const activeRefCount = await FileAsset.countDocuments({
          cloudinaryPublicId: doc.cloudinaryPublicId,
          _id: { $ne: doc._id },
          isArchived: false,
        })
        if (activeRefCount === 0) {
          try {
            await activeProvider.delete(doc.cloudinaryPublicId, doc.cloudinaryResourceType)
          } catch (delErr) {
            const msg = delErr instanceof Error ? delErr.message.toLowerCase() : String(delErr).toLowerCase()
            if (!msg.includes('not found')) throw delErr
          }
        }
        await FileAsset.updateOne(
          { _id: doc._id },
          { $set: { 'metadata.pendingCloudDelete': false, 'metadata.cloudDeletedAt': new Date() } }
        )
        cleanedPendingCloudDeletes += 1
      } catch {
        errors += 1
      }
    }
  }

  // 2. Unregistered cloud objects within the CRM prefix older than minAgeHours
  const unregisteredCloudAssets: Array<{ publicId: string; resourceType: string; bytes: number; createdAt: string }> = []
  if (typeof activeProvider.listAssetsByPrefix === 'function') {
    let cloudItems: CloudResourceItem[] = []
    try {
      const [imageItems, rawItems] = await Promise.all([
        activeProvider.listAssetsByPrefix('etech_crm/', 'image'),
        activeProvider.listAssetsByPrefix('etech_crm/', 'raw'),
      ])
      cloudItems = [...imageItems, ...rawItems]
    } catch {
      errors += 1
    }

    const agedCrmItems = cloudItems.filter(
      (item) => VALID_PREFIX_PATTERN.test(item.publicId) && item.createdAt <= cutoffDate
    )

    if (agedCrmItems.length > 0) {
      const candidateIds = agedCrmItems.map((i) => i.publicId)
      const knownDocs = await FileAsset.find({ cloudinaryPublicId: { $in: candidateIds } })
        .select('cloudinaryPublicId isArchived metadata.pendingCloudDelete')
        .lean()
      const activeOrHandledKeys = new Set(
        knownDocs
          .filter((d) => !d.isArchived || Boolean((d.metadata as { pendingCloudDelete?: boolean } | undefined)?.pendingCloudDelete))
          .map((d) => d.cloudinaryPublicId)
      )

      for (const item of agedCrmItems) {
        if (!activeOrHandledKeys.has(item.publicId)) {
          unregisteredCloudAssets.push({
            publicId: item.publicId,
            resourceType: item.resourceType,
            bytes: item.bytes,
            createdAt: item.createdAt.toISOString(),
          })
          if (!dryRun) {
            try {
              await activeProvider.delete(item.publicId, item.resourceType)
              cleanedUnregisteredCloudAssets += 1
            } catch {
              errors += 1
            }
          }
        }
      }
    }
  }

  // 3. Optional deep check: active DB FileAsset records missing from cloud provider
  const staleDbRecords: Array<{ assetId: string; publicId: string; ownerType: string; ownerId: string }> = []
  if (verifyCloud && typeof activeProvider.getAssetMetadata === 'function') {
    const query: Record<string, unknown> = {
      isArchived: false,
      createdAt: { $lte: cutoffDate },
    }
    if (activeProvider instanceof CloudinaryStorageProvider) {
      query.secureStorageReference = { $not: /mock-storage\.local/ }
    }

    const dbAssets = await FileAsset.find(query).limit(50).lean()
    for (const asset of dbAssets) {
      try {
        const remote = await activeProvider.getAssetMetadata(asset.cloudinaryPublicId, asset.cloudinaryResourceType)
        if (!remote) {
          staleDbRecords.push({
            assetId: String(asset._id),
            publicId: asset.cloudinaryPublicId,
            ownerType: asset.ownerType,
            ownerId: String(asset.ownerId),
          })
          if (!dryRun) {
            await FileAsset.updateOne(
              { _id: asset._id, isArchived: false },
              {
                $set: {
                  isArchived: true,
                  deletedAt: new Date(),
                  'metadata.archivedReason': 'MISSING_FROM_CLOUD',
                },
              }
            )
            await clearOwnerEntityReference(asset)
            archivedStaleDbRecords += 1
          }
        }
      } catch {
        errors += 1
      }
    }
  }

  await recordAudit(
    actor.id,
    dryRun ? 'FILE_ORPHAN_AUDIT' : 'FILE_ORPHAN_CLEANUP',
    'FileAsset',
    actor.id,
    {
      dryRun,
      minAgeHours,
      verifyCloud,
      pendingCount: pendingCloudDeletes.length,
      unregisteredCount: unregisteredCloudAssets.length,
      staleDbCount: staleDbRecords.length,
      cleanedPendingCloudDeletes,
      cleanedUnregisteredCloudAssets,
      archivedStaleDbRecords,
      errors,
    }
  )

  return {
    dryRun,
    minAgeHours,
    verifyCloud,
    cutoffDate: cutoffDate.toISOString(),
    summary: {
      pendingCloudDeletes: pendingCloudDeletes.length,
      unregisteredCloudAssets: unregisteredCloudAssets.length,
      staleDbRecords: staleDbRecords.length,
      cleanedPendingCloudDeletes,
      cleanedUnregisteredCloudAssets,
      archivedStaleDbRecords,
      errors,
    },
    items: {
      pendingCloudDeletes: pendingCloudDeletes.slice(0, 50),
      unregisteredCloudAssets: unregisteredCloudAssets.slice(0, 50),
      staleDbRecords: staleDbRecords.slice(0, 50),
    },
  }
}
