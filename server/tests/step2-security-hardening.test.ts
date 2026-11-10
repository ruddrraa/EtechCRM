import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
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
let Client: typeof import('../src/models/Client.js')['Client']
let Visit: typeof import('../src/models/Visit.js')['Visit']
let Notification: typeof import('../src/models/Notification.js')['Notification']
let AuditEvent: typeof import('../src/models/AuditEvent.js')['AuditEvent']
let FileAsset: typeof import('../src/models/FileAsset.js')['FileAsset']
let RateLimitBucket: typeof import('../src/models/RateLimitBucket.js')['RateLimitBucket']

const mockStorage = new MockStorageProvider()

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  setStorageProvider(mockStorage)

  const [
    { createApp },
    userMod,
    clientMod,
    visitMod,
    notifMod,
    auditMod,
    fileMod,
    rateLimitMod,
    { connectDatabase },
  ] = await Promise.all([
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/Client.js'),
    import('../src/models/Visit.js'),
    import('../src/models/Notification.js'),
    import('../src/models/AuditEvent.js'),
    import('../src/models/FileAsset.js'),
    import('../src/models/RateLimitBucket.js'),
    import('../src/config/db.js'),
  ])

  User = userMod.User
  Client = clientMod.Client
  Visit = visitMod.Visit
  Notification = notifMod.Notification
  AuditEvent = auditMod.AuditEvent
  FileAsset = fileMod.FileAsset
  RateLimitBucket = rateLimitMod.RateLimitBucket

  await connectDatabase(mongo.getUri())
  await RateLimitBucket.syncIndexes()
  app = createApp()
})

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Client.deleteMany({}),
    Visit.deleteMany({}),
    Notification.deleteMany({}),
    AuditEvent.deleteMany({}),
    FileAsset.deleteMany({}),
    RateLimitBucket.deleteMany({}),
  ])
})

afterAll(async () => {
  const mongoose = await import('mongoose')
  await mongoose.default.disconnect()
  if (mongo) await mongo.stop()
})

async function createUser(
  role: 'SUPER_ADMIN' | 'MARKETING_HEAD' | 'MARKETING_EXECUTIVE',
  email: string,
  reportingTo?: string
) {
  const passwordHash = await bcrypt.hash('password123', 10)
  return User.create({
    name: email.split('@')[0],
    email,
    passwordHash,
    role,
    reportingTo: reportingTo ?? null,
    isActive: true,
    isArchived: false,
  })
}

async function login(email: string, password = 'password123') {
  const res = await request(app).post('/api/auth/login').send({ email, password })
  return { status: res.status, cookie: res.headers['set-cookie'], body: res.body, headers: res.headers }
}

describe('Step 2 — Security, RBAC, IDOR, Session, CSRF & Serverless Rate Limiting', () => {
  it('1. Cross-team client isolation: Marketing Head cannot edit clients created by another team; Super Admin can', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'c-super@test.com')
    const headA = await createUser('MARKETING_HEAD', 'c-heada@test.com')
    const headB = await createUser('MARKETING_HEAD', 'c-headb@test.com')
    const execA = await createUser('MARKETING_EXECUTIVE', 'c-execa@test.com', String(headA._id))

    const clientB = await Client.create({
      organisationName: 'Team B Hospital',
      category: 'Hospital',
      address: 'Salt Lake',
      phone: '9830011111',
      createdBy: headB._id,
    })
    const clientTeamA = await Client.create({
      organisationName: 'Team A Lab',
      category: 'Clinic',
      address: 'Park Street',
      phone: '9830022222',
      createdBy: execA._id,
    })

    const [{ cookie: superCookie }, { cookie: headACookie }, { cookie: execACookie }] = await Promise.all([
      login(superAdmin.email),
      login(headA.email),
      login(execA.email),
    ])

    // Cross-team Marketing Head edit blocked (403)
    const crossEdit = await request(app)
      .patch(`/api/clients/${clientB._id}`)
      .set('Cookie', headACookie)
      .send({ organisationName: 'Hijacked Hospital', category: 'Hospital', address: 'Salt Lake', phone: '9830011111' })
    expect(crossEdit.status).toBe(403)

    // Executive edit blocked (403)
    const execEdit = await request(app)
      .patch(`/api/clients/${clientTeamA._id}`)
      .set('Cookie', execACookie)
      .send({ organisationName: 'Exec Edit', category: 'Clinic', address: 'Park Street', phone: '9830022222' })
    expect(execEdit.status).toBe(403)

    // Own team client edit by Head A succeeds (200)
    const ownTeamEdit = await request(app)
      .patch(`/api/clients/${clientTeamA._id}`)
      .set('Cookie', headACookie)
      .send({ organisationName: 'Team A Lab Updated', category: 'Clinic', address: 'Park Street', phone: '9830022222' })
    expect(ownTeamEdit.status).toBe(200)

    // Super Admin can edit any client (200)
    const superEdit = await request(app)
      .patch(`/api/clients/${clientB._id}`)
      .set('Cookie', superCookie)
      .send({ organisationName: 'Team B Hospital Official', category: 'Hospital', address: 'Salt Lake', phone: '9830011111' })
    expect(superEdit.status).toBe(200)
  })

  it('2. Cross-team visit access after reassignment: Previous Head loses operational access while new Head & Super Admin retain access', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'v-super@test.com')
    const headA = await createUser('MARKETING_HEAD', 'v-heada@test.com')
    const headB = await createUser('MARKETING_HEAD', 'v-headb@test.com')
    const exec = await createUser('MARKETING_EXECUTIVE', 'v-exec@test.com', String(headA._id))
    const client = await Client.create({
      organisationName: 'Visit Scope Clinic',
      category: 'Clinic',
      address: 'Sector 1',
      phone: '9830033333',
      createdBy: superAdmin._id,
    })

    const visit = await Visit.create({
      client: client._id,
      assignedTo: exec._id,
      assignedBy: headA._id,
      marketingHeadAtAssignment: headA._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date(),
      status: 'ARRIVED',
    })

    // Reassign executive from Head A to Head B
    const { cookie: superCookie } = await login(superAdmin.email)
    await request(app)
      .patch(`/api/users/${exec._id}/reporting`)
      .set('Cookie', superCookie)
      .send({ reportingTo: String(headB._id) })

    const [{ cookie: headACookie }, { cookie: headBCookie }] = await Promise.all([
      login(headA.email),
      login(headB.email),
    ])

    // Head A can no longer fetch visit or authorize exception after reassignment
    expect((await request(app).get(`/api/visits/${visit._id}`).set('Cookie', headACookie)).status).toBe(404)
    expect(
      (
        await request(app)
          .post(`/api/visits/${visit._id}/authorize-exception`)
          .set('Cookie', headACookie)
          .send({ reason: 'Old manager trying to bypass' })
      ).status
    ).toBe(403)

    // New team manager Head B can inspect visit and authorize exception
    expect((await request(app).get(`/api/visits/${visit._id}`).set('Cookie', headBCookie)).status).toBe(200)
    expect(
      (
        await request(app)
          .post(`/api/visits/${visit._id}/authorize-exception`)
          .set('Cookie', headBCookie)
          .send({ reason: 'Approved by new manager' })
      ).status
    ).toBe(200)

    // Historical attribution on the visit document remains unchanged
    const updatedVisit = await Visit.findById(visit._id).lean()
    expect(String(updatedVisit?.marketingHeadAtAssignment)).toBe(String(headA._id))
  })

  it('3. Unauthorized file viewing & XSS SVG escaping: Rejects cross-team/executive access and escapes SVG filenames', async () => {
    const headA = await createUser('MARKETING_HEAD', 'f-heada@test.com')
    const headB = await createUser('MARKETING_HEAD', 'f-headb@test.com')
    const execA = await createUser('MARKETING_EXECUTIVE', 'f-execa@test.com', String(headA._id))
    const execB = await createUser('MARKETING_EXECUTIVE', 'f-execb@test.com', String(headB._id))
    const client = await Client.create({
      organisationName: 'File Clinic',
      category: 'Clinic',
      address: 'Kolkata',
      phone: '9830044444',
      createdBy: headA._id,
    })
    const visitA = await Visit.create({
      client: client._id,
      assignedTo: execA._id,
      assignedBy: headA._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date(),
      status: 'ASSIGNED',
    })

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    const { cookie: execACookie } = await login(execA.email)
    const { cookie: execBCookie } = await login(execB.email)
    const { cookie: headBCookie } = await login(headB.email)

    const uploadRes = await request(app)
      .post('/api/files/upload')
      .set('Cookie', execACookie)
      .attach('file', pngHeader, 'proof&clinic<tag>.png')
      .field('ownerType', 'VISIT_PHOTO')
      .field('ownerId', String(visitA._id))

    expect(uploadRes.status).toBe(201)
    const fileId = uploadRes.body.data.asset._id

    // Cross-executive & cross-team Marketing Head blocked
    expect((await request(app).get(`/api/files/${fileId}/view`).set('Cookie', execBCookie)).status).toBe(403)
    expect((await request(app).get(`/api/files/${fileId}/view`).set('Cookie', headBCookie)).status).toBe(403)

    // Authorized executive view escapes XML inside mock SVG preview
    const okView = await request(app).get(`/api/files/${fileId}/view`).set('Cookie', execACookie)
    expect(okView.status).toBe(200)
    const svgText = Buffer.isBuffer(okView.body) ? okView.body.toString('utf8') : String(okView.text || '')
    expect(svgText).not.toContain('<tag>')
    expect(svgText).toContain('proof&amp;clinic_tag_.png')
  })

  it('4. Staff permission escalation & team-scoped audit logs', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 's-super@test.com')
    const headA = await createUser('MARKETING_HEAD', 's-heada@test.com')
    const headB = await createUser('MARKETING_HEAD', 's-headb@test.com')
    const execA = await createUser('MARKETING_EXECUTIVE', 's-execa@test.com', String(headA._id))

    await AuditEvent.create([
      { actor: superAdmin._id, action: 'SETTING_UPDATED', entityType: 'Setting', entityId: superAdmin._id },
      { actor: headB._id, action: 'VISIT_ASSIGNED', entityType: 'Visit', entityId: headB._id },
      { actor: execA._id, action: 'VISIT_CHECKED_IN', entityType: 'Visit', entityId: execA._id },
    ])

    const [{ cookie: headACookie }, { cookie: execACookie }] = await Promise.all([
      login(headA.email),
      login(execA.email),
    ])

    // Executive cannot create users or read audit logs
    expect(
      (
        await request(app)
          .post('/api/auth/users')
          .set('Cookie', execACookie)
          .send({ name: 'Hacker', email: 'h@test.com', password: 'password123', role: 'MARKETING_EXECUTIVE' })
      ).status
    ).toBe(403)
    expect((await request(app).get('/api/audit-logs').set('Cookie', execACookie)).status).toBe(403)

    // Marketing Head cannot promote to MARKETING_HEAD or reassign executives
    expect(
      (
        await request(app)
          .post('/api/auth/users')
          .set('Cookie', headACookie)
          .send({ name: 'Rogue Head', email: 'rh@test.com', password: 'password123', role: 'MARKETING_HEAD' })
      ).status
    ).toBe(403)
    expect(
      (
        await request(app)
          .patch(`/api/users/${execA._id}/reporting`)
          .set('Cookie', headACookie)
          .send({ reportingTo: String(headB._id) })
      ).status
    ).toBe(403)

    // Marketing Head GET /api/audit-logs only returns own/team events
    const headLogs = await request(app).get('/api/audit-logs').set('Cookie', headACookie)
    expect(headLogs.status).toBe(200)
    expect(headLogs.body.data.items).toHaveLength(1)
    expect(headLogs.body.data.items[0].action).toBe('VISIT_CHECKED_IN')
  })

  it('5. Notification ownership: Users cannot mark read or delete another user notifications', async () => {
    const userA = await createUser('MARKETING_EXECUTIVE', 'n-a@test.com')
    const userB = await createUser('MARKETING_EXECUTIVE', 'n-b@test.com')
    const notifB = await Notification.create({
      recipient: userB._id,
      title: 'Private Alert',
      message: 'Confidential B message',
      type: 'VISIT_ASSIGNED',
    })

    const { cookie: cookieA } = await login(userA.email)
    const readRes = await request(app).post(`/api/notifications/${notifB._id}/read`).set('Cookie', cookieA)
    expect(readRes.body.data).toEqual({ read: false })
    const delRes = await request(app).delete(`/api/notifications/${notifB._id}`).set('Cookie', cookieA)
    expect(delRes.body.data).toEqual({ deleted: false })
    expect(await Notification.findById(notifB._id)).not.toBeNull()
  })

  it('6. CSRF & CORS enforcement: Rejects disallowed Origin, foreign Referer, and Sec-Fetch-Site: cross-site', async () => {
    const user = await createUser('SUPER_ADMIN', 'csrf@test.com')
    const { cookie } = await login(user.email)

    const badOrigin = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil-phish.example.com')
      .send({ name: 'Malicious Cat' })
    expect(badOrigin.status).toBe(403)

    const badReferer = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .set('Referer', 'https://evil-phish.example.com/attack.html')
      .send({ name: 'Malicious Cat' })
    expect(badReferer.status).toBe(403)

    const crossSiteHeader = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ name: 'Malicious Cat' })
    expect(crossSiteHeader.status).toBe(403)
  })

  it('7. Distributed MongoDB TTL rate limiting: Enforces 15-attempt login limit, hashes keys, and fails closed (503) on DB error', async () => {
    await createUser('MARKETING_EXECUTIVE', 'ratelimit@test.com')

    for (let i = 0; i < 15; i++) {
      const res = await login('ratelimit@test.com', 'wrongpass123')
      expect(res.status).toBe(401)
    }

    // 16th attempt hits distributed 429 limit
    const blocked = await login('ratelimit@test.com', 'password123')
    expect(blocked.status).toBe(429)
    expect(blocked.headers['retry-after']).toBeDefined()

    // Keys stored in Atlas must be SHA-256 hashed (never raw plaintext email)
    const buckets = await RateLimitBucket.find({}).lean()
    expect(buckets.some((b) => b.key.includes('ratelimit@test.com'))).toBe(false)
    expect(buckets.some((b) => b.key.startsWith('auth_login_acct:'))).toBe(true)

    // Simulated DB store failure fails closed with 503 (never unlimited)
    const dbSpy = vi.spyOn(RateLimitBucket, 'findOneAndUpdate').mockRejectedValueOnce(new Error('Atlas M0 unreachable'))
    const failClosedRes = await login('ratelimit@test.com', 'password123')
    expect(failClosedRes.status).toBe(503)
    dbSpy.mockRestore()
  })

  it('8. Two-session revocation: Both password change and logout-all invalidate prior device sessions', async () => {
    const user = await createUser('MARKETING_EXECUTIVE', 'two-session@test.com')
    const session1 = await login(user.email)
    const session2 = await login(user.email)

    expect((await request(app).get('/api/users/me').set('Cookie', session1.cookie)).status).toBe(200)
    expect((await request(app).get('/api/users/me').set('Cookie', session2.cookie)).status).toBe(200)

    // Changing password via session 1 invalidates session 2
    const changePw = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', session1.cookie)
      .send({ currentPassword: 'password123', newPassword: 'NewPassword456!' })
    expect(changePw.status).toBe(200)
    expect((await request(app).get('/api/users/me').set('Cookie', session2.cookie)).status).toBe(401)

    // Re-login two sessions, then logout-all revokes all sessions
    const s3 = await login(user.email, 'NewPassword456!')
    const s4 = await login(user.email, 'NewPassword456!')
    const logoutAll = await request(app).post('/api/auth/logout-all').set('Cookie', s3.cookie)
    expect(logoutAll.status).toBe(200)
    expect((await request(app).get('/api/users/me').set('Cookie', s3.cookie)).status).toBe(401)
    expect((await request(app).get('/api/users/me').set('Cookie', s4.cookie)).status).toBe(401)
  })

  it('9. Input hardening: Rejects external avatar/logo URLs, malformed ObjectIds (422), alg:none JWTs, and strips $ keys', async () => {
    const admin = await createUser('SUPER_ADMIN', 'harden@test.com')
    const { cookie } = await login(admin.email)

    // External avatar / org logo URL injection blocked (422)
    const badAvatar = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookie)
      .send({ name: 'Admin', avatar: 'https://evil.example.com/tracker.png' })
    expect(badAvatar.status).toBe(422)

    const badOrgLogo = await request(app)
      .patch('/api/organization')
      .set('Cookie', cookie)
      .send({ name: 'Excel Tech', expandedLogo: 'https://evil.example.com/logo.png' })
    expect(badOrgLogo.status).toBe(422)

    // Valid internal CRM file route passes
    const validOrgLogo = await request(app)
      .patch('/api/organization')
      .set('Cookie', cookie)
      .send({ name: 'Excel Tech', expandedLogo: '/api/files/507f1f77bcf86cd799439011/view' })
    expect(validOrgLogo.status).toBe(200)

    // Malformed IDs return 422 instead of 500 CastError
    expect((await request(app).get('/api/visits/not-valid-id').set('Cookie', cookie)).status).toBe(422)
    expect((await request(app).delete('/api/notifications/not-valid-id').set('Cookie', cookie)).status).toBe(422)
    expect((await request(app).patch('/api/users/not-valid-id/status').set('Cookie', cookie).send({ isActive: false })).status).toBe(422)

    // ReDoS input on category search safely escaped
    const redosRes = await request(app).get('/api/categories?q=(a+)+$').set('Cookie', cookie)
    expect(redosRes.status).toBe(200)

    // Unsigned / alg:none forged JWT rejected
    const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const fakePayload = Buffer.from(JSON.stringify({ id: String(admin._id), role: 'SUPER_ADMIN', tokenVersion: 0 })).toString('base64url')
    const forgedToken = `${fakeHeader}.${fakePayload}.`
    expect((await request(app).get('/api/users/me').set('Cookie', [`accessToken=${forgedToken}`])).status).toBe(401)
    expect(jwt).toBeDefined()
  })
})
