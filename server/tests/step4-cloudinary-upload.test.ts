import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
let FileAsset: typeof import('../src/models/FileAsset.js')['FileAsset']
let AuditEvent: typeof import('../src/models/AuditEvent.js')['AuditEvent']

const mockStorage = new MockStorageProvider()

const PNG_HEADER_HEX = '89504e470d0a1a0a0000000d49484452'
const PDF_HEADER_HEX = '255044462d312e340a25e2e3cfd30a0a'
const PNG_BUFFER = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('mock-png-body')])

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  setStorageProvider(mockStorage)

  const [{ createApp }, userMod, clientMod, fileMod, auditMod, { connectDatabase }] = await Promise.all([
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/Client.js'),
    import('../src/models/FileAsset.js'),
    import('../src/models/AuditEvent.js'),
    import('../src/config/db.js'),
  ])

  app = createApp()
  User = userMod.User
  Client = clientMod.Client
  FileAsset = fileMod.FileAsset
  AuditEvent = auditMod.AuditEvent
  await connectDatabase()
}, 120000)

beforeEach(async () => {
  mockStorage.clear()
  await Promise.all([
    User.deleteMany({}),
    Client.deleteMany({}),
    FileAsset.deleteMany({}),
    AuditEvent.deleteMany({}),
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
  if (res.status !== 200 || !res.headers['set-cookie']) {
    throw new Error(`Login failed for ${email}: status=${res.status} body=${JSON.stringify(res.body)}`)
  }
  return res.headers['set-cookie']
}

function seedDirectUploadInMock(publicId: string, filename: string, resourceType: 'image' | 'raw', buffer: Buffer, tags: string[] = []) {
  mockStorage.storedFiles.set(publicId, {
    buffer,
    uploadedAt: new Date(),
    options: {
      buffer,
      filename,
      mimeType: resourceType === 'image' ? 'image/png' : 'application/pdf',
      resourceType,
      folder: publicId.substring(0, publicId.lastIndexOf('/')),
      publicId,
      tags,
    },
  })
}

describe('Phase 3.5 Step 4: Cloudinary Upload Ceiling, Registration, Safe Replacement & Orphan Cleanup', () => {
  it('enforces auth, RBAC, size limits, and magic-byte validation on POST /api/files/sign-upload without leaking secrets', async () => {
    const admin = await createUser('SUPER_ADMIN', 'admin4@test.com')
    const exec = await createUser('MARKETING_EXECUTIVE', 'exec4@test.com')
    const client = await Client.create({
      organisationName: 'Signed Upload Corp',
      category: 'Hospital',
      address: 'Kolkata Central',
      phone: '9998887776',
      createdBy: exec._id,
    })

    // Unauthenticated rejected
    const unauthRes = await request(app).post('/api/files/sign-upload').send({
      ownerType: 'USER_AVATAR',
      ownerId: String(exec._id),
      originalName: 'avatar.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      headerHex: PNG_HEADER_HEX,
    })
    expect(unauthRes.status).toBe(401)

    const execCookie = await loginUser('exec4@test.com')

    // Cross-user avatar write blocked
    const otherAvatarRes = await request(app).post('/api/files/sign-upload').set('Cookie', execCookie).send({
      ownerType: 'USER_AVATAR',
      ownerId: String(admin._id),
      originalName: 'avatar.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      headerHex: PNG_HEADER_HEX,
    })
    expect(otherAvatarRes.status).toBe(403)

    // Oversized avatar (>5MB) rejected before signing
    const oversizedRes = await request(app).post('/api/files/sign-upload').set('Cookie', execCookie).send({
      ownerType: 'USER_AVATAR',
      ownerId: String(exec._id),
      originalName: 'huge.png',
      mimeType: 'image/png',
      sizeBytes: 6 * 1024 * 1024,
      headerHex: PNG_HEADER_HEX,
    })
    expect(oversizedRes.status).toBe(422)

    // Spoofed magic bytes (EXE header labeled image/png) rejected
    const spoofedRes = await request(app).post('/api/files/sign-upload').set('Cookie', execCookie).send({
      ownerType: 'USER_AVATAR',
      ownerId: String(exec._id),
      originalName: 'fake.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      headerHex: '4d5a90000300000004000000ffff0000',
    })
    expect(spoofedRes.status).toBe(422)

    // Valid >4.5MB CLIENT_DOCUMENT (12MB PDF, under 25MB limit) signs cleanly without exposing secrets
    const signRes = await request(app).post('/api/files/sign-upload').set('Cookie', execCookie).send({
      ownerType: 'CLIENT_DOCUMENT',
      ownerId: String(client._id),
      originalName: 'proposal-large.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12 * 1024 * 1024,
      headerHex: PDF_HEADER_HEX,
    })
    expect(signRes.status).toBe(200)
    expect(signRes.body.data.uploadIntentToken).toBeTruthy()
    expect(signRes.body.data.uploadParams.publicId).toContain(`etech_crm/client_document/${client._id}/`)
    expect(JSON.stringify(signRes.body)).not.toContain(process.env.JWT_SECRET!)
  })

  it('rejects tampered/invalid tokens, enforces server-side metadata checks, and supports idempotent direct upload registration', async () => {
    const exec = await createUser('MARKETING_EXECUTIVE', 'exec-reg@test.com')
    const execCookie = await loginUser('exec-reg@test.com')
    const client = await Client.create({
      organisationName: 'Register Check LLC',
      category: 'Clinic',
      address: 'Kolkata North',
      phone: '9990001112',
      createdBy: exec._id,
    })

    // 1. Tampered JWT token rejected
    const tamperedRes = await request(app).post('/api/files/register').set('Cookie', execCookie).send({
      uploadIntentToken: 'tampered.jwt.token.value',
    })
    expect(tamperedRes.status).toBe(401)

    // 2. Token pointing to arbitrary publicId outside ownership prefix blocked
    const { env } = await import('../src/config/env.js')
    const forgedPrefixToken = jwt.sign(
      {
        purpose: 'FILE_UPLOAD_INTENT',
        intentId: 'forged-1',
        actorId: String(exec._id),
        ownerType: 'CLIENT_DOCUMENT',
        ownerId: String(client._id),
        originalName: 'doc.pdf',
        mimeType: 'application/pdf',
        expectedSizeBytes: 1024,
        maxAllowedBytes: 25 * 1024 * 1024,
        resourceType: 'raw',
        publicId: 'other_bucket/secret_file',
        folder: 'other_bucket',
      },
      env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '10m' }
    )
    const forgedPrefixRes = await request(app).post('/api/files/register').set('Cookie', execCookie).send({
      uploadIntentToken: forgedPrefixToken,
    })
    expect(forgedPrefixRes.status).toBe(422)

    // 3. Legitimate sign-upload followed by unuploaded register -> 404
    const signRes = await request(app).post('/api/files/sign-upload').set('Cookie', execCookie).send({
      ownerType: 'USER_AVATAR',
      ownerId: String(exec._id),
      originalName: 'avatar.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BUFFER.length,
      headerHex: PNG_HEADER_HEX,
    })
    expect(signRes.status).toBe(200)
    const { uploadIntentToken, uploadParams } = signRes.body.data

    const missingCloudRes = await request(app).post('/api/files/register').set('Cookie', execCookie).send({
      uploadIntentToken,
    })
    expect(missingCloudRes.status).toBe(404)

    // 4. Server-side check deletes mismatched format uploaded to cloud
    seedDirectUploadInMock(uploadParams.publicId, 'malicious.exe', 'image', PNG_BUFFER)
    const badFormatRes = await request(app).post('/api/files/register').set('Cookie', execCookie).send({
      uploadIntentToken,
    })
    expect(badFormatRes.status).toBe(422)
    expect(mockStorage.storedFiles.has(uploadParams.publicId)).toBe(false)

    // 5. Valid cloud upload registers cleanly & retries idempotently without creating duplicates
    seedDirectUploadInMock(uploadParams.publicId, 'avatar.png', 'image', PNG_BUFFER)
    const reg1 = await request(app).post('/api/files/register').set('Cookie', execCookie).send({
      uploadIntentToken,
    })
    expect(reg1.status).toBe(201)
    expect(reg1.body.data.viewUrl).toBe(`/api/files/${reg1.body.data.asset._id}/view`)

    const reg2 = await request(app).post('/api/files/register').set('Cookie', execCookie).send({
      uploadIntentToken,
    })
    expect(reg2.status).toBe(200)
    expect(reg2.body.data.idempotent).toBe(true)
    expect(reg2.body.data.asset._id).toBe(reg1.body.data.asset._id)
    expect(await FileAsset.countDocuments({ cloudinaryPublicId: uploadParams.publicId })).toBe(1)

    // Streaming proxy still works seamlessly
    const streamRes = await request(app).get(reg1.body.data.viewUrl).set('Cookie', execCookie)
    expect(streamRes.status).toBe(200)
  })

  it('safely replaces single-slot assets, rolls back ONLY failed new uploads, and preserves multi-asset history', async () => {
    const exec = await createUser('MARKETING_EXECUTIVE', 'exec-replace@test.com')
    const execCookie = await loginUser('exec-replace@test.com')

    // Upload Avatar A
    const signA = await request(app).post('/api/files/sign-upload').set('Cookie', execCookie).send({
      ownerType: 'USER_AVATAR',
      ownerId: String(exec._id),
      originalName: 'avatar-a.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BUFFER.length,
      headerHex: PNG_HEADER_HEX,
    })
    const keyA = signA.body.data.uploadParams.publicId
    seedDirectUploadInMock(keyA, 'avatar-a.png', 'image', PNG_BUFFER)
    const regA = await request(app).post('/api/files/register').set('Cookie', execCookie).send({
      uploadIntentToken: signA.body.data.uploadIntentToken,
    })
    expect(regA.status).toBe(201)
    const assetAId = regA.body.data.asset._id

    // Sign Avatar B & simulate MongoDB failure during persistence -> new upload B must be rolled back, A kept intact!
    const signB = await request(app).post('/api/files/sign-upload').set('Cookie', execCookie).send({
      ownerType: 'USER_AVATAR',
      ownerId: String(exec._id),
      originalName: 'avatar-b.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BUFFER.length,
      headerHex: PNG_HEADER_HEX,
    })
    const keyB = signB.body.data.uploadParams.publicId
    seedDirectUploadInMock(keyB, 'avatar-b.png', 'image', PNG_BUFFER)

    const createSpy = vi.spyOn(FileAsset, 'create').mockRejectedValueOnce(new Error('Simulated Mongo write failure'))
    const failB = await request(app).post('/api/files/register').set('Cookie', execCookie).send({
      uploadIntentToken: signB.body.data.uploadIntentToken,
    })
    createSpy.mockRestore()

    expect(failB.status).toBe(500)
    expect(mockStorage.storedFiles.has(keyB)).toBe(false)
    expect(mockStorage.storedFiles.has(keyA)).toBe(true)

    const userAfterFail = await User.findById(exec._id).lean()
    expect(String(userAfterFail?.avatarAsset)).toBe(assetAId)

    // Retry valid Avatar B -> old A is archived & deleted from storage, new B becomes active
    seedDirectUploadInMock(keyB, 'avatar-b.png', 'image', PNG_BUFFER)
    const okB = await request(app).post('/api/files/register').set('Cookie', execCookie).send({
      uploadIntentToken: signB.body.data.uploadIntentToken,
    })
    expect(okB.status).toBe(201)
    const assetBId = okB.body.data.asset._id

    expect(mockStorage.storedFiles.has(keyA)).toBe(false)
    expect(mockStorage.storedFiles.has(keyB)).toBe(true)
    const archivedA = await FileAsset.findById(assetAId).lean()
    expect(archivedA?.isArchived).toBe(true)

    const userAfterB = await User.findById(exec._id).lean()
    expect(String(userAfterB?.avatarAsset)).toBe(assetBId)

    // Replace B with C while cloud deletion fails -> C must still succeed and B must be flagged pendingCloudDelete
    const signC = await request(app).post('/api/files/sign-upload').set('Cookie', execCookie).send({
      ownerType: 'USER_AVATAR',
      ownerId: String(exec._id),
      originalName: 'avatar-c.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BUFFER.length,
      headerHex: PNG_HEADER_HEX,
    })
    const keyC = signC.body.data.uploadParams.publicId
    seedDirectUploadInMock(keyC, 'avatar-c.png', 'image', PNG_BUFFER)
    mockStorage.shouldFailDelete = true

    const okC = await request(app).post('/api/files/register').set('Cookie', execCookie).send({
      uploadIntentToken: signC.body.data.uploadIntentToken,
    })
    mockStorage.shouldFailDelete = false
    expect(okC.status).toBe(201)

    const archivedB = await FileAsset.findById(assetBId).lean()
    expect(archivedB?.isArchived).toBe(true)
    expect((archivedB?.metadata as { pendingCloudDelete?: boolean })?.pendingCloudDelete).toBe(true)
    const pendingAudit = await AuditEvent.findOne({ action: 'FILE_ORPHAN_CLEANUP_PENDING' }).lean()
    expect(pendingAudit).not.toBeNull()

    // Multi-asset CLIENT_DOCUMENT must preserve all documents
    const client = await Client.create({
      organisationName: 'Multi Doc Co',
      category: 'Diagnostic Lab',
      address: 'Salt Lake',
      phone: '9997776665',
      createdBy: exec._id,
    })
    const doc1 = await request(app)
      .post('/api/files/upload')
      .set('Cookie', execCookie)
      .field('ownerType', 'CLIENT_DOCUMENT')
      .field('ownerId', String(client._id))
      .attach('file', PNG_BUFFER, 'doc1.png')
    const doc2 = await request(app)
      .post('/api/files/upload')
      .set('Cookie', execCookie)
      .field('ownerType', 'CLIENT_DOCUMENT')
      .field('ownerId', String(client._id))
      .attach('file', PNG_BUFFER, 'doc2.png')
    expect(doc1.status).toBe(201)
    expect(doc2.status).toBe(201)

    const updatedClient = await Client.findById(client._id).lean()
    expect(updatedClient?.documentAssets).toHaveLength(2)
  })

  it('restricts orphan detection & cleanup to SUPER_ADMIN, enforces age guard, and runs idempotently', async () => {
    const admin = await createUser('SUPER_ADMIN', 'admin-orphan@test.com')
    const exec = await createUser('MARKETING_EXECUTIVE', 'exec-orphan@test.com')
    const adminCookie = await loginUser('admin-orphan@test.com')
    const execCookie = await loginUser('exec-orphan@test.com')

    // Non-Super-Admin blocked
    const forbiddenOrphan = await request(app).get('/api/files/storage/orphans').set('Cookie', execCookie)
    expect(forbiddenOrphan.status).toBe(403)

    // Active avatar must never be touched
    const activeRes = await request(app)
      .post('/api/files/upload')
      .set('Cookie', execCookie)
      .field('ownerType', 'USER_AVATAR')
      .field('ownerId', String(exec._id))
      .attach('file', PNG_BUFFER, 'active.png')
    expect(activeRes.status).toBe(201)
    const activePublicId = activeRes.body.data.asset.cloudinaryPublicId as string

    // 1. Recent (<24h) unregistered upload must be protected by default 24h age guard
    const recentUnregisteredKey = `etech_crm/user_avatar/${exec._id}/${Date.now()}_recent`
    seedDirectUploadInMock(recentUnregisteredKey, 'recent.png', 'image', PNG_BUFFER)

    // 2. Aged (>25h) unregistered upload under CRM prefix -> eligible orphan
    const oldDate = new Date(Date.now() - 26 * 60 * 60 * 1000)
    const oldUnregisteredKey = `etech_crm/user_avatar/${exec._id}/${Date.now() - 999999}_old`
    mockStorage.storedFiles.set(oldUnregisteredKey, {
      buffer: PNG_BUFFER,
      uploadedAt: oldDate,
      options: {
        buffer: PNG_BUFFER,
        filename: 'abandoned.png',
        mimeType: 'image/png',
        resourceType: 'image',
        folder: `etech_crm/user_avatar/${exec._id}`,
        publicId: oldUnregisteredKey,
      },
    })

    // 3. Aged archived pendingCloudDelete record -> eligible retry cleanup
    const pendingKey = `etech_crm/user_avatar/${exec._id}/pending_old`
    mockStorage.storedFiles.set(pendingKey, {
      buffer: PNG_BUFFER,
      uploadedAt: oldDate,
      options: {
        buffer: PNG_BUFFER,
        filename: 'pending.png',
        mimeType: 'image/png',
        resourceType: 'image',
        folder: `etech_crm/user_avatar/${exec._id}`,
        publicId: pendingKey,
      },
    })
    const pendingAsset = await FileAsset.create({
      originalName: 'pending.png',
      resourceType: 'image',
      mimeType: 'image/png',
      sizeBytes: PNG_BUFFER.length,
      cloudinaryPublicId: pendingKey,
      cloudinaryResourceType: 'image',
      secureStorageReference: `https://mock-storage.local/${pendingKey}`,
      ownerType: 'USER_AVATAR',
      ownerId: exec._id,
      uploadedBy: exec._id,
      visibility: 'PRIVATE',
      isArchived: true,
      deletedAt: oldDate,
      metadata: { pendingCloudDelete: true },
    })

    // 4. Aged stale DB record whose cloud object disappeared -> detected under verifyCloud=true
    const missingCloudKey = `etech_crm/user_avatar/${admin._id}/missing_cloud`
    const staleDbAsset = await FileAsset.create({
      originalName: 'stale.png',
      resourceType: 'image',
      mimeType: 'image/png',
      sizeBytes: PNG_BUFFER.length,
      cloudinaryPublicId: missingCloudKey,
      cloudinaryResourceType: 'image',
      secureStorageReference: `https://mock-storage.local/${missingCloudKey}`,
      ownerType: 'USER_AVATAR',
      ownerId: admin._id,
      uploadedBy: admin._id,
      visibility: 'PRIVATE',
      isArchived: false,
      createdAt: oldDate,
      updatedAt: oldDate,
    })

    // Dry-run scan
    const dryRes = await request(app)
      .get('/api/files/storage/orphans?minAgeHours=24&verifyCloud=true')
      .set('Cookie', adminCookie)
    expect(dryRes.status).toBe(200)
    expect(dryRes.body.data.summary.pendingCloudDeletes).toBe(1)
    expect(dryRes.body.data.summary.unregisteredCloudAssets).toBe(1)
    expect(dryRes.body.data.summary.staleDbRecords).toBe(1)
    // Recent upload NOT flagged
    expect(mockStorage.storedFiles.has(recentUnregisteredKey)).toBe(true)
    expect(mockStorage.storedFiles.has(oldUnregisteredKey)).toBe(true)

    // Execute cleanup
    const cleanRes = await request(app)
      .post('/api/files/storage/orphans/cleanup')
      .set('Cookie', adminCookie)
      .send({ dryRun: false, minAgeHours: 24, verifyCloud: true })
    expect(cleanRes.status).toBe(200)
    expect(cleanRes.body.data.summary.cleanedPendingCloudDeletes).toBe(1)
    expect(cleanRes.body.data.summary.cleanedUnregisteredCloudAssets).toBe(1)
    expect(cleanRes.body.data.summary.archivedStaleDbRecords).toBe(1)

    // Active + <24h preserved; old orphans cleaned
    expect(mockStorage.storedFiles.has(activePublicId)).toBe(true)
    expect(mockStorage.storedFiles.has(recentUnregisteredKey)).toBe(true)
    expect(mockStorage.storedFiles.has(oldUnregisteredKey)).toBe(false)
    expect(mockStorage.storedFiles.has(pendingKey)).toBe(false)

    const updatedPending = await FileAsset.findById(pendingAsset._id).lean()
    expect((updatedPending?.metadata as { pendingCloudDelete?: boolean })?.pendingCloudDelete).toBe(false)
    const archivedStale = await FileAsset.findById(staleDbAsset._id).lean()
    expect(archivedStale?.isArchived).toBe(true)

    // Audit event recorded
    const cleanupAudit = await AuditEvent.findOne({ action: 'FILE_ORPHAN_CLEANUP' }).lean()
    expect(cleanupAudit).not.toBeNull()

    // Idempotent second cleanup run finds 0 items
    const secondRun = await request(app)
      .post('/api/files/storage/orphans/cleanup')
      .set('Cookie', adminCookie)
      .send({ dryRun: false, minAgeHours: 24, verifyCloud: true })
    expect(secondRun.status).toBe(200)
    expect(secondRun.body.data.summary.pendingCloudDeletes).toBe(0)
    expect(secondRun.body.data.summary.unregisteredCloudAssets).toBe(0)
    expect(secondRun.body.data.summary.staleDbRecords).toBe(0)
  })
})
