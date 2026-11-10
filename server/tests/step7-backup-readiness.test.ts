import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import mongoose, { type Connection } from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { v2 as cloudinary } from 'cloudinary'
import { CloudinaryStorageProvider } from '../src/services/storage/cloudinary.provider.js'
import { MockStorageProvider } from '../src/services/storage/mock.provider.js'
import { PENDING_ORGANIZATION_OWNER_ID, setStorageProvider, uploadFileAsset } from '../src/services/storage/storage.service.js'
import { updateOrganizationConfig } from '../src/services/organization.js'
import { Organization } from '../src/models/Organization.js'
import { FileAsset } from '../src/models/FileAsset.js'
import { User } from '../src/models/User.js'
import { env } from '../src/config/env.js'
import {
  assertSafeRestoreTargetUri,
  BACKUP_MAGIC,
  createEncryptedBackup,
  createEncryptedBackupToFile,
  decryptAndVerifyBackup,
  normalizeMongoTargetIdentity,
  reconcileCloudinaryMetadata,
  resolveBackupKey,
  RestoreConsistencyError,
  restoreEncryptedBackupFromFile,
  restoreEncryptedBackupToIsolatedTarget,
  verifyBackupFile,
  verifyRestoredDatabaseIntegrity,
} from '../src/services/backup.js'

const VALID_BACKUP_KEY_HEX = 'a'.repeat(64)
const WRONG_BACKUP_KEY_HEX = 'b'.repeat(64)

let sourceMongo: MongoMemoryServer
let targetMongo: MongoMemoryServer
let sourceConn: Connection
let targetConn: Connection
const mockStorage = new MockStorageProvider()

beforeAll(async () => {
  ;[sourceMongo, targetMongo] = await Promise.all([
    MongoMemoryServer.create(),
    MongoMemoryServer.create(),
  ])
  const sourceUri = sourceMongo.getUri('etech_prod_sim')
  const targetUri = targetMongo.getUri('etech_restore_verify')

  ;[sourceConn, targetConn] = await Promise.all([
    mongoose.createConnection(sourceUri).asPromise(),
    mongoose.createConnection(targetUri).asPromise(),
  ])

  setStorageProvider(mockStorage)
}, 120000)

async function clearDb(conn: Connection) {
  if (!conn.db) return
  const collections = await conn.db.listCollections({}, { nameOnly: true }).toArray()
  for (const col of collections) {
    if (!col.name.startsWith('system.')) {
      await conn.collection(col.name).deleteMany({})
    }
  }
}

beforeEach(async () => {
  mockStorage.clear()
  await Promise.all([clearDb(sourceConn), clearDb(targetConn)])
})

afterAll(async () => {
  await Promise.all([
    sourceConn?.close().catch(() => {}),
    targetConn?.close().catch(() => {}),
  ])
  await Promise.all([
    sourceMongo?.stop(),
    targetMongo?.stop(),
  ])
})

describe('Phase 3.5 Step 7: Encrypted Logical Backup, Non-Destructive Restore & Cloud Reconciliation', () => {
  it('1. Rejects weak/invalid backup keys, encrypts with AES-256-GCM, hides metadata in ciphertext, and rejects wrong keys or tampering', async () => {
    expect(() => resolveBackupKey('')).toThrow(/64-character hexadecimal/i)
    expect(() => resolveBackupKey('too-short-key')).toThrow(/64-character hexadecimal/i)
    expect(() => resolveBackupKey('z'.repeat(64))).toThrow(/64-character hexadecimal/i)

    const passHash = await bcrypt.hash('SecretPass#2026', 10)
    await sourceConn.collection('users').insertOne({
      _id: new mongoose.Types.ObjectId(),
      name: 'Backup Admin',
      email: 'backup-admin@test.com',
      passwordHash: passHash,
      role: 'SUPER_ADMIN',
      isActive: true,
      tokenVersion: 2,
      createdAt: new Date('2026-11-10T01:00:00.000Z'),
    })

    // Seed ephemeral RateLimitBucket that MUST be excluded
    await sourceConn.collection('ratelimitbuckets').insertOne({
      bucketKey: 'ephemeral_login_hash',
      count: 3,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const created = await createEncryptedBackup(sourceConn, VALID_BACKUP_KEY_HEX)
    expect(created.encryptedBuffer.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)).toBe(true)

    // Ciphertext envelope must NOT expose plaintext passwordHash, email, collection names, or counts
    const rawText = created.encryptedBuffer.toString('latin1')
    expect(rawText).not.toContain(passHash)
    expect(rawText).not.toContain('backup-admin@test.com')
    expect(rawText).not.toContain('users')
    expect(rawText).not.toContain('collectionCounts')
    expect(created.excludedCollections).toContain('ratelimitbuckets')

    // Wrong key rejected
    expect(() => decryptAndVerifyBackup(created.encryptedBuffer, WRONG_BACKUP_KEY_HEX)).toThrow(/decryption or authentication failed/i)

    // Tampered ciphertext byte rejected
    const tampered = Buffer.from(created.encryptedBuffer)
    tampered[tampered.length - 5] ^= 0xff
    expect(() => decryptAndVerifyBackup(tampered, VALID_BACKUP_KEY_HEX)).toThrow(/decryption or authentication failed/i)

    // Corrupted/truncated archive rejected
    expect(() => decryptAndVerifyBackup(created.encryptedBuffer.subarray(0, 20), VALID_BACKUP_KEY_HEX)).toThrow(/truncated/i)

    // Valid decrypt verifies counts and excludes RateLimitBucket
    const decrypted = decryptAndVerifyBackup(created.encryptedBuffer, VALID_BACKUP_KEY_HEX)
    expect(decrypted.verification.collectionCounts.users).toBe(1)
    expect(decrypted.payload.collections.ratelimitbuckets).toBeUndefined()
  })

  it('2. Restores into an isolated database preserving ObjectId/Date/passwordHash/PushSubscription/attribution, protects custom indexes, and leaves source DB untouched', async () => {
    const headId = new mongoose.Types.ObjectId()
    const execId = new mongoose.Types.ObjectId()
    const clientId = new mongoose.Types.ObjectId()
    const visitId = new mongoose.Types.ObjectId()
    const taskId = new mongoose.Types.ObjectId()
    const assetId = new mongoose.Types.ObjectId()

    const execPasswordHash = await bcrypt.hash('ExecSecret123!', 10)
    const plannedDate = new Date('2026-11-09T09:00:00.000Z')
    const followUpDate = new Date('2026-11-12T00:00:00.000Z')

    await sourceConn.collection('users').insertMany([
      {
        _id: headId,
        name: 'Historical Head',
        email: 'head-step7@test.com',
        passwordHash: execPasswordHash,
        role: 'MARKETING_HEAD',
        isActive: true,
        tokenVersion: 0,
        createdAt: new Date(),
      },
      {
        _id: execId,
        name: 'Field Exec',
        email: 'exec-step7@test.com',
        passwordHash: execPasswordHash,
        role: 'MARKETING_EXECUTIVE',
        reportingTo: headId,
        isActive: true,
        tokenVersion: 1,
        createdAt: new Date(),
      },
    ])

    await sourceConn.collection('clients').insertOne({
      _id: clientId,
      organisationName: 'Medica Multispecialty',
      category: 'Hospital',
      address: 'EM Bypass, Kolkata',
      createdBy: headId,
      visitingCardAsset: assetId,
      isActive: true,
      createdAt: new Date(),
    })

    await sourceConn.collection('visits').insertOne({
      _id: visitId,
      client: clientId,
      assignedTo: execId,
      assignedBy: headId,
      marketingHeadAtAssignment: headId,
      source: 'ADMIN_ASSIGNED',
      plannedDate,
      followUpDate,
      status: 'COMPLETED',
      remarks: 'Visited and quoted',
      createdAt: new Date(),
    })

    await sourceConn.collection('followuptasks').insertOne({
      _id: taskId,
      sourceVisit: visitId,
      client: clientId,
      assignedTo: execId,
      marketingHeadAtCreation: headId,
      dueDate: followUpDate,
      status: 'PENDING',
      createdAt: new Date(),
    })

    await sourceConn.collection('pushsubscriptions').insertOne({
      _id: new mongoose.Types.ObjectId(),
      user: execId,
      endpoint: 'https://push.example.com/sub-step7',
      keys: { p256dh: 'pub-key-b64', auth: 'auth-secret-b64' },
      createdAt: new Date(),
    })

    await sourceConn.collection('notifications').insertOne({
      _id: new mongoose.Types.ObjectId(),
      recipient: execId,
      title: 'Follow-up reminder',
      message: 'Call Medica',
      type: 'FOLLOW_UP_REMINDER',
      entityType: 'Visit',
      entityId: visitId,
      createdAt: new Date(),
    })

    await sourceConn.collection('auditevents').insertOne({
      _id: new mongoose.Types.ObjectId(),
      actor: headId,
      action: 'VISIT_ASSIGNED',
      entityType: 'Visit',
      entityId: visitId,
      timestamp: new Date(),
    })

    const activeCloudKey = `etech_crm/client_visiting_card/${clientId}/card_1`
    const extraCloudKey = `etech_crm/client_document/${clientId}/newer_doc`
    await sourceConn.collection('fileassets').insertOne({
      _id: assetId,
      originalName: 'card.png',
      resourceType: 'image',
      mimeType: 'image/png',
      sizeBytes: 2048,
      cloudinaryPublicId: activeCloudKey,
      cloudinaryResourceType: 'image',
      secureStorageReference: `https://mock-storage.local/${activeCloudKey}`,
      ownerType: 'CLIENT_VISITING_CARD',
      ownerId: clientId,
      uploadedBy: headId,
      visibility: 'PRIVATE',
      isArchived: false,
      createdAt: new Date(),
    })

    // Seed mock cloud storage with active file + 1 post-backup unregistered file
    mockStorage.storedFiles.set(activeCloudKey, {
      buffer: Buffer.from('card'),
      uploadedAt: new Date(),
      options: {
        buffer: Buffer.from('card'),
        filename: 'card.png',
        mimeType: 'image/png',
        resourceType: 'image',
        folder: `etech_crm/client_visiting_card/${clientId}`,
        publicId: activeCloudKey,
      },
    })
    mockStorage.storedFiles.set(extraCloudKey, {
      buffer: Buffer.from('newer'),
      uploadedAt: new Date(),
      options: {
        buffer: Buffer.from('newer'),
        filename: 'newer.png',
        mimeType: 'image/png',
        resourceType: 'image',
        folder: `etech_crm/client_document/${clientId}`,
        publicId: extraCloudKey,
      },
    })

    const sourceHashBefore = crypto
      .createHash('sha256')
      .update(JSON.stringify(await sourceConn.collection('visits').findOne({ _id: visitId })))
      .digest('hex')

    const backup = await createEncryptedBackup(sourceConn, VALID_BACKUP_KEY_HEX)

    // Pre-create a custom index on empty target `visits` to prove safe index creation does NOT drop unrelated indexes
    await targetConn.collection('visits').createIndex({ source: 1 }, { name: 'custom_ops_idx' })

    const restoreResult = await restoreEncryptedBackupToIsolatedTarget({
      encryptedBuffer: backup.encryptedBuffer,
      targetConnection: targetConn,
      targetUri: targetMongo.getUri('etech_restore_verify'),
      productionUri: sourceMongo.getUri('etech_prod_sim'),
      encryptionKeyHex: VALID_BACKUP_KEY_HEX,
    })

    expect(restoreResult.consistencyReport.countsMatched).toBe(true)
    expect(restoreResult.consistencyReport.consistencyWarnings).toEqual([])
    expect(restoreResult.consistencyReport.usersWithPasswordHash).toBe(2)
    expect(restoreResult.consistencyReport.pushSubscriptionsCount).toBe(1)

    // Verify ObjectId, Date, passwordHash, and historical attribution preserved
    const restoredExec = await targetConn.collection('users').findOne({ _id: execId })
    expect(restoredExec?._id).toBeInstanceOf(mongoose.mongo.BSON.ObjectId)
    expect(String(restoredExec?._id)).toBe(String(execId))
    expect(await bcrypt.compare('ExecSecret123!', String(restoredExec?.passwordHash))).toBe(true)

    const restoredVisit = await targetConn.collection('visits').findOne({ _id: visitId })
    expect(restoredVisit?.plannedDate).toBeInstanceOf(Date)
    expect((restoredVisit?.plannedDate as Date).toISOString()).toBe(plannedDate.toISOString())
    expect(String(restoredVisit?.marketingHeadAtAssignment)).toBe(String(headId))

    const restoredTask = await targetConn.collection('followuptasks').findOne({ _id: taskId })
    expect(String(restoredTask?.marketingHeadAtCreation)).toBe(String(headId))

    // Verify pre-existing unrelated custom index survived restore (syncIndexes was NOT used)
    expect(restoreResult.consistencyReport.preservedIndexesByCollection.visits).toContain('custom_ops_idx')

    // Source DB must remain completely untouched
    const sourceHashAfter = crypto
      .createHash('sha256')
      .update(JSON.stringify(await sourceConn.collection('visits').findOne({ _id: visitId })))
      .digest('hex')
    expect(sourceHashAfter).toBe(sourceHashBefore)

    // Read-only Cloudinary metadata reconciliation detects unregistered post-backup upload without deleting anything!
    const recon = await reconcileCloudinaryMetadata(targetConn)
    expect(recon.activeDbAssets).toBe(1)
    expect(recon.missingInCloud).toHaveLength(0)
    expect(recon.unregisteredInDb.map((u) => u.publicId)).toEqual([extraCloudKey])
    expect(mockStorage.storedFiles.has(extraCloudKey)).toBe(true)
  })

  it('3. Blocks restore onto production MONGODB_URI and rejects non-empty target databases without overwriting data', async () => {
    await sourceConn.collection('settings').insertOne({ key: 'GEOFENCE_CONFIG', value: { defaultRadius: 50 } })
    const backup = await createEncryptedBackup(sourceConn, VALID_BACKUP_KEY_HEX)

    const prodUri = sourceMongo.getUri('etech_prod_sim')

    // Same cluster host & DB name rejected with 403
    expect(() => assertSafeRestoreTargetUri(prodUri, prodUri)).toThrow(/matches production MONGODB_URI/i)

    await expect(
      restoreEncryptedBackupToIsolatedTarget({
        encryptedBuffer: backup.encryptedBuffer,
        targetConnection: targetConn,
        targetUri: prodUri,
        productionUri: prodUri,
        encryptionKeyHex: VALID_BACKUP_KEY_HEX,
      })
    ).rejects.toMatchObject({ statusCode: 403 })

    // Non-empty target DB rejected with 409 and existing target document preserved intact
    await targetConn.collection('settings').insertOne({ key: 'EXISTING_PROD_LIKE', value: { keepMe: true } })

    await expect(
      restoreEncryptedBackupToIsolatedTarget({
        encryptedBuffer: backup.encryptedBuffer,
        targetConnection: targetConn,
        targetUri: targetMongo.getUri('etech_restore_verify'),
        productionUri: prodUri,
        encryptionKeyHex: VALID_BACKUP_KEY_HEX,
      })
    ).rejects.toMatchObject({ statusCode: 409 })

    const existingDoc = await targetConn.collection('settings').findOne({ key: 'EXISTING_PROD_LIKE' })
    expect(existingDoc?.value).toEqual({ keepMe: true })
  })

  it('4. Enforces fail-closed URI parsing across SRV, replica seedlists, loopback aliases, missing env, and source fingerprint', async () => {
    // Multi-host comma-separated URI parsing must succeed without URL parser failure
    const parsedSeedlist = normalizeMongoTargetIdentity(
      'mongodb://user:pass@h2:27017,h1:27017/etechcrm_prod?replicaSet=rs0&retryWrites=true'
    )
    expect(parsedSeedlist.dbName).toBe('etechcrm_prod')
    expect(parsedSeedlist.hosts).toEqual(['h1:27017', 'h2:27017'])
    expect(parsedSeedlist.replicaSet).toBe('rs0')

    // Missing production URI fails closed even when process.env.MONGODB_URI is unset
    const prevEnvMongo = process.env.MONGODB_URI
    try {
      delete process.env.MONGODB_URI
      expect(() =>
        assertSafeRestoreTargetUri('mongodb://127.0.0.1:27017/etechcrm_staging', '')
      ).toThrow(/MONGODB_URI is required/i)
    } finally {
      if (prevEnvMongo !== undefined) process.env.MONGODB_URI = prevEnvMongo
    }

    // Missing target URI or missing explicit DB name fails closed
    expect(() =>
      assertSafeRestoreTargetUri('', 'mongodb://127.0.0.1:27017/etechcrm_prod')
    ).toThrow(/RESTORE_TARGET_MONGODB_URI is required/i)
    expect(() =>
      assertSafeRestoreTargetUri('mongodb+srv://cluster0.abcde.mongodb.net/', 'mongodb://127.0.0.1:27017/etechcrm_prod')
    ).toThrow(/explicit target database name/i)

    // Reordered query parameters pointing to same DB & host rejected (403)
    expect(() =>
      assertSafeRestoreTargetUri(
        'mongodb+srv://cluster0.abcde.mongodb.net/etechcrm?w=majority&retryWrites=true',
        'mongodb+srv://cluster0.abcde.mongodb.net/etechcrm?retryWrites=true&w=majority'
      )
    ).toThrow(/Refusing restore/i)

    // Atlas SRV vs equivalent standard shard seedlist URI rejected (403)
    expect(() =>
      assertSafeRestoreTargetUri(
        'mongodb://ac-xyz-shard-00-00.abcde.mongodb.net:27017,ac-xyz-shard-00-01.abcde.mongodb.net:27017/etechcrm?ssl=true&replicaSet=atlas-abc',
        'mongodb+srv://cluster0.abcde.mongodb.net/etechcrm?retryWrites=true'
      )
    ).toThrow(/Refusing restore/i)

    // Comma-separated replica-set host overlap rejected (403)
    expect(() =>
      assertSafeRestoreTargetUri(
        'mongodb://rs2.internal:27017,rs3.internal:27017/etechcrm',
        'mongodb://rs1.internal:27017,rs2.internal:27017/etechcrm'
      )
    ).toThrow(/Refusing restore/i)

    // Loopback alias equivalence rejected (403)
    expect(() =>
      assertSafeRestoreTargetUri(
        'mongodb://localhost:27017/etechcrm',
        'mongodb://127.0.0.1:27017/etechcrm'
      )
    ).toThrow(/Refusing restore/i)

    // Cross-scheme uncertainty (non-Atlas SRV vs standard hosts with identical DB name) fails closed
    expect(() =>
      assertSafeRestoreTargetUri(
        'mongodb+srv://alias.internal.corp/etechcrm',
        'mongodb://node1.internal.corp:27017/etechcrm'
      )
    ).toThrow(/Refusing restore/i)

    // Distinct isolated database or distinct Atlas cluster IDs succeed
    expect(() =>
      assertSafeRestoreTargetUri(
        'mongodb://127.0.0.1:27017/etechcrm_restore_staging',
        'mongodb://127.0.0.1:27017/etechcrm_prod'
      )
    ).not.toThrow()
    expect(() =>
      assertSafeRestoreTargetUri(
        'mongodb+srv://staging.zzzzz.mongodb.net/etechcrm',
        'mongodb+srv://prod.abcde.mongodb.net/etechcrm'
      )
    ).not.toThrow()

    // Encrypted source DB fingerprint inside backup refuses restore onto source DB even if productionUri differs
    await sourceConn.collection('settings').insertOne({ key: 'FINGERPRINT_CHECK', value: 1 })
    const backup = await createEncryptedBackup(sourceConn, VALID_BACKUP_KEY_HEX)
    const actualSourceUri = sourceMongo.getUri(sourceConn.db!.databaseName)

    // Wire a temp connection directly to actualSourceUri (same host/DB as backup source) while setting a different dummy productionUri
    const replayConn = await mongoose.createConnection(actualSourceUri).asPromise()
    try {
      await expect(
        restoreEncryptedBackupToIsolatedTarget({
          encryptedBuffer: backup.encryptedBuffer,
          targetConnection: replayConn,
          targetUri: actualSourceUri,
          productionUri: 'mongodb://rs1.unrelated-prod.internal:27017/unrelated_db?replicaSet=prod-rs',
          encryptionKeyHex: VALID_BACKUP_KEY_HEX,
        })
      ).rejects.toMatchObject({ statusCode: 403 })
    } finally {
      await replayConn.close().catch(() => {})
    }
  })

  it('5. Reconciles >2000 DB records and >500 image + >500 raw assets across pages without truncating or false missing alerts on error', async () => {
    const adminId = new mongoose.Types.ObjectId()
    const docsToInsert: Record<string, unknown>[] = []
    mockStorage.listPageSizeForTests = 120 // Force multi-page pagination (9+ pages per resourceType)

    // 1050 images + 1050 raw = 2100 active DB assets (1049 + 1050 = 2099 present in cloud, 1 missing in cloud)
    for (let i = 0; i < 1050; i++) {
      const publicId = `etech_crm/visit_photo/${adminId}/img_${i}`
      docsToInsert.push({
        _id: new mongoose.Types.ObjectId(),
        cloudinaryPublicId: publicId,
        resourceType: 'image',
        ownerType: 'VISIT_PHOTO',
        ownerId: new mongoose.Types.ObjectId(),
        uploadedBy: adminId,
        isArchived: false,
      })
      if (i > 0) {
        await mockStorage.upload({
          buffer: Buffer.from('img'),
          filename: `img_${i}.png`,
          mimeType: 'image/png',
          resourceType: 'image',
          folder: `etech_crm/visit_photo/${adminId}`,
          publicId,
        })
      }
    }

    for (let i = 0; i < 1050; i++) {
      const publicId = `etech_crm/client_document/${adminId}/raw_${i}`
      docsToInsert.push({
        _id: new mongoose.Types.ObjectId(),
        cloudinaryPublicId: publicId,
        resourceType: 'raw',
        ownerType: 'CLIENT_DOCUMENT',
        ownerId: new mongoose.Types.ObjectId(),
        uploadedBy: adminId,
        isArchived: false,
      })
      await mockStorage.upload({
        buffer: Buffer.from('pdf'),
        filename: `raw_${i}.pdf`,
        mimeType: 'application/pdf',
        resourceType: 'raw',
        folder: `etech_crm/client_document/${adminId}`,
        publicId,
      })
    }

    await targetConn.collection('fileassets').insertMany(docsToInsert)

    // Extra cloud-only raw asset must be detected as unregisteredInDb and NEVER deleted
    const unregisteredKey = `etech_crm/client_document/${adminId}/unregistered_extra`
    await mockStorage.upload({
      buffer: Buffer.from('extra'),
      filename: 'extra.pdf',
      mimeType: 'application/pdf',
      resourceType: 'raw',
      folder: `etech_crm/client_document/${adminId}`,
      publicId: unregisteredKey,
    })

    const fullReport = await reconcileCloudinaryMetadata(targetConn)
    expect(fullReport.complete).toBe(true)
    expect(fullReport.truncated).toBe(false)
    expect(fullReport.activeDbAssets).toBe(2100)
    expect(fullReport.cloudAssetsScanned).toBe(2100)
    expect(fullReport.missingInCloud).toHaveLength(1)
    expect(fullReport.missingInCloud[0].publicId).toBe(`etech_crm/visit_photo/${adminId}/img_0`)
    expect(fullReport.unregisteredInDb.map((u) => u.publicId)).toEqual([unregisteredKey])
    expect(mockStorage.storedFiles.has(unregisteredKey)).toBe(true)

    // Simulate cloud listing failure after page 2: MUST report incomplete & NEVER classify unseen assets as missingInCloud
    mockStorage.shouldFailListAfterPages = 2
    const failedReport = await reconcileCloudinaryMetadata(targetConn)
    expect(failedReport.complete).toBe(false)
    expect(failedReport.truncated).toBe(true)
    expect(failedReport.scanError).toMatch(/pagination failure/i)
    expect(failedReport.missingInCloud).toEqual([])
  })

  it('6. Detects broken cross-references across all asset, organization, category, and reportingTo links without false positives on nullable/archived records', async () => {
    const orgId = new mongoose.Types.ObjectId()
    const headId = new mongoose.Types.ObjectId()
    const execId = new mongoose.Types.ObjectId()
    const catId = new mongoose.Types.ObjectId()
    const clientId = new mongoose.Types.ObjectId()
    const visitId = new mongoose.Types.ObjectId()

    const userAvatarId = new mongoose.Types.ObjectId()
    const orgExpandedLogoId = new mongoose.Types.ObjectId()
    const orgCollapsedLogoId = new mongoose.Types.ObjectId()
    const clientCardId = new mongoose.Types.ObjectId()
    const clientDocId = new mongoose.Types.ObjectId()
    const visitPhotoId = new mongoose.Types.ObjectId()
    const visitAttachId = new mongoose.Types.ObjectId()
    const archivedOrphanAssetId = new mongoose.Types.ObjectId()

    await targetConn.collection('organizations').insertOne({
      _id: orgId,
      name: 'EtechCRM',
      expandedLogoAsset: orgExpandedLogoId,
      collapsedLogoAsset: orgCollapsedLogoId,
    })
    await targetConn.collection('categories').insertOne({ _id: catId, name: 'Enterprise' })
    await targetConn.collection('users').insertMany([
      {
        _id: headId,
        email: 'head2@etech.test',
        passwordHash: '$2a$10$validhashplaceholder1234567890',
        reportingTo: null,
        avatarAsset: userAvatarId,
      },
      {
        _id: execId,
        email: 'exec2@etech.test',
        passwordHash: '$2a$10$validhashplaceholder1234567890',
        reportingTo: headId,
      },
    ])
    await targetConn.collection('clients').insertOne({
      _id: clientId,
      companyName: 'Valid Co',
      createdBy: headId,
      categoryId: catId,
      visitingCardAsset: clientCardId,
      documentAssets: [clientDocId],
    })
    await targetConn.collection('visits').insertOne({
      _id: visitId,
      client: clientId,
      assignedTo: execId,
      assignedBy: headId,
      marketingHeadAtAssignment: headId,
      photoAssets: [visitPhotoId],
      attachmentAssets: [visitAttachId],
    })
    await targetConn.collection('fileassets').insertMany([
      { _id: userAvatarId, ownerType: 'USER_AVATAR', ownerId: headId, uploadedBy: headId, isArchived: false },
      {
        _id: orgExpandedLogoId,
        ownerType: 'ORGANIZATION_EXPANDED_LOGO',
        ownerId: orgId,
        uploadedBy: headId,
        isArchived: false,
      },
      {
        _id: orgCollapsedLogoId,
        ownerType: 'ORGANIZATION_COLLAPSED_LOGO',
        ownerId: orgId,
        uploadedBy: headId,
        isArchived: false,
      },
      {
        _id: clientCardId,
        ownerType: 'CLIENT_VISITING_CARD',
        ownerId: clientId,
        uploadedBy: execId,
        isArchived: false,
      },
      {
        _id: clientDocId,
        ownerType: 'CLIENT_DOCUMENT',
        ownerId: clientId,
        uploadedBy: execId,
        isArchived: false,
      },
      {
        _id: visitPhotoId,
        ownerType: 'VISIT_PHOTO',
        ownerId: visitId,
        uploadedBy: execId,
        isArchived: false,
      },
      {
        _id: visitAttachId,
        ownerType: 'VISIT_ATTACHMENT',
        ownerId: visitId,
        uploadedBy: execId,
        isArchived: false,
      },
      // Archived asset whose owner was cleaned up must NOT trigger false positive
      {
        _id: archivedOrphanAssetId,
        ownerType: 'CLIENT_DOCUMENT',
        ownerId: new mongoose.Types.ObjectId(),
        uploadedBy: headId,
        isArchived: true,
      },
    ])

    const cleanReport = await verifyRestoredDatabaseIntegrity(targetConn, {
      users: 2,
      organizations: 1,
      categories: 1,
      settings: 0,
      clients: 1,
      visits: 1,
      followuptasks: 0,
      notifications: 0,
      pushsubscriptions: 0,
      fileassets: 8,
      auditevents: 0,
      cronjobruns: 0,
    })
    expect(cleanReport.integrityViolations).toEqual([])
    expect(cleanReport.consistencyWarnings).toEqual([])

    // Inject broken references across every newly checked link type
    const missingRef = new mongoose.Types.ObjectId()
    const badClientId = new mongoose.Types.ObjectId()
    const badVisitId = new mongoose.Types.ObjectId()
    const badFileAsset1 = new mongoose.Types.ObjectId()
    const badFileAsset2 = new mongoose.Types.ObjectId()
    const badFileAsset3 = new mongoose.Types.ObjectId()

    await targetConn.collection('users').updateOne({ _id: execId }, { $set: { reportingTo: missingRef, avatarAsset: missingRef } })
    await targetConn.collection('organizations').updateOne(
      { _id: orgId },
      { $set: { expandedLogoAsset: missingRef, collapsedLogoAsset: missingRef } }
    )
    await targetConn.collection('clients').insertOne({
      _id: badClientId,
      companyName: 'Broken Client',
      createdBy: headId,
      categoryId: missingRef,
      visitingCardAsset: missingRef,
      documentAssets: [missingRef],
    })
    await targetConn.collection('visits').insertOne({
      _id: badVisitId,
      client: clientId,
      assignedTo: execId,
      assignedBy: headId,
      photoAssets: [missingRef],
      attachmentAssets: [missingRef],
    })
    await targetConn.collection('fileassets').insertMany([
      {
        _id: badFileAsset1,
        ownerType: 'CLIENT_DOCUMENT',
        ownerId: missingRef,
        uploadedBy: missingRef,
        isArchived: false,
      },
      {
        _id: badFileAsset2,
        ownerType: 'VISIT_PHOTO',
        ownerId: missingRef,
        uploadedBy: headId,
        isArchived: false,
      },
      {
        _id: badFileAsset3,
        ownerType: 'ORGANIZATION_EXPANDED_LOGO',
        ownerId: missingRef,
        uploadedBy: headId,
        isArchived: false,
      },
    ])

    const brokenReport = await verifyRestoredDatabaseIntegrity(targetConn, {
      users: 2,
      organizations: 1,
      categories: 1,
      settings: 0,
      clients: 2,
      visits: 2,
      followuptasks: 0,
      notifications: 0,
      pushsubscriptions: 0,
      fileassets: 11,
      auditevents: 0,
      cronjobruns: 0,
    })

    const vKeys = brokenReport.integrityViolations.map((v) => `${v.collection}.${v.field}`)
    expect(vKeys).toEqual(
      expect.arrayContaining([
        'users.reportingTo',
        'users.avatarAsset',
        'organizations.expandedLogoAsset',
        'organizations.collapsedLogoAsset',
        'clients.categoryId',
        'clients.visitingCardAsset',
        'clients.documentAssets',
        'visits.photoAssets',
        'visits.attachmentAssets',
        'fileassets.uploadedBy',
        'fileassets.ownerId',
      ])
    )
    expect(brokenReport.integrityViolations.every((v) => v.missingRef === String(missingRef))).toBe(true)
    expect(brokenReport.consistencyWarnings.length).toBeGreaterThanOrEqual(11)
  })

  it('7. Direct CloudinaryStorageProvider pagination handles multi-page, repeated cursor, maxPages, maxDurationMs, API errors, duplicate IDs, and bounded fallback', async () => {
    const prevCloud = {
      name: env.CLOUDINARY_CLOUD_NAME,
      key: env.CLOUDINARY_API_KEY,
      secret: env.CLOUDINARY_API_SECRET,
    }
    env.CLOUDINARY_CLOUD_NAME = 'test_cloud'
    env.CLOUDINARY_API_KEY = 'test_key'
    env.CLOUDINARY_API_SECRET = 'test_secret'

    const deleteSpy = vi.spyOn(cloudinary.uploader, 'destroy')
    const resourcesSpy = vi.spyOn(cloudinary.api, 'resources')

    try {
      const cloudProvider = new CloudinaryStorageProvider()

      // 7a. Normal multi-page completion across 3 pages
      resourcesSpy
        .mockResolvedValueOnce({
          resources: [
            { public_id: 'etech_crm/img_a', resource_type: 'image', type: 'authenticated', bytes: 100, created_at: new Date().toISOString() },
          ],
          next_cursor: 'cur_2',
        } as never)
        .mockResolvedValueOnce({
          resources: [
            { public_id: 'etech_crm/img_b', resource_type: 'image', type: 'authenticated', bytes: 200, created_at: new Date().toISOString() },
          ],
          next_cursor: 'cur_3',
        } as never)
        .mockResolvedValueOnce({
          resources: [
            { public_id: 'etech_crm/img_c', resource_type: 'image', type: 'authenticated', bytes: 300, created_at: new Date().toISOString() },
          ],
        } as never)

      const completeScan = await cloudProvider.listAllAssetsByPrefix('etech_crm/', 'image')
      expect(completeScan.truncated).toBe(false)
      expect(completeScan.terminationReason).toBe('COMPLETED')
      expect(completeScan.pagesFetched).toBe(3)
      expect(completeScan.items.map((i) => `${i.resourceType}:${i.type}:${i.publicId}`)).toEqual([
        'image:authenticated:etech_crm/img_a',
        'image:authenticated:etech_crm/img_b',
        'image:authenticated:etech_crm/img_c',
      ])

      // 7b. Repeated cursor MUST terminate safely and NEVER mark complete
      resourcesSpy.mockReset()
      resourcesSpy
        .mockResolvedValueOnce({
          resources: [{ public_id: 'etech_crm/img_1', resource_type: 'image', type: 'authenticated', bytes: 50, created_at: new Date().toISOString() }],
          next_cursor: 'stuck_cur',
        } as never)
        .mockResolvedValueOnce({
          resources: [{ public_id: 'etech_crm/img_2', resource_type: 'image', type: 'authenticated', bytes: 50, created_at: new Date().toISOString() }],
          next_cursor: 'stuck_cur',
        } as never)

      const repeatedScan = await cloudProvider.listAllAssetsByPrefix('etech_crm/', 'image')
      expect(repeatedScan.truncated).toBe(true)
      expect(repeatedScan.terminationReason).toBe('REPEATED_CURSOR')
      expect(repeatedScan.pagesFetched).toBe(2)

      // 7c. Reconcile using CloudinaryStorageProvider repeated cursor => complete=false, missingInCloud=[]
      setStorageProvider(cloudProvider)
      await targetConn.collection('fileassets').insertOne({
        _id: new mongoose.Types.ObjectId(),
        cloudinaryPublicId: 'etech_crm/missing_when_incomplete',
        cloudinaryResourceType: 'image',
        resourceType: 'image',
        ownerType: 'USER_AVATAR',
        ownerId: new mongoose.Types.ObjectId(),
        uploadedBy: new mongoose.Types.ObjectId(),
        isArchived: false,
      })
      resourcesSpy.mockReset()
      resourcesSpy.mockImplementation(async (opts: unknown) => {
        const o = opts as { resource_type?: string; next_cursor?: string }
        if (o.resource_type === 'raw') {
          return { resources: [] } as never
        }
        return {
          resources: [{ public_id: 'etech_crm/repeated_page_item', resource_type: 'image', type: 'authenticated', bytes: 10, created_at: new Date().toISOString() }],
          next_cursor: 'loop_cursor',
        } as never
      })
      const repeatedRecon = await reconcileCloudinaryMetadata(targetConn)
      expect(repeatedRecon.complete).toBe(false)
      expect(repeatedRecon.truncated).toBe(true)
      expect(repeatedRecon.scanError).toMatch(/REPEATED_CURSOR/i)
      expect(repeatedRecon.missingInCloud).toEqual([])

      // 7d. Hit maxPages limit & maxDurationMs limit
      resourcesSpy.mockReset()
      resourcesSpy.mockImplementation(async (opts: unknown) => {
        const o = opts as { resource_type?: string; next_cursor?: string }
        if (o.resource_type === 'raw') return { resources: [] } as never
        return {
          resources: [{ public_id: `etech_crm/${o.next_cursor || 'p0'}`, resource_type: 'image', type: 'authenticated', bytes: 10, created_at: new Date().toISOString() }],
          next_cursor: `next_${Math.random()}`,
        } as never
      })
      const maxPagesRecon = await reconcileCloudinaryMetadata(targetConn, { maxPages: 2 })
      expect(maxPagesRecon.complete).toBe(false)
      expect(maxPagesRecon.truncated).toBe(true)
      expect(maxPagesRecon.scanError).toMatch(/MAX_PAGES/i)
      expect(maxPagesRecon.missingInCloud).toEqual([])

      resourcesSpy.mockReset()
      resourcesSpy.mockImplementation(async (opts: unknown) => {
        const o = opts as { resource_type?: string; next_cursor?: string }
        if (o.resource_type === 'raw') return { resources: [] } as never
        await new Promise((r) => setTimeout(r, 25))
        return {
          resources: [{ public_id: `etech_crm/slow_${o.next_cursor || '0'}`, resource_type: 'image', type: 'authenticated', bytes: 10, created_at: new Date().toISOString() }],
          next_cursor: `slow_${Math.random()}`,
        } as never
      })
      const runtimeRecon = await reconcileCloudinaryMetadata(targetConn, { maxDurationMs: 10 })
      expect(runtimeRecon.complete).toBe(false)
      expect(runtimeRecon.truncated).toBe(true)
      expect(runtimeRecon.scanError).toMatch(/MAX_RUNTIME_MS/i)
      expect(runtimeRecon.missingInCloud).toEqual([])

      // 7e. Duplicate publicId across pages + SAME publicId in image vs raw + API error on page 2
      resourcesSpy.mockReset()
      resourcesSpy.mockImplementation(async (opts: unknown) => {
        const o = opts as { resource_type?: string; next_cursor?: string }
        if (o.resource_type === 'image') {
          if (!o.next_cursor) {
            return {
              resources: [
                { public_id: 'etech_crm/shared_id', resource_type: 'image', type: 'authenticated', bytes: 100, created_at: new Date().toISOString() },
              ],
              next_cursor: 'img_p2',
            } as never
          }
          return {
            resources: [
              // Duplicate across pages must be deduplicated cleanly
              { public_id: 'etech_crm/shared_id', resource_type: 'image', type: 'authenticated', bytes: 100, created_at: new Date().toISOString() },
            ],
          } as never
        }
        return {
          resources: [
            // Same publicId under raw resourceType is distinct!
            { public_id: 'etech_crm/shared_id', resource_type: 'raw', type: 'authenticated', bytes: 200, created_at: new Date().toISOString() },
          ],
        } as never
      })
      const dupRecon = await reconcileCloudinaryMetadata(targetConn)
      expect(dupRecon.complete).toBe(true)
      expect(dupRecon.cloudAssetsScanned).toBe(2)
      expect(dupRecon.unregisteredInDb.map((u) => `${u.resourceType}:${u.deliveryType}:${u.publicId}`).sort()).toEqual([
        'image:authenticated:etech_crm/shared_id',
        'raw:authenticated:etech_crm/shared_id',
      ])

      // API error on later page must yield missingInCloud: []
      resourcesSpy.mockReset()
      resourcesSpy.mockImplementation(async (opts: unknown) => {
        const o = opts as { resource_type?: string; next_cursor?: string }
        if (o.resource_type === 'image' && o.next_cursor === 'p2') {
          throw new Error('Cloudinary 503 downstream')
        }
        return {
          resources: [{ public_id: 'etech_crm/ok1', resource_type: o.resource_type, type: 'authenticated', bytes: 10, created_at: new Date().toISOString() }],
          next_cursor: o.resource_type === 'image' ? 'p2' : undefined,
        } as never
      })
      const errRecon = await reconcileCloudinaryMetadata(targetConn)
      expect(errRecon.complete).toBe(false)
      expect(errRecon.scanError).toMatch(/Cloudinary 503/i)
      expect(errRecon.missingInCloud).toEqual([])

      // 7f. Bounded-only fallback provider MUST explicitly mark incomplete/truncated and never emit false missingInCloud
      setStorageProvider({
        name: 'BoundedOnlyProvider',
        upload: vi.fn() as never,
        delete: vi.fn() as never,
        getSignedUrl: vi.fn() as never,
        listAssetsByPrefix: vi.fn().mockResolvedValue([]),
      })
      const fallbackRecon = await reconcileCloudinaryMetadata(targetConn)
      expect(fallbackRecon.complete).toBe(false)
      expect(fallbackRecon.truncated).toBe(true)
      expect(fallbackRecon.missingInCloud).toEqual([])
      expect(deleteSpy).not.toHaveBeenCalled()
    } finally {
      setStorageProvider(mockStorage)
      resourcesSpy.mockRestore()
      deleteSpy.mockRestore()
      env.CLOUDINARY_CLOUD_NAME = prevCloud.name
      env.CLOUDINARY_API_KEY = prevCloud.key
      env.CLOUDINARY_API_SECRET = prevCloud.secret
    }
  })

  it('8. Handles Organization logo ownership lifecycle, placeholder transition, rollback safety, and integrity distinction', async () => {
    const adminId = new mongoose.Types.ObjectId()
    const pngHeaderPlusBody = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('mock-png-bytes'),
    ])
    const fakeFile = {
      fieldname: 'file',
      originalname: 'logo.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: pngHeaderPlusBody.length,
      buffer: pngHeaderPlusBody,
    } as unknown as Express.Multer.File

    // Ensure mongoose default connection points cleanly to test DB for storage service models
    const prevReadyState = mongoose.connection.readyState
    if (prevReadyState !== 1) {
      await mongoose.connect(sourceMongo.getUri('etech_org_lifecycle'))
    }
    try {
      await Organization.deleteMany({})
      await FileAsset.deleteMany({})
      await User.deleteMany({})
      await User.collection.insertOne({
        _id: adminId,
        name: 'Org SuperAdmin',
        email: 'org-admin@test.com',
        passwordHash: '$2a$10$hash1234567890123456789012',
        role: 'SUPER_ADMIN',
        isActive: true,
      })

      // 8a. Reject non-existent random ownerId before Organization exists
      await expect(
        uploadFileAsset(
          { id: String(adminId), email: 'org-admin@test.com', role: 'SUPER_ADMIN', tokenVersion: 0 },
          fakeFile,
          'ORGANIZATION_EXPANDED_LOGO',
          String(new mongoose.Types.ObjectId())
        )
      ).rejects.toMatchObject({ statusCode: 404 })

      // 8b. Pending placeholder before Organization exists lazily creates Organization and rebinds ownerId to real _id
      const expandedRes = await uploadFileAsset(
        { id: String(adminId), email: 'org-admin@test.com', role: 'SUPER_ADMIN', tokenVersion: 0 },
        fakeFile,
        'ORGANIZATION_EXPANDED_LOGO',
        PENDING_ORGANIZATION_OWNER_ID
      )
      const orgDoc = await Organization.findOne({}).lean()
      expect(orgDoc?._id).toBeDefined()
      expect(String(expandedRes.asset.ownerId)).toBe(String(orgDoc!._id))
      expect((expandedRes.asset.metadata as { ownershipStatus?: string })?.ownershipStatus).toBe('ASSIGNED')

      // 8c. Collapsed logo with placeholder resolves cleanly to existing Organization _id
      const collapsedRes = await uploadFileAsset(
        { id: String(adminId), email: 'org-admin@test.com', role: 'SUPER_ADMIN', tokenVersion: 0 },
        fakeFile,
        'ORGANIZATION_COLLAPSED_LOGO',
        PENDING_ORGANIZATION_OWNER_ID
      )
      expect(String(collapsedRes.asset.ownerId)).toBe(String(orgDoc!._id))

      // 8d. Failed upload rollback leaves zero dangling FileAsset or cloud files
      mockStorage.shouldFailUpload = true
      const countBeforeFail = await FileAsset.countDocuments({})
      await expect(
        uploadFileAsset(
          { id: String(adminId), email: 'org-admin@test.com', role: 'SUPER_ADMIN', tokenVersion: 0 },
          fakeFile,
          'ORGANIZATION_EXPANDED_LOGO',
          String(orgDoc!._id)
        )
      ).rejects.toThrow(/Simulated storage provider upload error/i)
      expect(await FileAsset.countDocuments({})).toBe(countBeforeFail)
      mockStorage.shouldFailUpload = false

      await updateOrganizationConfig(String(adminId), { name: 'Excel Tech Verified' })

      // 8e. Integrity validation distinguishes: assigned org logo, explicit pending logo, invalid placeholder without pending flag, missing ref, archived
      const pendingId = new mongoose.Types.ObjectId()
      const badPlaceholderId = new mongoose.Types.ObjectId()
      const missingRefCollapsedId = new mongoose.Types.ObjectId()
      const archivedLogoId = new mongoose.Types.ObjectId()
      await targetConn.collection('users').insertOne({
        _id: adminId,
        email: 'org-admin@test.com',
        passwordHash: '$2a$10$hash1234567890123456789012',
      })
      await targetConn.collection('organizations').insertOne({ _id: orgDoc!._id, name: 'Excel Tech Verified', updatedBy: adminId })
      await targetConn.collection('fileassets').insertMany([
        { _id: expandedRes.asset._id, ownerType: 'ORGANIZATION_EXPANDED_LOGO', ownerId: orgDoc!._id, uploadedBy: adminId, isArchived: false },
        { _id: collapsedRes.asset._id, ownerType: 'ORGANIZATION_COLLAPSED_LOGO', ownerId: orgDoc!._id, uploadedBy: adminId, isArchived: false },
        {
          _id: pendingId,
          ownerType: 'ORGANIZATION_EXPANDED_LOGO',
          ownerId: new mongoose.Types.ObjectId(PENDING_ORGANIZATION_OWNER_ID),
          uploadedBy: adminId,
          isArchived: false,
          metadata: { ownershipStatus: 'PENDING_ORGANIZATION' },
        },
        {
          _id: archivedLogoId,
          ownerType: 'ORGANIZATION_COLLAPSED_LOGO',
          ownerId: new mongoose.Types.ObjectId(),
          uploadedBy: adminId,
          isArchived: true,
        },
      ])

      const cleanOrgReport = await verifyRestoredDatabaseIntegrity(targetConn, {
        users: 1, organizations: 1, categories: 0, settings: 0, clients: 0, visits: 0,
        followuptasks: 0, notifications: 0, pushsubscriptions: 0, fileassets: 4, auditevents: 0, cronjobruns: 0,
      })
      expect(cleanOrgReport.pendingOrganizationLogosCount).toBe(1)
      expect(cleanOrgReport.integrityViolations).toEqual([])

      // Raw placeholder WITHOUT explicit pending status + broken collapsed logo ownerId MUST fail validation
      const missingOrgRef = new mongoose.Types.ObjectId()
      await targetConn.collection('fileassets').insertMany([
        {
          _id: badPlaceholderId,
          ownerType: 'ORGANIZATION_EXPANDED_LOGO',
          ownerId: new mongoose.Types.ObjectId(PENDING_ORGANIZATION_OWNER_ID),
          uploadedBy: adminId,
          isArchived: false,
        },
        {
          _id: missingRefCollapsedId,
          ownerType: 'ORGANIZATION_COLLAPSED_LOGO',
          ownerId: missingOrgRef,
          uploadedBy: adminId,
          isArchived: false,
        },
      ])
      const badOrgReport = await verifyRestoredDatabaseIntegrity(targetConn, {
        users: 1, organizations: 1, categories: 0, settings: 0, clients: 0, visits: 0,
        followuptasks: 0, notifications: 0, pushsubscriptions: 0, fileassets: 6, auditevents: 0, cronjobruns: 0,
      })
      expect(badOrgReport.integrityViolations.map((v) => v.documentId).sort()).toEqual([
        String(badPlaceholderId),
        String(missingRefCollapsedId),
      ].sort())
    } finally {
      if (prevReadyState !== 1) {
        await mongoose.connection.close().catch(() => {})
      }
    }
  })

  it('9. Cross-checks targetConnection vs targetUri, enforces non-Atlas ambiguity & IPv6 safety, and protects empty production DBs', async () => {
    // 9a. URI parser handles encoded credentials cleanly and rejects unencoded '/' before '@'
    const parsedCreds = normalizeMongoTargetIdentity('mongodb://ops%2Fuser:p%40ss%2Fword@db1.internal:27017/etechcrm?replicaSet=rs0')
    expect(parsedCreds.dbName).toBe('etechcrm')
    expect(parsedCreds.hosts).toEqual(['db1.internal:27017'])
    expect(() =>
      normalizeMongoTargetIdentity('mongodb://ops/user:pass@db1.internal:27017/etechcrm')
    ).toThrow(/percent-encode/i)

    // 9b. Non-Atlas same-scheme hosts without distinct explicit replicaSets MUST be refused when dbName matches
    expect(() =>
      assertSafeRestoreTargetUri(
        'mongodb://node-b.internal:27017/etechcrm',
        'mongodb://node-a.internal:27017/etechcrm'
      )
    ).toThrow(/cannot prove/i)
    expect(() =>
      assertSafeRestoreTargetUri(
        'mongodb://node-b.internal:27017/etechcrm?replicaSet=rs-staging',
        'mongodb://node-a.internal:27017/etechcrm?replicaSet=rs-prod'
      )
    ).not.toThrow()

    // 9c. IPv6 loopback [::1] equivalent to 127.0.0.1 and localhost
    expect(() =>
      assertSafeRestoreTargetUri(
        'mongodb://[::1]:27017/etechcrm',
        'mongodb://127.0.0.1:27017/etechcrm'
      )
    ).toThrow(/Refusing restore/i)

    // 9d. Bare IPv6 sourceConnection.host ('::1') backup creation must succeed cleanly without crashing
    const ipv6MockConn = {
      readyState: 1,
      host: '::1',
      port: 27017,
      name: 'etech_ipv6_prod',
      db: { databaseName: 'etech_ipv6_prod' },
      collection: () => ({
        find: () => ({
          batchSize: () => ({
            [Symbol.asyncIterator]: async function* () {
              // empty collection cursor
            },
          }),
        }),
      }),
    } as unknown as Connection
    const ipv6Backup = await createEncryptedBackup(ipv6MockConn, VALID_BACKUP_KEY_HEX)
    expect(ipv6Backup.encryptedBuffer.length).toBeGreaterThan(20)

    // 9e. Programmatic caller CANNOT pair safe targetUri with targetConnection connected to production (even if production is EMPTY!)
    const backup = await createEncryptedBackup(sourceConn, VALID_BACKUP_KEY_HEX)
    const emptyProdUri = sourceMongo.getUri('etech_prod_sim')
    const safeTargetUri = targetMongo.getUri('etech_restore_verify')

    // targetUri === safeTargetUri, targetConnection === sourceConn (empty prod DB!): MUST REFUSE (403)
    await expect(
      restoreEncryptedBackupToIsolatedTarget({
        encryptedBuffer: backup.encryptedBuffer,
        targetConnection: sourceConn,
        targetUri: safeTargetUri,
        productionUri: emptyProdUri,
        encryptionKeyHex: VALID_BACKUP_KEY_HEX,
      })
    ).rejects.toMatchObject({ statusCode: 403 })

    // Direct empty prod URI target refused (403) before verifyTargetDatabaseIsEmpty even sees emptiness
    await expect(
      restoreEncryptedBackupToIsolatedTarget({
        encryptedBuffer: backup.encryptedBuffer,
        targetConnection: sourceConn,
        targetUri: emptyProdUri,
        productionUri: emptyProdUri,
        encryptionKeyHex: VALID_BACKUP_KEY_HEX,
      })
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('10. Enforces backup 413 document/byte limits, atomic cleanup on interrupted backup, truncated V2 rejection, and V1 backward compatibility', async () => {
    await sourceConn.collection('settings').insertMany([
      { key: 'K1', value: 'x'.repeat(200) },
      { key: 'K2', value: 'y'.repeat(200) },
      { key: 'K3', value: 'z'.repeat(200) },
    ])

    // 10a. Incremental document limit => 413
    await expect(
      createEncryptedBackup(sourceConn, VALID_BACKUP_KEY_HEX, { maxTotalDocuments: 2 })
    ).rejects.toMatchObject({ statusCode: 413 })

    // 10b. Incremental serialized byte limit => 413
    await expect(
      createEncryptedBackup(sourceConn, VALID_BACKUP_KEY_HEX, { maxSerializedBytes: 512 })
    ).rejects.toMatchObject({ statusCode: 413 })

    // 10c. Interrupted atomic file backup leaves zero .enc or .tmp files
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'etech-bk-test-'))
    const interruptedOut = path.join(tmpDir, 'aborted-backup.enc')
    try {
      await expect(
        createEncryptedBackupToFile(interruptedOut, sourceConn, VALID_BACKUP_KEY_HEX, { maxTotalDocuments: 1 })
      ).rejects.toMatchObject({ statusCode: 413 })
      const entries = await fs.readdir(tmpDir)
      expect(entries).toEqual([])

      // Valid streaming disk backup + verifyBackupFile + truncated V2 archive check
      const validOut = path.join(tmpDir, 'valid-v2.enc')
      const diskRes = await createEncryptedBackupToFile(validOut, sourceConn, VALID_BACKUP_KEY_HEX)
      expect(diskRes.totalDocuments).toBe(3)
      const verifiedFile = await verifyBackupFile(validOut, VALID_BACKUP_KEY_HEX)
      expect(verifiedFile.version).toBe(2)
      expect(verifiedFile.totalDocuments).toBe(3)

      const fullBuf = await fs.readFile(validOut)
      // Truncate off authTag & part of ciphertext
      expect(() => decryptAndVerifyBackup(fullBuf.subarray(0, fullBuf.length - 20), VALID_BACKUP_KEY_HEX)).toThrow(
        /decryption or authentication failed|truncated/i
      )

      // Streaming restore from file into targetConn
      const restoreFileRes = await restoreEncryptedBackupFromFile({
        filePath: validOut,
        targetConnection: targetConn,
        targetUri: targetMongo.getUri('etech_restore_verify'),
        productionUri: sourceMongo.getUri('etech_prod_sim'),
        encryptionKeyHex: VALID_BACKUP_KEY_HEX,
      })
      expect(restoreFileRes.totalRestored).toBe(3)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }

    // 10d. V1 format backward compatibility check
    const key = resolveBackupKey(VALID_BACKUP_KEY_HEX)
    const EJSON = mongoose.mongo.BSON.EJSON
    const v1Payload = {
      version: 1,
      format: 'ETECHCRM_LOGICAL_BACKUP_V1',
      logicalSnapshotDisclaimer: 'legacy v1 test',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      excludedCollections: ['ratelimitbuckets'],
      collectionCounts: {
        users: 0, organizations: 0, categories: 0, settings: 1, clients: 0, visits: 0,
        followuptasks: 0, notifications: 0, pushsubscriptions: 0, fileassets: 0, auditevents: 0, cronjobruns: 0,
      },
      collections: { settings: [{ _id: new mongoose.Types.ObjectId(), key: 'V1_KEY', value: true }] },
    }
    const sha256 = crypto.createHash('sha256').update(EJSON.stringify(v1Payload, { relaxed: false }), 'utf8').digest('hex')
    const compressed = zlib.gzipSync(Buffer.from(EJSON.stringify({ sha256, payload: v1Payload }, { relaxed: false }), 'utf8'))
    const iv = crypto.randomBytes(12)
    const ver = Buffer.from([1])
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.concat([BACKUP_MAGIC, ver]))
    const v1Ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()])
    const v1AuthTag = cipher.getAuthTag()
    const encV1 = Buffer.concat([BACKUP_MAGIC, ver, iv, v1AuthTag, v1Ciphertext])
    const parsedV1 = decryptAndVerifyBackup(encV1, VALID_BACKUP_KEY_HEX)
    expect(parsedV1.verification.version).toBe(1)
    expect(parsedV1.verification.collectionCounts.settings).toBe(1)
  })

  it('11. Handles interrupted restore failures non-destructively (409 on retry) and fails programmatically on integrity errors', async () => {
    const missingUserId = new mongoose.Types.ObjectId()
    await sourceConn.collection('settings').insertOne({ key: 'S1', value: 'ok' })
    const cleanBackup = await createEncryptedBackup(sourceConn, VALID_BACKUP_KEY_HEX)

    // 11a. Simulate interrupted restore during insertMany (failure midway leaves partial docs -> retry returns 409)
    const origCollectionFn = targetConn.collection.bind(targetConn)
    let failInsert = true
    const colSpy = vi.spyOn(targetConn, 'collection').mockImplementation(((name: string) => {
      const realCol = origCollectionFn(name)
      if (name === 'settings' && failInsert) {
        return new Proxy(realCol, {
          get(target, prop, receiver) {
            if (prop === 'insertMany') {
              return async () => {
                await realCol.insertOne({ key: 'PARTIAL_BEFORE_CRASH', value: true })
                throw new Error('Simulated network disconnect mid-insertMany')
              }
            }
            return Reflect.get(target, prop, receiver)
          },
        })
      }
      return realCol
    }) as never)

    try {
      await expect(
        restoreEncryptedBackupToIsolatedTarget({
          encryptedBuffer: cleanBackup.encryptedBuffer,
          targetConnection: targetConn,
          targetUri: targetMongo.getUri('etech_restore_verify'),
          productionUri: sourceMongo.getUri('etech_prod_sim'),
          encryptionKeyHex: VALID_BACKUP_KEY_HEX,
        })
      ).rejects.toThrow(/Simulated network disconnect/i)
    } finally {
      failInsert = false
      colSpy.mockRestore()
    }

    // Retry against partially populated target DB MUST reject non-destructively with 409
    await expect(
      restoreEncryptedBackupToIsolatedTarget({
        encryptedBuffer: cleanBackup.encryptedBuffer,
        targetConnection: targetConn,
        targetUri: targetMongo.getUri('etech_restore_verify'),
        productionUri: sourceMongo.getUri('etech_prod_sim'),
        encryptionKeyHex: VALID_BACKUP_KEY_HEX,
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    await targetConn.collection('settings').deleteMany({})

    // 11b. Interrupted during index creation after insertMany => retry also refuses cleanly with 409
    let failIndex = true
    const idxColSpy = vi.spyOn(targetConn, 'collection').mockImplementation(((name: string) => {
      const realCol = origCollectionFn(name)
      if (name === 'settings' && failIndex) {
        return new Proxy(realCol, {
          get(target, prop, receiver) {
            if (prop === 'createIndex') {
              return async () => {
                throw new Error('Simulated index build timeout')
              }
            }
            return Reflect.get(target, prop, receiver)
          },
        })
      }
      return realCol
    }) as never)
    try {
      await expect(
        restoreEncryptedBackupToIsolatedTarget({
          encryptedBuffer: cleanBackup.encryptedBuffer,
          targetConnection: targetConn,
          targetUri: targetMongo.getUri('etech_restore_verify'),
          productionUri: sourceMongo.getUri('etech_prod_sim'),
          encryptionKeyHex: VALID_BACKUP_KEY_HEX,
        })
      ).rejects.toThrow(/Simulated index build timeout/i)
    } finally {
      failIndex = false
      idxColSpy.mockRestore()
    }
    await expect(
      restoreEncryptedBackupToIsolatedTarget({
        encryptedBuffer: cleanBackup.encryptedBuffer,
        targetConnection: targetConn,
        targetUri: targetMongo.getUri('etech_restore_verify'),
        productionUri: sourceMongo.getUri('etech_prod_sim'),
        encryptionKeyHex: VALID_BACKUP_KEY_HEX,
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    await targetConn.collection('settings').deleteMany({})

    // 11c. Programmatic restore on DB with broken reference MUST throw RestoreConsistencyError (not succeed silently)
    await sourceConn.collection('notifications').insertOne({
      _id: new mongoose.Types.ObjectId(),
      recipient: missingUserId,
      title: 'Orphan notification',
      message: 'broken ref',
      type: 'SYSTEM',
    })
    const brokenBackup = await createEncryptedBackup(sourceConn, VALID_BACKUP_KEY_HEX)
    await expect(
      restoreEncryptedBackupToIsolatedTarget({
        encryptedBuffer: brokenBackup.encryptedBuffer,
        targetConnection: targetConn,
        targetUri: targetMongo.getUri('etech_restore_verify'),
        productionUri: sourceMongo.getUri('etech_prod_sim'),
        encryptionKeyHex: VALID_BACKUP_KEY_HEX,
      })
    ).rejects.toBeInstanceOf(RestoreConsistencyError)
  })

  it('12. Validates all secondary actor references, PushSubscription.user, GENERAL vs unknown FileAsset.ownerType, and remaining ownerTypes', async () => {
    const orgId = new mongoose.Types.ObjectId()
    const headId = new mongoose.Types.ObjectId()
    const execId = new mongoose.Types.ObjectId()
    const clientId = new mongoose.Types.ObjectId()
    const visitId = new mongoose.Types.ObjectId()
    const taskId = new mongoose.Types.ObjectId()
    const generalAssetId = new mongoose.Types.ObjectId()

    await targetConn.collection('organizations').insertOne({ _id: orgId, name: 'Org', updatedBy: headId })
    await targetConn.collection('users').insertMany([
      { _id: headId, email: 'h@t.com', passwordHash: '$2a$10$hash' },
      { _id: execId, email: 'e@t.com', passwordHash: '$2a$10$hash' },
    ])
    await targetConn.collection('clients').insertOne({ _id: clientId, companyName: 'C', createdBy: headId })
    await targetConn.collection('visits').insertOne({
      _id: visitId,
      client: clientId,
      assignedTo: execId,
      assignedBy: headId,
      cancelledBy: null,
      exceptionAuthorizedBy: headId,
      checkIn: { locationStatus: 'AVAILABLE', exceptionApprovedBy: headId },
      checkOut: { locationStatus: 'AVAILABLE', exceptionApprovedBy: null },
    })
    await targetConn.collection('followuptasks').insertOne({
      _id: taskId,
      sourceVisit: visitId,
      client: clientId,
      assignedTo: execId,
      completedBy: execId,
      cancelledBy: null,
    })
    await targetConn.collection('pushsubscriptions').insertOne({
      _id: new mongoose.Types.ObjectId(),
      user: execId,
      endpoint: 'https://push.test/1',
      keys: { p256dh: 'p', auth: 'a' },
    })
    await targetConn.collection('fileassets').insertOne({
      _id: generalAssetId,
      ownerType: 'GENERAL',
      ownerId: headId,
      uploadedBy: headId,
      isArchived: false,
    })

    const clean = await verifyRestoredDatabaseIntegrity(targetConn, {
      users: 2, organizations: 1, categories: 0, settings: 0, clients: 1, visits: 1,
      followuptasks: 1, notifications: 0, pushsubscriptions: 1, fileassets: 1, auditevents: 0, cronjobruns: 0,
    })
    expect(clean.integrityViolations).toEqual([])

    // Inject broken refs on all secondary actor fields, PushSubscription.user, unknown ownerType, and remaining active ownerTypes
    const badRef = new mongoose.Types.ObjectId()
    await targetConn.collection('organizations').updateOne({ _id: orgId }, { $set: { updatedBy: badRef } })
    await targetConn.collection('visits').updateOne(
      { _id: visitId },
      {
        $set: {
          cancelledBy: badRef,
          exceptionAuthorizedBy: badRef,
          'checkIn.exceptionApprovedBy': badRef,
          'checkOut.exceptionApprovedBy': badRef,
        },
      }
    )
    await targetConn.collection('followuptasks').updateOne(
      { _id: taskId },
      { $set: { completedBy: badRef, cancelledBy: badRef } }
    )
    await targetConn.collection('pushsubscriptions').insertOne({
      _id: new mongoose.Types.ObjectId(),
      user: badRef,
      endpoint: 'https://push.test/bad',
      keys: { p256dh: 'p', auth: 'a' },
    })
    await targetConn.collection('fileassets').insertMany([
      { _id: new mongoose.Types.ObjectId(), ownerType: 'UNKNOWN_TYPE', ownerId: badRef, uploadedBy: headId, isArchived: false },
      { _id: new mongoose.Types.ObjectId(), ownerType: 'USER_AVATAR', ownerId: badRef, uploadedBy: headId, isArchived: false },
      { _id: new mongoose.Types.ObjectId(), ownerType: 'CLIENT_VISITING_CARD', ownerId: badRef, uploadedBy: headId, isArchived: false },
      { _id: new mongoose.Types.ObjectId(), ownerType: 'VISIT_ATTACHMENT', ownerId: badRef, uploadedBy: headId, isArchived: false },
      { _id: new mongoose.Types.ObjectId(), ownerType: 'ORGANIZATION_COLLAPSED_LOGO', ownerId: badRef, uploadedBy: headId, isArchived: false },
    ])

    const broken = await verifyRestoredDatabaseIntegrity(targetConn, {
      users: 2, organizations: 1, categories: 0, settings: 0, clients: 1, visits: 1,
      followuptasks: 1, notifications: 0, pushsubscriptions: 2, fileassets: 6, auditevents: 0, cronjobruns: 0,
    })
    const pairs = broken.integrityViolations.map((v) => `${v.collection}.${v.field}`)
    expect(pairs).toEqual(
      expect.arrayContaining([
        'organizations.updatedBy',
        'visits.cancelledBy',
        'visits.exceptionAuthorizedBy',
        'visits.checkIn.exceptionApprovedBy',
        'visits.checkOut.exceptionApprovedBy',
        'followuptasks.completedBy',
        'followuptasks.cancelledBy',
        'pushsubscriptions.user',
        'fileassets.ownerType',
        'fileassets.ownerId',
      ])
    )
  })
})

