import { Router } from 'express';
import { AuditEvent } from '../models/AuditEvent.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { success } from '../utils/api.js';
export const auditRouter = Router();
auditRouter.use(requireAuth, requireRoles('SUPER_ADMIN', 'MARKETING_HEAD', 'ADMIN'));
auditRouter.get('/', async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const [items, total] = await Promise.all([AuditEvent.find().populate('actor', 'name role').sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditEvent.countDocuments()]);
    return success(res, { items, page, limit, total, pages: Math.ceil(total / limit) });
});
