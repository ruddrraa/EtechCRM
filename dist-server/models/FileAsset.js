import { Schema, model } from 'mongoose';
export const fileOwnerTypes = [
    'USER_AVATAR',
    'CLIENT_VISITING_CARD',
    'CLIENT_DOCUMENT',
    'VISIT_PHOTO',
    'VISIT_ATTACHMENT',
    'GENERAL',
];
export const fileVisibilities = ['PUBLIC', 'AUTHENTICATED', 'PRIVATE'];
const fileAssetSchema = new Schema({
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    resourceType: { type: String, enum: ['image', 'raw', 'video'], required: true },
    mimeType: { type: String, required: true, trim: true },
    sizeBytes: { type: Number, required: true, min: 0 },
    cloudinaryPublicId: { type: String, required: true, trim: true, index: true },
    cloudinaryResourceType: { type: String, required: true, trim: true },
    secureStorageReference: { type: String, required: true, trim: true },
    ownerType: { type: String, enum: fileOwnerTypes, required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    visibility: { type: String, enum: fileVisibilities, required: true, default: 'PRIVATE' },
    metadata: { type: Schema.Types.Mixed },
    isArchived: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
}, { timestamps: true, versionKey: false });
fileAssetSchema.index({ ownerType: 1, ownerId: 1, isArchived: 1 });
fileAssetSchema.index({ uploadedBy: 1, createdAt: -1 });
fileAssetSchema.index({ ownerType: 1, createdAt: -1 });
export const FileAsset = model('FileAsset', fileAssetSchema);
