import type { Request, Response } from 'express'
import { success } from '../utils/api.js'
import {
  cancelFollowUpTask,
  completeFollowUpTask,
  listFollowUpTasks,
} from '../services/followupTask.js'
import { listFollowUpsQuerySchema } from '../validators/followup.js'

export async function getFollowUps(req: Request, res: Response) {
  const query = listFollowUpsQuerySchema.parse(req.query)
  const result = await listFollowUpTasks(req.authUser!, query)
  return success(res, result)
}

export async function postCompleteFollowUp(req: Request, res: Response) {
  const task = await completeFollowUpTask(String(req.params.id), req.body.notes, req.authUser!)
  return success(res, task)
}

export async function postCancelFollowUp(req: Request, res: Response) {
  const task = await cancelFollowUpTask(String(req.params.id), req.body.reason, req.authUser!)
  return success(res, task)
}

