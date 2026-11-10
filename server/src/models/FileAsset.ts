import { Schema, model, type HydratedDocument } from 'mongoose'

export const fileOwnerTypes = [
  'USER_AVATAR',
  'CLIENT_VISITING_CARD',
  'CLIENT_DOCUMENT',
  'VISIT_PHOTO',
  'VISIT_ATTACHMENT',
  'ORGANIZATION_EXPANDED_LOGO',
  'ORGANIZATION_COLLAPSED_LOGO',
  'GENERAL',
] as const

export type FileOwnerType = (typeof fileOwnerTypes)[number]

export const fileVisibilities = ['PUBLIC', 'AUTHENTICATED', 'PRIVATE'] as const
export type FileVisibility = (typeof fileVisibilities)[number]

export interface IFileAsset {
  originalName: string
  resourceType: 'image' | 'raw' | 'video'
  mimeType: string
  sizeBytes: number
  cloudinaryPublicId: string
  cloudinaryResourceType: string
  secureStorageReference: string
  ownerType: FileOwnerType
  ownerId: Schema.Types.ObjectId
  uploadedBy: Schema.Types.ObjectId
  visibility: FileVisibility
  metadata?: Record<string, unknown>
  isArchived: boolean
  deletedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const fileAssetSchema = new Schema<IFileAsset>(
  {
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    resourceType: { type: String, enum: ['image', 'raw', 'video'], required: true },
    mimeType: { type: String, required: true, trim: true },
    sizeBytes: { type: Number, required: true, min: 0 },
    cloudinaryPublicId: { type: String, required: true, trim: true, index: true },
    cloudinaryResourceType: { type: String, required: true, trim: true },
    secureStorageReference: { type: String, required: true, trim: true },
    ownerType: { type: String, enum: fileOwnerTypes, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    visibility: { type: String, enum: fileVisibilities, required: true, default: 'PRIVATE' },
    metadata: { type: Schema.Types.Mixed },
    isArchived: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true, versionKey: false }
)

fileAssetSchema.index({ ownerType: 1, ownerId: 1, isArchived: 1 })
fileAssetSchema.index({ uploadedBy: 1, createdAt: -1 })
fileAssetSchema.index({ ownerType: 1, createdAt: -1 })

export type FileAssetDocument = HydratedDocument<IFileAsset>
export const FileAsset = model<IFileAsset>('FileAsset', fileAssetSchema)

