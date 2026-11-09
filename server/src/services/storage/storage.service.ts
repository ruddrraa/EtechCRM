import mongoose, { type Types } from 'mongoose'
import { FileAsset, type FileAssetDocument, type FileOwnerType, type FileVisibility } from '../../models/FileAsset.js'
import { User } from '../../models/User.js'
import { Client } from '../../models/Client.js'
import { Visit } from '../../models/Visit.js'
import { AppError } from '../../utils/errors.js'
import { recordAudit } from '../audit.js'
import type { AuthUser } from '../../middleware/auth.js'
import { isHeadRole } from '../../middleware/auth.js'
import type { IStorageProvider } from './storage.interface.js'
import { CloudinaryStorageProvider } from './cloudinary.provider.js'
import { MockStorageProvider } from './mock.provider.js'
import { validateUploadedFile } from '../../validators/file.js'
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

    case 'GENERAL':
      if (requiredMode === 'WRITE') {
        throw new AppError(403, 'Only Super Admin can manage general workspace assets')
      }
      return
  }
}

export async function uploadFileAsset(
  actor: AuthUser,
  file: Express.Multer.File | undefined,
  ownerType: FileOwnerType,
  ownerId: string,
  visibility: FileVisibility = 'PRIVATE'
): Promise<{ asset: FileAssetDocument; signedUrl: string }> {
  if (!mongoose.isValidObjectId(ownerId)) {
    throw new AppError(422, 'Invalid owner ID')
  }

  // 1. Authorization check
  await verifyEntityAccess(actor, ownerType, ownerId, 'WRITE')

  // 2. Validate MIME type, size, magic bytes, sanitized filename
  const { resourceType, sanitizedName } = validateUploadedFile(file, ownerType)

  // 3. Generate safe unique Cloudinary public ID
  const randomSuffix = Math.random().toString(36).substring(2, 8)
  const folder = `etech_crm/${ownerType.toLowerCase()}/${ownerId}`
  const publicId = `${folder}/${Date.now()}_${randomSuffix}`

  // 4. Upload to storage provider
  const uploadResult = await activeProvider.upload({
    buffer: file!.buffer,
    filename: sanitizedName,
    mimeType: file!.mimetype,
    resourceType,
    folder,
    publicId,
    tags: [ownerType, `user_${actor.id}`, `owner_${ownerId}`],
  })

  let createdAsset: FileAssetDocument | null = null

  try {
    // 5. Persist metadata in MongoDB
    createdAsset = await FileAsset.create({
      originalName: sanitizedName,
      resourceType,
      mimeType: file!.mimetype,
      sizeBytes: file!.size,
      cloudinaryPublicId: uploadResult.publicId,
      cloudinaryResourceType: uploadResult.resourceType,
      secureStorageReference: uploadResult.secureUrl,
      ownerType,
      ownerId: new mongoose.Types.ObjectId(ownerId),
      uploadedBy: new mongoose.Types.ObjectId(actor.id),
      visibility,
      metadata: {
        format: uploadResult.format,
        version: uploadResult.version,
      },
      isArchived: false,
    })

    // 6. Update reference on owner entity
    if (ownerType === 'USER_AVATAR') {
      const signedUrl = await activeProvider.getSignedUrl(createdAsset.cloudinaryPublicId, createdAsset.cloudinaryResourceType, 86400)
      await User.findByIdAndUpdate(ownerId, {
        $set: { avatarAsset: createdAsset._id, avatar: signedUrl },
      })
    } else if (ownerType === 'CLIENT_VISITING_CARD') {
      await Client.findByIdAndUpdate(ownerId, {
        $set: { visitingCardAsset: createdAsset._id },
      })
    } else if (ownerType === 'CLIENT_DOCUMENT') {
      await Client.findByIdAndUpdate(ownerId, {
        $addToSet: { documentAssets: createdAsset._id },
      })
    } else if (ownerType === 'VISIT_PHOTO') {
      await Visit.findByIdAndUpdate(ownerId, {
        $addToSet: { photoAssets: createdAsset._id },
      })
    } else if (ownerType === 'VISIT_ATTACHMENT') {
      await Visit.findByIdAndUpdate(ownerId, {
        $addToSet: { attachmentAssets: createdAsset._id },
      })
    }

    // 7. Audit logging
    await recordAudit(actor.id, 'FILE_UPLOADED', 'FileAsset', String(createdAsset._id), {
      originalName: sanitizedName,
      ownerType,
      ownerId,
      sizeBytes: file!.size,
      mimeType: file!.mimetype,
    })

    const signedUrl = await activeProvider.getSignedUrl(createdAsset.cloudinaryPublicId, createdAsset.cloudinaryResourceType, 3600)
    return { asset: createdAsset, signedUrl }
  } catch (error) {
    // Failure handling: If MongoDB persistence failed after successful storage upload, clean up asset!
    if (!createdAsset) {
      try {
        await activeProvider.delete(uploadResult.publicId, resourceType)
      } catch {
        // Log cleanup failure
      }
    }
    throw error
  }
}

export async function getFileAsset(
  actor: AuthUser,
  fileId: string
): Promise<{ asset: FileAssetDocument; signedUrl: string; isLegacyMock?: boolean }> {
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
  let signedUrl = ''

  if (isLegacyMock && activeProvider instanceof CloudinaryStorageProvider) {
    // Legacy mock asset uploaded before Cloudinary was activated.
    // Cloudinary cannot serve this asset. Return reference with legacy flag.
    signedUrl = asset.secureStorageReference
  } else {
    signedUrl = await activeProvider.getSignedUrl(asset.cloudinaryPublicId, asset.cloudinaryResourceType, 3600)
  }

  await recordAudit(actor.id, 'FILE_ACCESSED', 'FileAsset', fileId, {
    ownerType: asset.ownerType,
    ownerId: String(asset.ownerId),
    isLegacyMock,
  })

  return { asset, signedUrl, isLegacyMock }
}

export async function listFilesForOwner(
  actor: AuthUser,
  ownerType: FileOwnerType,
  ownerId: string
): Promise<Array<{ asset: FileAssetDocument; signedUrl: string; isLegacyMock?: boolean }>> {
  if (!mongoose.isValidObjectId(ownerId)) {
    throw new AppError(422, 'Invalid owner ID')
  }

  await verifyEntityAccess(actor, ownerType, ownerId, 'READ')

  const assets = await FileAsset.find({ ownerType, ownerId, isArchived: false }).sort({ createdAt: -1 })

  const results = await Promise.all(
    assets.map(async (asset) => {
      const isLegacyMock = Boolean(asset.secureStorageReference?.includes('mock-storage.local'))
      let signedUrl = ''
      if (isLegacyMock && activeProvider instanceof CloudinaryStorageProvider) {
        signedUrl = asset.secureStorageReference
      } else {
        signedUrl = await activeProvider.getSignedUrl(asset.cloudinaryPublicId, asset.cloudinaryResourceType, 3600)
      }
      return { asset, signedUrl, isLegacyMock }
    })
  )

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
    // If provider delete fails, we do not swallow silently, but if it was already deleted ('not found'), continue
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('not found')) {
      throw new AppError(502, `Storage provider deletion failed: ${msg}`)
    }
  }

  // Soft deletion in MongoDB
  asset.isArchived = true
  asset.deletedAt = new Date()
  await asset.save()

  // Remove references from owner entity
  if (asset.ownerType === 'USER_AVATAR') {
    await User.findByIdAndUpdate(asset.ownerId, { $unset: { avatarAsset: 1, avatar: 1 } })
  } else if (asset.ownerType === 'CLIENT_VISITING_CARD') {
    await Client.findByIdAndUpdate(asset.ownerId, { $unset: { visitingCardAsset: 1 } })
  } else if (asset.ownerType === 'CLIENT_DOCUMENT') {
    await Client.findByIdAndUpdate(asset.ownerId, { $pull: { documentAssets: asset._id } })
  } else if (asset.ownerType === 'VISIT_PHOTO') {
    await Visit.findByIdAndUpdate(asset.ownerId, { $pull: { photoAssets: asset._id } })
  } else if (asset.ownerType === 'VISIT_ATTACHMENT') {
    await Visit.findByIdAndUpdate(asset.ownerId, { $pull: { attachmentAssets: asset._id } })
  }

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
