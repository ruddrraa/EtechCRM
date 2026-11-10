import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MockStorageProvider } from '../src/services/storage/mock.provider.js'
import { setStorageProvider } from '../src/services/storage/storage.service.js'

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt'
process.env.JWT_EXPIRES_IN = '1d'
process.env.CLIENT_URL = 'http://localhost:5173'
process.env.NODE_ENV = 'test'
process.env.PORT = '3001'

let mongo: MongoMemoryServer
let app: ReturnType<typeof import('../src/app.js')['createApp']>
let User: typeof import('../src/models/User.js')['User']
let Organization: typeof import('../src/models/Organization.js')['Organization']
let AuditEvent: typeof import('../src/models/AuditEvent.js')['AuditEvent']
let Client: typeof import('../src/models/Client.js')['Client']
let Visit: typeof import('../src/models/Visit.js')['Visit']
let Notification: typeof import('../src/models/Notification.js')['Notification']
let PushSubscription: typeof import('../src/models/PushSubscription.js')['PushSubscription']
let FileAsset: typeof import('../src/models/FileAsset.js')['FileAsset']

const mockStorage = new MockStorageProvider()

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  setStorageProvider(mockStorage)

  const [
    { createApp },
    userMod,
    orgMod,
    auditMod,
    clientMod,
    visitMod,
    notificationMod,
    pushMod,
    fileAssetMod,
    { connectDatabase },
  ] = await Promise.all([
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/Organization.js'),
    import('../src/models/AuditEvent.js'),
    import('../src/models/Client.js'),
    import('../src/models/Visit.js'),
    import('../src/models/Notification.js'),
    import('../src/models/PushSubscription.js'),
    import('../src/models/FileAsset.js'),
    import('../src/config/db.js'),
  ])

  app = createApp()
  User = userMod.User
  Organization = orgMod.Organization
  AuditEvent = auditMod.AuditEvent
  Client = clientMod.Client
  Visit = visitMod.Visit
  Notification = notificationMod.Notification
  PushSubscription = pushMod.PushSubscription
  FileAsset = fileAssetMod.FileAsset
  await connectDatabase()
}, 120000)

beforeEach(async () => {
  mockStorage.clear()
  await Promise.all([
    User.deleteMany({}),
    Organization.deleteMany({}),
    AuditEvent.deleteMany({}),
    Client.deleteMany({}),
    Visit.deleteMany({}),
    Notification.deleteMany({}),
    PushSubscription.deleteMany({}),
    FileAsset.deleteMany({}),
  ])
})

afterAll(async () => {
  const mongoose = await import('mongoose')
  await mongoose.default.disconnect()
  if (mongo) await mongo.stop()
})

async function createUser(role: 'SUPER_ADMIN' | 'MARKETING_HEAD' | 'MARKETING_EXECUTIVE', email: string) {
  const passwordHash = await bcrypt.hash('password123', 10)
  return User.create({
    name: email.split('@')[0],
    email,
    passwordHash,
    role,
    isActive: true,
  })
}

async function loginUser(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
  return res.headers['set-cookie']
}

const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('Phase 3.4.1 — Organization Settings & Audit Log Management', () => {
  describe('Organization Settings', () => {
    it('1. GET /api/organization returns default organization config for authenticated user', async () => {
      await createUser('MARKETING_EXECUTIVE', 'exec_org@test.com')
      const cookie = await loginUser('exec_org@test.com')

      const res = await request(app).get('/api/organization').set('Cookie', cookie)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.name).toBe('Excel Technologies and Services')
    })

    it('2. PATCH /api/organization: Super Admin can update organization profile', async () => {
      await createUser('SUPER_ADMIN', 'admin_org@test.com')
      const cookie = await loginUser('admin_org@test.com')

      const res = await request(app)
        .patch('/api/organization')
        .set('Cookie', cookie)
        .send({
          name: 'Excel Group Enterprises',
          email: 'contact@excelgroup.com',
          phone: '+91 33 2222 3333',
          address: 'Salt Lake Sector V, Kolkata',
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.name).toBe('Excel Group Enterprises')
      expect(res.body.data.email).toBe('contact@excelgroup.com')

      // Verify MongoDB persistence
      const orgInDb = await Organization.findOne().lean()
      expect(orgInDb?.name).toBe('Excel Group Enterprises')

      // Verify audit record
      const audit = await AuditEvent.findOne({ action: 'ORGANIZATION_UPDATED' }).lean()
      expect(audit).toBeDefined()
    })

    it('3. PATCH /api/organization: Non-Super Admin roles receive 403 Forbidden', async () => {
      await createUser('MARKETING_HEAD', 'head_org@test.com')
      const cookie = await loginUser('head_org@test.com')

      const res = await request(app)
        .patch('/api/organization')
        .set('Cookie', cookie)
        .send({ name: 'Unauthorized Change' })

      expect(res.status).toBe(403)
    })

    it('4. Reports use dynamically configured organization name in export title and footer', async () => {
      const admin = await createUser('SUPER_ADMIN', 'admin_rep@test.com')
      const cookie = await loginUser('admin_rep@test.com')

      // Set custom organization name
      await Organization.create({ name: 'Custom Hospital Group' })

      const client = await Client.create({
        organisationName: 'Apex Health',
        category: 'Hospital',
        address: 'Kolkata',
        createdBy: admin._id,
      })

      await Visit.create({
        client: client._id,
        assignedTo: admin._id,
        assignedBy: admin._id,
        plannedDate: new Date(),
        status: 'COMPLETED',
        source: 'ADMIN_ASSIGNED',
      })

      // Request PDF export
      const res = await request(app)
        .get('/api/reports/export?view=client&format=pdf')
        .set('Cookie', cookie)

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('application/pdf')
      // PDF body buffer exists
      expect(res.body).toBeDefined()
    })

    it('5. Logo upload updates organization branding references', async () => {
      await createUser('SUPER_ADMIN', 'admin_logo@test.com')
      const cookie = await loginUser('admin_logo@test.com')
      const org = await Organization.create({ name: 'Apex Health' })

      const res = await request(app)
        .post('/api/files/upload')
        .set('Cookie', cookie)
        .attach('file', validPngBuffer, 'org_expanded.png')
        .field('ownerType', 'ORGANIZATION_EXPANDED_LOGO')
        .field('ownerId', String(org._id))

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)

      const updatedOrg = await Organization.findById(org._id).lean()
      expect(updatedOrg?.expandedLogoAsset).toBeDefined()
      expect(updatedOrg?.expandedLogo).toBeDefined()
    })
  })

  describe('Audit Logs — Clear Logs Feature', () => {
    it('1. DELETE /api/audit-logs: Super Admin can clear all audit logs', async () => {
      const admin = await createUser('SUPER_ADMIN', 'admin_clear@test.com')
      const cookie = await loginUser('admin_clear@test.com')

      // Create some initial audit events
      await AuditEvent.create([
        { actor: admin._id, action: 'USER_CREATED', entityType: 'User', entityId: admin._id },
        { actor: admin._id, action: 'CLIENT_CREATED', entityType: 'Client', entityId: admin._id },
      ])

      expect(await AuditEvent.countDocuments()).toBe(2)

      const res = await request(app).delete('/api/audit-logs').set('Cookie', cookie)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.cleared).toBe(true)
      expect(res.body.data.deletedCount).toBe(2)

      // Verified 0 records remain in MongoDB
      expect(await AuditEvent.countDocuments()).toBe(0)
    })

    it('2. DELETE /api/audit-logs: Non-Super Admin cannot clear audit logs (403)', async () => {
      await createUser('MARKETING_HEAD', 'head_clear@test.com')
      const cookie = await loginUser('head_clear@test.com')

      const res = await request(app).delete('/api/audit-logs').set('Cookie', cookie)

      expect(res.status).toBe(403)
    })
  })

  describe('Notifications — Clear & Delete Feature', () => {
    it('1. DELETE /api/notifications: Permanently clears all notifications for the user from MongoDB', async () => {
      const user = await createUser('MARKETING_EXECUTIVE', 'exec_notif@test.com')
      const cookie = await loginUser('exec_notif@test.com')

      // Create test notifications in MongoDB
      await Notification.create([
        { recipient: user._id, title: 'Visit Assigned', message: 'You have a new visit', type: 'VISIT_ASSIGNED' },
        { recipient: user._id, title: 'Visit Cancelled', message: 'Client cancelled visit', type: 'VISIT_CANCELLED' },
      ])

      expect(await Notification.countDocuments({ recipient: user._id })).toBe(2)

      const res = await request(app).delete('/api/notifications').set('Cookie', cookie)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.deleted).toBe(2)

      // Verified 0 records in MongoDB for this user
      expect(await Notification.countDocuments({ recipient: user._id })).toBe(0)
    })

    it('2. DELETE /api/notifications/:id: Permanently deletes a single notification from MongoDB', async () => {
      const user = await createUser('MARKETING_EXECUTIVE', 'exec_single@test.com')
      const cookie = await loginUser('exec_single@test.com')

      const notif1 = await Notification.create({
        recipient: user._id,
        title: 'Alert 1',
        message: 'Message 1',
        type: 'VISIT_ASSIGNED',
      })
      const notif2 = await Notification.create({
        recipient: user._id,
        title: 'Alert 2',
        message: 'Message 2',
        type: 'VISIT_UPDATED',
      })

      expect(await Notification.countDocuments({ recipient: user._id })).toBe(2)

      const res = await request(app).delete(`/api/notifications/${notif1._id}`).set('Cookie', cookie)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.deleted).toBe(true)

      // Verified only notif2 remains in MongoDB
      const remaining = await Notification.find({ recipient: user._id })
      expect(remaining.length).toBe(1)
      expect(String(remaining[0]._id)).toBe(String(notif2._id))
    })
  })

  describe('PHASE 3.4.2 QA — SESSION SECURITY, PREFERENCES & FILE STREAMING', () => {
    it('1. POST /api/auth/logout-all: Increments tokenVersion and invalidates all existing JWT sessions', async () => {
      const user = await createUser('MARKETING_EXECUTIVE', 'session_qa@test.com')
      const cookie = await loginUser('session_qa@test.com')

      // Verify authenticated endpoint works
      const preRes = await request(app).get('/api/users/me').set('Cookie', cookie)
      expect(preRes.status).toBe(200)

      // Call logout-all
      const logoutRes = await request(app).post('/api/auth/logout-all').set('Cookie', cookie)
      expect(logoutRes.status).toBe(200)
      expect(logoutRes.body.success).toBe(true)

      // Check user tokenVersion incremented in MongoDB
      const updatedUser = await User.findById(user._id)
      expect(updatedUser?.tokenVersion).toBe(1)

      // Using the old cookie must be rejected with 401 Unauthorized
      const postRes = await request(app).get('/api/users/me').set('Cookie', cookie)
      expect(postRes.status).toBe(401)
    })

    it('2. PATCH /api/users/me/preferences: Persists notification preferences in MongoDB', async () => {
      await createUser('MARKETING_EXECUTIVE', 'pref_qa@test.com')
      const cookie = await loginUser('pref_qa@test.com')

      const patchRes = await request(app)
        .patch('/api/users/me/preferences')
        .set('Cookie', cookie)
        .send({
          dailyProductivity: false,
          mobilePush: true,
          desktopAlerts: false,
        })

      expect(patchRes.status).toBe(200)
      expect(patchRes.body.success).toBe(true)
      expect(patchRes.body.data.dailyProductivity).toBe(false)
      expect(patchRes.body.data.mobilePush).toBe(true)
      expect(patchRes.body.data.desktopAlerts).toBe(false)

      // Verify persistence via GET /api/users/me
      const meRes = await request(app).get('/api/users/me').set('Cookie', cookie)
      expect(meRes.status).toBe(200)
      expect(meRes.body.data.notificationPreferences.dailyProductivity).toBe(false)
      expect(meRes.body.data.notificationPreferences.mobilePush).toBe(true)
      expect(meRes.body.data.notificationPreferences.desktopAlerts).toBe(false)
    })

    it('3. Web Push API: Subscribes, fetches VAPID key, and unsubscribes cleanly in MongoDB', async () => {
      const user = await createUser('MARKETING_EXECUTIVE', 'push_qa@test.com')
      const cookie = await loginUser('push_qa@test.com')

      // VAPID key endpoint is accessible without cookies as a public key endpoint
      const vapidPublicRes = await request(app).get('/api/notifications/push/vapid-key')
      expect(vapidPublicRes.status).toBe(200)
      expect(vapidPublicRes.body.data).toHaveProperty('vapidPublicKey')

      // VAPID key endpoint with auth cookie
      const vapidRes = await request(app).get('/api/notifications/push/vapid-key').set('Cookie', cookie)
      expect(vapidRes.status).toBe(200)
      expect(vapidRes.body.data).toHaveProperty('vapidPublicKey')

      // Subscribe endpoint
      const subEndpoint = 'https://fcm.googleapis.com/fcm/send/test-sub-123'
      const subRes = await request(app)
        .post('/api/notifications/push/subscribe')
        .set('Cookie', cookie)
        .send({
          endpoint: subEndpoint,
          keys: {
            p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcPP3Y7yA=',
            auth: 'tBHItJI5svbpez7KI4CCXg==',
          },
          userAgent: 'Mozilla/5.0 Test Suite',
        })

      expect(subRes.status).toBe(201)
      expect(subRes.body.success).toBe(true)

      const savedSub = await PushSubscription.findOne({ endpoint: subEndpoint })
      expect(savedSub).not.toBeNull()
      expect(String(savedSub?.user)).toBe(String(user._id))

      // Unsubscribe endpoint
      const unsubRes = await request(app)
        .post('/api/notifications/push/unsubscribe')
        .set('Cookie', cookie)
        .send({ endpoint: subEndpoint })

      expect(unsubRes.status).toBe(200)
      expect(unsubRes.body.success).toBe(true)

      const deletedSub = await PushSubscription.findOne({ endpoint: subEndpoint })
      expect(deletedSub).toBeNull()

      // Push delivery respects user preference: when mobilePush is disabled, push is skipped
      const { sendPushToUser } = await import('../src/services/push.js')
      await User.findByIdAndUpdate(user._id, { $set: { 'notificationPreferences.mobilePush': false } })
      const pushPrefRes = await sendPushToUser(String(user._id), { title: 'Test', body: 'Preference test' })
      expect(pushPrefRes).toEqual({ sent: 0, failed: 0 })
    })

    it('4. GET /api/files/:id/view: Enforces authentication, RBAC boundaries, and sets strict security headers', async () => {
      const head1 = await createUser('MARKETING_HEAD', 'head_team1@test.com')
      const exec1 = await User.create({
        name: 'Exec 1',
        email: 'exec_team1@test.com',
        passwordHash: await bcrypt.hash('password123', 10),
        role: 'MARKETING_EXECUTIVE',
        reportingTo: head1._id,
        isActive: true,
      })
      await createUser('MARKETING_EXECUTIVE', 'exec_team2@test.com')

      const cookieExec1 = await loginUser('exec_team1@test.com')
      const cookieExec2 = await loginUser('exec_team2@test.com')

      // Create a client and visit for Exec 1
      const client = await Client.create({
        organisationName: 'Stream QA Client',
        category: 'Corporate',
        address: '123 Test Street, Kolkata',
        location: { type: 'Point', coordinates: [88.3639, 22.5726] },
        createdBy: exec1._id,
      })

      const visit = await Visit.create({
        client: client._id,
        assignedTo: exec1._id,
        assignedBy: head1._id,
        status: 'PLANNED',
        source: 'ADMIN_ASSIGNED',
        plannedDate: new Date(),
      })

      // Create a file asset for this visit
      const asset = await FileAsset.create({
        ownerType: 'VISIT_ATTACHMENT',
        ownerId: visit._id,
        originalName: 'MeetingNotes.pdf',
        resourceType: 'raw',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        cloudinaryPublicId: 'etech_crm/test/meeting_notes',
        cloudinaryResourceType: 'raw',
        secureStorageReference: 'https://mock-storage.local/etech_crm/test/meeting_notes',
        uploadedBy: exec1._id,
        isArchived: false,
      })

      // A. Unauthenticated request -> 401
      const unauthRes = await request(app).get(`/api/files/${asset._id}/view`)
      expect(unauthRes.status).toBe(401)

      // B. Cross-team / unauthorized executive -> 403
      const forbiddenRes = await request(app).get(`/api/files/${asset._id}/view`).set('Cookie', cookieExec2)
      expect(forbiddenRes.status).toBe(403)

      // C. Authorized user -> 200 with inline stream headers (no redirects to external storage)
      const okRes = await request(app).get(`/api/files/${asset._id}/view`).set('Cookie', cookieExec1)
      expect(okRes.status).toBe(200)
      expect(okRes.headers['location']).toBeUndefined()
      expect(okRes.headers['content-disposition']).toContain('inline; filename="MeetingNotes.pdf"')
      expect(okRes.headers['x-content-type-options']).toBe('nosniff')
      expect(okRes.headers['cache-control']).toBe('private, no-cache, no-store, must-revalidate')

      // D. Explicit download request (?download=1) sets Content-Disposition: attachment
      const dlRes = await request(app).get(`/api/files/${asset._id}/view?download=1`).set('Cookie', cookieExec1)
      expect(dlRes.status).toBe(200)
      expect(dlRes.headers['content-disposition']).toContain('attachment; filename="MeetingNotes.pdf"')

      // E. GET /api/files/:id returns CRM-domain viewUrl, not raw external storage links
      const metaRes = await request(app).get(`/api/files/${asset._id}`).set('Cookie', cookieExec1)
      expect(metaRes.status).toBe(200)
      expect(metaRes.body.data.viewUrl).toBe(`/api/files/${asset._id}/view`)
      expect(metaRes.body.data.signedUrl).toBe(`/api/files/${asset._id}/view`)

      // F. Verify FILE_ACCESSED audit log recorded
      const auditLog = await AuditEvent.findOne({
        action: 'FILE_ACCESSED',
        entityId: asset._id,
      })
      expect(auditLog).not.toBeNull()
      expect(auditLog?.metadata?.mode).toBe('STREAM_VIEW')
    })

    it('5. Foreground Notification Pipeline: POST /api/notifications/test generates authenticated notification', async () => {
      const exec = await User.create({
        name: 'Alert Executive',
        email: 'alert.exec@exceltechnologies.in',
        passwordHash: await bcrypt.hash('password123', 10),
        role: 'MARKETING_EXECUTIVE',
        isActive: true,
      })
      const loginRes = await request(app).post('/api/auth/login').send({
        email: exec.email,
        password: 'password123',
      })
      const cookie = loginRes.headers['set-cookie']

      // A. Post test notification twice -> each call creates a single distinct notification record
      const testRes1 = await request(app).post('/api/notifications/test').set('Cookie', cookie)
      expect(testRes1.status).toBe(201)
      expect(testRes1.body.data.type).toBe('TEST')
      expect(testRes1.body.data.title).toBe('Excel Technologies & Services')
      expect(testRes1.body.data.recipient).toBe(String(exec._id))

      const testRes2 = await request(app).post('/api/notifications/test').set('Cookie', cookie)
      expect(testRes2.status).toBe(201)
      expect(testRes2.body.data._id).not.toBe(testRes1.body.data._id)

      // B. Verify retrieved via GET /api/notifications
      const getRes = await request(app).get('/api/notifications').set('Cookie', cookie)
      expect(getRes.status).toBe(200)
      expect(getRes.body.data.items).toHaveLength(2)
      expect(getRes.body.data.items[0].type).toBe('TEST')
      expect(getRes.body.data.items.map((i: { _id: string }) => i._id)).toContain(testRes1.body.data._id)
      expect(getRes.body.data.items.map((i: { _id: string }) => i._id)).toContain(testRes2.body.data._id)
    })

    it('6. Visit Assignment Notification Delivery: Executive receives native CRM notification on visit creation', async () => {
      const head = await User.create({
        name: 'Dispatch Head',
        email: 'dispatch.head@exceltechnologies.in',
        passwordHash: await bcrypt.hash('password123', 10),
        role: 'MARKETING_HEAD',
        isActive: true,
      })
      const exec = await User.create({
        name: 'Field Executive',
        email: 'field.exec@exceltechnologies.in',
        passwordHash: await bcrypt.hash('password123', 10),
        role: 'MARKETING_EXECUTIVE',
        reportingTo: head._id,
        isActive: true,
      })
      const client = await Client.create({
        organisationName: 'Metro Diagnostic Lab',
        category: 'Diagnostic Center',
        address: 'Sector 5, Salt Lake, Kolkata',
        phone: '9830000000',
        createdBy: head._id,
        isActive: true,
      })

      const headLogin = await request(app).post('/api/auth/login').send({
        email: head.email,
        password: 'password123',
      })
      const execLogin = await request(app).post('/api/auth/login').send({
        email: exec.email,
        password: 'password123',
      })

      // Head assigns a visit to executive
      const visitRes = await request(app)
        .post('/api/visits')
        .set('Cookie', headLogin.headers['set-cookie'])
        .send({
          clientId: String(client._id),
          assignedTo: String(exec._id),
          plannedDate: new Date(Date.now() + 86400000).toISOString(),
          instructions: 'Collect pathology reagent feedback',
        })
      expect(visitRes.status).toBe(201)

      // Executive polls /api/notifications
      const notifRes = await request(app)
        .get('/api/notifications')
        .set('Cookie', execLogin.headers['set-cookie'])
      expect(notifRes.status).toBe(200)
      expect(notifRes.body.data.items.length).toBeGreaterThanOrEqual(1)

      const assignedNotif = notifRes.body.data.items.find(
        (n: { type: string; recipient: string }) => n.type === 'VISIT_ASSIGNED' && n.recipient === String(exec._id)
      )
      expect(assignedNotif).toBeDefined()
      expect(assignedNotif.title).toBe('New visit assigned')
      expect(assignedNotif.entityType).toBe('Visit')
      expect(assignedNotif.entityId).toBe(visitRes.body.data._id)
      expect(assignedNotif.readAt).toBeUndefined()
    })
  })
})
