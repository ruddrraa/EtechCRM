import type { Request, Response } from 'express'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notification.js'
import { success } from '../utils/api.js'

export async function getNotifications(req: Request, res: Response) {
  return success(res, await listNotifications(req.authUser!.id, Number(req.query.page) || 1, Number(req.query.limit) || 20))
}

export async function readNotification(req: Request, res: Response) {
  const notification = await markNotificationRead(String(req.params.id), req.authUser!.id)
  return success(res, notification ?? { read: false })
}

export async function readAllNotifications(req: Request, res: Response) {
  return success(res, await markAllNotificationsRead(req.authUser!.id))
}
