import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { MongoMemoryServer } from 'mongodb-memory-server'

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
let Setting: typeof import('../src/models/Setting.js')['Setting']
let AuditEvent: typeof import('../src/models/AuditEvent.js')['AuditEvent']

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  const [{ createApp }, userMod, clientMod, visitMod, settingMod, auditMod, { connectDatabase }] = await Promise.all([
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/Client.js'),
    import('../src/models/Visit.js'),
    import('../src/models/Setting.js'),
    import('../src/models/AuditEvent.js'),
    import('../src/config/db.js'),
  ])
  app = createApp()
  User = userMod.User
  Client = clientMod.Client
  Visit = visitMod.Visit
  Setting = settingMod.Setting
  AuditEvent = auditMod.AuditEvent
  await connectDatabase()
}, 120000)

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Client.deleteMany({}),
    Visit.deleteMany({}),
    Setting.deleteMany({}),
    AuditEvent.deleteMany({}),
  ])
})

afterAll(async () => {
  const mongoose = await import('mongoose')
  await mongoose.default.disconnect()
  if (mongo) await mongo.stop()
})

async function createUser(role: 'SUPER_ADMIN' | 'MARKETING_HEAD' | 'MARKETING_EXECUTIVE', email: string, reportingTo?: string) {
  const passwordHash = await bcrypt.hash('password123', 10)
  return User.create({
    name: email.split('@')[0],
    email,
    passwordHash,
    role,
    reportingTo: reportingTo ?? null,
    isActive: true,
  })
}

async function loginUser(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
  return res.headers['set-cookie']
}

describe('GPS Geofencing and Visit Location Verification', () => {
  const CLIENT_LAT = 22.52590
  const CLIENT_LNG = 88.38620

  async function setupVisit(clientOverrides = {}) {
    const superAdmin = await createUser('SUPER_ADMIN', 'super@geofence.com')
    const manager = await createUser('MARKETING_HEAD', 'manager@geofence.com')
    const executive = await createUser('MARKETING_EXECUTIVE', 'exec@geofence.com', String(manager._id))

    const client = await Client.create({
      organisationName: 'BMRI Kolkata Hospital',
      category: 'Hospital',
      address: '68, Dr G S Bose Rd, Kolkata',
      latitude: CLIENT_LAT,
      longitude: CLIENT_LNG,
      phone: '9876543210',
      createdBy: manager._id,
      ...clientOverrides,
    })

    const visit = await Visit.create({
      client: client._id,
      assignedTo: executive._id,
      assignedBy: manager._id,
      marketingHeadAtAssignment: manager._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date(),
      status: 'ASSIGNED',
    })

    const execCookie = await loginUser(executive.email)
    const managerCookie = await loginUser(manager.email)
    const superCookie = await loginUser(superAdmin.email)

    // Executive marks arrived
    const arrivedRes = await request(app)
      .post(`/api/visits/${visit._id}/arrived`)
      .set('Cookie', execCookie)
    expect(arrivedRes.status).toBe(200)

    return { superAdmin, manager, executive, client, visit, execCookie, managerCookie, superCookie }
  }

  it('1. Inside 20m: Allows check-in with VERIFIED status and calculated distance', async () => {
    const { visit, execCookie } = await setupVisit()

    // 22.52608 is ~20m from 22.52590
    const res = await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.52608,
        longitude: CLIENT_LNG,
        accuracy: 10,
        recordedAt: new Date().toISOString(),
        locationStatus: 'AVAILABLE',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('CHECKED_IN')
    expect(res.body.data.checkIn.verificationStatus).toBe('VERIFIED')
    expect(res.body.data.checkIn.distanceFromClient).toBeLessThanOrEqual(25)
    expect(res.body.data.checkIn.allowedRadius).toBe(50)
  })

  it('2. Inside 50m: Allows check-in at boundary (~44m)', async () => {
    const { visit, execCookie } = await setupVisit()

    // 22.52630 is ~44m from 22.52590
    const res = await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.52630,
        longitude: CLIENT_LNG,
        accuracy: 12,
        recordedAt: new Date().toISOString(),
        locationStatus: 'AVAILABLE',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('CHECKED_IN')
    expect(res.body.data.checkIn.verificationStatus).toBe('VERIFIED')
    expect(res.body.data.checkIn.distanceFromClient).toBeLessThanOrEqual(50)
  })

  it('3. Outside 50m: Rejects check-in and returns clear error with measured distance', async () => {
    const { visit, execCookie } = await setupVisit()

    // 22.52666 is ~85m from 22.52590
    const res = await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.52666,
        longitude: CLIENT_LNG,
        accuracy: 10,
        recordedAt: new Date().toISOString(),
        locationStatus: 'AVAILABLE',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/85m.*50m/)

    // Visit status remains ARRIVED
    const fresh = await Visit.findById(visit._id)
    expect(fresh?.status).toBe('ARRIVED')
  })

  it('4. Poor GPS accuracy: Rejects check-in when accuracy is insufficient (>100m)', async () => {
    const { visit, execCookie } = await setupVisit()

    // Position is inside (20m), but accuracy is poor (150m)
    const res = await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.52608,
        longitude: CLIENT_LNG,
        accuracy: 150,
        recordedAt: new Date().toISOString(),
        locationStatus: 'AVAILABLE',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/accuracy is insufficient/i)
  })

  it('5. Stale GPS: Rejects check-in when GPS reading is older than staleness threshold', async () => {
    const { visit, execCookie } = await setupVisit()

    // Timestamp is 10 minutes ago
    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const res = await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.52608,
        longitude: CLIENT_LNG,
        accuracy: 10,
        recordedAt: staleTime,
        locationStatus: 'AVAILABLE',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/stale/i)
  })

  it('6. Missing client coordinates: Rejects normal check-in and demands exception', async () => {
    const { visit, execCookie } = await setupVisit({ latitude: undefined, longitude: undefined })

    const res = await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.52608,
        longitude: CLIENT_LNG,
        accuracy: 10,
        recordedAt: new Date().toISOString(),
        locationStatus: 'AVAILABLE',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/registered GPS coordinates/i)
  })

  it('7. GPS unavailable: Rejects check-in without silent bypass', async () => {
    const { visit, execCookie } = await setupVisit()

    const res = await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        locationStatus: 'LOCATION_UNAVAILABLE',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/GPS location is required/i)
  })

  it('8. Checkout 500m away: Allows checkout and marks OUTSIDE_GEOFENCE with actual distance', async () => {
    const { visit, execCookie } = await setupVisit()

    // First do verified check-in
    await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.52608,
        longitude: CLIENT_LNG,
        accuracy: 10,
        recordedAt: new Date().toISOString(),
        locationStatus: 'AVAILABLE',
      })

    // Checkout at 500m away (22.53040)
    const checkoutRes = await request(app)
      .post(`/api/visits/${visit._id}/complete`)
      .set('Cookie', execCookie)
      .send({
        remarks: 'Meeting completed, executive left the premises',
        location: {
          latitude: 22.53040,
          longitude: CLIENT_LNG,
          accuracy: 15,
          locationStatus: 'AVAILABLE',
        },
      })

    expect(checkoutRes.status).toBe(200)
    expect(checkoutRes.body.data.status).toBe('COMPLETED')
    expect(checkoutRes.body.data.checkOut.verificationStatus).toBe('OUTSIDE_GEOFENCE')
    expect(checkoutRes.body.data.checkOut.distanceFromClient).toBeGreaterThanOrEqual(490)
    expect(checkoutRes.body.data.checkOut.distanceFromClient).toBeLessThanOrEqual(510)
  })

  it('9. Checkout 1km away: Allows checkout and stores distance', async () => {
    const { visit, execCookie } = await setupVisit()

    await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.52608,
        longitude: CLIENT_LNG,
        accuracy: 10,
        locationStatus: 'AVAILABLE',
      })

    // Checkout 1km away (22.53490)
    const checkoutRes = await request(app)
      .post(`/api/visits/${visit._id}/complete`)
      .set('Cookie', execCookie)
      .send({
        remarks: 'Checked out from transit',
        location: {
          latitude: 22.53490,
          longitude: CLIENT_LNG,
          accuracy: 20,
          locationStatus: 'AVAILABLE',
        },
      })

    expect(checkoutRes.status).toBe(200)
    expect(checkoutRes.body.data.status).toBe('COMPLETED')
    expect(checkoutRes.body.data.checkOut.verificationStatus).toBe('OUTSIDE_GEOFENCE')
    expect(checkoutRes.body.data.checkOut.distanceFromClient).toBeGreaterThanOrEqual(990)
  })

  it('10. Tampered frontend distance: Recalculates true distance and rejects false distance claim', async () => {
    const { visit, execCookie } = await setupVisit()

    // Frontend maliciously claims distance: 5 and verificationStatus: 'VERIFIED'
    // but actual coordinates are 85m away
    const res = await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.52666, // 85m away
        longitude: CLIENT_LNG,
        accuracy: 10,
        distance: 5,
        distanceFromClient: 5,
        verificationStatus: 'VERIFIED',
        locationStatus: 'AVAILABLE',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/85m.*50m/)
  })

  it('11. Unauthorized bypass: Rejects executive attempt to bypass geofencing with unapproved exception', async () => {
    const { visit, execCookie } = await setupVisit()

    // Executive tries to check-in outside radius with allowException
    const res = await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.52666,
        longitude: CLIENT_LNG,
        locationStatus: 'AVAILABLE',
        allowException: true,
        exceptionReason: 'I am here trust me',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toMatch(/not been authorized/i)
  })

  it('12. Approved exception: Marketing Head or Super Admin authorizes exception, allowing check-in', async () => {
    const { visit, execCookie, managerCookie } = await setupVisit()

    // Marketing Head authorizes exception
    const authRes = await request(app)
      .post(`/api/visits/${visit._id}/authorize-exception`)
      .set('Cookie', managerCookie)
      .send({ reason: 'Client clinic in basement with no GPS reception' })

    expect(authRes.status).toBe(200)
    expect(authRes.body.data.exceptionAuthorized).toBe(true)

    // Now executive can check in with exception
    const checkInRes = await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        locationStatus: 'LOCATION_UNAVAILABLE',
        allowException: true,
      })

    expect(checkInRes.status).toBe(200)
    expect(checkInRes.body.data.status).toBe('CHECKED_IN')
    expect(checkInRes.body.data.checkIn.verificationStatus).toBe('EXCEPTION_APPROVED')
    expect(checkInRes.body.data.checkIn.exceptionReason).toMatch(/basement/i)

    // Audit trail verification
    const audit = await AuditEvent.findOne({ action: 'VISIT_CHECKED_IN_EXCEPTION', entityId: visit._id })
    expect(audit).toBeTruthy()
  })

  it('13. Historical visit data preservation: Preserves legacy checkIn/checkOut without errors', async () => {
    const { client, executive, manager, superCookie } = await setupVisit()

    const legacyVisit = await Visit.create({
      client: client._id,
      assignedTo: executive._id,
      assignedBy: manager._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date('2026-01-01'),
      status: 'COMPLETED',
      checkIn: {
        latitude: 22.52590,
        longitude: 88.38620,
        recordedAt: new Date('2026-01-01T10:00:00Z'),
        locationStatus: 'AVAILABLE',
      },
      checkOut: {
        latitude: 22.52590,
        longitude: 88.38620,
        recordedAt: new Date('2026-01-01T11:00:00Z'),
        locationStatus: 'AVAILABLE',
      },
    })

    const res = await request(app)
      .get(`/api/visits/${legacyVisit._id}`)
      .set('Cookie', superCookie)

    expect(res.status).toBe(200)
    expect(res.body.data.checkIn.latitude).toBe(22.52590)
    expect(res.body.data.checkOut.latitude).toBe(22.52590)
  })

  it('14. Configuration: Super Admin can configure geofence radius and settings are enforced', async () => {
    const { visit, execCookie, superCookie, managerCookie } = await setupVisit()

    // Non-super-admin cannot update setting
    const forbidden = await request(app)
      .patch('/api/settings/geofence')
      .set('Cookie', managerCookie)
      .send({ defaultRadius: 100 })
    expect(forbidden.status).toBe(403)

    // Super Admin updates default radius to 100m
    const updateRes = await request(app)
      .patch('/api/settings/geofence')
      .set('Cookie', superCookie)
      .send({ defaultRadius: 100 })
    expect(updateRes.status).toBe(200)
    expect(updateRes.body.data.defaultRadius).toBe(100)

    // Now executive checking in at 85m (which was rejected under 50m) is VERIFIED!
    const res = await request(app)
      .post(`/api/visits/${visit._id}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.52666, // 85m away
        longitude: CLIENT_LNG,
        accuracy: 10,
        recordedAt: new Date().toISOString(),
        locationStatus: 'AVAILABLE',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.checkIn.verificationStatus).toBe('VERIFIED')
    expect(res.body.data.checkIn.allowedRadius).toBe(100)
  })

  it('15. Population: listVisits and getVisit populate client coordinates, geofenceRadius, and placeId', async () => {
    const { visit, execCookie, superCookie } = await setupVisit({
      latitude: 22.52590,
      longitude: 88.38620,
      geofenceRadius: 65,
      placeId: 'ola-place-123',
      formattedAddress: '68, Dr G S Bose Rd, Kolkata, India',
    })

    // Test getVisit
    const getRes = await request(app)
      .get(`/api/visits/${visit._id}`)
      .set('Cookie', execCookie)

    expect(getRes.status).toBe(200)
    expect(getRes.body.data.client.latitude).toBe(22.52590)
    expect(getRes.body.data.client.longitude).toBe(88.38620)
    expect(getRes.body.data.client.geofenceRadius).toBe(65)
    expect(getRes.body.data.client.placeId).toBe('ola-place-123')
    expect(getRes.body.data.client.formattedAddress).toBe('68, Dr G S Bose Rd, Kolkata, India')

    // Test listVisits
    const listRes = await request(app)
      .get('/api/visits')
      .set('Cookie', superCookie)

    expect(listRes.status).toBe(200)
    const target = listRes.body.data.items.find((v: { _id: string; client: { latitude: number; longitude: number; geofenceRadius: number } }) => v._id === String(visit._id))
    expect(target).toBeDefined()
    expect(target.client.latitude).toBe(22.52590)
    expect(target.client.longitude).toBe(88.38620)
    expect(target.client.geofenceRadius).toBe(65)
  })

  it('16. Client Persistence: Coordinates are persisted during creation and preserved or invalidated on edit', async () => {
    await createUser('SUPER_ADMIN', 'admin_persist@test.com')
    const superCookie = await loginUser('admin_persist@test.com')

    // 1. Create client with coordinates
    const createRes = await request(app)
      .post('/api/clients')
      .set('Cookie', superCookie)
      .send({
        organisationName: 'Persist Hospital',
        category: 'Hospital',
        address: '100 Medical Road, Kolkata',
        phone: '9876543210',
        latitude: 22.5259,
        longitude: 88.3862,
        geofenceRadius: 75,
        placeId: 'test-place-999',
        formattedAddress: '100 Medical Road, Kolkata, WB',
      })

    expect(createRes.status).toBe(201)
    const clientId = createRes.body.data._id
    expect(createRes.body.data.latitude).toBe(22.5259)
    expect(createRes.body.data.longitude).toBe(88.3862)
    expect(createRes.body.data.geofenceRadius).toBe(75)

    // 2. Edit unrelated field (phone) without passing coords - coords are preserved
    const editRes1 = await request(app)
      .patch(`/api/clients/${clientId}`)
      .set('Cookie', superCookie)
      .send({
        organisationName: 'Persist Hospital',
        category: 'Hospital',
        address: '100 Medical Road, Kolkata',
        phone: '9876543210',
      })

    expect(editRes1.status).toBe(200)
    expect(editRes1.body.data.latitude).toBe(22.5259)
    expect(editRes1.body.data.longitude).toBe(88.3862)

    // 3. Manual address change with explicit null coordinates invalidates stale coordinates
    const editRes2 = await request(app)
      .patch(`/api/clients/${clientId}`)
      .set('Cookie', superCookie)
      .send({
        organisationName: 'Persist Hospital',
        category: 'Hospital',
        address: 'New Unverified Address, Kolkata',
        phone: '9876543210',
        latitude: null,
        longitude: null,
        placeId: null,
        formattedAddress: null,
      })

    expect(editRes2.status).toBe(200)
    expect(editRes2.body.data.latitude).toBeNull()
    expect(editRes2.body.data.longitude).toBeNull()
  })
})
