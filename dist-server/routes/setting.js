import { Router } from 'express';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getGeofenceSetting, patchGeofenceSetting } from '../controllers/setting.js';
import { geofenceSettingSchema } from '../validators/setting.js';
export const settingRouter = Router();
settingRouter.use(requireAuth);
settingRouter.get('/geofence', getGeofenceSetting);
settingRouter.patch('/geofence', requireRoles('SUPER_ADMIN'), validate(geofenceSettingSchema), patchGeofenceSetting);
