import { getOrganizationConfig, updateOrganizationConfig } from '../services/organization.js';
import { success } from '../utils/api.js';
export async function getOrganization(_req, res) {
    const org = await getOrganizationConfig();
    return success(res, org);
}
export async function patchOrganization(req, res) {
    const actor = req.authUser;
    const updated = await updateOrganizationConfig(actor.id, req.body);
    return success(res, updated);
}
