import { useEffect, useRef } from 'react'
import type { AuthUser, NotificationItem } from '../types'
import { registerServiceWorker } from './pushClient'

export type NotificationLifecycleEvent = {
  type: 'created' | 'sw_accepted' | 'onshow' | 'active_check' | 'click' | 'close' | 'error' | 'suppressed'
  timestamp: number
  detail?: string
}

export type NotificationDiagnosticReport = {
  notificationId: string
  tag: string
  title: string
  method: 'service-worker' | 'window-notification' | 'suppressed' | 'failed'
  status: 'dispatched' | 'suppressed' | 'error'
  reason?: string
  environment: {
    origin: string
    permission: NotificationPermission | 'unsupported'
    visibilityState: DocumentVisibilityState | 'unknown'
    hasFocus: boolean
    serviceWorkerSupported: boolean
    serviceWorkerState: string
    isMobileUserAgent: boolean
  }
  options: {
    body: string
    icon: string
    badge: string
    tag: string
    silent: boolean
    requireInteraction: boolean
    renotify: boolean
  }
  activeInNotificationCenterCount?: number
  events: NotificationLifecycleEvent[]
}

export type DesktopNotificationOptions = {
  notificationId?: string
  title?: string
  body: string
  icon?: string
  badge?: string
  tag?: string
  url?: string
  onClick?: () => void
  onClose?: () => void
}

type DiagnosticListener = (report: NotificationDiagnosticReport) => void
const diagnosticListeners = new Set<DiagnosticListener>()
const diagnosticStore = new Map<string, NotificationDiagnosticReport>()

export function subscribeToNotificationDiagnostics(listener: DiagnosticListener): () => void {
  diagnosticListeners.add(listener)
  return () => {
    diagnosticListeners.delete(listener)
  }
}

export function getNotificationDiagnostic(notificationId: string): NotificationDiagnosticReport | undefined {
  return diagnosticStore.get(notificationId)
}

function emitDiagnostic(report: NotificationDiagnosticReport) {
  diagnosticStore.set(report.notificationId, report)
  diagnosticListeners.forEach((listener) => {
    try {
      listener({ ...report, events: [...report.events] })
    } catch {
      // ignore subscriber errors
    }
  })
}

function appendDiagnosticEvent(
  notificationId: string,
  event: NotificationLifecycleEvent,
  patch?: Partial<NotificationDiagnosticReport>
) {
  const existing = diagnosticStore.get(notificationId)
  if (!existing) return
  const updated: NotificationDiagnosticReport = {
    ...existing,
    ...patch,
    events: [...existing.events, event],
  }
  emitDiagnostic(updated)
}

function appendDiagnosticEventByTag(tag: string, event: NotificationLifecycleEvent) {
  for (const [id, report] of diagnosticStore.entries()) {
    if (report.tag === tag) {
      appendDiagnosticEvent(id, event)
    }
  }
}

function getEnvironmentSnapshot(swState = 'unknown'): NotificationDiagnosticReport['environment'] {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
  return {
    origin: typeof window !== 'undefined' ? window.location.origin : '',
    permission: typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
    hasFocus: typeof document !== 'undefined' ? document.hasFocus() : false,
    serviceWorkerSupported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    serviceWorkerState: swState,
    isMobileUserAgent,
  }
}

async function resolveActiveServiceWorker(): Promise<{
  registration: ServiceWorkerRegistration | null
  state: string
}> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { registration: null, state: 'unsupported' }
  }

  try {
    let reg: ServiceWorkerRegistration | null | undefined = await navigator.serviceWorker.getRegistration('/')
    if (!reg) {
      reg = await registerServiceWorker()
    }
    if (!reg) {
      return { registration: null, state: 'registration_failed' }
    }

    if (reg.active) {
      return { registration: reg, state: reg.active.state }
    }

    // Wait briefly (up to 1500ms) for installing/waiting worker to activate
    const readyReg = await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ])
    if (readyReg?.active) {
      return { registration: readyReg, state: readyReg.active.state }
    }

    const fallbackState = reg.installing?.state || reg.waiting?.state || 'not_active'
    return { registration: reg, state: fallbackState }
  } catch (err) {
    console.warn('[NotificationPipeline] Failed to inspect service worker:', err)
    return { registration: null, state: 'error' }
  }
}

/**
 * Unified foreground & persistent browser notification delivery.
 *
 * Uses ServiceWorkerRegistration.showNotification() as primary path so notifications
 * work consistently across:
 * - Desktop (Windows/macOS, active tab, background tab, and minimized browser)
 * - Mobile (Android Chrome/Edge, iOS PWA), where `new Notification()` throws TypeError.
 *
 * Falls back to `new Notification()` on desktop if Service Worker is unavailable.
 */
export async function sendDesktopNotification({
  notificationId,
  title = 'Excel Technologies & Services',
  body,
  icon = '/assets/notification-icon.png',
  badge = '/assets/notification-badge.png',
  tag,
  url = '/',
  onClick,
  onClose,
}: DesktopNotificationOptions): Promise<NotificationDiagnosticReport> {
  const notifId = notificationId || `local-${Date.now()}`
  const resolvedTag = tag || `crm-notif-${notifId}`
  const baseOptions = {
    body,
    icon,
    badge,
    tag: resolvedTag,
    silent: false,
    requireInteraction: false,
    renotify: true,
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    const report: NotificationDiagnosticReport = {
      notificationId: notifId,
      tag: resolvedTag,
      title,
      method: 'failed',
      status: 'error',
      reason: 'Browser does not support the Web Notification API.',
      environment: getEnvironmentSnapshot('unsupported'),
      options: baseOptions,
      events: [{ type: 'error', timestamp: Date.now(), detail: 'Notification API unsupported' }],
    }
    console.warn('[NotificationPipeline] Unsupported:', report)
    emitDiagnostic(report)
    return report
  }

  if (Notification.permission !== 'granted') {
    const report: NotificationDiagnosticReport = {
      notificationId: notifId,
      tag: resolvedTag,
      title,
      method: 'suppressed',
      status: 'suppressed',
      reason: `Browser Notification.permission is "${Notification.permission}" (must be "granted").`,
      environment: getEnvironmentSnapshot('skipped'),
      options: baseOptions,
      events: [
        {
          type: 'suppressed',
          timestamp: Date.now(),
          detail: `Permission is ${Notification.permission}`,
        },
      ],
    }
    console.warn('[NotificationPipeline] Permission not granted:', report)
    emitDiagnostic(report)
    return report
  }

  const { registration, state: swState } = await resolveActiveServiceWorker()
  const env = getEnvironmentSnapshot(swState)

  // 1. Primary path: ServiceWorkerRegistration.showNotification()
  // Works on both Windows/Desktop OS Notification Center AND Mobile Chrome/Edge/iOS PWA.
  if (registration?.active) {
    try {
      const existing = await registration.getNotifications({ tag: resolvedTag })
      if (existing.length > 0) {
        const dupReport: NotificationDiagnosticReport = {
          notificationId: notifId,
          tag: resolvedTag,
          title,
          method: 'suppressed',
          status: 'suppressed',
          reason: `Notification with tag "${resolvedTag}" is already active in notification center.`,
          environment: env,
          options: baseOptions,
          activeInNotificationCenterCount: existing.length,
          events: [
            {
              type: 'suppressed',
              timestamp: Date.now(),
              detail: `Existing notification already active (count=${existing.length})`,
            },
          ],
        }
        console.log('[NotificationPipeline] Duplicate suppressed via getNotifications:', dupReport)
        emitDiagnostic(dupReport)
        return dupReport
      }

      const createdAt = Date.now()
      const initialReport: NotificationDiagnosticReport = {
        notificationId: notifId,
        tag: resolvedTag,
        title,
        method: 'service-worker',
        status: 'dispatched',
        environment: env,
        options: baseOptions,
        events: [
          {
            type: 'created',
            timestamp: createdAt,
            detail: `Dispatching via ServiceWorkerRegistration.showNotification (visibility=${env.visibilityState}, hasFocus=${env.hasFocus})`,
          },
        ],
      }
      emitDiagnostic(initialReport)
      console.log('[NotificationPipeline] Creating via ServiceWorker:', {
        notificationId: notifId,
        tag: resolvedTag,
        env,
        options: baseOptions,
      })

      const swNotificationOptions: NotificationOptions & { renotify?: boolean } = {
        body,
        icon,
        badge,
        tag: resolvedTag,
        silent: false,
        requireInteraction: false,
        renotify: true,
        data: {
          notificationId: notifId,
          tag: resolvedTag,
          url,
          timestamp: createdAt,
        },
      }
      await registration.showNotification(title, swNotificationOptions)

      appendDiagnosticEvent(notifId, {
        type: 'sw_accepted',
        timestamp: Date.now(),
        detail: 'ServiceWorkerRegistration.showNotification() promise resolved',
      })

      // Check after 350ms if OS/browser still holds the notification or immediately closed/suppressed it
      setTimeout(() => {
        void registration
          .getNotifications({ tag: resolvedTag })
          .then((activeList) => {
            console.log('[NotificationPipeline] Active check in browser store:', {
              tag: resolvedTag,
              activeCount: activeList.length,
            })
            appendDiagnosticEvent(
              notifId,
              {
                type: 'active_check',
                timestamp: Date.now(),
                detail:
                  activeList.length > 0
                    ? `Present in browser/OS store (${activeList.length} active)`
                    : 'Not in active browser store after 350ms (dismissed, expired, or moved)',
              },
              { activeInNotificationCenterCount: activeList.length }
            )
          })
          .catch(() => {})
      }, 350)

      return diagnosticStore.get(notifId) || initialReport
    } catch (swErr) {
      console.warn('[NotificationPipeline] ServiceWorker showNotification failed, attempting desktop fallback:', swErr)
    }
  }

  // 2. Fallback path: document-level `new Notification()` (Desktop browsers without active SW)
  // Note: Throws `TypeError: Illegal constructor` on Android Chrome/Edge mobile.
  try {
    const createdAt = Date.now()
    const report: NotificationDiagnosticReport = {
      notificationId: notifId,
      tag: resolvedTag,
      title,
      method: 'window-notification',
      status: 'dispatched',
      environment: env,
      options: baseOptions,
      events: [
        {
          type: 'created',
          timestamp: createdAt,
          detail: `Constructing new Notification() fallback (swState=${swState}, visibility=${env.visibilityState}, hasFocus=${env.hasFocus})`,
        },
      ],
    }
    emitDiagnostic(report)
    console.log('[NotificationPipeline] Fallback new Notification():', {
      notificationId: notifId,
      tag: resolvedTag,
      env,
      options: baseOptions,
    })

    const notif = new Notification(title, {
      body,
      icon,
      tag: resolvedTag,
      silent: false,
      requireInteraction: false,
      renotify: true,
      data: { notificationId: notifId, tag: resolvedTag, url, timestamp: createdAt },
    } as NotificationOptions)

    let showTime: number | null = null

    notif.onshow = () => {
      showTime = Date.now()
      console.log('[NotificationPipeline] onshow fired:', { notificationId: notifId, elapsedMs: showTime - createdAt })
      appendDiagnosticEvent(notifId, {
        type: 'onshow',
        timestamp: showTime,
        detail: `onshow fired (+${showTime - createdAt}ms)`,
      })
    }

    notif.onerror = (errEvt) => {
      console.error('[NotificationPipeline] onerror fired:', { notificationId: notifId, errEvt })
      appendDiagnosticEvent(
        notifId,
        {
          type: 'error',
          timestamp: Date.now(),
          detail: 'Browser Notification onerror event fired',
        },
        { status: 'error', reason: 'Notification onerror event triggered by browser.' }
      )
    }

    notif.onclick = () => {
      console.log('[NotificationPipeline] onclick fired:', { notificationId: notifId })
      appendDiagnosticEvent(notifId, {
        type: 'click',
        timestamp: Date.now(),
        detail: 'User clicked notification',
      })
      try {
        window.focus()
      } catch {
        // window.focus may be restricted by browser policy
      }
      notif.close()
      onClick?.()
    }

    notif.onclose = () => {
      const now = Date.now()
      const duration = showTime ? now - showTime : now - createdAt
      console.log('[NotificationPipeline] onclose fired:', { notificationId: notifId, visibleDurationMs: duration })
      appendDiagnosticEvent(notifId, {
        type: 'close',
        timestamp: now,
        detail:
          duration < 500
            ? `Closed very rapidly after ${duration}ms (possible OS suppression or replacement)`
            : `Closed after ${duration}ms`,
      })
      onClose?.()
    }

    return report
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error('[NotificationPipeline] Failed to construct Notification:', errMsg)
    const errReport: NotificationDiagnosticReport = {
      notificationId: notifId,
      tag: resolvedTag,
      title,
      method: 'failed',
      status: 'error',
      reason: env.isMobileUserAgent
        ? `Mobile browsers require an active Service Worker (${errMsg}). Please refresh the page or install the app.`
        : errMsg,
      environment: env,
      options: baseOptions,
      events: [{ type: 'error', timestamp: Date.now(), detail: errMsg }],
    }
    emitDiagnostic(errReport)
    return errReport
  }
}

/**
 * Connects React Query notification polling to unified desktop & mobile OS notification delivery.
 *
 * - Proactively registers `/sw.js` on mount so both Desktop and Mobile use persistent notifications.
 * - Seeds existing notification IDs on initial mount to prevent historical notification spam.
 * - Deduplicates via in-memory Set, sessionStorage, and Service Worker notification tags.
 * - Evaluates `desktopAlerts` and `newEventCreated` preferences before displaying.
 */
export function useForegroundNotifications({
  user,
  items,
  onNavigate,
  onMarkRead,
}: {
  user: AuthUser | null
  items?: NotificationItem[]
  onNavigate?: (path: string) => void
  onMarkRead?: (id: string) => void
}) {
  const seenIdsRef = useRef<Set<string>>(new Set())
  const isInitializedRef = useRef<boolean>(false)
  const onNavigateRef = useRef(onNavigate)
  const onMarkReadRef = useRef(onMarkRead)
  const userKey = user?._id || 'guest'

  useEffect(() => {
    onNavigateRef.current = onNavigate
    onMarkReadRef.current = onMarkRead
  }, [onNavigate, onMarkRead])

  // Proactively register Service Worker and listen for SW notification click/close telemetry
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    void registerServiceWorker()

    const handleSwMessage = (event: MessageEvent) => {
      const payload = event.data as
        | {
            type?: string
            event?: 'click' | 'close' | 'push_shown'
            tag?: string
            notificationId?: string
            targetUrl?: string
            timestamp?: number
          }
        | undefined

      if (!payload || payload.type !== 'CRM_NOTIFICATION_EVENT' || !payload.tag) return

      console.log('[NotificationPipeline] SW event received:', payload)
      if (payload.event === 'click') {
        appendDiagnosticEventByTag(payload.tag, {
          type: 'click',
          timestamp: payload.timestamp || Date.now(),
          detail: 'Service Worker notificationclick triggered',
        })
        if (payload.notificationId && onMarkReadRef.current) {
          onMarkReadRef.current(payload.notificationId)
        }
        if (payload.targetUrl && onNavigateRef.current) {
          onNavigateRef.current(payload.targetUrl)
        }
      } else if (payload.event === 'close') {
        appendDiagnosticEventByTag(payload.tag, {
          type: 'close',
          timestamp: payload.timestamp || Date.now(),
          detail: 'Service Worker notificationclose triggered',
        })
      }
    }

    navigator.serviceWorker.addEventListener('message', handleSwMessage)
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage)
    }
  }, [])

  // Load seen notification IDs from sessionStorage on mount or user change
  useEffect(() => {
    isInitializedRef.current = false
    try {
      const stored = sessionStorage.getItem(`etech_seen_notif_${userKey}`)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          seenIdsRef.current = new Set(parsed)
        }
      } else {
        seenIdsRef.current = new Set()
      }
    } catch {
      seenIdsRef.current = new Set()
    }
  }, [userKey])

  // Watch incoming polled notifications from React Query
  useEffect(() => {
    if (!items || !Array.isArray(items)) return

    // 1. Initial snapshot handling: record pre-existing items without firing desktop banners
    if (!isInitializedRef.current) {
      items.forEach((item) => {
        if (item?._id) {
          seenIdsRef.current.add(item._id)
        }
      })
      try {
        sessionStorage.setItem(
          `etech_seen_notif_${userKey}`,
          JSON.stringify(Array.from(seenIdsRef.current).slice(-100))
        )
      } catch {
        // ignore quota errors
      }
      isInitializedRef.current = true
      return
    }

    // 2. Incremental polling / refetch handling: identify unseen unread notifications
    const newUnreadItems = items.filter(
      (item) => item?._id && !item.readAt && !seenIdsRef.current.has(item._id)
    )

    if (newUnreadItems.length === 0) return

    // Immediately record IDs to prevent duplicate processing across re-renders
    newUnreadItems.forEach((item) => seenIdsRef.current.add(item._id))
    try {
      sessionStorage.setItem(
        `etech_seen_notif_${userKey}`,
        JSON.stringify(Array.from(seenIdsRef.current).slice(-100))
      )
    } catch {
      // ignore quota errors
    }

    // 3. Evaluate desktop notification preferences
    if (user?.notificationPreferences?.desktopAlerts === false) {
      newUnreadItems.forEach((item) => {
        const suppressedReport: NotificationDiagnosticReport = {
          notificationId: item._id,
          tag: `crm-notif-${item._id}`,
          title: item.title,
          method: 'suppressed',
          status: 'suppressed',
          reason: 'User has disabled "Desktop notification banners" in Settings > General.',
          environment: getEnvironmentSnapshot('skipped'),
          options: {
            body: item.message,
            icon: '/assets/notification-icon.png',
            badge: '/assets/notification-badge.png',
            tag: `crm-notif-${item._id}`,
            silent: false,
            requireInteraction: false,
            renotify: true,
          },
          events: [
            {
              type: 'suppressed',
              timestamp: Date.now(),
              detail: 'desktopAlerts preference is false',
            },
          ],
        }
        emitDiagnostic(suppressedReport)
      })
      console.log('[NotificationPipeline] Suppressed: desktopAlerts disabled in preferences.')
      return
    }

    // 4. Deliver each new notification via the unified pipeline
    newUnreadItems.forEach((item) => {
      if (item.type === 'VISIT_ASSIGNED' && user?.notificationPreferences?.newEventCreated === false) {
        const suppressedReport: NotificationDiagnosticReport = {
          notificationId: item._id,
          tag: `crm-notif-${item._id}`,
          title: item.title,
          method: 'suppressed',
          status: 'suppressed',
          reason: 'User has disabled "New visit assignments" alerts in Settings > General.',
          environment: getEnvironmentSnapshot('skipped'),
          options: {
            body: item.message,
            icon: '/assets/notification-icon.png',
            badge: '/assets/notification-badge.png',
            tag: `crm-notif-${item._id}`,
            silent: false,
            requireInteraction: false,
            renotify: true,
          },
          events: [
            {
              type: 'suppressed',
              timestamp: Date.now(),
              detail: 'newEventCreated preference is false',
            },
          ],
        }
        emitDiagnostic(suppressedReport)
        return
      }

      const targetPath = item.entityType === 'Visit' ? '/visits' : item.entityType === 'Client' ? '/clients' : '/'

      void sendDesktopNotification({
        notificationId: item._id,
        title: item.title || 'Excel Technologies & Services',
        body: item.message,
        tag: `crm-notif-${item._id}`,
        url: targetPath,
        onClick: () => {
          onMarkReadRef.current?.(item._id)
          onNavigateRef.current?.(targetPath)
        },
      })
    })
  }, [items, user?.notificationPreferences, userKey])
}
