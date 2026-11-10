import type { Request, Response } from 'express'
import { success } from '../utils/api.js'
import { AppError } from '../utils/errors.js'
import {
  uploadFileAsset,
  createSignedUploadIntent,
  registerDirectUpload,
  getFileAsset,
  streamFileAsset,
  listFilesForOwner,
  deleteFileAsset,
  getStorageDashboardStats,
  auditOrCleanOrphans,
} from '../services/storage/storage.service.js'
import type { FileOwnerType, FileVisibility } from '../models/FileAsset.js'
import { fileOwnerTypes } from '../models/FileAsset.js'

export async function handleUpload(req: Request, res: Response) {
  const actor = req.authUser!
  const file = req.file

  if (!file) {
    throw new AppError(400, 'Please select a file to upload')
  }

  const { ownerType, ownerId, visibility } = req.body

  if (!ownerType || !fileOwnerTypes.includes(ownerType as FileOwnerType)) {
    throw new AppError(422, 'Invalid or missing ownerType')
  }

  if (!ownerId || typeof ownerId !== 'string') {
    throw new AppError(422, 'Invalid or missing ownerId')
  }

  const validVisibility: FileVisibility =
    visibility === 'PUBLIC' || visibility === 'AUTHENTICATED' ? visibility : 'PRIVATE'

  const result = await uploadFileAsset(
    actor,
    file,
    ownerType as FileOwnerType,
    ownerId,
    validVisibility
  )

  return success(res, result, 201)
}

export async function handleGetFile(req: Request, res: Response) {
  const actor = req.authUser!
  const fileId = String(req.params.id)

  const result = await getFileAsset(actor, fileId)
  return success(res, result)
}

export async function handleViewFile(req: Request, res: Response) {
  const actor = req.authUser!
  const fileId = String(req.params.id)

  await streamFileAsset(actor, fileId, req, res)
}

export async function handleListOwnerFiles(req: Request, res: Response) {
  const actor = req.authUser!
  const { ownerType, ownerId } = req.params

  if (!ownerType || !fileOwnerTypes.includes(ownerType as FileOwnerType)) {
    throw new AppError(422, 'Invalid ownerType')
  }

  const items = await listFilesForOwner(actor, ownerType as FileOwnerType, String(ownerId))
  return success(res, { items })
}

export async function handleDeleteFile(req: Request, res: Response) {
  const actor = req.authUser!
  const fileId = String(req.params.id)

  const result = await deleteFileAsset(actor, fileId)
  return success(res, result)
}

export async function handleStorageDashboard(req: Request, res: Response) {
  const actor = req.authUser!
  const stats = await getStorageDashboardStats(actor)
  return success(res, stats)
}

export async function handleSignUpload(req: Request, res: Response) {
  const actor = req.authUser!
  const result = await createSignedUploadIntent(actor, req.body)
  return success(res, result)
}

export async function handleRegisterUpload(req: Request, res: Response) {
  const actor = req.authUser!
  const { uploadIntentToken, visibility } = req.body as {
    uploadIntentToken: string
    visibility?: FileVisibility
  }
  const result = await registerDirectUpload(actor, uploadIntentToken, visibility ?? 'PRIVATE')
  return success(res, result, result.idempotent ? 200 : 201)
}

export async function handleListOrphans(req: Request, res: Response) {
  const actor = req.authUser!
  const rawAge = req.query.minAgeHours
  const minAgeHours = rawAge !== undefined ? Number(rawAge) : 24
  if (!Number.isInteger(minAgeHours) || minAgeHours < 1 || minAgeHours > 720) {
    throw new AppError(422, 'minAgeHours must be an integer between 1 and 720')
  }
  const verifyCloud = req.query.verifyCloud === 'true' || req.query.verifyCloud === '1'
  const report = await auditOrCleanOrphans(actor, {
    dryRun: true,
    minAgeHours,
    verifyCloud,
  })
  return success(res, report)
}

export async function handleCleanupOrphans(req: Request, res: Response) {
  const actor = req.authUser!
  const { dryRun, minAgeHours, verifyCloud } = req.body as {
    dryRun: boolean
    minAgeHours: number
    verifyCloud: boolean
  }
  const report = await auditOrCleanOrphans(actor, { dryRun, minAgeHours, verifyCloud })
  return success(res, report)
}

