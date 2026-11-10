import { Router } from 'express'
import mongoose from 'mongoose'
import { AuditEvent } from '../models/AuditEvent.js'
import { User } from '../models/User.js'
import { requireAuth, requireRoles } from '../middleware/auth.js'
import { success } from '../utils/api.js'

export const auditRouter = Router()
auditRouter.use(requireAuth, requireRoles('SUPER_ADMIN', 'MARKETING_HEAD', 'ADMIN'))
auditRouter.get('/', async (req, res) => {
  const actor = req.authUser!
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))

  // Super Admin has org-wide audit visibility; Marketing Head sees only own + current team activity
  let filter: Record<string, unknown> = {}
  if (actor.role !== 'SUPER_ADMIN') {
    const team = await User.find({ reportingTo: actor.id }).select('_id').lean()
    const allowedActors = [new mongoose.Types.ObjectId(actor.id), ...team.map((m) => m._id)]
    filter = { actor: { $in: allowedActors } }
  }

  const [items, total] = await Promise.all([
    AuditEvent.find(filter).populate('actor', 'name role').sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditEvent.countDocuments(filter),
  ])
  return success(res, { items, page, limit, total, pages: Math.ceil(total / limit) })
})

auditRouter.delete('/', requireRoles('SUPER_ADMIN'), async (_req, res) => {
  const result = await AuditEvent.deleteMany({})
  return success(res, { cleared: true, deletedCount: result.deletedCount })
})
