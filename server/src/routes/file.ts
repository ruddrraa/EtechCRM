import { Router } from 'express'
import multer from 'multer'
import { requireAuth, requireRoles } from '../middleware/auth.js'
import { uploadRateLimiter } from '../middleware/rateLimit.js'
import { validate } from '../middleware/validate.js'
import {
  orphanCleanupSchema,
  registerUploadSchema,
  signUploadSchema,
} from '../validators/file.js'
import {
  handleUpload,
  handleSignUpload,
  handleRegisterUpload,
  handleGetFile,
  handleViewFile,
  handleListOwnerFiles,
  handleDeleteFile,
  handleStorageDashboard,
  handleListOrphans,
  handleCleanupOrphans,
} from '../controllers/file.js'

export const fileRouter = Router()

// Memory storage for legacy direct-to-server fallback / mock tests; production large files use /sign-upload + /register
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 1,
  },
})

fileRouter.use(requireAuth)

fileRouter.post('/sign-upload', uploadRateLimiter, validate(signUploadSchema), handleSignUpload)
fileRouter.post('/register', uploadRateLimiter, validate(registerUploadSchema), handleRegisterUpload)
fileRouter.post('/upload', uploadRateLimiter, upload.single('file'), handleUpload)
fileRouter.get('/storage/dashboard', requireRoles('SUPER_ADMIN'), handleStorageDashboard)
fileRouter.get('/storage/orphans', requireRoles('SUPER_ADMIN'), handleListOrphans)
fileRouter.post('/storage/orphans/cleanup', requireRoles('SUPER_ADMIN'), validate(orphanCleanupSchema), handleCleanupOrphans)
fileRouter.get('/owner/:ownerType/:ownerId', handleListOwnerFiles)
fileRouter.get('/:id/view', handleViewFile)
fileRouter.get('/:id', handleGetFile)
fileRouter.delete('/:id', handleDeleteFile)

