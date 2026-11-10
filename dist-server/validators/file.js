import { z } from 'zod';
import { AppError } from '../utils/errors.js';
import { fileOwnerTypes } from '../models/FileAsset.js';
export const fileUploadQuerySchema = z.object({
    ownerType: z.enum(fileOwnerTypes),
    ownerId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid owner ID'),
    visibility: z.enum(['PUBLIC', 'AUTHENTICATED', 'PRIVATE']).default('PRIVATE'),
});
// File size limits in bytes
export const FILE_SIZE_LIMITS = {
    USER_AVATAR: 5 * 1024 * 1024, // 5MB
    CLIENT_VISITING_CARD: 10 * 1024 * 1024, // 10MB
    VISIT_PHOTO: 10 * 1024 * 1024, // 10MB
    CLIENT_DOCUMENT: 25 * 1024 * 1024, // 25MB
    VISIT_ATTACHMENT: 25 * 1024 * 1024, // 25MB
    ORGANIZATION_EXPANDED_LOGO: 5 * 1024 * 1024, // 5MB
    ORGANIZATION_COLLAPSED_LOGO: 5 * 1024 * 1024, // 5MB
    GENERAL: 25 * 1024 * 1024, // 25MB
};
// Allowed MIME types per owner type
const ALLOWED_MIME_TYPES = {
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
};
/**
 * Checks file signature (magic bytes) to prevent extension spoofing.
 */
function verifyMagicBytes(buffer, mimeType) {
    if (buffer.length < 4)
        return false;
    const hex = buffer.subarray(0, 4).toString('hex').toLowerCase();
    switch (mimeType) {
        case 'image/jpeg':
            return hex.startsWith('ffd8ff');
        case 'image/png':
            return hex === '89504e47';
        case 'image/webp':
            return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
        case 'application/pdf':
            return buffer.subarray(0, 4).toString('ascii') === '%PDF';
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
            // Zip header for modern Office XML formats
            return hex === '504b0304' || hex === '504b0506' || hex === '504b0708';
        case 'application/msword':
        case 'application/vnd.ms-excel':
            // Compound Document File header for legacy Office formats
            return hex === 'd0cf11e0';
        default:
            return false;
    }
}
export function validateUploadedFile(file, ownerType) {
    if (!file || !file.buffer) {
        throw new AppError(400, 'No file was uploaded');
    }
    // 1. Size limit
    const maxBytes = FILE_SIZE_LIMITS[ownerType] || 25 * 1024 * 1024;
    if (file.size > maxBytes) {
        const maxMb = Math.round(maxBytes / (1024 * 1024));
        throw new AppError(422, `File size exceeds the allowed limit of ${maxMb}MB for ${ownerType}`);
    }
    // 2. MIME type check
    const allowedMimes = ALLOWED_MIME_TYPES[ownerType];
    if (!allowedMimes.includes(file.mimetype)) {
        throw new AppError(422, `File type "${file.mimetype}" is not permitted for ${ownerType}`);
    }
    // 3. Magic bytes / signature check
    const isSignatureValid = verifyMagicBytes(file.buffer, file.mimetype);
    if (!isSignatureValid) {
        throw new AppError(422, 'File signature does not match the declared MIME type. Executable or corrupted files are rejected.');
    }
    // 4. Filename sanitization (prevent path traversal & command injection)
    const sanitizedName = file.originalname
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\.{2,}/g, '.')
        .trim();
    if (!sanitizedName || sanitizedName.startsWith('.')) {
        throw new AppError(422, 'Invalid file name');
    }
    // 5. Determine Cloudinary resource type
    const isImage = file.mimetype.startsWith('image/');
    const resourceType = isImage ? 'image' : 'raw';
    return { resourceType, sanitizedName };
}
