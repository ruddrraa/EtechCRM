import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { handleUpload, handleGetFile, handleViewFile, handleListOwnerFiles, handleDeleteFile, handleStorageDashboard, } from '../controllers/file.js';
export const fileRouter = Router();
// Memory storage for stream upload to Cloudinary without local disk clutter
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 30 * 1024 * 1024, // 30MB maximum hard ceiling
        files: 1,
    },
});
// Rate limit uploads to prevent denial-of-service / Cloudinary resource exhaustion
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 60, // 60 uploads per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { message: 'Too many file uploads. Please try again later.' } },
});
fileRouter.use(requireAuth);
fileRouter.post('/upload', uploadLimiter, upload.single('file'), handleUpload);
fileRouter.get('/storage/dashboard', requireRoles('SUPER_ADMIN'), handleStorageDashboard);
fileRouter.get('/owner/:ownerType/:ownerId', handleListOwnerFiles);
fileRouter.get('/:id/view', handleViewFile);
fileRouter.get('/:id', handleGetFile);
fileRouter.delete('/:id', handleDeleteFile);
