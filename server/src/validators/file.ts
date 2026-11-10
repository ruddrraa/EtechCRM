import { z } from 'zod'
import { AppError } from '../utils/errors.js'
import { fileOwnerTypes, type FileOwnerType } from '../models/FileAsset.js'

export const fileUploadQuerySchema = z.object({
  ownerType: z.enum(fileOwnerTypes),
  ownerId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid owner ID'),
  visibility: z.enum(['PUBLIC', 'AUTHENTICATED', 'PRIVATE']).default('PRIVATE'),
})

export const signUploadSchema = z.object({
  ownerType: z.enum(fileOwnerTypes),
  ownerId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid owner ID'),
  originalName: z.string().trim().min(1, 'File name is required').max(255),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.coerce.number().int().min(1, 'File cannot be empty'),
  headerHex: z.string().regex(/^[a-f\d]{8,64}$/i, 'Valid file signature header is required'),
})

export const registerUploadSchema = z.object({
  uploadIntentToken: z.string().min(20, 'Valid upload intent token is required'),
  visibility: z.enum(['PUBLIC', 'AUTHENTICATED', 'PRIVATE']).default('PRIVATE'),
})

export const orphanCleanupSchema = z.object({
  dryRun: z.boolean().default(true),
  minAgeHours: z.coerce.number().int().min(1).max(720).default(24),
  verifyCloud: z.boolean().default(false),
})

// File size limits in bytes
export const FILE_SIZE_LIMITS: Record<FileOwnerType, number> = {
  USER_AVATAR: 5 * 1024 * 1024, // 5MB
  CLIENT_VISITING_CARD: 10 * 1024 * 1024, // 10MB
  VISIT_PHOTO: 10 * 1024 * 1024, // 10MB
  CLIENT_DOCUMENT: 25 * 1024 * 1024, // 25MB
  VISIT_ATTACHMENT: 25 * 1024 * 1024, // 25MB
  ORGANIZATION_EXPANDED_LOGO: 5 * 1024 * 1024, // 5MB
  ORGANIZATION_COLLAPSED_LOGO: 5 * 1024 * 1024, // 5MB
  GENERAL: 25 * 1024 * 1024, // 25MB
}

// Allowed MIME types per owner type
export const ALLOWED_MIME_TYPES: Record<FileOwnerType, string[]> = {
  USER_AVATAR: ['image/jpeg', 'image/png', 'image/webp'],
  VISIT_PHOTO: ['image/jpeg', 'image/png', 'image/webp'],
  ORGANIZATION_EXPANDED_LOGO: ['image/jpeg', 'image/png', 'image/webp'],
  ORGANIZATION_COLLAPSED_LOGO: ['image/jpeg', 'image/png', 'image/webp'],
  CLIENT_VISITING_CARD: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  CLIENT_DOCUMENT: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  VISIT_ATTACHMENT: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  GENERAL: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
}

// Allowed Cloudinary formats per MIME type for server-side registration verification
export const ALLOWED_FORMATS_FOR_MIME: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
}

/**
 * Checks file signature (magic bytes) to prevent extension spoofing.
 */
export function verifyMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false
  const hex = buffer.subarray(0, 4).toString('hex').toLowerCase()

  switch (mimeType) {
    case 'image/jpeg':
      return hex.startsWith('ffd8ff')
    case 'image/png':
      return hex === '89504e47'
    case 'image/webp':
      return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    case 'application/pdf':
      return buffer.subarray(0, 4).toString('ascii') === '%PDF'
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      // Zip header for modern Office XML formats
      return hex === '504b0304' || hex === '504b0506' || hex === '504b0708'
    case 'application/msword':
    case 'application/vnd.ms-excel':
      // Compound Document File header for legacy Office formats
      return hex === 'd0cf11e0'
    default:
      return false
  }
}

export function sanitizeFileName(rawName: string): string {
  const sanitizedName = rawName
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim()

  if (!sanitizedName || sanitizedName.startsWith('.')) {
    throw new AppError(422, 'Invalid file name')
  }
  return sanitizedName
}

export function validateFileDescriptor(input: {
  ownerType: FileOwnerType
  originalName: string
  mimeType: string
  sizeBytes: number
  headerBuffer: Buffer
}): { resourceType: 'image' | 'raw'; sanitizedName: string } {
  const maxBytes = FILE_SIZE_LIMITS[input.ownerType] || 25 * 1024 * 1024
  if (input.sizeBytes <= 0) {
    throw new AppError(422, 'File cannot be empty')
  }
  if (input.sizeBytes > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024))
    throw new AppError(422, `File size exceeds the allowed limit of ${maxMb}MB for ${input.ownerType}`)
  }

  const allowedMimes = ALLOWED_MIME_TYPES[input.ownerType]
  if (!allowedMimes.includes(input.mimeType)) {
    throw new AppError(422, `File type "${input.mimeType}" is not permitted for ${input.ownerType}`)
  }

  if (!verifyMagicBytes(input.headerBuffer, input.mimeType)) {
    throw new AppError(422, 'File signature does not match the declared MIME type. Executable or corrupted files are rejected.')
  }

  const sanitizedName = sanitizeFileName(input.originalName)
  const resourceType: 'image' | 'raw' = input.mimeType.startsWith('image/') ? 'image' : 'raw'
  return { resourceType, sanitizedName }
}

export function validateUploadedFile(
  file: Express.Multer.File | undefined,
  ownerType: FileOwnerType
): { resourceType: 'image' | 'raw'; sanitizedName: string } {
  if (!file || !file.buffer) {
    throw new AppError(400, 'No file was uploaded')
  }

  return validateFileDescriptor({
    ownerType,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    headerBuffer: file.buffer,
  })
}
