// Service Worker for EtechCRM Persistent & Push Notifications
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

async function broadcastToClients(payload) {
  try {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientList) {
      client.postMessage(payload)
    }
  } catch (err) {
    console.warn('[SW] Failed to postMessage to clients:', err)
  }
}

self.addEventListener('push', (event) => {
  let data = {
    title: 'Excel Technologies and Services',
    body: 'You have a new update in EtechCRM',
    url: '/',
  }

  if (event.data) {
    try {
      data = event.data.json()
    } catch {
      data.body = event.data.text()
    }
  }

  const tag = data.tag || `crm-push-${Date.now()}`
  const options = {
    body: data.body,
    icon: data.icon || '/assets/notification-icon.png',
    badge: data.badge || '/assets/notification-badge.png',
    data: {
      url: data.url || '/',
      notificationId: data.notificationId || data.id,
      tag,
      timestamp: Date.now(),
    },
    vibrate: [200, 100, 200],
    silent: false,
    requireInteraction: false,
    tag,
    renotify: true,
  }

  event.waitUntil(
    (async () => {
      // Prevent duplicates if foreground polling already rendered the same tag
      const existing = await self.registration.getNotifications({ tag })
      if (existing.length > 0) {
        console.log('[SW] Suppressed duplicate push notification for existing tag:', tag)
        return
      }
      await self.registration.showNotification(data.title || 'Excel Technologies & Services', options)
      await broadcastToClients({
        type: 'CRM_NOTIFICATION_EVENT',
        event: 'push_shown',
        tag,
        notificationId: options.data.notificationId,
        timestamp: Date.now(),
      })
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  const tag = event.notification.tag
  const data = event.notification.data || {}
  const targetUrl = data.url || '/'

  console.log('[SW] notificationclick:', { tag, notificationId: data.notificationId, targetUrl })
  event.notification.close()

  event.waitUntil(
    (async () => {
      await broadcastToClients({
        type: 'CRM_NOTIFICATION_EVENT',
        event: 'click',
        tag,
        notificationId: data.notificationId,
        targetUrl,
        timestamp: Date.now(),
      })

      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clientList) {
        if ('focus' in client && client.url && client.url.includes(self.location.origin)) {
          await client.focus()
          if ('navigate' in client && targetUrl && targetUrl !== '/') {
            await client.navigate(targetUrl)
          }
          return
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl)
      }
    })()
  )
})

self.addEventListener('notificationclose', (event) => {
  const tag = event.notification.tag
  const data = event.notification.data || {}
  console.log('[SW] notificationclose:', { tag, notificationId: data.notificationId })

  event.waitUntil(
    broadcastToClients({
      type: 'CRM_NOTIFICATION_EVENT',
      event: 'close',
      tag,
      notificationId: data.notificationId,
      timestamp: Date.now(),
    })
  )
})
