import { Router } from 'express'
import {
  handleDailyFollowUpsCron,
  handleListCronRuns,
  requireCronSecret,
} from '../controllers/cron.js'
import { requireAuth, requireRoles } from '../middleware/auth.js'

export const cronRouter = Router()

cronRouter.get('/runs', requireAuth, requireRoles('SUPER_ADMIN'), handleListCronRuns)
cronRouter.get('/follow-ups', requireCronSecret, handleDailyFollowUpsCron)
cronRouter.post('/follow-ups', requireCronSecret, handleDailyFollowUpsCron)

