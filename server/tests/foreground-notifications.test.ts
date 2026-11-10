import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendDesktopNotification } from '../../src/lib/useForegroundNotifications.js'

describe('Foreground & Persistent Notification Delivery Pipeline', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('1. Primary Path: Uses ServiceWorkerRegistration.showNotification() for desktop and mobile with lightweight icon and non-silent flags', async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined)
    const getNotifications = vi
      .fn()
      .mockResolvedValueOnce([]) // pre-check: no duplicate
      .mockResolvedValueOnce([{ tag: 'crm-notif-sw1' }]) // 350ms active check

    const NotificationCtor = Object.assign(vi.fn(), { permission: 'granted' as NotificationPermission })
    vi.stubGlobal('Notification', NotificationCtor)
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' }, Notification: NotificationCtor })
    vi.stubGlobal('document', { visibilityState: 'hidden', hasFocus: () => false })
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/130.0',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue({
          active: { state: 'activated' },
          getNotifications,
          showNotification,
        }),
        register: vi.fn(),
        ready: Promise.resolve({ active: { state: 'activated' }, getNotifications, showNotification }),
      },
    })

    const report = await sendDesktopNotification({
      notificationId: 'sw1',
      title: 'New visit assigned',
      body: 'Metro Diagnostic Lab scheduled',
      tag: 'crm-notif-sw1',
      url: '/visits',
    })

    expect(report.method).toBe('service-worker')
    expect(report.status).toBe('dispatched')
    expect(report.environment.visibilityState).toBe('hidden')
    expect(showNotification).toHaveBeenCalledTimes(1)
    expect(showNotification).toHaveBeenCalledWith(
      'New visit assigned',
      expect.objectContaining({
        body: 'Metro Diagnostic Lab scheduled',
        icon: '/assets/notification-icon.png',
        badge: '/assets/notification-badge.png',
        tag: 'crm-notif-sw1',
        silent: false,
        requireInteraction: false,
        renotify: true,
      })
    )
    expect(report.events.some((e) => e.type === 'sw_accepted')).toBe(true)

    // Allow 350ms active check timer to run
    await new Promise((r) => setTimeout(r, 400))
    expect(getNotifications).toHaveBeenCalledTimes(2)
  })

  it('2. Duplicate Suppression: Skips dispatching when tag is already active in ServiceWorker notification store', async () => {
    const showNotification = vi.fn()
    const getNotifications = vi.fn().mockResolvedValueOnce([{ tag: 'crm-notif-dup1' }])

    const NotificationCtor = Object.assign(vi.fn(), { permission: 'granted' as NotificationPermission })
    vi.stubGlobal('Notification', NotificationCtor)
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' }, Notification: NotificationCtor })
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true })
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Android',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue({
          active: { state: 'activated' },
          getNotifications,
          showNotification,
        }),
      },
    })

    const report = await sendDesktopNotification({
      notificationId: 'dup1',
      body: 'Already visible',
      tag: 'crm-notif-dup1',
    })

    expect(report.method).toBe('suppressed')
    expect(report.status).toBe('suppressed')
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('3. Desktop Fallback & Lifecycle Telemetry: Logs created, onshow, onclick, onclose when SW is unavailable', async () => {
    const createdInstances: Array<{
      onshow?: () => void
      onerror?: (e: unknown) => void
      onclick?: () => void
      onclose?: () => void
      close: () => void
    }> = []

    const MockNotification = vi.fn(function (this: Record<string, unknown>) {
      const inst = {
        close: vi.fn(),
        onshow: undefined as (() => void) | undefined,
        onerror: undefined as ((e: unknown) => void) | undefined,
        onclick: undefined as (() => void) | undefined,
        onclose: undefined as (() => void) | undefined,
      }
      createdInstances.push(inst)
      return inst
    })

    const focusSpy = vi.fn()
    const NotificationCtor = Object.assign(MockNotification, { permission: 'granted' as NotificationPermission })
    vi.stubGlobal('Notification', NotificationCtor)
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' }, focus: focusSpy, Notification: NotificationCtor })
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true })
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

    const onClick = vi.fn()
    const onClose = vi.fn()
    const report = await sendDesktopNotification({
      notificationId: 'fb1',
      title: 'Fallback Alert',
      body: 'Document notification test',
      onClick,
      onClose,
    })

    expect(report.method).toBe('window-notification')
    expect(report.status).toBe('dispatched')
    expect(createdInstances).toHaveLength(1)

    createdInstances[0].onshow?.()
    createdInstances[0].onclick?.()
    createdInstances[0].onclose?.()

    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(createdInstances[0].close).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('4. Mobile Illegal Constructor Guard: Reports actionable error instead of throwing on mobile when SW is inactive', async () => {
    const MobileNotificationError = vi.fn(() => {
      throw new TypeError("Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.")
    })

    const NotificationCtor = Object.assign(MobileNotificationError, { permission: 'granted' as NotificationPermission })
    vi.stubGlobal('Notification', NotificationCtor)
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' }, Notification: NotificationCtor })
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true })
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
    })

    const report = await sendDesktopNotification({
      notificationId: 'mob1',
      body: 'Mobile fallback check',
    })

    expect(report.method).toBe('failed')
    expect(report.status).toBe('error')
    expect(report.reason).toContain('Mobile browsers require an active Service Worker')
  })

  it('5. Permission Guard: Suppresses delivery clearly when Notification.permission is denied', async () => {
    const NotificationCtor = Object.assign(vi.fn(), { permission: 'denied' as NotificationPermission })
    vi.stubGlobal('Notification', NotificationCtor)
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' }, Notification: NotificationCtor })
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true })

    const report = await sendDesktopNotification({
      notificationId: 'perm1',
      body: 'Blocked alert',
    })

    expect(report.method).toBe('suppressed')
    expect(report.status).toBe('suppressed')
    expect(report.reason).toContain('"denied"')
  })
})
