import { Router } from 'express'
import { login, logout, logoutAll, me, createUser, bootstrap, changePassword } from '../controllers/auth.js'
import { requireAuth, requireRoles } from '../middleware/auth.js'
import { loginAccountLimiter, loginIpLimiter, passwordSessionLimiter } from '../middleware/rateLimit.js'
import { validate } from '../middleware/validate.js'
import { loginSchema, registerUserSchema, bootstrapSchema, passwordSchema } from '../validators/auth.js'

export const authRouter = Router()
authRouter.post('/login', loginIpLimiter, validate(loginSchema), loginAccountLimiter, login)
authRouter.post('/bootstrap', loginIpLimiter, validate(bootstrapSchema), bootstrap)
authRouter.post('/logout', requireAuth, logout)
authRouter.post('/logout-all', requireAuth, passwordSessionLimiter, logoutAll)
authRouter.post('/change-password', requireAuth, passwordSessionLimiter, validate(passwordSchema), changePassword)
authRouter.get('/me', requireAuth, me)
authRouter.post('/users', requireAuth, requireRoles('SUPER_ADMIN', 'MARKETING_HEAD', 'ADMIN'), validate(registerUserSchema), createUser)
