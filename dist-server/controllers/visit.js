import { authorizeException, cancel, checkIn, complete, createAssignedVisit, getVisit, listVisits, markArrived, reschedule, selfAssignVisit } from '../services/visit.js';
import { success } from '../utils/api.js';
import { isExecutiveRole } from '../middleware/auth.js';
export async function getVisits(req, res) {
    return success(res, await listVisits(req.authUser, { page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20, status: typeof req.query.status === 'string' ? req.query.status : undefined, clientId: typeof req.query.clientId === 'string' ? req.query.clientId : undefined }));
}
export async function getVisitById(req, res) { return success(res, await getVisit(String(req.params.id), req.authUser)); }
export async function postVisit(req, res) {
    const visit = isExecutiveRole(req.authUser.role) ? await selfAssignVisit(req.body, req.authUser) : await createAssignedVisit(req.body, req.authUser);
    return success(res, visit, 201);
}
export async function postCheckIn(req, res) { return success(res, await checkIn(String(req.params.id), req.body, req.authUser)); }
export async function postArrived(req, res) { return success(res, await markArrived(String(req.params.id), req.authUser)); }
export async function postComplete(req, res) { return success(res, await complete(String(req.params.id), { ...req.body, location: req.body.location }, req.authUser)); }
export async function postCancel(req, res) { return success(res, await cancel(String(req.params.id), req.body.reason, req.authUser)); }
export async function postReschedule(req, res) { return success(res, await reschedule(String(req.params.id), req.body.plannedDate, req.authUser)); }
export async function postAuthorizeException(req, res) {
    return success(res, await authorizeException(String(req.params.id), req.body.reason, req.authUser));
}
