import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { success } from '../utils/api.js';
import { getDashboardSummary } from '../services/dashboard.js';
import { dashboardQuerySchema } from '../validators/dashboard.js';
export const dashboardRouter = Router();
dashboardRouter.get('/', requireAuth, validateQuery(dashboardQuerySchema), async (req, res) => success(res, await getDashboardSummary(req.authUser, req.query)));
