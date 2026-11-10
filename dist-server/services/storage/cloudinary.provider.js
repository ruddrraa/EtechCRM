import { v2 as cloudinary } from 'cloudinary';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
export class CloudinaryStorageProvider {
    name = 'Cloudinary';
    constructor() {
        if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
            cloudinary.config({
                cloud_name: env.CLOUDINARY_CLOUD_NAME,
                api_key: env.CLOUDINARY_API_KEY,
                api_secret: env.CLOUDINARY_API_SECRET,
                secure: true,
            });
        }
    }
    ensureConfigured() {
        if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
            throw new AppError(503, 'Cloudinary storage provider is not configured. Set CLOUDINARY_* environment variables.');
        }
    }
    async ping() {
        this.ensureConfigured();
        try {
            const res = await cloudinary.api.ping();
            return res;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new AppError(503, `Cloudinary ping failed: ${msg}`);
        }
    }
    async upload(options) {
        this.ensureConfigured();
        return new Promise((resolve, reject) => {
            const uploadOptions = {
                resource_type: options.resourceType,
                public_id: options.publicId,
                tags: options.tags,
                type: 'authenticated', // Private authenticated asset delivery by default
            };
            if (!options.publicId && options.folder) {
                uploadOptions.folder = options.folder;
            }
            const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
                if (error || !result) {
                    return reject(new AppError(502, `Cloudinary upload failed: ${error?.message || 'Unknown error'}`));
                }
                resolve({
                    publicId: result.public_id,
                    secureUrl: result.secure_url,
                    resourceType: result.resource_type,
                    format: result.format,
                    bytes: result.bytes,
                    version: result.version,
                });
            });
            stream.end(options.buffer);
        });
    }
    async delete(publicId, resourceType = 'image') {
        this.ensureConfigured();
        try {
            const res = await cloudinary.uploader.destroy(publicId, {
                resource_type: resourceType,
                type: 'authenticated',
                invalidate: true,
            });
            const isOk = res.result === 'ok' || res.result === 'not found';
            return { success: isOk, result: res.result };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new AppError(502, `Cloudinary asset deletion failed: ${msg}`);
        }
    }
    async getSignedUrl(publicId, resourceType = 'image', expiresInSeconds = 3600) {
        this.ensureConfigured();
        const url = cloudinary.url(publicId, {
            resource_type: resourceType,
            type: 'authenticated',
            sign_url: true,
            secure: true,
            expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
        });
        return url;
    }
}
