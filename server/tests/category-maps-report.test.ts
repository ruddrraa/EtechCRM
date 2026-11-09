import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { migrateCategories } from '../src/services/migration.js'
import { env } from '../src/config/env.js'

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
let Category: typeof import('../src/models/Category.js')['Category']

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  const [{ createApp }, user, client, visit, category, { connectDatabase }] = await Promise.all([
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/Client.js'),
    import('../src/models/Visit.js'),
    import('../src/models/Category.js'),
    import('../src/config/db.js'),
  ])
  app = createApp()
  User = user.User
  Client = client.Client
  Visit = visit.Visit
  Category = category.Category
  await connectDatabase()
}, 120000)

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Client.deleteMany({}),
    Visit.deleteMany({}),
    Category.deleteMany({}),
  ])
  vi.restoreAllMocks()
})

afterAll(async () => {
  const mongoose = await import('mongoose')
  await mongoose.disconnect()
  await mongo.stop()
})

async function createUser(role: 'SUPER_ADMIN' | 'MARKETING_HEAD' | 'MARKETING_EXECUTIVE', email: string) {
  return User.create({
    name: email.split('@')[0],
    email,
    role,
    passwordHash: await bcrypt.hash('password123', 10),
    isActive: true,
  })
}

async function loginUser(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
  return res.headers['set-cookie']
}

describe('Category Master', () => {
  it('1. Super Admin can create categories', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'cat-super@example.com')
    const cookie = await loginUser(superAdmin.email)

    const res = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .send({ name: 'Hospitals & Healthcare' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.name).toBe('Hospitals & Healthcare')
    expect(res.body.data.normalizedName).toBe('hospitals & healthcare')
    expect(res.body.data.isActive).toBe(true)

    const saved = await Category.findById(res.body.data._id)
    expect(saved).not.toBeNull()
    expect(saved?.name).toBe('Hospitals & Healthcare')
  })

  it('2. Marketing Head cannot create categories', async () => {
    const head = await createUser('MARKETING_HEAD', 'cat-head@example.com')
    const cookie = await loginUser(head.email)

    const res = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .send({ name: 'Diagnostic Labs' })

    expect(res.status).toBe(403)
  })

  it('3. Marketing Executive cannot create categories', async () => {
    const exec = await createUser('MARKETING_EXECUTIVE', 'cat-exec@example.com')
    const cookie = await loginUser(exec.email)

    const res = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .send({ name: 'Diagnostic Labs' })

    expect(res.status).toBe(403)
  })

  it('4. Duplicate category names are rejected case-insensitively', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'cat-dup@example.com')
    const cookie = await loginUser(superAdmin.email)

    const first = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .send({ name: 'Pharmaceutical' })
    expect(first.status).toBe(201)

    const duplicateExact = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .send({ name: 'Pharmaceutical' })
    expect(duplicateExact.status).toBe(409)

    const duplicateCase = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .send({ name: 'PHARMACEUTICAL' })
    expect(duplicateCase.status).toBe(409)

    const duplicateWhitespace = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .send({ name: '  pharmaceutical   ' })
    expect(duplicateWhitespace.status).toBe(409)
  })

  it('5. Inactive categories cannot be selected for new clients', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'cat-inactive-admin@example.com')
    const cookie = await loginUser(superAdmin.email)

    const catRes = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .send({ name: 'Dental Care' })
    expect(catRes.status).toBe(201)
    const categoryId = catRes.body.data._id

    // Deactivate category
    const deactRes = await request(app)
      .patch(`/api/categories/${categoryId}`)
      .set('Cookie', cookie)
      .send({ isActive: false })
    expect(deactRes.status).toBe(200)
    expect(deactRes.body.data.isActive).toBe(false)

    // Attempt to create client using deactivated category
    const clientRes = await request(app)
      .post('/api/clients')
      .set('Cookie', cookie)
      .send({
        organisationName: 'Smiles Dental Clinic',
        categoryId,
        address: '123 Park Street, Kolkata',
        phone: '9876543210',
      })
    expect(clientRes.status).toBe(400)
    expect(clientRes.body.error.message).toMatch(/inactive/i)
  })

  it('6. Existing clients retain their categories', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'cat-retain-admin@example.com')
    const cookie = await loginUser(superAdmin.email)

    const cat = await Category.create({
      name: 'Cardiology',
      normalizedName: 'cardiology',
      isActive: true,
      createdBy: superAdmin._id,
    })

    const client = await Client.create({
      organisationName: 'Heart Care Center',
      categoryId: cat._id,
      category: cat.name,
      address: '22 Camac Street',
      phone: '9876543211',
      createdBy: superAdmin._id,
    })

    const getRes = await request(app).get('/api/clients').set('Cookie', cookie)
    expect(getRes.status).toBe(200)
    const found = getRes.body.data.items.find((c: { _id: string }) => String(c._id) === String(client._id))
    expect(found).toBeDefined()
    expect(found.category).toBe('Cardiology')
    expect(String(found.categoryId?._id || found.categoryId)).toBe(String(cat._id))
  })

  it('7. Category migration is safe to rerun', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'cat-mig-admin@example.com')

    // Create legacy clients with raw category strings
    await Client.create([
      { organisationName: 'Apollo Hospital', category: 'Hospital', address: 'EM Bypass', phone: '9876543212', createdBy: superAdmin._id },
      { organisationName: 'Fortis Healthcare', category: 'HOSPITAL', address: 'Anandapur', phone: '9876543213', createdBy: superAdmin._id },
      { organisationName: 'City Clinic', category: 'Clinic', address: 'MG Road', phone: '9876543214', createdBy: superAdmin._id },
    ])

    // Run migration 1st time
    await migrateCategories(String(superAdmin._id))

    const categoriesAfterFirst = await Category.find({}).lean()
    expect(categoriesAfterFirst).toHaveLength(2) // Hospital and Clinic

    const clientsAfterFirst = await Client.find({}).lean()
    for (const c of clientsAfterFirst) {
      expect(c.categoryId).toBeDefined()
      expect(c.categoryId).not.toBeNull()
    }

    // Run migration 2nd time (rerun safety)
    await migrateCategories(String(superAdmin._id))

    const categoriesAfterSecond = await Category.find({}).lean()
    expect(categoriesAfterSecond).toHaveLength(2)

    const clientsAfterSecond = await Client.find({}).lean()
    expect(clientsAfterSecond).toHaveLength(3)
  })

  it('8. Categories already used by clients cannot be hard-deleted', async () => {
    const superAdmin = await createUser('SUPER_ADMIN', 'cat-del-admin@example.com')
    const cookie = await loginUser(superAdmin.email)

    const cat = await Category.create({
      name: 'Oncology',
      normalizedName: 'oncology',
      isActive: true,
      createdBy: superAdmin._id,
    })

    await Client.create({
      organisationName: 'Cancer Institute',
      categoryId: cat._id,
      category: 'Oncology',
      address: 'New Town, Kolkata',
      phone: '9876543215',
      createdBy: superAdmin._id,
    })

    const delRes = await request(app)
      .delete(`/api/categories/${cat._id}`)
      .set('Cookie', cookie)

    expect(delRes.status).toBe(400)
    expect(delRes.body.error.message).toMatch(/referenced by/i)

    // Unreferenced category can be deleted
    const unusedCat = await Category.create({
      name: 'Veterinary',
      normalizedName: 'veterinary',
      isActive: true,
      createdBy: superAdmin._id,
    })

    const delUnusedRes = await request(app)
      .delete(`/api/categories/${unusedCat._id}`)
      .set('Cookie', cookie)

    expect(delUnusedRes.status).toBe(200)
  })
})

describe('Ola Maps Address Autocomplete', () => {
  it('1. Backend proxy works with valid configuration', async () => {
    const user = await createUser('SUPER_ADMIN', 'maps-user@example.com')
    const cookie = await loginUser(user.email)

    // Mock fetch for Ola Maps API
    const mockOlaResponse = {
      status: 'ok',
      predictions: [
        {
          place_id: 'ola-place-123',
          description: 'BMRI Hospital, Dhakuria, Kolkata, West Bengal',
          structured_formatting: {
            main_text: 'BMRI Hospital',
            secondary_text: 'Dhakuria, Kolkata, West Bengal',
          },
          geometry: {
            location: {
              lat: 22.5055,
              lng: 88.3654,
            },
          },
        },
      ],
    }

    const originalApiKey = env.OLA_MAPS_API_KEY
    env.OLA_MAPS_API_KEY = 'mock_valid_ola_key'

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockOlaResponse,
    } as unknown as Response)

    const res = await request(app)
      .get('/api/maps/autocomplete?input=BMRI Hospital')
      .set('Cookie', cookie)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.predictions).toHaveLength(1)
    expect(res.body.data.predictions[0].placeId).toBe('ola-place-123')
    expect(res.body.data.predictions[0].mainText).toBe('BMRI Hospital')
    expect(res.body.data.predictions[0].latitude).toBe(22.5055)
    expect(res.body.data.predictions[0].longitude).toBe(88.3654)

    env.OLA_MAPS_API_KEY = originalApiKey
  })

  it('2. API key is never returned to frontend', async () => {
    const user = await createUser('SUPER_ADMIN', 'maps-secret@example.com')
    const cookie = await loginUser(user.email)

    const secretKey = 'super_secret_ola_key_12345'
    const originalApiKey = env.OLA_MAPS_API_KEY
    env.OLA_MAPS_API_KEY = secretKey

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', predictions: [] }),
    } as unknown as Response)

    const res = await request(app)
      .get('/api/maps/autocomplete?input=Apollo')
      .set('Cookie', cookie)

    const bodyString = JSON.stringify(res.body)
    expect(bodyString).not.toContain(secretKey)

    env.OLA_MAPS_API_KEY = originalApiKey
  })

  it('3. Invalid or empty queries are rejected', async () => {
    const user = await createUser('SUPER_ADMIN', 'maps-invalid@example.com')
    const cookie = await loginUser(user.email)

    const emptyRes = await request(app)
      .get('/api/maps/autocomplete?input=')
      .set('Cookie', cookie)
    expect(emptyRes.status).toBe(400)

    const singleCharRes = await request(app)
      .get('/api/maps/autocomplete?input=a')
      .set('Cookie', cookie)
    expect(singleCharRes.status).toBe(400)
  })

  it('4. Provider errors are handled gracefully', async () => {
    const user = await createUser('SUPER_ADMIN', 'maps-err@example.com')
    const cookie = await loginUser(user.email)

    const originalApiKey = env.OLA_MAPS_API_KEY
    env.OLA_MAPS_API_KEY = 'some_key'

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    } as unknown as Response)

    const res = await request(app)
      .get('/api/maps/autocomplete?input=Ruby Hospital')
      .set('Cookie', cookie)

    expect(res.status).toBe(200)
    expect(res.body.data.predictions).toEqual([])

    env.OLA_MAPS_API_KEY = originalApiKey
  })

  it('5. Manual address entry continues to work when provider is unavailable', async () => {
    const user = await createUser('SUPER_ADMIN', 'maps-fallback@example.com')
    const cookie = await loginUser(user.email)

    const cat = await Category.create({
      name: 'General Clinic',
      normalizedName: 'general clinic',
      isActive: true,
      createdBy: user._id,
    })

    const res = await request(app)
      .post('/api/clients')
      .set('Cookie', cookie)
      .send({
        organisationName: 'Offline Manual Clinic',
        categoryId: cat._id,
        address: 'Village Post Office, Rural District, No GPS Available',
        phone: '9876543216',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.address).toBe('Village Post Office, Rural District, No GPS Available')
    expect(res.body.data.latitude).toBeUndefined()
    expect(res.body.data.longitude).toBeUndefined()
  })

  it('6. Selecting a suggestion saves the correct address and returned coordinates', async () => {
    const user = await createUser('SUPER_ADMIN', 'maps-coord@example.com')
    const cookie = await loginUser(user.email)

    const cat = await Category.create({
      name: 'Super Specialty',
      normalizedName: 'super specialty',
      isActive: true,
      createdBy: user._id,
    })

    const res = await request(app)
      .post('/api/clients')
      .set('Cookie', cookie)
      .send({
        organisationName: 'Dhakuria Medicare',
        categoryId: cat._id,
        address: 'BMRI Hospital, Dhakuria, Kolkata, West Bengal',
        latitude: 22.5055,
        longitude: 88.3654,
        placeId: 'ola-place-123',
        formattedAddress: 'BMRI Hospital, Dhakuria, Kolkata, West Bengal',
        phone: '9876543217',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.address).toBe('BMRI Hospital, Dhakuria, Kolkata, West Bengal')
    expect(res.body.data.latitude).toBe(22.5055)
    expect(res.body.data.longitude).toBe(88.3654)
    expect(res.body.data.placeId).toBe('ola-place-123')
    expect(res.body.data.formattedAddress).toBe('BMRI Hospital, Dhakuria, Kolkata, West Bengal')
  })
})

describe('Reports Filter and Visit Lifecycle', () => {
  it('1. ARRIVED is not available as a report filter', async () => {
    const admin = await createUser('SUPER_ADMIN', 'report-arr-admin@example.com')
    const cookie = await loginUser(admin.email)

    const res = await request(app)
      .get('/api/reports/client?status=ARRIVED')
      .set('Cookie', cookie)

    expect(res.status).toBe(422)
  })

  it('2. CHECKED_IN is not available as a report filter', async () => {
    const admin = await createUser('SUPER_ADMIN', 'report-chk-admin@example.com')
    const cookie = await loginUser(admin.email)

    const res = await request(app)
      .get('/api/reports/client?status=CHECKED_IN')
      .set('Cookie', cookie)

    expect(res.status).toBe(422)
  })

  it('3. ASSIGNED, COMPLETED and CANCELLED remain available as report filters', async () => {
    const admin = await createUser('SUPER_ADMIN', 'report-valid-filters@example.com')
    const cookie = await loginUser(admin.email)

    const assignedRes = await request(app)
      .get('/api/reports/client?status=ASSIGNED')
      .set('Cookie', cookie)
    expect(assignedRes.status).toBe(200)

    const completedRes = await request(app)
      .get('/api/reports/client?status=COMPLETED')
      .set('Cookie', cookie)
    expect(completedRes.status).toBe(200)

    const cancelledRes = await request(app)
      .get('/api/reports/client?status=CANCELLED')
      .set('Cookie', cookie)
    expect(cancelledRes.status).toBe(200)
  })

  it('4. Visit lifecycle functionality remains unchanged', async () => {
    const admin = await createUser('SUPER_ADMIN', 'lifecycle-admin@example.com')
    const executive = await createUser('MARKETING_EXECUTIVE', 'lifecycle-exec@example.com')
    const adminCookie = await loginUser(admin.email)
    const execCookie = await loginUser(executive.email)

    const client = await Client.create({
      organisationName: 'Lifecycle Clinic',
      category: 'General',
      address: 'Park Street',
      latitude: 22.5726,
      longitude: 88.3639,
      phone: '9876543218',
      createdBy: admin._id,
    })

    // Assign visit
    const assignRes = await request(app)
      .post('/api/visits')
      .set('Cookie', adminCookie)
      .send({
        clientId: client._id,
        assignedTo: executive._id,
        plannedDate: new Date().toISOString(),
      })
    expect(assignRes.status).toBe(201)
    const visitId = assignRes.body.data._id
    expect(assignRes.body.data.status).toBe('ASSIGNED')

    // Mark arrived (ARRIVED status lifecycle preserved)
    const arrivedRes = await request(app)
      .post(`/api/visits/${visitId}/arrived`)
      .set('Cookie', execCookie)
    expect(arrivedRes.status).toBe(200)
    expect(arrivedRes.body.data.status).toBe('ARRIVED')

    // Check in (CHECKED_IN status lifecycle preserved)
    const checkInRes = await request(app)
      .post(`/api/visits/${visitId}/check-in`)
      .set('Cookie', execCookie)
      .send({
        latitude: 22.5726,
        longitude: 88.3639,
        locationStatus: 'AVAILABLE',
      })
    expect(checkInRes.status).toBe(200)
    expect(checkInRes.body.data.status).toBe('CHECKED_IN')

    // Complete visit (COMPLETED status lifecycle preserved)
    const completeRes = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Cookie', execCookie)
      .send({
        remarks: 'Meeting completed with clinic head',
        location: {
          latitude: 22.5726,
          longitude: 88.3639,
          locationStatus: 'AVAILABLE',
        },
      })
    expect(completeRes.status).toBe(200)
    expect(completeRes.body.data.status).toBe('COMPLETED')
    expect(completeRes.body.data.remarks).toBe('Meeting completed with clinic head')
  })
})
