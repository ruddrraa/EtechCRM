import { createApp } from './app.js'
import { connectDatabase } from './config/db.js'
import { env } from './config/env.js'
import { migrateLegacyRoles } from './services/migration.js'
import { verifyStorageConnectivity } from './services/storage/storage.service.js'
import { isVapidReady } from './services/push.js'

await connectDatabase()
await migrateLegacyRoles()
await verifyStorageConnectivity()
console.log(`[WebPush] Diagnostics: VAPID configured = ${isVapidReady()}`)
createApp().listen(env.PORT, '0.0.0.0', () => console.log(`API listening on port ${env.PORT}`))
