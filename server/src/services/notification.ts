import { Notification, type NotificationType } from '../models/Notification.js'
import { sendPushToUserDetailed, type PushDeliverySummary } from './push.js'

export interface CreateNotificationInput {
  recipient: string
  title: string
  message: string
  type: NotificationType
  entityType?: 'Visit' | 'Client'
  entityId?: string
  deliveryKey?: string
}

export async function createIdempotentNotification(input: CreateNotificationInput): Promise<{
  notification: NonNullable<Awaited<ReturnType<typeof Notification.findById>>>
  deduplicated: boolean
  pushResult: PushDeliverySummary
}> {
  let notif
  let deduplicated = false

  try {
    notif = await Notification.create(input)
  } catch (err: unknown) {
    const mongoErr = err as { code?: number }
    if (input.deliveryKey && mongoErr?.code === 11000) {
      const existing = await Notification.findOne({ deliveryKey: input.deliveryKey })
      if (existing) {
        deduplicated = true
        return {
          notification: existing,
          deduplicated: true,
          pushResult: {
            sent: 0,
            failed: 0,
            removedExpired: 0,
            retried: 0,
            timedOut: 0,
            skippedReason: 'DUPLICATE_DELIVERY_KEY',
          },
        }
      }
    }
    throw err
  }

  let pushResult: PushDeliverySummary = {
    sent: 0,
    failed: 0,
    removedExpired: 0,
    retried: 0,
    timedOut: 0,
  }

  try {
    pushResult = await sendPushToUserDetailed(
      input.recipient,
      {
        title: input.title,
        body: input.message,
        url: input.entityType === 'Visit' ? '/visits' : input.entityType === 'Client' ? '/clients' : '/',
        tag: `crm-notif-${String(notif._id)}`,
        notificationId: String(notif._id),
      },
      { notificationType: input.type }
    )
  } catch (err) {
    console.warn('[Notification] Push dispatch failed safely:', err instanceof Error ? err.message : 'Unknown error')
    pushResult = { sent: 0, failed: 1, removedExpired: 0, retried: 0, timedOut: 0 }
  }

  return { notification: notif, deduplicated, pushResult }
}

export async function createNotification(input: CreateNotificationInput) {
  const { notification } = await createIdempotentNotification(input)
  return notification
}

export async function listNotifications(recipient: string, page = 1, limit = 20) {
  const safePage = Math.max(1, page)
  const safeLimit = Math.min(50, Math.max(1, limit))
  const filter = { recipient }
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...filter, readAt: { $exists: false } }),
  ])
  return { items, total, unread, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) }
}

export async function markNotificationRead(id: string, recipient: string) {
  return Notification.findOneAndUpdate({ _id: id, recipient }, { $set: { readAt: new Date() } }, { new: true }).lean()
}

export async function markAllNotificationsRead(recipient: string) {
  const result = await Notification.updateMany({ recipient, readAt: { $exists: false } }, { $set: { readAt: new Date() } })
  return { updated: result.modifiedCount }
}

export async function clearAllNotifications(recipient: string) {
  const result = await Notification.deleteMany({ recipient })
  return { deleted: result.deletedCount }
}

export async function deleteNotification(id: string, recipient: string) {
  const result = await Notification.deleteOne({ _id: id, recipient })
  return { deleted: result.deletedCount > 0 }
}
