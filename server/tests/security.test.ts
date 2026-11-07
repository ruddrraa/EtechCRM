import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { migrateLegacyRoles } from '../src/services/migration.js'

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt'
process.env.JWT_EXPIRES_IN = '1d'
process.env.CLIENT_URL = 'http://localhost:5173'
process.env.NODE_ENV = 'test'
process.env.PORT = '3001'

let mongo: MongoMemoryServer
let app: typeof import('../src/app.js')['createApp'] extends () => infer T ? T : never
let User: typeof import('../src/models/User.js')['User']
let Client: typeof import('../src/models/Client.js')['Client']
let Visit: typeof import('../src/models/Visit.js')['Visit']
let Notification: typeof import('../src/models/Notification.js')['Notification']

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  const [{ createApp }, user, client, visit, notification, { connectDatabase }] = await Promise.all([
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/Client.js'),
    import('../src/models/Visit.js'),
    import('../src/models/Notification.js'),
    import('../src/config/db.js'),
  ])
  app = createApp()
  User = user.User
  Client = client.Client
  Visit = visit.Visit
  Notification = notification.Notification
  await connectDatabase()
}, 120000)

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Client.deleteMany({}), Visit.deleteMany({}), Notification.deleteMany({})])
})

afterAll(async () => {
  const mongoose = await import('mongoose')
  await mongoose.disconnect()
  await mongo.stop()
})

async function createUser(role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'MARKETING_HEAD' | 'MARKETING_EXECUTIVE', email: string) {
  return User.create({ name: email.split('@')[0], email, role, passwordHash: await bcrypt.hash('password123', 10), isActive: true })
}

describe('security boundaries', () => {
  it('migrates legacy roles without changing identity or visit history', async () => {
    const legacyHead = await createUser('ADMIN', 'legacy-head@example.com')
    const legacyExecutive = await createUser('USER', 'legacy-executive@example.com')
    const client = await Client.create({ organisationName: 'Legacy Clinic', category: 'Clinic', address: 'Road', email: 'legacy@clinic.com', createdBy: legacyHead._id })
    const visit = await Visit.create({ client: client._id, assignedTo: legacyExecutive._id, assignedBy: legacyHead._id, source: 'ADMIN_ASSIGNED', plannedDate: new Date(), status: 'ASSIGNED' })
    await migrateLegacyRoles()
    const [head, executive] = await Promise.all([User.findById(legacyHead._id).lean(), User.findById(legacyExecutive._id).lean()])
    expect(head?.role).toBe('MARKETING_HEAD')
    expect(executive?.role).toBe('MARKETING_EXECUTIVE')
    expect(executive?.reportingTo).toBeNull()
    expect(String(executive?._id)).toBe(String(legacyExecutive._id))
    expect(await Visit.exists({ _id: visit._id })).toBeTruthy()
    expect((await request(app).post('/api/auth/login').send({ email: legacyExecutive.email, password: 'password123' })).status).toBe(200)
  })

  it('isolates Marketing Head teams and supports audited Super Admin reassignment', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'teams-super@example.com')
    const ram = await createUser('MARKETING_HEAD', 'ram@example.com')
    const shyam = await createUser('MARKETING_HEAD', 'shyam@example.com')
    const executive = await createUser('MARKETING_EXECUTIVE', 'unassigned@example.com')
    const superLogin = await request(app).post('/api/auth/login').send({ email: superAdmin.email, password: 'password123' })
    const ramLogin = await request(app).post('/api/auth/login').send({ email: ram.email, password: 'password123' })
    const shyamLogin = await request(app).post('/api/auth/login').send({ email: shyam.email, password: 'password123' })
    expect((await request(app).get('/api/users?role=MARKETING_EXECUTIVE').set('Cookie', ramLogin.headers['set-cookie'])).body.data).toHaveLength(0)
    const reassigned = await request(app).patch(`/api/users/${executive._id}/reporting`).set('Cookie', superLogin.headers['set-cookie']).send({ reportingTo: ram._id })
    expect(reassigned.status).toBe(200)
    expect((await request(app).get('/api/users?role=MARKETING_EXECUTIVE').set('Cookie', ramLogin.headers['set-cookie'])).body.data[0]._id).toBe(String(executive._id))
    expect((await request(app).get('/api/users?role=MARKETING_EXECUTIVE').set('Cookie', shyamLogin.headers['set-cookie'])).body.data).toHaveLength(0)
    const client = await Client.create({ organisationName: 'Team Clinic', category: 'Clinic', address: 'Road', email: 'team@clinic.com', createdBy: superAdmin._id })
    const crossTeam = await request(app).post('/api/visits').set('Cookie', shyamLogin.headers['set-cookie']).send({ clientId: client._id, assignedTo: executive._id, plannedDate: new Date().toISOString() })
    expect(crossTeam.status).toBe(403)
    const assignment = await request(app).post('/api/visits').set('Cookie', ramLogin.headers['set-cookie']).send({ clientId: client._id, assignedTo: executive._id, plannedDate: new Date().toISOString() })
    expect(assignment.status).toBe(201)
  })

  it('scopes dashboard analytics by role and applies date filters', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'analytics-super@example.com')
    const ram = await createUser('MARKETING_HEAD', 'analytics-ram@example.com')
    const shyam = await createUser('MARKETING_HEAD', 'analytics-shyam@example.com')
    const ramExecutive = await createUser('MARKETING_EXECUTIVE', 'analytics-ram-exec@example.com')
    const shyamExecutive = await createUser('MARKETING_EXECUTIVE', 'analytics-shyam-exec@example.com')
    await User.updateOne({ _id: ramExecutive._id }, { reportingTo: ram._id })
    await User.updateOne({ _id: shyamExecutive._id }, { reportingTo: shyam._id })
    const ramClient = await Client.create({ organisationName: 'Ram Analytics Clinic', category: 'Clinic', address: 'Road', email: 'ram-analytics@clinic.com', createdBy: ram._id })
    const shyamClient = await Client.create({ organisationName: 'Shyam Analytics Clinic', category: 'Clinic', address: 'Road', email: 'shyam-analytics@clinic.com', createdBy: shyam._id })
    await Visit.create([
      { client: ramClient._id, assignedTo: ramExecutive._id, assignedBy: ram._id, source: 'ADMIN_ASSIGNED', plannedDate: new Date(), status: 'COMPLETED' },
      { client: shyamClient._id, assignedTo: shyamExecutive._id, assignedBy: shyam._id, source: 'ADMIN_ASSIGNED', plannedDate: new Date(), status: 'ASSIGNED' },
      { client: ramClient._id, assignedTo: ramExecutive._id, assignedBy: ram._id, source: 'ADMIN_ASSIGNED', plannedDate: new Date(Date.now() - 10 * 86400000), status: 'COMPLETED' },
    ])
    const [superLogin, ramLogin, shyamLogin, executiveLogin] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: superAdmin.email, password: 'password123' }),
      request(app).post('/api/auth/login').send({ email: ram.email, password: 'password123' }),
      request(app).post('/api/auth/login').send({ email: shyam.email, password: 'password123' }),
      request(app).post('/api/auth/login').send({ email: ramExecutive.email, password: 'password123' }),
    ])
    const customStart = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
    const customEnd = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    const [superDashboard, ramDashboard, shyamDashboard, executiveDashboard] = await Promise.all([
      request(app).get(`/api/dashboard?preset=custom&startDate=${customStart}&endDate=${customEnd}`).set('Cookie', superLogin.headers['set-cookie']),
      request(app).get(`/api/dashboard?preset=custom&startDate=${customStart}&endDate=${customEnd}`).set('Cookie', ramLogin.headers['set-cookie']),
      request(app).get(`/api/dashboard?preset=custom&startDate=${customStart}&endDate=${customEnd}`).set('Cookie', shyamLogin.headers['set-cookie']),
      request(app).get(`/api/dashboard?preset=custom&startDate=${customStart}&endDate=${customEnd}`).set('Cookie', executiveLogin.headers['set-cookie']),
    ])
    expect(superDashboard.status).toBe(200)
    expect(superDashboard.body.data.metrics.assignedVisits).toBe(2)
    expect(superDashboard.body.data.headPerformance.map((item: { name: string }) => item.name)).toEqual(expect.arrayContaining([ram.name, shyam.name]))
    expect(ramDashboard.body.data.metrics.assignedVisits).toBe(1)
    expect(ramDashboard.body.data.executivePerformance.map((item: { name: string }) => item.name)).toEqual([ramExecutive.name])
    expect(shyamDashboard.body.data.metrics.assignedVisits).toBe(1)
    expect(shyamDashboard.body.data.executivePerformance.map((item: { name: string }) => item.name)).toEqual([shyamExecutive.name])
    expect(executiveDashboard.body.data.metrics.assignedVisits).toBe(1)
    expect(executiveDashboard.body.data.topClients.map((item: { name: string }) => item.name)).toEqual([ramClient.organisationName])
  })

  it('creates a Marketing Head without a reporting manager', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'create-head-super@example.com')
    const login = await request(app).post('/api/auth/login').send({ email: superAdmin.email, password: 'password123' })
    const response = await request(app).post('/api/auth/users').set('Cookie', login.headers['set-cookie']).send({
      name: 'New Marketing Head',
      email: 'new-head@example.com',
      password: 'password123',
      role: 'MARKETING_HEAD',
      designation: 'Regional Marketing Head',
    })
    expect(response.status).toBe(201)
    expect(response.body.data.reportingTo).toBeNull()
  })

  it('rejects unauthenticated protected requests', async () => {
    const response = await request(app).get('/api/visits')
    expect(response.status).toBe(401)
  })

  it('updates the authenticated user profile without changing role or email', async () => {
    const user = await createUser('SUPER_ADMIN', 'profile@example.com')
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: 'password123' })
    const response = await request(app).patch('/api/users/me').set('Cookie', login.headers['set-cookie']).send({ name: 'Updated Name', phone: '+911234567890' })
    expect(response.status).toBe(200)
    expect(response.body.data.name).toBe('Updated Name')
    expect(response.body.data.phone).toBe('+911234567890')
    expect(response.body.data.email).toBe(user.email)
    expect(response.body.data.role).toBe('SUPER_ADMIN')
    expect((await User.findById(user._id).lean())?.name).toBe('Updated Name')
  })

  it('prevents an executive from listing another executive visits', async () => {
    const first = await createUser('USER', 'first@example.com')
    const second = await createUser('USER', 'second@example.com')
    const client = await Client.create({ organisationName: 'Shared Clinic', category: 'Clinic', address: 'Main Road', phone: '+911234567890', createdBy: first._id })
    await Visit.create({ client: client._id, assignedTo: second._id, assignedBy: second._id, source: 'SELF_ASSIGNED', plannedDate: new Date(), status: 'ASSIGNED' })
    const login = await request(app).post('/api/auth/login').send({ email: 'first@example.com', password: 'password123' })
    const response = await request(app).get('/api/visits').set('Cookie', login.headers['set-cookie'])
    expect(response.status).toBe(200)
    expect(response.body.data.items).toHaveLength(0)
  })

  it('prevents an executive from retrieving a colleague visit by id or cancelling an Admin visit', async () => {
    await createUser('USER', 'first@example.com')
    const second = await createUser('USER', 'second@example.com')
    const admin = await createUser('ADMIN', 'admin@example.com')
    const client = await Client.create({ organisationName: 'Restricted Clinic', category: 'Clinic', address: 'Main Road', phone: '+911234567890', createdBy: admin._id })
    const visit = await Visit.create({ client: client._id, assignedTo: second._id, assignedBy: admin._id, source: 'ADMIN_ASSIGNED', plannedDate: new Date(), status: 'ASSIGNED' })
    const login = await request(app).post('/api/auth/login').send({ email: 'first@example.com', password: 'password123' })
    const getResponse = await request(app).get(`/api/visits/${visit._id}`).set('Cookie', login.headers['set-cookie'])
    const cancelResponse = await request(app).post(`/api/visits/${visit._id}/cancel`).set('Cookie', login.headers['set-cookie']).send({ reason: 'No longer needed' })
    expect(getResponse.status).toBe(404)
    expect(cancelResponse.status).toBe(404)
  })

  it('allows an executive to view shared clients but rejects invalid contact data', async () => {
    await createUser('USER', 'first@example.com')
    const login = await request(app).post('/api/auth/login').send({ email: 'first@example.com', password: 'password123' })
    const invalid = await request(app).post('/api/clients').set('Cookie', login.headers['set-cookie']).send({ organisationName: 'Clinic', category: 'Clinic', address: 'Road' })
    expect(invalid.status).toBe(422)
    const valid = await request(app).post('/api/clients').set('Cookie', login.headers['set-cookie']).send({ organisationName: 'Clinic', category: 'Clinic', address: 'Road', email: 'contact@example.com' })
    expect(valid.status).toBe(201)
  })

  it('enforces visit lifecycle and prevents Admin from creating another Admin', async () => {
    const executive = await createUser('USER', 'exec@example.com')
    const admin = await createUser('ADMIN', 'admin@example.com')
    const client = await Client.create({ organisationName: 'Lifecycle Clinic', category: 'Clinic', address: 'Road', email: 'clinic@example.com', createdBy: admin._id })
    const login = await request(app).post('/api/auth/login').send({ email: 'exec@example.com', password: 'password123' })
    const visit = await request(app).post('/api/visits').set('Cookie', login.headers['set-cookie']).send({ clientId: String(client._id), plannedDate: new Date().toISOString() })
    expect(visit.status).toBe(201)
    const arrived = await request(app).post(`/api/visits/${visit.body.data._id}/arrived`).set('Cookie', login.headers['set-cookie'])
    expect(arrived.status).toBe(200)
    expect(arrived.body.data.status).toBe('ARRIVED')
    expect(arrived.body.data.arrivedAt).toBeTruthy()
    const checkIn = await request(app).post(`/api/visits/${visit.body.data._id}/check-in`).set('Cookie', login.headers['set-cookie']).send({ locationStatus: 'LOCATION_UNAVAILABLE' })
    expect(checkIn.status).toBe(200)
    const complete = await request(app).post(`/api/visits/${visit.body.data._id}/complete`).set('Cookie', login.headers['set-cookie']).send({ remarks: 'Discussed next steps', location: { locationStatus: 'LOCATION_UNAVAILABLE' } })
    expect(complete.status).toBe(200)
    expect(complete.body.data.status).toBe('COMPLETED')
    const adminLogin = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'password123' })
    const createAdmin = await request(app).post('/api/auth/users').set('Cookie', adminLogin.headers['set-cookie']).send({ name: 'Another Admin', email: 'another-admin@example.com', password: 'password123', role: 'ADMIN' })
    expect(createAdmin.status).toBe(403)
    expect(executive.role).toBe('USER')
  })

  it('persists an Admin-assigned visit through the API', async () => {
    const admin = await createUser('ADMIN', 'assign-admin@example.com')
    const executive = await createUser('USER', 'assign-executive@example.com')
    const client = await Client.create({ organisationName: 'Assignment Clinic', category: 'Clinic', address: 'Road', email: 'assignment@clinic.com', createdBy: admin._id })
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })
    const plannedDate = '2026-11-07T20:14:00'
    const response = await request(app).post('/api/visits').set('Cookie', adminLogin.headers['set-cookie']).send({
      clientId: String(client._id),
      assignedTo: String(executive._id),
      plannedDate,
      instructions: 'Bring the requested documents',
    })
    expect(response.status).toBe(201)
    expect(response.body.data.status).toBe('ASSIGNED')
    expect(response.body.data.client).toBe(String(client._id))
    expect(response.body.data.assignedTo).toBe(String(executive._id))
    expect(new Date(response.body.data.plannedDate).toISOString()).toBe(new Date(plannedDate).toISOString())
    const persisted = await Visit.findById(response.body.data._id).lean()
    expect(persisted?.instructions).toBe('Bring the requested documents')
  })

  it('enforces staff status management and protects organisation reports', async () => {
    const admin = await createUser('ADMIN', 'admin-status@example.com')
    const executive = await createUser('USER', 'exec-status@example.com')
    const executiveLogin = await request(app).post('/api/auth/login').send({ email: executive.email, password: 'password123' })
    expect((await request(app).get('/api/reports/overview').set('Cookie', executiveLogin.headers['set-cookie'])).status).toBe(403)
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })
    const status = await request(app).patch(`/api/users/${executive._id}/status`).set('Cookie', adminLogin.headers['set-cookie']).send({ isActive: false })
    expect(status.status).toBe(200)
    expect(status.body.data.isActive).toBe(false)
    const activeStaff = await request(app).get('/api/users?role=USER&activeOnly=true').set('Cookie', adminLogin.headers['set-cookie'])
    expect(activeStaff.status).toBe(200)
    expect(activeStaff.body.data.some((item: { _id: string }) => item._id === String(executive._id))).toBe(false)
    const allStaff = await request(app).get('/api/users?role=USER').set('Cookie', adminLogin.headers['set-cookie'])
    expect(allStaff.body.data.some((item: { _id: string }) => item._id === String(executive._id))).toBe(true)
    const selfStatus = await request(app).patch(`/api/users/${admin._id}/status`).set('Cookie', adminLogin.headers['set-cookie']).send({ isActive: false })
    expect(selfStatus.status).toBe(400)
  })

  it('enforces account hierarchy and preserves archived staff history', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'hierarchy-super@example.com')
    const admin = await createUser('ADMIN', 'hierarchy-admin@example.com')
    const executive = await createUser('USER', 'hierarchy-executive@example.com')
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })
    expect((await request(app).patch(`/api/users/${superAdmin._id}/status`).set('Cookie', adminLogin.headers['set-cookie']).send({ isActive: false })).status).toBe(403)
    expect((await request(app).patch(`/api/users/${superAdmin._id}/status`).set('Cookie', adminLogin.headers['set-cookie']).send({ isActive: true })).status).toBe(403)
    expect((await request(app).delete(`/api/users/${superAdmin._id}`).set('Cookie', adminLogin.headers['set-cookie'])).status).toBe(403)
    expect((await request(app).post('/api/auth/users').set('Cookie', adminLogin.headers['set-cookie']).send({ name: 'Promoted', email: 'promoted@example.com', password: 'password123', role: 'SUPER_ADMIN' })).status).toBe(422)
    const superLogin = await request(app).post('/api/auth/login').send({ email: superAdmin.email, password: 'password123' })
    expect((await request(app).patch(`/api/users/${admin._id}/status`).set('Cookie', superLogin.headers['set-cookie']).send({ isActive: false })).status).toBe(200)
    expect((await request(app).patch(`/api/users/${admin._id}/status`).set('Cookie', superLogin.headers['set-cookie']).send({ isActive: true })).status).toBe(200)
    const client = await Client.create({ organisationName: 'Archived Staff Clinic', category: 'Clinic', address: 'Road', email: 'archived@clinic.com', createdBy: admin._id })
    const historicalVisit = await Visit.create({ client: client._id, assignedTo: executive._id, assignedBy: admin._id, source: 'ADMIN_ASSIGNED', plannedDate: new Date(), status: 'ASSIGNED' })
    const deactivated = await request(app).patch(`/api/users/${executive._id}/status`).set('Cookie', superLogin.headers['set-cookie']).send({ isActive: false })
    expect(deactivated.status).toBe(200)
    expect((await request(app).post('/api/auth/login').send({ email: executive.email, password: 'password123' })).status).toBe(401)
    const archived = await request(app).delete(`/api/users/${executive._id}`).set('Cookie', superLogin.headers['set-cookie'])
    expect(archived.status).toBe(200)
    expect((await request(app).post('/api/auth/login').send({ email: executive.email, password: 'password123' })).status).toBe(401)
    expect((await request(app).get('/api/users').set('Cookie', superLogin.headers['set-cookie'])).body.data.some((item: { _id: string }) => item._id === String(executive._id))).toBe(false)
    expect(await Visit.exists({ _id: historicalVisit._id })).toBeTruthy()
  })

  it('returns paginated all-record reports and applies permitted filters', async () => {
    const admin = await createUser('ADMIN', 'report-admin@example.com')
    const first = await createUser('USER', 'report-first@example.com')
    const second = await createUser('USER', 'report-second@example.com')
    const firstClient = await Client.create({ organisationName: 'First Report Clinic', category: 'Clinic', address: 'Road', email: 'first@clinic.com', createdBy: admin._id })
    const secondClient = await Client.create({ organisationName: 'Second Report Clinic', category: 'Clinic', address: 'Road', email: 'second@clinic.com', createdBy: admin._id })
    await Visit.create([
      { client: firstClient._id, assignedTo: first._id, assignedBy: admin._id, source: 'ADMIN_ASSIGNED', plannedDate: new Date(), status: 'ASSIGNED' },
      { client: secondClient._id, assignedTo: second._id, assignedBy: admin._id, source: 'ADMIN_ASSIGNED', plannedDate: new Date(), status: 'CANCELLED' },
    ])
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })
    const allClients = await request(app).get('/api/reports/client?limit=1').set('Cookie', adminLogin.headers['set-cookie'])
    expect(allClients.status).toBe(200)
    expect(allClients.body.data.total).toBe(2)
    expect(allClients.body.data.pages).toBe(2)
    const oneClient = await request(app).get(`/api/reports/client?clientId=${firstClient._id}`).set('Cookie', adminLogin.headers['set-cookie'])
    expect(oneClient.body.data.total).toBe(1)
    const allStaff = await request(app).get('/api/reports/staff/records').set('Cookie', adminLogin.headers['set-cookie'])
    expect(allStaff.body.data.total).toBe(2)
    const executiveLogin = await request(app).post('/api/auth/login').send({ email: first.email, password: 'password123' })
    expect((await request(app).get('/api/reports/client').set('Cookie', executiveLogin.headers['set-cookie'])).status).toBe(403)
  })

  it('invalidates only the logging-out user token and preserves creator attribution', async () => {
    const admin = await createUser('ADMIN', 'logout-admin@example.com')
    const executive = await createUser('USER', 'logout-exec@example.com')
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })
    const executiveLogin = await request(app).post('/api/auth/login').send({ email: executive.email, password: 'password123' })
    const client = await request(app).post('/api/clients').set('Cookie', executiveLogin.headers['set-cookie']).send({ organisationName: 'Attributed Clinic', category: 'Clinic', address: 'Road', email: 'clinic@example.com' })
    expect(client.status).toBe(201)
    expect(client.body.data.createdByName).toBe(executive.name)
    expect((await request(app).post('/api/auth/logout').set('Cookie', adminLogin.headers['set-cookie'])).status).toBe(200)
    expect((await request(app).get('/api/users/me').set('Cookie', adminLogin.headers['set-cookie'])).status).toBe(401)
    expect((await request(app).get('/api/users/me').set('Cookie', executiveLogin.headers['set-cookie'])).status).toBe(200)
  })

  it('accepts legacy users without a stored token version after refresh', async () => {
    const user = await createUser('USER', 'legacy-session@example.com')
    await User.updateOne({ _id: user._id }, { $unset: { tokenVersion: 1 } })
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: 'password123' })
    expect(login.status).toBe(200)
    const me = await request(app).get('/api/auth/me').set('Cookie', login.headers['set-cookie'])
    expect(me.status).toBe(200)
    expect(me.body.data.email).toBe(user.email)
  })

  it('creates private assignment notifications and supports read state changes', async () => {
    const admin = await createUser('ADMIN', 'notify-admin@example.com')
    const first = await createUser('USER', 'notify-first@example.com')
    const second = await createUser('USER', 'notify-second@example.com')
    const client = await Client.create({ organisationName: 'Notify Clinic', category: 'Clinic', address: 'Road', email: 'notify@clinic.com', createdBy: admin._id })
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })
    const visit = await request(app).post('/api/visits').set('Cookie', adminLogin.headers['set-cookie']).send({ clientId: String(client._id), assignedTo: String(first._id), plannedDate: new Date().toISOString() })
    expect(visit.status).toBe(201)
    const firstLogin = await request(app).post('/api/auth/login').send({ email: first.email, password: 'password123' })
    const secondLogin = await request(app).post('/api/auth/login').send({ email: second.email, password: 'password123' })
    const firstNotifications = await request(app).get('/api/notifications').set('Cookie', firstLogin.headers['set-cookie'])
    const secondNotifications = await request(app).get('/api/notifications').set('Cookie', secondLogin.headers['set-cookie'])
    expect(firstNotifications.body.data.unread).toBe(1)
    expect(secondNotifications.body.data.items).toHaveLength(0)
    const notificationId = firstNotifications.body.data.items[0]._id
    expect((await request(app).post(`/api/notifications/${notificationId}/read`).set('Cookie', firstLogin.headers['set-cookie'])).status).toBe(200)
    const readNotifications = await request(app).get('/api/notifications').set('Cookie', firstLogin.headers['set-cookie'])
    expect(readNotifications.body.data.unread).toBe(0)
  })
})
