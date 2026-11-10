import mongoose from 'mongoose'
import { setVapidDetails, sendNotification, type RequestOptions } from 'web-push'
import { PushSubscription, type PushSubscriptionDocument } from '../models/PushSubscription.js'
import { Notification, type NotificationType } from '../models/Notification.js'
import { User } from '../models/User.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/errors.js'

export const PUSH_REQUEST_TIMEOUT_MS = 3000
export const PUSH_MAX_RETRIES = 1
export const PUSH_RETRY_DELAY_MS = 150
export const MAX_SUBSCRIPTIONS_PER_USER = 10

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
  notificationId?: string
}

export interface PushDeliverySummary {
  sent: number
  failed: number
  removedExpired: number
  retried: number
  timedOut: number
  skippedReason?: string
}

export type PushSender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options?: RequestOptions
) => Promise<unknown>

let isVapidConfigured = false

if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  try {
    setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
    isVapidConfigured = true
    console.log(`[WebPush] VAPID configured: true (Subject: ${env.VAPID_SUBJECT})`)
  } catch (err) {
    console.warn(`[WebPush] VAPID configured: false (Initialization failed: ${(err as Error).message})`)
  }
} else {
  console.log('[WebPush] VAPID configured: false (Keys not provided in environment)')
}

let activePushSender: PushSender = (sub, payload, options) => sendNotification(sub, payload, options)
let testVapidOverride: boolean | null = null

export function setPushTransportForTest(sender: PushSender | null, readyOverride: boolean | null = null): void {
  activePushSender = sender ?? ((sub, payload, options) => sendNotification(sub, payload, options))
  testVapidOverride = readyOverride
}

export function isVapidReady(): boolean {
  return testVapidOverride ?? isVapidConfigured
}

export function getVapidPublicKey(): string {
  return env.VAPID_PUBLIC_KEY || ''
}

export async function saveSubscription(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string
): Promise<PushSubscriptionDocument> {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new AppError(422, 'Invalid push subscription payload')
  }

  const existing = await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      $set: {
        user: userId,
        keys: subscription.keys,
        userAgent,
        updatedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  )

  return existing
}

export async function deleteSubscription(endpoint: string, userId: string): Promise<{ deleted: boolean }> {
  const result = await PushSubscription.deleteOne({ endpoint, user: userId })
  return { deleted: result.deletedCount > 0 }
}

function getPushErrorStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const record = err as { statusCode?: number; status?: number }
  return typeof record.statusCode === 'number' ? record.statusCode : record.status
}

function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const record = err as { code?: string; name?: string; message?: string }
  const msg = (record.message || '').toLowerCase()
  return (
    record.code === 'ETIMEDOUT' ||
    record.code === 'ESOCKETTIMEDOUT' ||
    record.name === 'TimeoutError' ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  )
}

function isRetryablePushError(err: unknown): boolean {
  const status = getPushErrorStatusCode(err)
  if (typeof status === 'number') {
    if (status === 410 || status === 404 || status === 400 || status === 401 || status === 403 || status === 413) {
      return false
    }
    return status === 408 || status === 429 || status >= 500
  }
  if (isTimeoutError(err)) return true
  const code = (err as { code?: string })?.code
  return code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN'
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutErr = new Error(`Web push request exceeded ${timeoutMs}ms timeout`)
      timeoutErr.name = 'TimeoutError'
      reject(timeoutErr)
    }, timeoutMs)

    promise.then(
      (val) => {
        clearTimeout(timer)
        resolve(val)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

async function deliverSingleSubscription(
  sub: { _id: unknown; endpoint: string; keys: { p256dh: string; auth: string } },
  jsonPayload: string,
  timeoutMs: number,
  maxRetries: number,
  retryDelayMs: number
): Promise<{ ok: boolean; expiredRemoved: boolean; retriedCount: number; timedOut: boolean }> {
  let retriedCount = 0
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      retriedCount += 1
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }

    try {
      await withTimeout(
        activePushSender(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
            },
          },
          jsonPayload,
          { timeout: timeoutMs, TTL: 3600 }
        ),
        timeoutMs
      )
      return { ok: true, expiredRemoved: false, retriedCount, timedOut: false }
    } catch (err) {
      lastError = err
      const status = getPushErrorStatusCode(err)
      if (status === 410 || status === 404) {
        await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {})
        return { ok: false, expiredRemoved: true, retriedCount, timedOut: false }
      }
      if (!isRetryablePushError(err) || attempt >= maxRetries) {
        return {
          ok: false,
          expiredRemoved: false,
          retriedCount,
          timedOut: isTimeoutError(lastError),
        }
      }
    }
  }

  return {
    ok: false,
    expiredRemoved: false,
    retriedCount,
    timedOut: isTimeoutError(lastError),
  }
}

async function persistNotificationPushOutcome(
  notificationId: string | undefined,
  summary: PushDeliverySummary
): Promise<void> {
  if (!notificationId || !mongoose.isValidObjectId(notificationId)) return
  let pushStatus: 'SENT' | 'PARTIAL' | 'SKIPPED' | 'FAILED' = 'SKIPPED'
  if (summary.skippedReason) {
    pushStatus = 'SKIPPED'
  } else if (summary.sent > 0 && summary.failed === 0) {
    pushStatus = 'SENT'
  } else if (summary.sent > 0 && summary.failed > 0) {
    pushStatus = 'PARTIAL'
  } else if (summary.failed > 0) {
    pushStatus = 'FAILED'
  }

  await Notification.updateOne(
    { _id: notificationId },
    {
      $set: {
        pushStatus,
        pushAttemptedAt: new Date(),
        pushStats: {
          sent: summary.sent,
          failed: summary.failed,
          removedExpired: summary.removedExpired,
          retried: summary.retried,
          ...(summary.skippedReason ? { skippedReason: summary.skippedReason } : {}),
        },
      },
    }
  ).catch(() => {})
}

export async function sendPushToUserDetailed(
  userId: string,
  payload: PushPayload,
  options: {
    notificationType?: NotificationType
    timeoutMs?: number
    maxRetries?: number
    retryDelayMs?: number
  } = {}
): Promise<PushDeliverySummary> {
  const timeoutMs = options.timeoutMs ?? PUSH_REQUEST_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? PUSH_MAX_RETRIES
  const retryDelayMs = options.retryDelayMs ?? PUSH_RETRY_DELAY_MS

  // Prevent duplicate push dispatches for the same persistent Notification record when requests are retried
  const notifId = payload.notificationId
  if (notifId && mongoose.isValidObjectId(notifId)) {
    const existingNotif = await Notification.findById(notifId).select('pushStatus').lean()
    if (existingNotif) {
      const claim = await Notification.findOneAndUpdate(
        {
          _id: notifId,
          $or: [{ pushStatus: 'PENDING' }, { pushStatus: { $exists: false } }, { pushStatus: null }],
        },
        {
          $set: {
            pushStatus: 'IN_PROGRESS',
            pushAttemptedAt: new Date(),
          },
        },
        { new: true }
      ).lean()

      if (!claim) {
        return {
          sent: 0,
          failed: 0,
          removedExpired: 0,
          retried: 0,
          timedOut: 0,
          skippedReason: 'ALREADY_DISPATCHED',
        }
      }
    }
  }

  if (!isVapidReady()) {
    const summary: PushDeliverySummary = {
      sent: 0,
      failed: 0,
      removedExpired: 0,
      retried: 0,
      timedOut: 0,
      skippedReason: 'VAPID_NOT_CONFIGURED',
    }
    await persistNotificationPushOutcome(notifId, summary)
    return summary
  }

  const recipient = await User.findById(userId)
    .select('notificationPreferences isActive isArchived')
    .lean()

  if (!recipient || !recipient.isActive || recipient.isArchived) {
    const summary: PushDeliverySummary = {
      sent: 0,
      failed: 0,
      removedExpired: 0,
      retried: 0,
      timedOut: 0,
      skippedReason: 'INACTIVE_USER',
    }
    await persistNotificationPushOutcome(notifId, summary)
    return summary
  }

  if (recipient.notificationPreferences?.mobilePush === false) {
    const summary: PushDeliverySummary = {
      sent: 0,
      failed: 0,
      removedExpired: 0,
      retried: 0,
      timedOut: 0,
      skippedReason: 'MOBILE_PUSH_DISABLED',
    }
    await persistNotificationPushOutcome(notifId, summary)
    return summary
  }

  if (options.notificationType === 'VISIT_ASSIGNED' && recipient.notificationPreferences?.newEventCreated === false) {
    const summary: PushDeliverySummary = {
      sent: 0,
      failed: 0,
      removedExpired: 0,
      retried: 0,
      timedOut: 0,
      skippedReason: 'NEW_EVENT_DISABLED',
    }
    await persistNotificationPushOutcome(notifId, summary)
    return summary
  }

  if (options.notificationType === 'FOLLOW_UP_REMINDER' && recipient.notificationPreferences?.dailyProductivity === false) {
    const summary: PushDeliverySummary = {
      sent: 0,
      failed: 0,
      removedExpired: 0,
      retried: 0,
      timedOut: 0,
      skippedReason: 'DAILY_PRODUCTIVITY_DISABLED',
    }
    await persistNotificationPushOutcome(notifId, summary)
    return summary
  }

  const subscriptions = await PushSubscription.find({ user: userId })
    .sort({ updatedAt: -1 })
    .limit(MAX_SUBSCRIPTIONS_PER_USER)
    .lean()

  if (!subscriptions.length) {
    const summary: PushDeliverySummary = {
      sent: 0,
      failed: 0,
      removedExpired: 0,
      retried: 0,
      timedOut: 0,
      skippedReason: 'NO_SUBSCRIPTIONS',
    }
    await persistNotificationPushOutcome(notifId, summary)
    return summary
  }

  const jsonPayload = JSON.stringify(payload)
  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      deliverSingleSubscription(sub, jsonPayload, timeoutMs, maxRetries, retryDelayMs)
    )
  )

  let sent = 0
  let failed = 0
  let removedExpired = 0
  let retried = 0
  let timedOut = 0

  for (const res of results) {
    if (res.status === 'fulfilled') {
      retried += res.value.retriedCount
      if (res.value.ok) {
        sent += 1
      } else {
        failed += 1
        if (res.value.expiredRemoved) removedExpired += 1
        if (res.value.timedOut) timedOut += 1
      }
    } else {
      failed += 1
    }
  }

  const summary: PushDeliverySummary = {
    sent,
    failed,
    removedExpired,
    retried,
    timedOut,
  }

  if (failed > 0 || removedExpired > 0) {
    console.warn('[WebPush] Delivery summary:', {
      userId,
      notificationType: options.notificationType || 'GENERIC',
      sent,
      failed,
      removedExpired,
      retried,
      timedOut,
    })
  }

  await persistNotificationPushOutcome(notifId, summary)
  return summary
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  options: {
    notificationType?: NotificationType
    timeoutMs?: number
    maxRetries?: number
    retryDelayMs?: number
  } = {}
): Promise<{ sent: number; failed: number }> {
  const summary = await sendPushToUserDetailed(userId, payload, options)
  return { sent: summary.sent, failed: summary.failed }
}
