import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { success } from '../utils/api.js'
import { getDashboardSummary } from '../services/dashboard.js'

export const dashboardRouter = Router()
dashboardRouter.get('/', requireAuth, async (req, res) => success(res, await getDashboardSummary(req.authUser!)))
