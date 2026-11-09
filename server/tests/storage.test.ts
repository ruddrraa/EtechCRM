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
let Client: typeof import('../src/models/Client.js')['Client']
let Visit: typeof import('../src/models/Visit.js')['Visit']
let FileAsset: typeof import('../src/models/FileAsset.js')['FileAsset']
let AuditEvent: typeof import('../src/models/AuditEvent.js')['AuditEvent']

const mockStorage = new MockStorageProvider()

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  setStorageProvider(mockStorage)

  const [{ createApp }, userMod, clientMod, visitMod, fileMod, auditMod, { connectDatabase }] = await Promise.all([
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/Client.js'),
    import('../src/models/Visit.js'),
    import('../src/models/FileAsset.js'),
    import('../src/models/AuditEvent.js'),
    import('../src/config/db.js'),
  ])

  app = createApp()
  User = userMod.User
  Client = clientMod.Client
  Visit = visitMod.Visit
  FileAsset = fileMod.FileAsset
  AuditEvent = auditMod.AuditEvent
  await connectDatabase()
}, 120000)

beforeEach(async () => {
  mockStorage.clear()
  await Promise.all([
    User.deleteMany({}),
    Client.deleteMany({}),
    Visit.deleteMany({}),
    FileAsset.deleteMany({}),
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

// Valid JPEG buffer with ffd8ff signature
const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])

// Valid PNG buffer with 89504e47 signature
const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// Valid PDF buffer with %PDF signature
const validPdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])

describe('Phase 3.4 — Centralized Cloud File Storage & Media Management', () => {
  it('1. Unauthenticated upload: Returns 401 when no token is provided', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .attach('file', validJpegBuffer, 'avatar.jpg')
      .field('ownerType', 'USER_AVATAR')
      .field('ownerId', '507f1f77bcf86cd799439011')

    expect(res.status).toBe(401)
  })

  it('2. Authenticated upload: Super Admin can upload staff avatar and metadata is stored in MongoDB', async () => {
    const admin = await createUser('SUPER_ADMIN', 'admin_storage@test.com')
    const cookie = await loginUser('admin_storage@test.com')

    const res = await request(app)
      .post('/api/files/upload')
      .set('Cookie', cookie)
      .attach('file', validJpegBuffer, 'admin_avatar.jpg')
      .field('ownerType', 'USER_AVATAR')
      .field('ownerId', String(admin._id))

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.asset.originalName).toBe('admin_avatar.jpg')
    expect(res.body.data.asset.resourceType).toBe('image')
    expect(res.body.data.signedUrl).toContain('mock-storage.local')

    // Verify MongoDB stores metadata only (NO binary content)
    const savedAsset = await FileAsset.findById(res.body.data.asset._id).lean()
    expect(savedAsset).toBeDefined()
    expect(savedAsset?.originalName).toBe('admin_avatar.jpg')
    expect(savedAsset?.cloudinaryPublicId).toBeDefined()
    expect(savedAsset).not.toHaveProperty('buffer')
    expect(savedAsset).not.toHaveProperty('data')

    // Verify User model was updated with reference
    const updatedAdmin = await User.findById(admin._id).lean()
    expect(String(updatedAdmin?.avatarAsset)).toBe(String(savedAsset?._id))
    expect(updatedAdmin?.avatar).toBeDefined()

    // Verify audit log
    const audit = await AuditEvent.findOne({ action: 'FILE_UPLOADED', entityId: savedAsset?._id }).lean()
    expect(audit).toBeDefined()
  })

  it('3. File signature and MIME validation: Rejects spoofed extension', async () => {
    const admin = await createUser('SUPER_ADMIN', 'admin_spoof@test.com')
    const cookie = await loginUser('admin_spoof@test.com')

    // Plain text buffer spoofed as JPEG
    const fakeBuffer = Buffer.from('This is a plain text file pretending to be an image')

    const res = await request(app)
      .post('/api/files/upload')
      .set('Cookie', cookie)
      .attach('file', fakeBuffer, { filename: 'malicious.jpg', contentType: 'image/jpeg' })
      .field('ownerType', 'USER_AVATAR')
      .field('ownerId', String(admin._id))

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/signature does not match/i)
  })

  it('4. File size limit enforcement: Rejects avatar larger than 5MB', async () => {
    const admin = await createUser('SUPER_ADMIN', 'admin_size@test.com')
    const cookie = await loginUser('admin_size@test.com')

    // 6MB buffer starting with valid JPEG signature
    const oversizedBuffer = Buffer.alloc(6 * 1024 * 1024)
    oversizedBuffer[0] = 0xff
    oversizedBuffer[1] = 0xd8
    oversizedBuffer[2] = 0xff
    oversizedBuffer[3] = 0xe0

    const res = await request(app)
      .post('/api/files/upload')
      .set('Cookie', cookie)
      .attach('file', oversizedBuffer, { filename: 'giant_avatar.jpg', contentType: 'image/jpeg' })
      .field('ownerType', 'USER_AVATAR')
      .field('ownerId', String(admin._id))

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/exceeds the allowed limit of 5MB/i)
  })

  it('5. Cross-team isolation: Marketing Head A cannot access attachments of Marketing Head B team visit', async () => {
    await createUser('MARKETING_HEAD', 'headA@test.com')
    const headB = await createUser('MARKETING_HEAD', 'headB@test.com')
    const execB = await createUser('MARKETING_EXECUTIVE', 'execB@test.com', String(headB._id))

    const cookieA = await loginUser('headA@test.com')
    const cookieB = await loginUser('headB@test.com')

    const client = await Client.create({
      organisationName: 'Team B Client',
      category: 'Hospital',
      address: 'Kolkata Sector V',
      phone: '9876543210',
      createdBy: headB._id,
    })

    const visitB = await Visit.create({
      client: client._id,
      assignedTo: execB._id,
      assignedBy: headB._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date(),
      status: 'ASSIGNED',
    })

    // Head B uploads visit attachment
    const uploadRes = await request(app)
      .post('/api/files/upload')
      .set('Cookie', cookieB)
      .attach('file', validPdfBuffer, 'visit_report.pdf')
      .field('ownerType', 'VISIT_ATTACHMENT')
      .field('ownerId', String(visitB._id))

    expect(uploadRes.status).toBe(201)
    const fileId = uploadRes.body.data.asset._id

    // Head A tries to access file of visit belonging to Head B's team -> 403 Forbidden!
    const forbiddenRes = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Cookie', cookieA)

    expect(forbiddenRes.status).toBe(403)
    expect(forbiddenRes.body.error.message).toMatch(/cross-team/i)

    // Head A tries to list files for visit B -> 403 Forbidden!
    const listForbidden = await request(app)
      .get(`/api/files/owner/VISIT_ATTACHMENT/${visitB._id}`)
      .set('Cookie', cookieA)

    expect(listForbidden.status).toBe(403)
  })

  it('6. Marketing Executive access: Cannot access another executive visit attachments', async () => {
    const head = await createUser('MARKETING_HEAD', 'manager@test.com')
    const exec1 = await createUser('MARKETING_EXECUTIVE', 'exec1@test.com', String(head._id))
    await createUser('MARKETING_EXECUTIVE', 'exec2@test.com', String(head._id))

    const cookie1 = await loginUser('exec1@test.com')
    const cookie2 = await loginUser('exec2@test.com')

    const client = await Client.create({
      organisationName: 'Shared Client',
      category: 'Hospital',
      address: 'Kolkata South',
      phone: '9876543210',
      createdBy: head._id,
    })

    const visit1 = await Visit.create({
      client: client._id,
      assignedTo: exec1._id,
      assignedBy: head._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date(),
      status: 'ASSIGNED',
    })

    // Executive 1 uploads a site photo
    const uploadRes = await request(app)
      .post('/api/files/upload')
      .set('Cookie', cookie1)
      .attach('file', validPngBuffer, 'site_photo.png')
      .field('ownerType', 'VISIT_PHOTO')
      .field('ownerId', String(visit1._id))

    expect(uploadRes.status).toBe(201)
    const fileId = uploadRes.body.data.asset._id

    // Executive 2 tries to access Executive 1's visit photo -> 403 Forbidden!
    const forbidden = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Cookie', cookie2)

    expect(forbidden.status).toBe(403)
  })

  it('7. Deletion & Cleanup: Soft-deletes in MongoDB, removes from storage, and records audit', async () => {
    const admin = await createUser('SUPER_ADMIN', 'admin_del@test.com')
    const cookie = await loginUser('admin_del@test.com')

    const uploadRes = await request(app)
      .post('/api/files/upload')
      .set('Cookie', cookie)
      .attach('file', validJpegBuffer, 'temp_file.jpg')
      .field('ownerType', 'USER_AVATAR')
      .field('ownerId', String(admin._id))

    expect(uploadRes.status).toBe(201)
    const fileId = uploadRes.body.data.asset._id
    const publicId = uploadRes.body.data.asset.cloudinaryPublicId

    expect(mockStorage.storedFiles.has(publicId)).toBe(true)

    // Delete file
    const delRes = await request(app)
      .delete(`/api/files/${fileId}`)
      .set('Cookie', cookie)

    expect(delRes.status).toBe(200)
    expect(delRes.body.data.success).toBe(true)

    // Storage provider asset deleted
    expect(mockStorage.storedFiles.has(publicId)).toBe(false)

    // MongoDB asset soft-deleted
    const archivedAsset = await FileAsset.findById(fileId).lean()
    expect(archivedAsset?.isArchived).toBe(true)
    expect(archivedAsset?.deletedAt).toBeDefined()

    // Subsequent retrieval returns 404
    const getRes = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Cookie', cookie)

    expect(getRes.status).toBe(404)

    // Audit log recorded
    const delAudit = await AuditEvent.findOne({ action: 'FILE_DELETED', entityId: fileId }).lean()
    expect(delAudit).toBeDefined()
  })

  it('8. Failure Cleanup: If MongoDB persistence fails, storage upload is cleaned up', async () => {
    const admin = await createUser('SUPER_ADMIN', 'admin_rollback@test.com')
    const cookie = await loginUser('admin_rollback@test.com')

    // Temporarily spy on FileAsset.create to simulate a database connection drop or constraint error
    const originalCreate = FileAsset.create.bind(FileAsset)
    FileAsset.create = (() => Promise.reject(new Error('Database connection dropped during write'))) as unknown as typeof FileAsset.create

    try {
      const res = await request(app)
        .post('/api/files/upload')
        .set('Cookie', cookie)
        .attach('file', validJpegBuffer, 'fail_persist.jpg')
        .field('ownerType', 'USER_AVATAR')
        .field('ownerId', String(admin._id))

      expect(res.status).toBe(500)

      // Verify that no orphaned files remained in storage provider!
      expect(mockStorage.storedFiles.size).toBe(0)
    } finally {
      FileAsset.create = originalCreate
    }
  })

  it('9. Storage Dashboard: Super Admin can access storage metrics; non-admins are rejected', async () => {
    const admin = await createUser('SUPER_ADMIN', 'admin_dash@test.com')
    await createUser('MARKETING_HEAD', 'head_dash@test.com')

    const adminCookie = await loginUser('admin_dash@test.com')
    const headCookie = await loginUser('head_dash@test.com')

    // Upload 1 avatar and 1 client visiting card
    const client = await Client.create({
      organisationName: 'Dash Client',
      category: 'Hospital',
      address: 'Kolkata',
      phone: '9876543210',
      createdBy: admin._id,
    })

    await request(app)
      .post('/api/files/upload')
      .set('Cookie', adminCookie)
      .attach('file', validJpegBuffer, 'avatar1.jpg')
      .field('ownerType', 'USER_AVATAR')
      .field('ownerId', String(admin._id))

    await request(app)
      .post('/api/files/upload')
      .set('Cookie', adminCookie)
      .attach('file', validPdfBuffer, 'card.pdf')
      .field('ownerType', 'CLIENT_VISITING_CARD')
      .field('ownerId', String(client._id))

    // Non-admin request -> 403 Forbidden
    const forbidden = await request(app)
      .get('/api/files/storage/dashboard')
      .set('Cookie', headCookie)

    expect(forbidden.status).toBe(403)

    // Super Admin request -> 200 with metrics
    const dashRes = await request(app)
      .get('/api/files/storage/dashboard')
      .set('Cookie', adminCookie)

    expect(dashRes.status).toBe(200)
    expect(dashRes.body.data.totalFiles).toBe(2)
    expect(dashRes.body.data.totalBytes).toBeGreaterThan(0)
    expect(dashRes.body.data.byCategory.USER_AVATAR.count).toBe(1)
    expect(dashRes.body.data.byCategory.CLIENT_VISITING_CARD.count).toBe(1)
    expect(dashRes.body.data.recentUploads.length).toBe(2)
  })

  it('10. Client Visiting Card & Document upload and owner listing', async () => {
    const admin = await createUser('SUPER_ADMIN', 'admin_client_docs@test.com')
    const cookie = await loginUser('admin_client_docs@test.com')

    const client = await Client.create({
      organisationName: 'Apollo Clinic',
      category: 'Hospital',
      address: 'Kolkata Central',
      phone: '9876543210',
      createdBy: admin._id,
    })

    // Upload visiting card
    const cardRes = await request(app)
      .post('/api/files/upload')
      .set('Cookie', cookie)
      .attach('file', validJpegBuffer, 'apollo_card.jpg')
      .field('ownerType', 'CLIENT_VISITING_CARD')
      .field('ownerId', String(client._id))

    expect(cardRes.status).toBe(201)

    // Upload document
    const docRes = await request(app)
      .post('/api/files/upload')
      .set('Cookie', cookie)
      .attach('file', validPdfBuffer, 'agreement.pdf')
      .field('ownerType', 'CLIENT_DOCUMENT')
      .field('ownerId', String(client._id))

    expect(docRes.status).toBe(201)

    // List files for client documents
    const listRes = await request(app)
      .get(`/api/files/owner/CLIENT_DOCUMENT/${client._id}`)
      .set('Cookie', cookie)

    expect(listRes.status).toBe(200)
    expect(listRes.body.data.items.length).toBe(1)
    expect(listRes.body.data.items[0].asset.originalName).toBe('agreement.pdf')
  })
})

