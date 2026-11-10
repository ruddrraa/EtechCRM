import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { isAllowedOrigin, requireSameOrigin } from './middleware/auth.js'
import { errorHandler } from './middleware/error.js'
import { requestContextMiddleware } from './middleware/requestContext.js'
import { sanitizeRequestInputs } from './middleware/validate.js'
import { handleHealthCheck } from './controllers/health.js'
import { authRouter } from './routes/auth.js'
import { clientRouter } from './routes/client.js'
import { visitRouter } from './routes/visit.js'
import { reportRouter } from './routes/report.js'
import { auditRouter } from './routes/audit.js'
import { dashboardRouter } from './routes/dashboard.js'
import { userRouter } from './routes/user.js'
import { notificationRouter } from './routes/notification.js'
import { categoryRouter } from './routes/category.js'
import { mapsRouter } from './routes/maps.js'
import { settingRouter } from './routes/setting.js'
import { fileRouter } from './routes/file.js'
import { organizationRouter } from './routes/organization.js'
import { cronRouter } from './routes/cron.js'
import { followUpRouter } from './routes/followup.js'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.use(requestContextMiddleware)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    })
  )
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)), credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use(sanitizeRequestInputs)
  app.use('/api', (_req, res, next) => {
    if (!res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    }
    next()
  })
  app.use(requireSameOrigin)
  app.use('/api/auth', authRouter)
  app.use('/api/clients', clientRouter)
  app.use('/api/visits', visitRouter)
  app.use('/api/reports', reportRouter)
  app.use('/api/audit-logs', auditRouter)
  app.use('/api/dashboard', dashboardRouter)
  app.use('/api/users', userRouter)
  app.use('/api/notifications', notificationRouter)
  app.use('/api/categories', categoryRouter)
  app.use('/api/maps', mapsRouter)
  app.use('/api/settings', settingRouter)
  app.use('/api/files', fileRouter)
  app.use('/api/organization', organizationRouter)
  app.use('/api/follow-ups', followUpRouter)
  app.use('/api/cron', cronRouter)
  app.get('/api/health', handleHealthCheck)
  app.use(errorHandler)
  return app
}
