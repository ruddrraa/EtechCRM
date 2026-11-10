// Frontend helper for Service Worker, Web Push & Desktop Notifications

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    return null
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    return reg
  } catch (err) {
    console.warn('[PushClient] Service Worker registration failed:', err)
    return null
  }
}

export async function requestDesktopNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied'
  }
  if (Notification.permission === 'granted') {
    return 'granted'
  }
  return await Notification.requestPermission()
}

export async function subscribeToWebPush(): Promise<{ success: boolean; message?: string }> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { success: false, message: 'Web Push is not supported by your browser.' }
  }

  const permission = await requestDesktopNotificationPermission()
  if (permission !== 'granted') {
    return { success: false, message: 'Notification permission was denied or dismissed.' }
  }

  const reg = await registerServiceWorker()
  if (!reg) {
    return { success: false, message: 'Could not register service worker.' }
  }

  // Fetch VAPID public key from backend
  const keyRes = await fetch('/api/notifications/push/vapid-key', { credentials: 'include' })
  if (!keyRes.ok) {
    return { success: false, message: 'Server did not provide VAPID key.' }
  }
  const keyJson = await keyRes.json()
  const vapidKey = keyJson.data?.vapidPublicKey || keyJson.data?.publicKey
  if (!vapidKey) {
    return { success: false, message: 'VAPID public key is not configured on the server.' }
  }

  try {
    let subscription = await reg.pushManager.getSubscription()
    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(vapidKey)
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
    }

    const subJson = subscription.toJSON()
    const p256dh = subJson.keys?.p256dh
    const auth = subJson.keys?.auth

    if (!subscription.endpoint || !p256dh || !auth) {
      return { success: false, message: 'Subscription generated without required cryptographic keys.' }
    }

    // Save subscription in MongoDB
    const saveRes = await fetch('/api/notifications/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: { p256dh, auth },
        userAgent: navigator.userAgent,
      }),
    })

    if (!saveRes.ok) {
      return { success: false, message: 'Failed to save push subscription on the server.' }
    }

    return { success: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, message: msg }
  }
}

export async function unsubscribeFromWebPush(): Promise<{ success: boolean }> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { success: true }
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg) {
      const subscription = await reg.pushManager.getSubscription()
      if (subscription) {
        await fetch('/api/notifications/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe()
      }
    }
    return { success: true }
  } catch (err) {
    console.warn('[PushClient] Push unsubscribe error:', err)
    return { success: false }
  }
}

export { sendDesktopNotification, sendDesktopNotification as showForegroundNotification } from './useForegroundNotifications'

