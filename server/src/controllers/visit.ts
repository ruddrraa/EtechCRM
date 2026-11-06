import type { Request, Response } from 'express'
import { cancel, checkIn, complete, createAssignedVisit, getVisit, listVisits, markArrived, reschedule, selfAssignVisit } from '../services/visit.js'
import { success } from '../utils/api.js'
import { isExecutiveRole } from '../middleware/auth.js'

export async function getVisits(req: Request, res: Response) {
  return success(res, await listVisits(req.authUser!, { page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20, status: typeof req.query.status === 'string' ? req.query.status : undefined, clientId: typeof req.query.clientId === 'string' ? req.query.clientId : undefined }))
}
export async function getVisitById(req: Request, res: Response) { return success(res, await getVisit(String(req.params.id), req.authUser!)) }
export async function postVisit(req: Request, res: Response) {
  const visit = isExecutiveRole(req.authUser!.role) ? await selfAssignVisit(req.body, req.authUser!) : await createAssignedVisit(req.body, req.authUser!)
  return success(res, visit, 201)
}
export async function postCheckIn(req: Request, res: Response) { return success(res, await checkIn(String(req.params.id), req.body, req.authUser!)) }
export async function postArrived(req: Request, res: Response) { return success(res, await markArrived(String(req.params.id), req.authUser!)) }
export async function postComplete(req: Request, res: Response) { return success(res, await complete(String(req.params.id), { ...req.body, location: req.body.location }, req.authUser!)) }
export async function postCancel(req: Request, res: Response) { return success(res, await cancel(String(req.params.id), req.body.reason, req.authUser!)) }
export async function postReschedule(req: Request, res: Response) { return success(res, await reschedule(String(req.params.id), req.body.plannedDate, req.authUser!)) }
