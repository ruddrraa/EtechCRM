import { Router } from 'express';
import { getOrganization, patchOrganization } from '../controllers/organization.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { updateOrganizationSchema } from '../validators/organization.js';
export const organizationRouter = Router();
organizationRouter.use(requireAuth);
// Any authenticated CRM user can read organization info (name, branding)
organizationRouter.get('/', getOrganization);
// Only Super Admin can update organization settings
organizationRouter.patch('/', requireRoles('SUPER_ADMIN'), validate(updateOrganizationSchema), patchOrganization);
