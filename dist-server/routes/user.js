import { Router } from 'express';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { archiveUser, listUsers, reassignExecutive, updateOwnProfile, updateUserStatus } from '../controllers/user.js';
import { success } from '../utils/api.js';
import { User } from '../models/User.js';
import { validate } from '../middleware/validate.js';
import { profileSchema, statusSchema } from '../validators/auth.js';
export const userRouter = Router();
userRouter.use(requireAuth);
userRouter.get('/', requireRoles('SUPER_ADMIN', 'MARKETING_HEAD', 'ADMIN'), listUsers);
userRouter.get('/me', async (req, res) => {
    const user = await User.findById(req.authUser.id)
        .select('name email phone role avatar avatarAsset isActive notificationPreferences createdAt updatedAt')
        .lean();
    if (user) {
        if (user.avatarAsset) {
            user.avatar = `/api/files/${user.avatarAsset}/view`;
        }
    }
    return success(res, user);
});
userRouter.patch('/me/preferences', async (req, res) => {
    const allowed = ['dailyProductivity', 'newEventCreated', 'mobilePush', 'desktopAlerts', 'emailSummary'];
    const updates = {};
    for (const key of allowed) {
        if (typeof req.body[key] === 'boolean') {
            updates[`notificationPreferences.${key}`] = req.body[key];
        }
    }
    const user = await User.findByIdAndUpdate(req.authUser.id, { $set: updates }, { new: true }).select('notificationPreferences').lean();
    return success(res, user?.notificationPreferences);
});
userRouter.patch('/me', validate(profileSchema), updateOwnProfile);
userRouter.patch('/:id/status', requireRoles('SUPER_ADMIN', 'MARKETING_HEAD', 'ADMIN'), validate(statusSchema), updateUserStatus);
userRouter.patch('/:id/reporting', requireRoles('SUPER_ADMIN'), reassignExecutive);
userRouter.delete('/:id', requireRoles('SUPER_ADMIN', 'MARKETING_HEAD', 'ADMIN'), archiveUser);
