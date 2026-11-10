import mongoose from 'mongoose'
import type { Request, Response } from 'express'
import {
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  clearAllNotifications,
  deleteNotification,
} from '../services/notification.js'
import { AppError } from '../utils/errors.js'
import {
  getVapidPublicKey,
  saveSubscription,
  deleteSubscription,
} from '../services/push.js'
import { success } from '../utils/api.js'

export async function getNotifications(req: Request, res: Response) {
  return success(res, await listNotifications(req.authUser!.id, Number(req.query.page) || 1, Number(req.query.limit) || 20))
}

export async function readNotification(req: Request, res: Response) {
  const id = String(req.params.id)
  if (!mongoose.isValidObjectId(id)) throw new AppError(422, 'Invalid notification ID')
  const notification = await markNotificationRead(id, req.authUser!.id)
  return success(res, notification ?? { read: false })
}

export async function readAllNotifications(req: Request, res: Response) {
  return success(res, await markAllNotificationsRead(req.authUser!.id))
}

export async function clearNotifications(req: Request, res: Response) {
  return success(res, await clearAllNotifications(req.authUser!.id))
}

export async function removeNotification(req: Request, res: Response) {
  const id = String(req.params.id)
  if (!mongoose.isValidObjectId(id)) throw new AppError(422, 'Invalid notification ID')
  return success(res, await deleteNotification(id, req.authUser!.id))
}

export async function createTestNotification(req: Request, res: Response) {
  const uniqueRef = new Date().toLocaleTimeString('en-IN', { hour12: false })
  const notif = await createNotification({
    recipient: req.authUser!.id,
    title: 'Excel Technologies & Services',
    message: `CRM desktop banner diagnostic check (${uniqueRef}).`,
    type: 'TEST',
  })
  return success(res, notif, 201)
}

export async function getVapidKey(_req: Request, res: Response) {
  const key = getVapidPublicKey()
  return success(res, { vapidPublicKey: key, publicKey: key })
}

export async function subscribePush(req: Request, res: Response) {
  const userAgent = req.header('user-agent')
  const payload = req.body.subscription || req.body
  const subscription = await saveSubscription(req.authUser!.id, payload, userAgent)
  return success(res, { subscribed: true, id: String(subscription._id) }, 201)
}

export async function unsubscribePush(req: Request, res: Response) {
  const result = await deleteSubscription(req.body.endpoint, req.authUser!.id)
  return success(res, result)
}
