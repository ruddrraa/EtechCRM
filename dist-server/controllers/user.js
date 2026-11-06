import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';
import { recordAudit } from '../services/audit.js';
import { success } from '../utils/api.js';
import { isExecutiveRole, isHeadRole } from '../middleware/auth.js';
import mongoose from 'mongoose';
const safeFields = 'name email phone role designation reportingTo avatar isActive isArchived createdAt updatedAt';
export async function listUsers(req, res) {
    const actor = req.authUser;
    const role = typeof req.query.role === 'string' ? req.query.role : undefined;
    const activeOnly = req.query.activeOnly === 'true';
    if (!['SUPER_ADMIN', 'MARKETING_HEAD', 'ADMIN'].includes(actor.role))
        throw new AppError(403, 'You do not have permission to list staff');
    const team = actor.role === 'MARKETING_HEAD' ? { reportingTo: actor.id, role: { $in: ['MARKETING_EXECUTIVE', 'USER'] } } : {};
    const users = await User.find({ isArchived: { $ne: true }, ...(activeOnly ? { isActive: true } : {}), ...(role ? { role: role === 'MARKETING_EXECUTIVE' ? { $in: ['MARKETING_EXECUTIVE', 'USER'] } : role } : {}), ...team }).select(safeFields).populate('reportingTo', 'name designation').sort({ name: 1 }).lean();
    return success(res, users);
}
export async function updateOwnProfile(req, res) {
    const allowed = { name: req.body.name, phone: req.body.phone, avatar: req.body.avatar };
    const user = await User.findByIdAndUpdate(req.authUser.id, { $set: allowed }, { new: true, runValidators: true }).select(safeFields).lean();
    return success(res, user);
}
export async function updateUserStatus(req, res) {
    const actor = req.authUser;
    const target = await User.findById(String(req.params.id));
    if (!target)
        throw new AppError(404, 'User not found');
    if (String(target._id) === actor.id)
        throw new AppError(400, 'You cannot deactivate your own account');
    if (!isHeadRole(actor.role) && actor.role !== 'SUPER_ADMIN')
        throw new AppError(403, 'You do not have permission to manage this account');
    if (target.role === 'SUPER_ADMIN' || (actor.role === 'MARKETING_HEAD' && !isExecutiveRole(target.role)))
        throw new AppError(403, 'You do not have permission to manage this account');
    if (actor.role === 'MARKETING_HEAD' && String(target.reportingTo ?? '') !== actor.id)
        throw new AppError(403, 'You can only manage your own team');
    if (target.role === 'MARKETING_HEAD' && req.body.isActive === false && await User.exists({ reportingTo: target._id, isActive: true, isArchived: { $ne: true } }))
        throw new AppError(409, 'Reassign active executives before deactivating this Marketing Head');
    target.isActive = req.body.isActive;
    await target.save();
    await recordAudit(actor.id, req.body.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'User', String(target._id));
    return success(res, await User.findById(target._id).select(safeFields).lean());
}
export async function archiveUser(req, res) {
    const actor = req.authUser;
    const target = await User.findById(String(req.params.id));
    if (!target)
        throw new AppError(404, 'User not found');
    if (String(target._id) === actor.id || target.role === 'SUPER_ADMIN' || (actor.role === 'MARKETING_HEAD' && (!isExecutiveRole(target.role) || String(target.reportingTo ?? '') !== actor.id))) {
        throw new AppError(403, 'You do not have permission to archive this account');
    }
    if (target.isActive)
        throw new AppError(409, 'Deactivate the account before archiving it');
    if (target.role === 'MARKETING_HEAD' && await User.exists({ reportingTo: target._id, isActive: true, isArchived: { $ne: true } }))
        throw new AppError(409, 'Reassign active executives before archiving this Marketing Head');
    target.isArchived = true;
    await target.save();
    await recordAudit(actor.id, 'USER_ARCHIVED', 'User', String(target._id));
    return success(res, { archived: true, userId: String(target._id) });
}
export async function reassignExecutive(req, res) {
    const actor = req.authUser;
    if (actor.role !== 'SUPER_ADMIN')
        throw new AppError(403, 'Only Super Admin can reassign executives');
    if (!mongoose.isValidObjectId(String(req.params.id)) || !mongoose.isValidObjectId(String(req.body.reportingTo)))
        throw new AppError(422, 'A valid executive and Marketing Head are required');
    const [target, manager] = await Promise.all([
        User.findOne({ _id: req.params.id, role: { $in: ['MARKETING_EXECUTIVE', 'USER'] }, isArchived: { $ne: true } }),
        User.findOne({ _id: req.body.reportingTo, role: { $in: ['MARKETING_HEAD', 'ADMIN'] }, isActive: true, isArchived: { $ne: true } }),
    ]);
    if (!target || !manager)
        throw new AppError(404, 'Executive or active Marketing Head not found');
    const previousReportingTo = target.reportingTo ? String(target.reportingTo) : null;
    target.reportingTo = manager._id;
    await target.save();
    await recordAudit(actor.id, 'USER_REASSIGNED', 'User', String(target._id), { previousReportingTo, reportingTo: String(manager._id) });
    return success(res, await User.findById(target._id).select(safeFields).populate('reportingTo', 'name designation').lean());
}
