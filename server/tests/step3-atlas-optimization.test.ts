import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
let Client: typeof import('../src/models/Client.js')['Client']
let Visit: typeof import('../src/models/Visit.js')['Visit']
let Notification: typeof import('../src/models/Notification.js')['Notification']
let AuditEvent: typeof import('../src/models/AuditEvent.js')['AuditEvent']
let Category: typeof import('../src/models/Category.js')['Category']
let Setting: typeof import('../src/models/Setting.js')['Setting']
let FileAsset: typeof import('../src/models/FileAsset.js')['FileAsset']
let PushSubscription: typeof import('../src/models/PushSubscription.js')['PushSubscription']

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
    catMod,
    settingMod,
    fileMod,
    pushMod,
    { connectDatabase },
  ] = await Promise.all([
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/Client.js'),
    import('../src/models/Visit.js'),
    import('../src/models/Notification.js'),
    import('../src/models/AuditEvent.js'),
    import('../src/models/Category.js'),
    import('../src/models/Setting.js'),
    import('../src/models/FileAsset.js'),
    import('../src/models/PushSubscription.js'),
    import('../src/config/db.js'),
  ])

  User = userMod.User
  Client = clientMod.Client
  Visit = visitMod.Visit
  Notification = notifMod.Notification
  AuditEvent = auditMod.AuditEvent
  Category = catMod.Category
  Setting = settingMod.Setting
  FileAsset = fileMod.FileAsset
  PushSubscription = pushMod.PushSubscription

  await connectDatabase(mongo.getUri())
  app = createApp()
})

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Client.deleteMany({}),
    Visit.deleteMany({}),
    Notification.deleteMany({}),
    AuditEvent.deleteMany({}),
  ])
})

afterAll(async () => {
  const mongoose = await import('mongoose')
  await mongoose.default.disconnect()
  if (mongo) await mongo.stop()
})

function hasDuplicateIndexes(indexes: Array<[Record<string, unknown>, Record<string, unknown>]>): string[] {
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const [spec] of indexes) {
    const key = JSON.stringify(spec)
    if (seen.has(key)) duplicates.push(key)
    seen.add(key)
  }
  return duplicates
}

describe('Step 3 — MongoDB Atlas M0 Query & Index Optimization', () => {
  it('1. getReport executes a single $facet aggregation pipeline (zero duplicate Visit.aggregate calls) with accurate summary', async () => {
    const admin = await User.create({
      name: 'Report Admin',
      email: 'r-admin@test.com',
      passwordHash: await bcrypt.hash('password123', 10),
      role: 'SUPER_ADMIN',
      isActive: true,
    })
    const exec = await User.create({
      name: 'Report Exec',
      email: 'r-exec@test.com',
      passwordHash: await bcrypt.hash('password123', 10),
      role: 'MARKETING_EXECUTIVE',
      isActive: true,
    })
    const client = await Client.create({
      organisationName: 'Apollo Diagnostics',
      category: 'Diagnostic',
      address: 'Salt Lake',
      phone: '9830011111',
      createdBy: admin._id,
    })

    const today = new Date()
    await Visit.create([
      { client: client._id, assignedTo: exec._id, assignedBy: admin._id, source: 'ADMIN_ASSIGNED', plannedDate: today, status: 'COMPLETED' },
      { client: client._id, assignedTo: exec._id, assignedBy: admin._id, source: 'ADMIN_ASSIGNED', plannedDate: today, status: 'ASSIGNED' },
      { client: client._id, assignedTo: exec._id, assignedBy: admin._id, source: 'ADMIN_ASSIGNED', plannedDate: today, status: 'CANCELLED', cancellationReason: 'Closed' },
    ])

    const loginRes = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })
    const cookie = loginRes.headers['set-cookie']

    const aggSpy = vi.spyOn(Visit, 'aggregate')
    const reportRes = await request(app).get('/api/reports/client?page=1&limit=2').set('Cookie', cookie)

    expect(reportRes.status).toBe(200)
    expect(aggSpy).toHaveBeenCalledTimes(1)
    expect(reportRes.body.data.items).toHaveLength(2)
    expect(reportRes.body.data.total).toBe(3)
    expect(reportRes.body.data.pages).toBe(2)
    expect(reportRes.body.data.summary).toEqual({
      total: 3,
      completed: 1,
      pending: 1,
      cancelled: 1,
    })

    aggSpy.mockRestore()
  })

  it('2. Bounded pagination and export guardrails prevent unbounded result explosions on Atlas M0 / Vercel', async () => {
    const admin = await User.create({
      name: 'Cap Admin',
      email: 'cap-admin@test.com',
      passwordHash: await bcrypt.hash('password123', 10),
      role: 'SUPER_ADMIN',
      isActive: true,
    })
    await User.create([
      { name: 'Staff 1', email: 's1@test.com', passwordHash: 'hashhashhash', role: 'MARKETING_EXECUTIVE', isActive: true },
      { name: 'Staff 2', email: 's2@test.com', passwordHash: 'hashhashhash', role: 'MARKETING_EXECUTIVE', isActive: true },
      { name: 'Staff 3', email: 's3@test.com', passwordHash: 'hashhashhash', role: 'MARKETING_EXECUTIVE', isActive: true },
    ])

    const loginRes = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })
    const cookie = loginRes.headers['set-cookie']

    // Clamped limit=999 -> max 100
    expect((await request(app).get('/api/clients?limit=999').set('Cookie', cookie)).body.data.limit).toBe(100)
    expect((await request(app).get('/api/visits?limit=999').set('Cookie', cookie)).body.data.limit).toBe(100)
    expect((await request(app).get('/api/audit-logs?limit=999').set('Cookie', cookie)).body.data.limit).toBe(100)

    // Users list supports bounded ?limit=
    const limitedStaff = await request(app).get('/api/users?limit=2').set('Cookie', cookie)
    expect(limitedStaff.status).toBe(200)
    expect(limitedStaff.body.data).toHaveLength(2)

    // Oversized export > 5000 rows returns clear 422 instead of OOM
    const { MAX_EXPORT_ROWS } = await import('../src/services/report.js')
    const oversizeSpy = vi.spyOn(Visit, 'aggregate').mockResolvedValueOnce(
      Array.from({ length: MAX_EXPORT_ROWS + 1 }, () => ({}))
    )
    const exportFail = await request(app).get('/api/reports/export?view=client&format=csv').set('Cookie', cookie)
    expect(exportFail.status).toBe(422)
    expect(exportFail.body.error.message).toContain('5,000-row limit')
    oversizeSpy.mockRestore()
  })

  it('3. Models have zero duplicate schema indexes and declare justified Atlas M0 compound indexes', async () => {
    const modelsToCheck = [
      ['User', User],
      ['Visit', Visit],
      ['Client', Client],
      ['Notification', Notification],
      ['AuditEvent', AuditEvent],
      ['Category', Category],
      ['Setting', Setting],
      ['FileAsset', FileAsset],
      ['PushSubscription', PushSubscription],
    ] as const

    for (const [name, model] of modelsToCheck) {
      const idx = model.schema.indexes()
      const dups = hasDuplicateIndexes(idx as never)
      expect(dups, `Duplicate schema indexes in ${name}`).toEqual([])
    }

    const visitIndexKeys = Visit.schema.indexes().map(([spec]) => JSON.stringify(spec))
    expect(visitIndexKeys).toContain(JSON.stringify({ plannedDate: -1, status: 1 }))
    expect(visitIndexKeys).toContain(JSON.stringify({ assignedTo: 1, status: 1, plannedDate: -1 }))
    expect(visitIndexKeys).toContain(JSON.stringify({ followUpDate: 1, status: 1 }))

    const notifIndexKeys = Notification.schema.indexes().map(([spec]) => JSON.stringify(spec))
    expect(notifIndexKeys).toContain(JSON.stringify({ recipient: 1, createdAt: -1 }))
    expect(notifIndexKeys).toContain(JSON.stringify({ recipient: 1, readAt: 1 }))

    const clientIndexKeys = Client.schema.indexes().map(([spec]) => JSON.stringify(spec))
    expect(clientIndexKeys).toContain(JSON.stringify({ isActive: 1, createdAt: -1 }))

    const auditIndexKeys = AuditEvent.schema.indexes().map(([spec]) => JSON.stringify(spec))
    expect(auditIndexKeys).toContain(JSON.stringify({ actor: 1, timestamp: -1 }))
  })
})

