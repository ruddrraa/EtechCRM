import { Router } from 'express'
import type { Request } from 'express'
import { requireAuth, requireRoles } from '../middleware/auth.js'
import { validateQuery } from '../middleware/validate.js'
import { success } from '../utils/api.js'
import { exportReport, getReport, getVisitDetails } from '../services/report.js'
import { exportQuerySchema, reportQuerySchema } from '../validators/report.js'
import type { ReportQuery } from '../validators/report.js'

export const reportRouter = Router()
reportRouter.use(requireAuth, requireRoles('SUPER_ADMIN', 'MARKETING_HEAD', 'MARKETING_EXECUTIVE', 'ADMIN', 'USER'))

const query = (req: Request) => reportQuerySchema.parse(req.query) as ReportQuery
reportRouter.get('/overview', validateQuery(reportQuerySchema), async (req, res) => {
  const parsed = query(req)
  const [clients, staff] = await Promise.all([getReport(req.authUser!, parsed, 'client'), getReport(req.authUser!, parsed, 'staff')])
  return success(res, { clients: clients.items, staff: staff.items })
})
reportRouter.get('/clients', validateQuery(reportQuerySchema), async (req, res) => success(res, (await getReport(req.authUser!, query(req), 'client')).items))
reportRouter.get('/staff', validateQuery(reportQuerySchema), async (req, res) => success(res, (await getReport(req.authUser!, query(req), 'staff')).items))
reportRouter.get('/client', validateQuery(reportQuerySchema), async (req, res) => success(res, await getReport(req.authUser!, query(req), 'client')))
reportRouter.get('/staff/records', validateQuery(reportQuerySchema), async (req, res) => success(res, await getReport(req.authUser!, query(req), 'staff')))
reportRouter.get('/client/:clientId', validateQuery(reportQuerySchema), async (req, res) => success(res, await getVisitDetails(req.authUser!, query(req), 'client', String(req.params.clientId))))
reportRouter.get('/staff/:userId', validateQuery(reportQuerySchema), async (req, res) => success(res, await getVisitDetails(req.authUser!, query(req), 'assignedTo', String(req.params.userId))))
reportRouter.get('/export', validateQuery(exportQuerySchema), async (req, res) => {
  const parsed = query(req)
  const view = String(req.query.view) as 'client' | 'staff'
  const format = String(req.query.format) as 'csv' | 'xlsx' | 'pdf'
  const result = await exportReport(req.authUser!, parsed, view, format)
  res.setHeader('Content-Type', result.contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
  return res.send(result.body)
})
