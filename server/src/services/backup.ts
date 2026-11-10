import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import readline from 'node:readline'
import { Readable, Transform } from 'node:stream'
import zlib from 'node:zlib'
import mongoose, { type Connection, type Model } from 'mongoose'
import { User } from '../models/User.js'
import { Client } from '../models/Client.js'
import { Visit } from '../models/Visit.js'
import { FollowUpTask } from '../models/FollowUpTask.js'
import { Category } from '../models/Category.js'
import { Organization } from '../models/Organization.js'
import { Setting } from '../models/Setting.js'
import { Notification } from '../models/Notification.js'
import { PushSubscription } from '../models/PushSubscription.js'
import { FileAsset } from '../models/FileAsset.js'
import { AuditEvent } from '../models/AuditEvent.js'
import { CronJobRun } from '../models/CronJobRun.js'
import { AppError } from '../utils/errors.js'
import { getStorageProvider, PENDING_ORGANIZATION_OWNER_ID } from './storage/storage.service.js'

const EJSON = mongoose.mongo.BSON.EJSON

export const BACKUP_MAGIC = Buffer.from('ETECHBK1', 'ascii')
export const BACKUP_FORMAT_VERSION_V1 = 1
export const BACKUP_FORMAT_VERSION = 2
export const EXCLUDED_BACKUP_COLLECTIONS = ['ratelimitbuckets'] as const
export const BACKUP_CURSOR_BATCH_SIZE = 500
export const MAX_BACKUP_TOTAL_DOCUMENTS = 500_000
export const MAX_BACKUP_SERIALIZED_BYTES = 256 * 1024 * 1024

const DURABLE_MODEL_SPECS: Array<{ collectionName: string; model: Model<never> }> = [
  { collectionName: 'users', model: User as unknown as Model<never> },
  { collectionName: 'organizations', model: Organization as unknown as Model<never> },
  { collectionName: 'categories', model: Category as unknown as Model<never> },
  { collectionName: 'settings', model: Setting as unknown as Model<never> },
  { collectionName: 'clients', model: Client as unknown as Model<never> },
  { collectionName: 'visits', model: Visit as unknown as Model<never> },
  { collectionName: 'followuptasks', model: FollowUpTask as unknown as Model<never> },
  { collectionName: 'notifications', model: Notification as unknown as Model<never> },
  { collectionName: 'pushsubscriptions', model: PushSubscription as unknown as Model<never> },
  { collectionName: 'fileassets', model: FileAsset as unknown as Model<never> },
  { collectionName: 'auditevents', model: AuditEvent as unknown as Model<never> },
  { collectionName: 'cronjobruns', model: CronJobRun as unknown as Model<never> },
]

export interface SourceDbFingerprint {
  dbNameHmac: string
  hostHmacs: string[]
  clusterSuffixHmac?: string
  replicaSetHmac?: string
}

export interface LogicalBackupPayload {
  version: number
  format: 'ETECHCRM_LOGICAL_BACKUP_V1' | 'ETECHCRM_LOGICAL_BACKUP_V2'
  logicalSnapshotDisclaimer: string
  startedAt: string
  completedAt: string
  excludedCollections: string[]
  sourceDbFingerprint?: SourceDbFingerprint
  collectionCounts: Record<string, number>
  collections: Record<string, unknown[]>
}

interface BackupStreamHeaderLine {
  type: 'HEADER'
  version: 2
  format: 'ETECHCRM_LOGICAL_BACKUP_V2'
  logicalSnapshotDisclaimer: string
  startedAt: string
  excludedCollections: string[]
  sourceDbFingerprint?: SourceDbFingerprint
}

interface BackupStreamDocLine {
  type: 'DOC'
  collection: string
  doc: unknown
}

interface BackupStreamFooterLine {
  type: 'FOOTER'
  completedAt: string
  collectionCounts: Record<string, number>
  totalDocuments: number
  sha256: string
}

interface InnerEncryptedWrapper {
  sha256: string
  payload: LogicalBackupPayload
}

export interface BackupCreationResult {
  encryptedBuffer: Buffer
  startedAt: string
  completedAt: string
  collectionCounts: Record<string, number>
  totalDocuments: number
  excludedCollections: string[]
}

export interface BackupVerificationResult {
  version: number
  startedAt: string
  completedAt: string
  collectionCounts: Record<string, number>
  totalDocuments: number
  excludedCollections: string[]
}

export interface IntegrityViolation {
  collection: string
  documentId: string
  field: string
  missingRef: string
  message: string
}

export interface RestoreConsistencyReport {
  countsMatched: boolean
  restoredCounts: Record<string, number>
  expectedCounts: Record<string, number>
  usersWithPasswordHash: number
  totalUsers: number
  pushSubscriptionsCount: number
  pendingOrganizationLogosCount: number
  preservedIndexesByCollection: Record<string, string[]>
  integrityViolations: IntegrityViolation[]
  consistencyWarnings: string[]
}

export class RestoreConsistencyError extends AppError {
  public readonly consistencyReport: RestoreConsistencyReport
  public readonly restoredCounts: Record<string, number>
  public readonly totalRestored: number

  constructor(
    message: string,
    consistencyReport: RestoreConsistencyReport,
    restoredCounts: Record<string, number>,
    totalRestored: number
  ) {
    super(422, message)
    this.name = 'RestoreConsistencyError'
    this.consistencyReport = consistencyReport
    this.restoredCounts = restoredCounts
    this.totalRestored = totalRestored
  }
}

export interface RestoreExecutionResult {
  restoredCounts: Record<string, number>
  totalRestored: number
  consistencyReport: RestoreConsistencyReport
}

export interface CloudinaryReconciliationReport {
  storageProvider: string
  complete: boolean
  truncated: boolean
  scanError?: string
  activeDbAssets: number
  cloudAssetsScanned: number
  missingInCloud: Array<{ assetId: string; publicId: string; resourceType: string; deliveryType: string; ownerType: string; ownerId: string }>
  unregisteredInDb: Array<{ publicId: string; resourceType: string; deliveryType: string; bytes: number }>
  archivedPendingCloudDelete: number
}

export function resolveBackupKey(rawKey?: string): Buffer {
  const keyStr = (rawKey ?? process.env.BACKUP_ENCRYPTION_KEY ?? '').trim()
  if (!/^[0-9a-f]{64}$/i.test(keyStr)) {
    throw new AppError(
      422,
      'BACKUP_ENCRYPTION_KEY must be an exact 64-character hexadecimal string (32 bytes for AES-256-GCM).'
    )
  }
  return Buffer.from(keyStr, 'hex')
}

export interface ParsedMongoUriIdentity {
  scheme: 'mongodb' | 'mongodb+srv'
  hosts: string[]
  canonicalHostKeys: string[]
  clusterSuffix?: string
  replicaSet?: string
  dbName: string
  host: string
  rawNormalized: string
}

function normalizeMongoHostToken(rawHost: string, scheme: 'mongodb' | 'mongodb+srv'): string {
  const lowered = rawHost.trim().toLowerCase()
  if (!lowered || /\s/.test(lowered)) {
    throw new AppError(422, 'Invalid MongoDB host entry in connection URI')
  }

  let hostname = lowered
  let port = ''

  if (lowered.startsWith('[')) {
    const closingIdx = lowered.indexOf(']')
    if (closingIdx === -1) {
      throw new AppError(422, 'Malformed IPv6 MongoDB host in connection URI')
    }
    hostname = lowered.slice(1, closingIdx)
    const remainder = lowered.slice(closingIdx + 1)
    if (remainder.startsWith(':')) {
      port = remainder.slice(1)
    } else if (remainder.length > 0) {
      throw new AppError(422, 'Malformed port in IPv6 MongoDB host')
    }
  } else if (net.isIPv6(lowered)) {
    // Handle bare unbracketed IPv6 literals (e.g., sourceConnection.host === '::1') safely
    hostname = lowered
  } else {
    const colonCount = (lowered.match(/:/g) || []).length
    if (colonCount > 1) {
      throw new AppError(422, 'Malformed MongoDB host:port token in connection URI')
    }
    if (colonCount === 1) {
      const [h, p] = lowered.split(':')
      hostname = h
      port = p
    }
  }

  if (!hostname) {
    throw new AppError(422, 'MongoDB URI host cannot be empty')
  }
  if (port && !/^\d{1,5}$/.test(port)) {
    throw new AppError(422, 'Invalid port number in MongoDB URI')
  }

  // Normalize local loopback hostnames (IPv4 & IPv6) so 127.0.0.1 / localhost / ::1 are equivalent
  const canonicalHostname =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '::ffff:127.0.0.1'
      ? '127.0.0.1'
      : hostname
  const effectivePort = port || (scheme === 'mongodb' ? '27017' : 'srv')

  return `${canonicalHostname}:${effectivePort}`
}

function extractHostnameFromNormalizedKey(key: string): string {
  return key.replace(/:(\d+|srv)$/, '')
}

function extractAtlasClusterSuffix(hosts: string[]): string | undefined {
  for (const h of hosts) {
    const hostOnly = extractHostnameFromNormalizedKey(h)
    if (!net.isIPv6(hostOnly) && hostOnly.endsWith('.mongodb.net')) {
      const parts = hostOnly.split('.')
      if (parts.length >= 3) {
        return parts.slice(-3).join('.')
      }
    }
  }
  return undefined
}

function hmacIdentityToken(key: Buffer, value: string): string {
  return crypto.createHmac('sha256', key).update(`etech-id:${value}`, 'utf8').digest('hex')
}

export function normalizeMongoTargetIdentity(uri: string): ParsedMongoUriIdentity {
  const trimmed = uri.trim()
  const match = /^(mongodb(?:\+srv)?):\/\/(.+)$/i.exec(trimmed)
  if (!match) {
    throw new AppError(422, 'Invalid MongoDB connection URI format')
  }

  const scheme = match[1].toLowerCase() as 'mongodb' | 'mongodb+srv'
  const rest = match[2]

  const queryIdx = rest.indexOf('?')
  const authorityAndPath = queryIdx >= 0 ? rest.slice(0, queryIdx) : rest
  const queryRaw = queryIdx >= 0 ? rest.slice(queryIdx + 1) : ''

  // Reject unencoded '/' or '@' confusion across userinfo vs hosts/dbName without storing or exposing credentials
  const slashIdx = authorityAndPath.indexOf('/')
  if (slashIdx >= 0 && authorityAndPath.indexOf('@', slashIdx) >= 0) {
    throw new AppError(422, 'Malformed MongoDB URI: credentials must percent-encode "/" as "%2F"')
  }

  const authority = slashIdx >= 0 ? authorityAndPath.slice(0, slashIdx) : authorityAndPath
  const pathRaw = slashIdx >= 0 ? authorityAndPath.slice(slashIdx + 1) : ''

  const atIdx = authority.lastIndexOf('@')
  const hostsRaw = (atIdx >= 0 ? authority.slice(atIdx + 1) : authority).trim()
  if (!hostsRaw) {
    throw new AppError(422, 'MongoDB URI is missing host specification')
  }

  const rawHostParts = hostsRaw.split(',').map((h) => h.trim()).filter(Boolean)
  if (rawHostParts.length === 0) {
    throw new AppError(422, 'MongoDB URI is missing host specification')
  }

  const canonicalHostKeys = Array.from(
    new Set(rawHostParts.map((token) => normalizeMongoHostToken(token, scheme)))
  ).sort()
  const hosts = canonicalHostKeys.map((hk) => hk.replace(/:srv$/, ''))

  // Extract database name cleanly (before any trailing segments)
  const rawDbSegment = pathRaw.split('/')[0] || ''
  let dbName = ''
  try {
    dbName = decodeURIComponent(rawDbSegment).trim()
  } catch {
    throw new AppError(422, 'Invalid URL encoding in MongoDB database name')
  }

  let replicaSet: string | undefined
  if (queryRaw) {
    const params = new URLSearchParams(queryRaw)
    const rs = (params.get('replicaSet') || params.get('replicaset') || '').trim().toLowerCase()
    if (rs) replicaSet = rs
  }

  const clusterSuffix = extractAtlasClusterSuffix(hosts)
  const normalizedHostSummary = canonicalHostKeys.join(',')

  return {
    scheme,
    hosts,
    canonicalHostKeys,
    clusterSuffix,
    replicaSet,
    dbName,
    host: hosts.join(','),
    rawNormalized: `${scheme}://${normalizedHostSummary}/${dbName}`,
  }
}

export function extractConnectionIdentity(conn: Connection): ParsedMongoUriIdentity {
  const dbName = (conn.db?.databaseName || conn.name || '').trim()
  const client = (
    conn as unknown as {
      getClient?: () => {
        options?: {
          hosts?: Array<string | { host?: string; port?: number; toString?: () => string }>
          srvHost?: string
          replicaSet?: string
        }
      }
    }
  ).getClient?.()

  const clientOpts = client?.options
  const scheme: 'mongodb' | 'mongodb+srv' = clientOpts?.srvHost ? 'mongodb+srv' : 'mongodb'
  const rawHostTokens: string[] = []

  if (clientOpts?.srvHost) {
    rawHostTokens.push(String(clientOpts.srvHost))
  }
  if (Array.isArray(clientOpts?.hosts)) {
    for (const entry of clientOpts.hosts) {
      if (typeof entry === 'string') {
        rawHostTokens.push(entry)
      } else if (entry && typeof entry.toString === 'function') {
        const str = entry.toString()
        if (str && str !== '[object Object]') rawHostTokens.push(str)
      } else if (entry?.host) {
        const hostStr = net.isIPv6(entry.host) ? `[${entry.host}]` : entry.host
        rawHostTokens.push(entry.port ? `${hostStr}:${entry.port}` : hostStr)
      }
    }
  }

  const connHostRaw = (conn.host || '').trim()
  const connPortRaw = conn.port ? String(conn.port) : '27017'
  if (connHostRaw) {
    for (const part of connHostRaw.split(',').map((p) => p.trim()).filter(Boolean)) {
      if (net.isIPv6(part)) {
        rawHostTokens.push(`[${part}]:${connPortRaw}`)
      } else if (part.includes(':') && !part.startsWith('[')) {
        rawHostTokens.push(part)
      } else if (part.startsWith('[') && part.includes(']:')) {
        rawHostTokens.push(part)
      } else {
        rawHostTokens.push(`${part}:${connPortRaw}`)
      }
    }
  }

  const canonicalHostKeys = Array.from(
    new Set(
      rawHostTokens.map((token) =>
        normalizeMongoHostToken(token, token.includes(':') || scheme === 'mongodb' ? 'mongodb' : 'mongodb+srv')
      )
    )
  ).sort()
  const hosts = canonicalHostKeys.map((hk) => hk.replace(/:srv$/, ''))
  const clusterSuffix = extractAtlasClusterSuffix(hosts)
  const replicaSet = clientOpts?.replicaSet ? String(clientOpts.replicaSet).trim().toLowerCase() : undefined

  return {
    scheme,
    hosts,
    canonicalHostKeys,
    clusterSuffix,
    replicaSet,
    dbName,
    host: hosts.join(','),
    rawNormalized: `${scheme}://${canonicalHostKeys.join(',')}/${dbName}`,
  }
}

function assertIdentitiesAreIsolated(
  targetIdentity: ParsedMongoUriIdentity,
  prodIdentity: ParsedMongoUriIdentity,
  contextLabel: string
): void {
  if (targetIdentity.dbName !== prodIdentity.dbName) {
    // Distinct database names provide namespace separation
    return
  }

  // Identical database name: fail closed unless target cluster is provably distinct from production
  const prodHostSet = new Set(prodIdentity.hosts)
  const prodCanonicalSet = new Set(prodIdentity.canonicalHostKeys)
  const prodHostnamesOnly = new Set(prodIdentity.hosts.map(extractHostnameFromNormalizedKey))
  const hostsOverlap =
    targetIdentity.hosts.some((h) => prodHostSet.has(h) || prodHostnamesOnly.has(extractHostnameFromNormalizedKey(h))) ||
    targetIdentity.canonicalHostKeys.some((hk) => prodCanonicalSet.has(hk))

  if (hostsOverlap) {
    throw new AppError(
      403,
      `Refusing restore: ${contextLabel} matches production MONGODB_URI (overlapping host). Use an isolated target database.`
    )
  }

  if (targetIdentity.clusterSuffix && prodIdentity.clusterSuffix) {
    if (targetIdentity.clusterSuffix === prodIdentity.clusterSuffix) {
      throw new AppError(
        403,
        `Refusing restore: ${contextLabel} Atlas cluster identity and database name match production MONGODB_URI.`
      )
    }
    if (
      targetIdentity.replicaSet &&
      prodIdentity.replicaSet &&
      targetIdentity.replicaSet === prodIdentity.replicaSet
    ) {
      throw new AppError(
        403,
        `Refusing restore: ${contextLabel} replicaSet and database name match production MONGODB_URI.`
      )
    }
    return
  }

  if (targetIdentity.replicaSet && prodIdentity.replicaSet) {
    if (targetIdentity.replicaSet === prodIdentity.replicaSet) {
      throw new AppError(
        403,
        `Refusing restore: ${contextLabel} replicaSet and database name match production MONGODB_URI.`
      )
    }
    if (targetIdentity.scheme === 'mongodb' && prodIdentity.scheme === 'mongodb') {
      // Explicit disjoint replica sets on non-Atlas mongodb:// URIs with non-overlapping hosts
      return
    }
  }

  // Uncertainty means refusal: cross-scheme, non-Atlas SRV, or self-managed mongodb:// hostnames without distinct replicaSet names
  throw new AppError(
    403,
    `Refusing restore: cannot prove ${contextLabel} cluster differs from production MONGODB_URI when database names match.`
  )
}

export function assertSafeRestoreTargetUri(targetUri: string, productionUri?: string): void {
  const trimmedTarget = (targetUri || '').trim()
  if (!trimmedTarget) {
    throw new AppError(422, 'RESTORE_TARGET_MONGODB_URI is required for restore operations')
  }

  const targetIdentity = normalizeMongoTargetIdentity(trimmedTarget)
  if (!targetIdentity.dbName) {
    throw new AppError(422, 'RESTORE_TARGET_MONGODB_URI must include an explicit target database name')
  }

  // Fail closed if production MONGODB_URI is absent or invalid — never silently bypass protection
  const prodUri = (productionUri ?? process.env.MONGODB_URI ?? '').trim()
  if (!prodUri) {
    throw new AppError(
      422,
      'MONGODB_URI is required to verify that the restore target database is isolated from production'
    )
  }

  const prodIdentity = normalizeMongoTargetIdentity(prodUri)
  if (!prodIdentity.dbName) {
    throw new AppError(
      422,
      'MONGODB_URI must include an explicit database name so production isolation can be verified'
    )
  }

  assertIdentitiesAreIsolated(targetIdentity, prodIdentity, 'target database')
}

function buildSourceDbFingerprint(conn: Connection, key: Buffer): SourceDbFingerprint | undefined {
  const identity = extractConnectionIdentity(conn)
  if (!identity.dbName) return undefined
  return {
    dbNameHmac: hmacIdentityToken(key, `db:${identity.dbName}`),
    hostHmacs: Array.from(
      new Set(identity.hosts.map((h) => hmacIdentityToken(key, `host:${extractHostnameFromNormalizedKey(h)}`)))
    ),
    ...(identity.clusterSuffix
      ? { clusterSuffixHmac: hmacIdentityToken(key, `cluster:${identity.clusterSuffix}`) }
      : {}),
    ...(identity.replicaSet
      ? { replicaSetHmac: hmacIdentityToken(key, `rs:${identity.replicaSet}`) }
      : {}),
  }
}

function assertTargetDoesNotMatchSourceFingerprint(
  identity: ParsedMongoUriIdentity,
  fingerprint: SourceDbFingerprint | undefined,
  key: Buffer,
  label: string
): void {
  if (!fingerprint) return
  const targetDbHmac = hmacIdentityToken(key, `db:${identity.dbName}`)
  if (targetDbHmac !== fingerprint.dbNameHmac) return

  const targetHostHmacs = new Set(
    identity.hosts.map((h) => hmacIdentityToken(key, `host:${extractHostnameFromNormalizedKey(h)}`))
  )
  const hostOverlap = fingerprint.hostHmacs.some((h) => targetHostHmacs.has(h))
  const targetClusterHmac = identity.clusterSuffix
    ? hmacIdentityToken(key, `cluster:${identity.clusterSuffix}`)
    : undefined
  const clusterOverlap = Boolean(targetClusterHmac) && targetClusterHmac === fingerprint.clusterSuffixHmac
  const targetReplicaSetHmac = identity.replicaSet
    ? hmacIdentityToken(key, `rs:${identity.replicaSet}`)
    : undefined
  const replicaSetOverlap =
    Boolean(targetReplicaSetHmac) && targetReplicaSetHmac === fingerprint.replicaSetHmac
  const ambiguousUncertainty =
    identity.scheme === 'mongodb+srv' && !targetClusterHmac && fingerprint.hostHmacs.length > 0

  if (hostOverlap || clusterOverlap || replicaSetOverlap || ambiguousUncertainty) {
    throw new AppError(
      403,
      `Refusing restore: ${label} matches the encrypted source database fingerprint.`
    )
  }
}

function validateHeaderMagicAndVersion(magic: Buffer, versionByte: Buffer): 1 | 2 {
  if (!magic.equals(BACKUP_MAGIC)) {
    throw new AppError(422, 'Unrecognized backup archive header')
  }
  const version = versionByte[0]
  if (version !== BACKUP_FORMAT_VERSION_V1 && version !== BACKUP_FORMAT_VERSION) {
    throw new AppError(422, `Unsupported backup archive version: ${version}`)
  }
  return version
}

async function writeChunkWithBackpressure(stream: NodeJS.WritableStream, data: string): Promise<void> {
  if (!stream.write(data, 'utf8')) {
    await new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        cleanup()
        resolve()
      }
      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }
      const cleanup = () => {
        stream.off('drain', onDrain)
        stream.off('error', onError)
      }
      stream.once('drain', onDrain)
      stream.once('error', onError)
    })
  }
}

async function executeStreamingEncryptedBackup(params: {
  sourceConnection: Connection
  encryptionKeyHex?: string
  outputPath?: string
  maxTotalDocuments?: number
  maxSerializedBytes?: number
}): Promise<{
  encryptedBuffer?: Buffer
  bytesWritten: number
  startedAt: string
  completedAt: string
  collectionCounts: Record<string, number>
  totalDocuments: number
  excludedCollections: string[]
}> {
  const { sourceConnection, encryptionKeyHex, outputPath } = params
  if (sourceConnection.readyState !== 1 || !sourceConnection.db) {
    throw new AppError(503, 'Source MongoDB connection is not ready for backup')
  }

  const key = resolveBackupKey(encryptionKeyHex)
  const startedAt = new Date().toISOString()
  const maxDocs = params.maxTotalDocuments ?? MAX_BACKUP_TOTAL_DOCUMENTS
  const maxBytes = params.maxSerializedBytes ?? MAX_BACKUP_SERIALIZED_BYTES
  const collectionCounts: Record<string, number> = {}
  let totalDocuments = 0
  let serializedBytes = 0

  const iv = crypto.randomBytes(12)
  const versionByte = Buffer.from([BACKUP_FORMAT_VERSION])
  const aad = Buffer.concat([BACKUP_MAGIC, versionByte])
  const headerBytes = Buffer.concat([BACKUP_MAGIC, versionByte, iv])

  const gzip = zlib.createGzip()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad)
  gzip.pipe(cipher)

  const runningSha256 = crypto.createHash('sha256')
  const sourceDbFingerprint = buildSourceDbFingerprint(sourceConnection, key)

  let bytesWritten = 0
  const ciphertextChunks: Buffer[] = []
  let tempFilePath: string | undefined
  let fileHandle: fs.FileHandle | undefined

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    tempFilePath = `${outputPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    fileHandle = await fs.open(tempFilePath, 'w', 0o600)
    await fileHandle.write(headerBytes)
    bytesWritten += headerBytes.length
  } else {
    ciphertextChunks.push(headerBytes)
    bytesWritten += headerBytes.length
  }

  const drainCipher = async (): Promise<void> => {
    for await (const chunk of cipher) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytesWritten += buf.length
      if (fileHandle) {
        await fileHandle.write(buf)
      } else {
        ciphertextChunks.push(buf)
      }
    }
  }

  const writeStreamLines = async (): Promise<string> => {
    const headerLineObj: BackupStreamHeaderLine = {
      type: 'HEADER',
      version: 2,
      format: 'ETECHCRM_LOGICAL_BACKUP_V2',
      logicalSnapshotDisclaimer:
        'Multi-collection logical export (MongoDB Atlas M0 has no PITR; concurrent writes may cause cross-collection skew)',
      startedAt,
      excludedCollections: [...EXCLUDED_BACKUP_COLLECTIONS],
      ...(sourceDbFingerprint ? { sourceDbFingerprint } : {}),
    }
    const headerLine = `${EJSON.stringify(headerLineObj, { relaxed: false })}\n`
    serializedBytes += Buffer.byteLength(headerLine, 'utf8')
    if (serializedBytes > maxBytes) {
      throw new AppError(
        413,
        `Backup aborted: serialized payload exceeds safety limit (${Math.round(maxBytes / (1024 * 1024))} MB)`
      )
    }
    runningSha256.update(headerLine, 'utf8')
    await writeChunkWithBackpressure(gzip, headerLine)

    for (const spec of DURABLE_MODEL_SPECS) {
      let colCount = 0
      const cursor = sourceConnection.collection(spec.collectionName).find({}).batchSize(BACKUP_CURSOR_BATCH_SIZE)
      for await (const doc of cursor) {
        totalDocuments += 1
        if (totalDocuments > maxDocs) {
          throw new AppError(
            413,
            `Backup aborted: document count exceeds single-process safety limit (${maxDocs})`
          )
        }
        const docLineObj: BackupStreamDocLine = {
          type: 'DOC',
          collection: spec.collectionName,
          doc,
        }
        const docLine = `${EJSON.stringify(docLineObj, { relaxed: false })}\n`
        serializedBytes += Buffer.byteLength(docLine, 'utf8')
        if (serializedBytes > maxBytes) {
          throw new AppError(
            413,
            `Backup aborted: serialized payload exceeds safety limit (${Math.round(maxBytes / (1024 * 1024))} MB)`
          )
        }
        runningSha256.update(docLine, 'utf8')
        await writeChunkWithBackpressure(gzip, docLine)
        colCount += 1
      }
      collectionCounts[spec.collectionName] = colCount
    }

    const completedAt = new Date().toISOString()
    const footerLineObj: BackupStreamFooterLine = {
      type: 'FOOTER',
      completedAt,
      collectionCounts,
      totalDocuments,
      sha256: runningSha256.digest('hex'),
    }
    const footerLine = `${EJSON.stringify(footerLineObj, { relaxed: false })}\n`
    await writeChunkWithBackpressure(gzip, footerLine)
    gzip.end()
    return completedAt
  }

  try {
    const [, completedAt] = await Promise.all([drainCipher(), writeStreamLines()])
    const authTag = cipher.getAuthTag()
    bytesWritten += authTag.length

    if (fileHandle && tempFilePath && outputPath) {
      await fileHandle.write(authTag)
      await fileHandle.sync()
      await fileHandle.close()
      fileHandle = undefined
      await fs.chmod(tempFilePath, 0o600).catch(() => {})
      await fs.rename(tempFilePath, outputPath)
      tempFilePath = undefined
      return {
        bytesWritten,
        startedAt,
        completedAt,
        collectionCounts,
        totalDocuments,
        excludedCollections: [...EXCLUDED_BACKUP_COLLECTIONS],
      }
    }

    ciphertextChunks.push(authTag)
    return {
      encryptedBuffer: Buffer.concat(ciphertextChunks),
      bytesWritten,
      startedAt,
      completedAt,
      collectionCounts,
      totalDocuments,
      excludedCollections: [...EXCLUDED_BACKUP_COLLECTIONS],
    }
  } catch (err) {
    gzip.destroy()
    cipher.destroy()
    if (fileHandle) {
      await fileHandle.close().catch(() => {})
    }
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(() => {})
    }
    throw err
  }
}

export async function createEncryptedBackup(
  sourceConnection: Connection = mongoose.connection,
  encryptionKeyHex?: string,
  options?: { maxTotalDocuments?: number; maxSerializedBytes?: number }
): Promise<BackupCreationResult> {
  const result = await executeStreamingEncryptedBackup({
    sourceConnection,
    encryptionKeyHex,
    maxTotalDocuments: options?.maxTotalDocuments,
    maxSerializedBytes: options?.maxSerializedBytes,
  })
  return {
    encryptedBuffer: result.encryptedBuffer!,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    collectionCounts: result.collectionCounts,
    totalDocuments: result.totalDocuments,
    excludedCollections: result.excludedCollections,
  }
}

export async function createEncryptedBackupToFile(
  outPath: string,
  sourceConnection: Connection = mongoose.connection,
  encryptionKeyHex?: string,
  options?: { maxTotalDocuments?: number; maxSerializedBytes?: number }
): Promise<Omit<BackupCreationResult, 'encryptedBuffer'> & { bytesWritten: number }> {
  const result = await executeStreamingEncryptedBackup({
    sourceConnection,
    encryptionKeyHex,
    outputPath: outPath,
    maxTotalDocuments: options?.maxTotalDocuments,
    maxSerializedBytes: options?.maxSerializedBytes,
  })
  return {
    bytesWritten: result.bytesWritten,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    collectionCounts: result.collectionCounts,
    totalDocuments: result.totalDocuments,
    excludedCollections: result.excludedCollections,
  }
}

function decryptAndVerifyV1Sync(
  encryptedBuffer: Buffer,
  key: Buffer,
  aad: Buffer
): { payload: LogicalBackupPayload; verification: BackupVerificationResult } {
  const minLength = BACKUP_MAGIC.length + 1 + 12 + 16 + 1
  if (encryptedBuffer.length < minLength) {
    throw new AppError(422, 'Backup archive is truncated or malformed')
  }
  const ivStart = BACKUP_MAGIC.length + 1
  const tagStart = ivStart + 12
  const cipherStart = tagStart + 16
  const iv = encryptedBuffer.subarray(ivStart, tagStart)
  const authTag = encryptedBuffer.subarray(tagStart, cipherStart)
  const ciphertext = encryptedBuffer.subarray(cipherStart)

  let decompressed: Buffer
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(aad)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    decompressed = zlib.gunzipSync(decrypted)
  } catch {
    throw new AppError(422, 'Backup decryption or authentication failed (wrong key or tampered archive)')
  }

  let parsedWrapper: InnerEncryptedWrapper
  try {
    parsedWrapper = EJSON.parse(decompressed.toString('utf8'), { relaxed: false }) as InnerEncryptedWrapper
  } catch {
    throw new AppError(422, 'Backup payload could not be parsed as valid EJSON')
  }

  if (!parsedWrapper?.sha256 || !parsedWrapper?.payload?.collections) {
    throw new AppError(422, 'Backup payload is missing required metadata or collections')
  }

  const recomputedSha = crypto
    .createHash('sha256')
    .update(EJSON.stringify(parsedWrapper.payload, { relaxed: false }), 'utf8')
    .digest('hex')

  if (recomputedSha !== parsedWrapper.sha256) {
    throw new AppError(422, 'Backup inner integrity checksum verification failed')
  }

  const payload = parsedWrapper.payload
  const normalizedCounts: Record<string, number> = {}
  let totalDocuments = 0
  for (const [colName, count] of Object.entries(payload.collectionCounts || {})) {
    const numCount = Number(count || 0)
    normalizedCounts[colName] = numCount
    totalDocuments += numCount
  }
  payload.version = Number(payload.version)
  payload.collectionCounts = normalizedCounts

  return {
    payload,
    verification: {
      version: payload.version,
      startedAt: payload.startedAt,
      completedAt: payload.completedAt,
      collectionCounts: normalizedCounts,
      totalDocuments,
      excludedCollections: payload.excludedCollections || [],
    },
  }
}

export function decryptAndVerifyBackup(
  encryptedBuffer: Buffer,
  encryptionKeyHex?: string
): { payload: LogicalBackupPayload; verification: BackupVerificationResult } {
  const key = resolveBackupKey(encryptionKeyHex)
  const minLength = BACKUP_MAGIC.length + 1 + 12 + 16 + 1
  if (!Buffer.isBuffer(encryptedBuffer) || encryptedBuffer.length < minLength) {
    throw new AppError(422, 'Backup archive is truncated or malformed')
  }

  const magic = encryptedBuffer.subarray(0, BACKUP_MAGIC.length)
  const versionByte = encryptedBuffer.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 1)
  const version = validateHeaderMagicAndVersion(magic, versionByte)
  const aad = Buffer.concat([magic, versionByte])

  if (version === BACKUP_FORMAT_VERSION_V1) {
    return decryptAndVerifyV1Sync(encryptedBuffer, key, aad)
  }

  // V2 layout: [MAGIC (8)] [VER=2 (1)] [IV (12)] [CIPHERTEXT (...)] [AUTH_TAG (16)]
  const ivStart = BACKUP_MAGIC.length + 1
  const cipherStart = ivStart + 12
  const tagStart = encryptedBuffer.length - 16
  if (tagStart <= cipherStart) {
    throw new AppError(422, 'Backup archive is truncated or malformed')
  }

  const iv = encryptedBuffer.subarray(ivStart, cipherStart)
  const ciphertext = encryptedBuffer.subarray(cipherStart, tagStart)
  const authTag = encryptedBuffer.subarray(tagStart)

  let decompressedText: string
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(aad)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    decompressedText = zlib.gunzipSync(decrypted).toString('utf8')
  } catch {
    throw new AppError(422, 'Backup decryption or authentication failed (wrong key or tampered archive)')
  }

  let header: BackupStreamHeaderLine | null = null
  let footer: BackupStreamFooterLine | null = null
  const collections: Record<string, unknown[]> = {}
  const actualCounts: Record<string, number> = {}
  let actualTotalDocs = 0
  const runningSha256 = crypto.createHash('sha256')

  const lines = decompressedText.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    if (!rawLine) continue
    if (footer) {
      throw new AppError(422, 'Backup stream contains trailing data after footer boundary')
    }

    let parsed: BackupStreamHeaderLine | BackupStreamDocLine | BackupStreamFooterLine
    try {
      parsed = EJSON.parse(rawLine, { relaxed: false }) as
        | BackupStreamHeaderLine
        | BackupStreamDocLine
        | BackupStreamFooterLine
    } catch {
      throw new AppError(422, 'Backup stream record could not be parsed as valid EJSON')
    }

    if (parsed.type === 'HEADER') {
      if (header) {
        throw new AppError(422, 'Duplicate HEADER record in backup stream')
      }
      header = parsed
      runningSha256.update(`${rawLine}\n`, 'utf8')
    } else if (parsed.type === 'DOC') {
      if (!header) {
        throw new AppError(422, 'Backup DOC record encountered before HEADER')
      }
      if (!collections[parsed.collection]) collections[parsed.collection] = []
      collections[parsed.collection].push(parsed.doc)
      actualCounts[parsed.collection] = (actualCounts[parsed.collection] || 0) + 1
      actualTotalDocs += 1
      runningSha256.update(`${rawLine}\n`, 'utf8')
    } else if (parsed.type === 'FOOTER') {
      if (!header) {
        throw new AppError(422, 'Backup FOOTER record encountered before HEADER')
      }
      footer = parsed
    } else {
      throw new AppError(422, 'Unrecognized record boundary inside backup stream')
    }
  }

  if (!header || !footer) {
    throw new AppError(422, 'Backup stream is incomplete (missing HEADER or FOOTER boundary)')
  }
  if (runningSha256.digest('hex') !== footer.sha256) {
    throw new AppError(422, 'Backup inner integrity checksum verification failed')
  }

  const normalizedCounts: Record<string, number> = {}
  let totalDocuments = 0
  for (const [colName, count] of Object.entries(footer.collectionCounts || {})) {
    const numCount = Number(count || 0)
    normalizedCounts[colName] = numCount
    totalDocuments += numCount
    if ((actualCounts[colName] || 0) !== numCount) {
      throw new AppError(422, `Backup collection count mismatch for "${colName}"`)
    }
  }
  if (totalDocuments !== actualTotalDocs || Number(footer.totalDocuments) !== actualTotalDocs) {
    throw new AppError(422, 'Backup total document count verification failed')
  }

  const payload: LogicalBackupPayload = {
    version: 2,
    format: 'ETECHCRM_LOGICAL_BACKUP_V2',
    logicalSnapshotDisclaimer: header.logicalSnapshotDisclaimer,
    startedAt: header.startedAt,
    completedAt: footer.completedAt,
    excludedCollections: header.excludedCollections || [],
    ...(header.sourceDbFingerprint ? { sourceDbFingerprint: header.sourceDbFingerprint } : {}),
    collectionCounts: normalizedCounts,
    collections,
  }

  return {
    payload,
    verification: {
      version: 2,
      startedAt: header.startedAt,
      completedAt: footer.completedAt,
      collectionCounts: normalizedCounts,
      totalDocuments,
      excludedCollections: header.excludedCollections || [],
    },
  }
}

async function streamProcessV2Source(params: {
  ciphertextInput: { kind: 'buffer'; buffer: Buffer } | { kind: 'file'; filePath: string; totalSize: number }
  iv: Buffer
  authTag: Buffer
  aad: Buffer
  key: Buffer
  onDoc?: (collection: string, doc: unknown) => Promise<void>
}): Promise<{
  header: BackupStreamHeaderLine
  footer: BackupStreamFooterLine
  normalizedCounts: Record<string, number>
}> {
  const { ciphertextInput, iv, authTag, aad, key, onDoc } = params
  const cipherStream =
    ciphertextInput.kind === 'buffer'
      ? Readable.from(ciphertextInput.buffer)
      : createReadStream(ciphertextInput.filePath, {
          start: BACKUP_MAGIC.length + 1 + 12,
          end: ciphertextInput.totalSize - 17,
        })

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(aad)
  decipher.setAuthTag(authTag)
  const gunzip = zlib.createGunzip()

  let header: BackupStreamHeaderLine | null = null
  let footer: BackupStreamFooterLine | null = null
  const actualCounts: Record<string, number> = {}
  let actualTotalDocs = 0
  const runningSha256 = crypto.createHash('sha256')

  const lineConsumer = new Transform({
    objectMode: false,
    transform(_chunk, _enc, cb) {
      cb()
    },
  })

  try {
    const pipedDecompress = cipherStream.pipe(decipher).pipe(gunzip)
    // Attach error handlers immediately so stream crypto/zlib errors reject cleanly instead of crashing uncaught
    const streamErrorPromise = new Promise<never>((_resolve, reject) => {
      cipherStream.once('error', reject)
      decipher.once('error', () =>
        reject(new AppError(422, 'Backup decryption or authentication failed (wrong key or tampered archive)'))
      )
      gunzip.once('error', () =>
        reject(new AppError(422, 'Backup decryption or authentication failed (wrong key or tampered archive)'))
      )
    })

    const rl = readline.createInterface({ input: pipedDecompress, crlfDelay: Infinity })
    const processLines = async () => {
      for await (const rawLine of rl) {
        if (!rawLine) continue
        if (footer) {
          throw new AppError(422, 'Backup stream contains trailing data after footer boundary')
        }
        let parsed: BackupStreamHeaderLine | BackupStreamDocLine | BackupStreamFooterLine
        try {
          parsed = EJSON.parse(rawLine, { relaxed: false }) as
            | BackupStreamHeaderLine
            | BackupStreamDocLine
            | BackupStreamFooterLine
        } catch {
          throw new AppError(422, 'Backup stream record could not be parsed as valid EJSON')
        }

        if (parsed.type === 'HEADER') {
          if (header) throw new AppError(422, 'Duplicate HEADER record in backup stream')
          header = parsed
          runningSha256.update(`${rawLine}\n`, 'utf8')
        } else if (parsed.type === 'DOC') {
          if (!header) throw new AppError(422, 'Backup DOC record encountered before HEADER')
          actualCounts[parsed.collection] = (actualCounts[parsed.collection] || 0) + 1
          actualTotalDocs += 1
          runningSha256.update(`${rawLine}\n`, 'utf8')
          if (onDoc) {
            await onDoc(parsed.collection, parsed.doc)
          }
        } else if (parsed.type === 'FOOTER') {
          if (!header) throw new AppError(422, 'Backup FOOTER record encountered before HEADER')
          footer = parsed
        } else {
          throw new AppError(422, 'Unrecognized record boundary inside backup stream')
        }
      }
    }

    await Promise.race([processLines(), streamErrorPromise])
  } catch (err) {
    cipherStream.destroy()
    decipher.destroy()
    gunzip.destroy()
    lineConsumer.destroy()
    if (err instanceof AppError) throw err
    throw new AppError(422, 'Backup decryption or authentication failed (wrong key or tampered archive)')
  }

  if (!header || !footer) {
    throw new AppError(422, 'Backup stream is incomplete (missing HEADER or FOOTER boundary)')
  }
  const verifiedHeader: BackupStreamHeaderLine = header
  const verifiedFooter: BackupStreamFooterLine = footer

  if (runningSha256.digest('hex') !== verifiedFooter.sha256) {
    throw new AppError(422, 'Backup inner integrity checksum verification failed')
  }

  const normalizedCounts: Record<string, number> = {}
  let expectedSum = 0
  for (const [colName, count] of Object.entries(verifiedFooter.collectionCounts || {})) {
    const numCount = Number(count || 0)
    normalizedCounts[colName] = numCount
    expectedSum += numCount
    if ((actualCounts[colName] || 0) !== numCount) {
      throw new AppError(422, `Backup collection count mismatch for "${colName}"`)
    }
  }
  if (expectedSum !== actualTotalDocs || Number(verifiedFooter.totalDocuments) !== actualTotalDocs) {
    throw new AppError(422, 'Backup total document count verification failed')
  }

  return { header: verifiedHeader, footer: verifiedFooter, normalizedCounts }
}

export async function verifyBackupFile(
  filePath: string,
  encryptionKeyHex?: string
): Promise<BackupVerificationResult> {
  const stat = await fs.stat(filePath)
  const minLength = BACKUP_MAGIC.length + 1 + 12 + 16 + 1
  if (stat.size < minLength) {
    throw new AppError(422, 'Backup archive is truncated or malformed')
  }

  const key = resolveBackupKey(encryptionKeyHex)
  const fh = await fs.open(filePath, 'r')
  const headerBuf = Buffer.alloc(BACKUP_MAGIC.length + 1 + 12)
  const tagBuf = Buffer.alloc(16)
  let version: 1 | 2
  try {
    await fh.read(headerBuf, 0, headerBuf.length, 0)
    await fh.read(tagBuf, 0, 16, stat.size - 16)
    const magic = headerBuf.subarray(0, BACKUP_MAGIC.length)
    const versionByte = headerBuf.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 1)
    version = validateHeaderMagicAndVersion(magic, versionByte)
  } finally {
    await fh.close()
  }

  if (version === BACKUP_FORMAT_VERSION_V1) {
    const buf = await fs.readFile(filePath)
    return decryptAndVerifyBackup(buf, encryptionKeyHex).verification
  }

  const magic = headerBuf.subarray(0, BACKUP_MAGIC.length)
  const versionByte = headerBuf.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 1)
  const iv = headerBuf.subarray(BACKUP_MAGIC.length + 1)
  const aad = Buffer.concat([magic, versionByte])

  const { header, footer, normalizedCounts } = await streamProcessV2Source({
    ciphertextInput: { kind: 'file', filePath, totalSize: stat.size },
    iv,
    authTag: tagBuf,
    aad,
    key,
  })

  return {
    version: 2,
    startedAt: header.startedAt,
    completedAt: footer.completedAt,
    collectionCounts: normalizedCounts,
    totalDocuments: Number(footer.totalDocuments),
    excludedCollections: header.excludedCollections || [],
  }
}

export async function verifyTargetDatabaseIsEmpty(targetConnection: Connection): Promise<void> {
  if (targetConnection.readyState !== 1 || !targetConnection.db) {
    throw new AppError(503, 'Target MongoDB connection is not ready')
  }

  const existingCollections = await targetConnection.db.listCollections({}, { nameOnly: true }).toArray()
  for (const colInfo of existingCollections) {
    if (!colInfo.name || colInfo.name.startsWith('system.')) continue
    const existingCount = await targetConnection.collection(colInfo.name).countDocuments({})
    if (existingCount > 0) {
      throw new AppError(
        409,
        `Refusing non-destructive restore: target collection "${colInfo.name}" already contains ${existingCount} document(s).`
      )
    }
  }
}

function validateTargetConnectionMatchesUriAndNotProdOrSource(params: {
  targetConnection: Connection
  targetUri: string
  productionUri?: string
  sourceDbFingerprint?: SourceDbFingerprint
  encryptionKey?: Buffer
}): { targetIdentity: ParsedMongoUriIdentity; connectedIdentity: ParsedMongoUriIdentity } {
  const targetIdentity = normalizeMongoTargetIdentity(params.targetUri)
  const prodUri = (params.productionUri ?? process.env.MONGODB_URI ?? '').trim()
  const prodIdentity = normalizeMongoTargetIdentity(prodUri)
  const connectedIdentity = extractConnectionIdentity(params.targetConnection)

  // Fail closed if driver cannot verify connected DB name or hosts
  if (!connectedIdentity.dbName || connectedIdentity.dbName !== targetIdentity.dbName) {
    throw new AppError(
      403,
      `Refusing restore: targetConnection database ("${connectedIdentity.dbName || '<unknown>'}") does not match RESTORE_TARGET_MONGODB_URI ("${targetIdentity.dbName}").`
    )
  }
  if (connectedIdentity.hosts.length === 0) {
    throw new AppError(
      403,
      'Refusing restore: unable to determine connected target cluster host identity from database driver.'
    )
  }

  // Verify actual targetConnection agrees with declared targetUri
  const uriHostSet = new Set(targetIdentity.hosts)
  const uriHostnameSet = new Set(targetIdentity.hosts.map(extractHostnameFromNormalizedKey))
  const hostMatchWithUri = connectedIdentity.hosts.some(
    (h) => uriHostSet.has(h) || uriHostnameSet.has(extractHostnameFromNormalizedKey(h))
  )
  const clusterSuffixMatchWithUri =
    Boolean(connectedIdentity.clusterSuffix) && connectedIdentity.clusterSuffix === targetIdentity.clusterSuffix

  if (!hostMatchWithUri && !clusterSuffixMatchWithUri) {
    throw new AppError(
      403,
      'Refusing restore: targetConnection cluster host identity does not match RESTORE_TARGET_MONGODB_URI.'
    )
  }

  // Independently verify connected targetConnection is isolated from production MONGODB_URI
  assertIdentitiesAreIsolated(connectedIdentity, prodIdentity, 'connected targetConnection')

  // Verify BOTH targetUri and actual targetConnection do not match encrypted source DB fingerprint
  if (params.sourceDbFingerprint && params.encryptionKey) {
    assertTargetDoesNotMatchSourceFingerprint(
      targetIdentity,
      params.sourceDbFingerprint,
      params.encryptionKey,
      'target database'
    )
    assertTargetDoesNotMatchSourceFingerprint(
      connectedIdentity,
      params.sourceDbFingerprint,
      params.encryptionKey,
      'connected targetConnection'
    )
  }

  return { targetIdentity, connectedIdentity }
}

async function finalizeRestoreIndexesAndVerify(params: {
  targetConnection: Connection
  expectedCounts: Record<string, number>
  restoredCounts: Record<string, number>
  totalRestored: number
}): Promise<RestoreExecutionResult> {
  // Safe index creation ONLY (NEVER use syncIndexes(), which drops unrelated/custom indexes)
  const preservedIndexesByCollection: Record<string, string[]> = {}
  for (const spec of DURABLE_MODEL_SPECS) {
    const schemaIndexes = spec.model.schema.indexes()
    const col = params.targetConnection.collection(spec.collectionName)
    for (const [fields, indexOptions] of schemaIndexes) {
      const normalizedOptions = indexOptions
        ? {
            ...indexOptions,
            ...(indexOptions.unique !== undefined ? { unique: Boolean(indexOptions.unique) } : {}),
          }
        : undefined
      await col.createIndex(
        fields as Record<string, 1 | -1 | 'text'>,
        normalizedOptions as mongoose.mongo.CreateIndexesOptions | undefined
      )
    }
    const colExists =
      (
        await params.targetConnection.db!
          .listCollections({ name: spec.collectionName }, { nameOnly: true })
          .toArray()
      ).length > 0
    if (colExists) {
      const resultingIndexes = await col.indexes()
      preservedIndexesByCollection[spec.collectionName] = resultingIndexes.map((idx) => String(idx.name))
    } else {
      preservedIndexesByCollection[spec.collectionName] = []
    }
  }

  // Post-restore cross-reference and integrity verification
  const consistencyReport = await verifyRestoredDatabaseIntegrity(
    params.targetConnection,
    params.expectedCounts,
    preservedIndexesByCollection
  )

  if (
    !consistencyReport.countsMatched ||
    consistencyReport.integrityViolations.length > 0 ||
    consistencyReport.consistencyWarnings.length > 0
  ) {
    throw new RestoreConsistencyError(
      `Restore integrity verification failed (${consistencyReport.consistencyWarnings.length} issue(s))`,
      consistencyReport,
      params.restoredCounts,
      params.totalRestored
    )
  }

  return {
    restoredCounts: params.restoredCounts,
    totalRestored: params.totalRestored,
    consistencyReport,
  }
}

export async function restoreEncryptedBackupToIsolatedTarget(params: {
  encryptedBuffer: Buffer
  targetConnection: Connection
  targetUri: string
  productionUri?: string
  encryptionKeyHex?: string
}): Promise<RestoreExecutionResult> {
  // 1. Strict guard against targeting production DB regardless of flags (fail closed before touching target DB)
  assertSafeRestoreTargetUri(params.targetUri, params.productionUri)

  if (params.targetConnection.readyState !== 1 || !params.targetConnection.db) {
    throw new AppError(503, 'Target MongoDB connection is not ready')
  }

  const key = resolveBackupKey(params.encryptionKeyHex)
  const minLength = BACKUP_MAGIC.length + 1 + 12 + 16 + 1
  if (!Buffer.isBuffer(params.encryptedBuffer) || params.encryptedBuffer.length < minLength) {
    throw new AppError(422, 'Backup archive is truncated or malformed')
  }
  const magic = params.encryptedBuffer.subarray(0, BACKUP_MAGIC.length)
  const versionByte = params.encryptedBuffer.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 1)
  const version = validateHeaderMagicAndVersion(magic, versionByte)

  if (version === BACKUP_FORMAT_VERSION_V1) {
    const { payload } = decryptAndVerifyBackup(params.encryptedBuffer, params.encryptionKeyHex)
    validateTargetConnectionMatchesUriAndNotProdOrSource({
      targetConnection: params.targetConnection,
      targetUri: params.targetUri,
      productionUri: params.productionUri,
      sourceDbFingerprint: payload.sourceDbFingerprint,
      encryptionKey: key,
    })
    await verifyTargetDatabaseIsEmpty(params.targetConnection)

    const restoredCounts: Record<string, number> = {}
    let totalRestored = 0
    for (const spec of DURABLE_MODEL_SPECS) {
      const docs = (payload.collections[spec.collectionName] || []) as Record<string, unknown>[]
      for (let offset = 0; offset < docs.length; offset += BACKUP_CURSOR_BATCH_SIZE) {
        const chunk = docs.slice(offset, offset + BACKUP_CURSOR_BATCH_SIZE)
        if (chunk.length > 0) {
          await params.targetConnection.collection(spec.collectionName).insertMany(chunk, { ordered: true })
        }
      }
      restoredCounts[spec.collectionName] = docs.length
      totalRestored += docs.length
    }

    return finalizeRestoreIndexesAndVerify({
      targetConnection: params.targetConnection,
      expectedCounts: payload.collectionCounts,
      restoredCounts,
      totalRestored,
    })
  }

  // V2 Two-pass bounded streaming restore:
  // Pass 1 validates GCM tag, checksum, source fingerprint, and boundaries without storing docs in RAM
  const ivStart = BACKUP_MAGIC.length + 1
  const cipherStart = ivStart + 12
  const tagStart = params.encryptedBuffer.length - 16
  if (tagStart <= cipherStart) {
    throw new AppError(422, 'Backup archive is truncated or malformed')
  }
  const iv = params.encryptedBuffer.subarray(ivStart, cipherStart)
  const ciphertext = params.encryptedBuffer.subarray(cipherStart, tagStart)
  const authTag = params.encryptedBuffer.subarray(tagStart)
  const aad = Buffer.concat([magic, versionByte])

  const { header, normalizedCounts } = await streamProcessV2Source({
    ciphertextInput: { kind: 'buffer', buffer: ciphertext },
    iv,
    authTag,
    aad,
    key,
  })

  validateTargetConnectionMatchesUriAndNotProdOrSource({
    targetConnection: params.targetConnection,
    targetUri: params.targetUri,
    productionUri: params.productionUri,
    sourceDbFingerprint: header.sourceDbFingerprint,
    encryptionKey: key,
  })

  await verifyTargetDatabaseIsEmpty(params.targetConnection)

  // Pass 2 streams document batches directly to target collections in BACKUP_CURSOR_BATCH_SIZE chunks
  const restoredCounts: Record<string, number> = {}
  let totalRestored = 0
  let currentCollection = ''
  let batch: Record<string, unknown>[] = []

  const flushBatch = async () => {
    if (batch.length === 0 || !currentCollection) return
    await params.targetConnection.collection(currentCollection).insertMany(batch, { ordered: true })
    restoredCounts[currentCollection] = (restoredCounts[currentCollection] || 0) + batch.length
    totalRestored += batch.length
    batch = []
  }

  await streamProcessV2Source({
    ciphertextInput: { kind: 'buffer', buffer: ciphertext },
    iv,
    authTag,
    aad,
    key,
    onDoc: async (collection, doc) => {
      if (currentCollection && currentCollection !== collection) {
        await flushBatch()
      }
      currentCollection = collection
      batch.push(doc as Record<string, unknown>)
      if (batch.length >= BACKUP_CURSOR_BATCH_SIZE) {
        await flushBatch()
      }
    },
  })
  await flushBatch()

  for (const spec of DURABLE_MODEL_SPECS) {
    if (restoredCounts[spec.collectionName] === undefined) {
      restoredCounts[spec.collectionName] = 0
    }
  }

  return finalizeRestoreIndexesAndVerify({
    targetConnection: params.targetConnection,
    expectedCounts: normalizedCounts,
    restoredCounts,
    totalRestored,
  })
}

export async function restoreEncryptedBackupFromFile(params: {
  filePath: string
  targetConnection: Connection
  targetUri: string
  productionUri?: string
  encryptionKeyHex?: string
}): Promise<RestoreExecutionResult> {
  assertSafeRestoreTargetUri(params.targetUri, params.productionUri)
  if (params.targetConnection.readyState !== 1 || !params.targetConnection.db) {
    throw new AppError(503, 'Target MongoDB connection is not ready')
  }

  const stat = await fs.stat(params.filePath)
  const minLength = BACKUP_MAGIC.length + 1 + 12 + 16 + 1
  if (stat.size < minLength) {
    throw new AppError(422, 'Backup archive is truncated or malformed')
  }

  const fh = await fs.open(params.filePath, 'r')
  const headerBuf = Buffer.alloc(BACKUP_MAGIC.length + 1 + 12)
  const tagBuf = Buffer.alloc(16)
  let version: 1 | 2
  try {
    await fh.read(headerBuf, 0, headerBuf.length, 0)
    await fh.read(tagBuf, 0, 16, stat.size - 16)
    const magic = headerBuf.subarray(0, BACKUP_MAGIC.length)
    const versionByte = headerBuf.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 1)
    version = validateHeaderMagicAndVersion(magic, versionByte)
  } finally {
    await fh.close()
  }

  if (version === BACKUP_FORMAT_VERSION_V1) {
    const encryptedBuffer = await fs.readFile(params.filePath)
    return restoreEncryptedBackupToIsolatedTarget({
      encryptedBuffer,
      targetConnection: params.targetConnection,
      targetUri: params.targetUri,
      productionUri: params.productionUri,
      encryptionKeyHex: params.encryptionKeyHex,
    })
  }

  const key = resolveBackupKey(params.encryptionKeyHex)
  const magic = headerBuf.subarray(0, BACKUP_MAGIC.length)
  const versionByte = headerBuf.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 1)
  const iv = headerBuf.subarray(BACKUP_MAGIC.length + 1)
  const aad = Buffer.concat([magic, versionByte])

  const { header, normalizedCounts } = await streamProcessV2Source({
    ciphertextInput: { kind: 'file', filePath: params.filePath, totalSize: stat.size },
    iv,
    authTag: tagBuf,
    aad,
    key,
  })

  validateTargetConnectionMatchesUriAndNotProdOrSource({
    targetConnection: params.targetConnection,
    targetUri: params.targetUri,
    productionUri: params.productionUri,
    sourceDbFingerprint: header.sourceDbFingerprint,
    encryptionKey: key,
  })

  await verifyTargetDatabaseIsEmpty(params.targetConnection)

  const restoredCounts: Record<string, number> = {}
  let totalRestored = 0
  let currentCollection = ''
  let batch: Record<string, unknown>[] = []

  const flushBatch = async () => {
    if (batch.length === 0 || !currentCollection) return
    await params.targetConnection.collection(currentCollection).insertMany(batch, { ordered: true })
    restoredCounts[currentCollection] = (restoredCounts[currentCollection] || 0) + batch.length
    totalRestored += batch.length
    batch = []
  }

  await streamProcessV2Source({
    ciphertextInput: { kind: 'file', filePath: params.filePath, totalSize: stat.size },
    iv,
    authTag: tagBuf,
    aad,
    key,
    onDoc: async (collection, doc) => {
      if (currentCollection && currentCollection !== collection) {
        await flushBatch()
      }
      currentCollection = collection
      batch.push(doc as Record<string, unknown>)
      if (batch.length >= BACKUP_CURSOR_BATCH_SIZE) {
        await flushBatch()
      }
    },
  })
  await flushBatch()

  for (const spec of DURABLE_MODEL_SPECS) {
    if (restoredCounts[spec.collectionName] === undefined) {
      restoredCounts[spec.collectionName] = 0
    }
  }

  return finalizeRestoreIndexesAndVerify({
    targetConnection: params.targetConnection,
    expectedCounts: normalizedCounts,
    restoredCounts,
    totalRestored,
  })
}

export async function verifyRestoredDatabaseIntegrity(
  targetConnection: Connection,
  expectedCounts: Record<string, number>,
  preservedIndexesByCollection: Record<string, string[]> = {}
): Promise<RestoreConsistencyReport> {
  const restoredCounts: Record<string, number> = {}
  const integrityViolations: IntegrityViolation[] = []
  const consistencyWarnings: string[] = []
  let countsMatched = true

  const recordViolation = (collection: string, documentId: unknown, field: string, missingRef: unknown): void => {
    const docIdStr = String(documentId)
    const refStr = String(missingRef)
    const message = `${collection} (${docIdStr}) field "${field}" references missing ${refStr}`
    integrityViolations.push({
      collection,
      documentId: docIdStr,
      field,
      missingRef: refStr,
      message,
    })
    consistencyWarnings.push(message)
  }

  const checkOptionalRef = (
    collection: string,
    documentId: unknown,
    field: string,
    refValue: unknown,
    validIds: Set<string>
  ): void => {
    if (refValue === undefined || refValue === null || String(refValue) === '') return
    const refStr = String(refValue)
    if (!validIds.has(refStr)) {
      recordViolation(collection, documentId, field, refStr)
    }
  }

  const checkRefArray = (
    collection: string,
    documentId: unknown,
    field: string,
    refs: unknown,
    validIds: Set<string>
  ): void => {
    if (!Array.isArray(refs)) return
    for (const refValue of refs) {
      if (refValue === undefined || refValue === null || String(refValue) === '') continue
      const refStr = String(refValue)
      if (!validIds.has(refStr)) {
        recordViolation(collection, documentId, field, refStr)
      }
    }
  }

  for (const spec of DURABLE_MODEL_SPECS) {
    const actualCount = await targetConnection.collection(spec.collectionName).countDocuments({})
    restoredCounts[spec.collectionName] = actualCount
    const expected = expectedCounts[spec.collectionName] ?? 0
    if (actualCount !== expected) {
      countsMatched = false
      consistencyWarnings.push(
        `Count mismatch for "${spec.collectionName}": expected ${expected}, restored ${actualCount}`
      )
    }
  }

  // Pass 1: Gather primary key sets using memory-bounded cursor scans
  const userIds = new Set<string>()
  let totalUsers = 0
  let usersWithPasswordHash = 0
  for await (const u of targetConnection
    .collection('users')
    .find({})
    .project({ _id: 1, passwordHash: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    userIds.add(String(u._id))
    totalUsers += 1
    if (typeof u.passwordHash === 'string' && u.passwordHash.length > 0) {
      usersWithPasswordHash += 1
    }
  }
  if (usersWithPasswordHash !== totalUsers) {
    consistencyWarnings.push(`${totalUsers - usersWithPasswordHash} user(s) missing passwordHash after restore`)
  }

  const organizationIds = new Set<string>()
  for await (const org of targetConnection
    .collection('organizations')
    .find({})
    .project({ _id: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    organizationIds.add(String(org._id))
  }

  const categoryIds = new Set<string>()
  for await (const cat of targetConnection
    .collection('categories')
    .find({})
    .project({ _id: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    categoryIds.add(String(cat._id))
  }

  const fileAssetIds = new Set<string>()
  for await (const asset of targetConnection
    .collection('fileassets')
    .find({})
    .project({ _id: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    fileAssetIds.add(String(asset._id))
  }

  const clientIds = new Set<string>()
  for await (const client of targetConnection
    .collection('clients')
    .find({})
    .project({ _id: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    clientIds.add(String(client._id))
  }

  const visitIds = new Set<string>()
  for await (const visit of targetConnection
    .collection('visits')
    .find({})
    .project({ _id: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    visitIds.add(String(visit._id))
  }

  // Pass 2: Validate all cross-collection references
  for await (const u of targetConnection
    .collection('users')
    .find({})
    .project({ _id: 1, reportingTo: 1, avatarAsset: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    checkOptionalRef('users', u._id, 'reportingTo', u.reportingTo, userIds)
    checkOptionalRef('users', u._id, 'avatarAsset', u.avatarAsset, fileAssetIds)
  }

  for await (const org of targetConnection
    .collection('organizations')
    .find({})
    .project({ _id: 1, expandedLogoAsset: 1, collapsedLogoAsset: 1, updatedBy: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    checkOptionalRef('organizations', org._id, 'expandedLogoAsset', org.expandedLogoAsset, fileAssetIds)
    checkOptionalRef('organizations', org._id, 'collapsedLogoAsset', org.collapsedLogoAsset, fileAssetIds)
    checkOptionalRef('organizations', org._id, 'updatedBy', org.updatedBy, userIds)
  }

  for await (const client of targetConnection
    .collection('clients')
    .find({})
    .project({ _id: 1, createdBy: 1, categoryId: 1, visitingCardAsset: 1, documentAssets: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    checkOptionalRef('clients', client._id, 'createdBy', client.createdBy, userIds)
    checkOptionalRef('clients', client._id, 'categoryId', client.categoryId, categoryIds)
    checkOptionalRef('clients', client._id, 'visitingCardAsset', client.visitingCardAsset, fileAssetIds)
    checkRefArray('clients', client._id, 'documentAssets', client.documentAssets, fileAssetIds)
  }

  for await (const visit of targetConnection
    .collection('visits')
    .find({})
    .project({
      _id: 1,
      client: 1,
      assignedTo: 1,
      assignedBy: 1,
      marketingHeadAtAssignment: 1,
      cancelledBy: 1,
      exceptionAuthorizedBy: 1,
      'checkIn.exceptionApprovedBy': 1,
      'checkOut.exceptionApprovedBy': 1,
      photoAssets: 1,
      attachmentAssets: 1,
    })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    checkOptionalRef('visits', visit._id, 'client', visit.client, clientIds)
    checkOptionalRef('visits', visit._id, 'assignedTo', visit.assignedTo, userIds)
    checkOptionalRef('visits', visit._id, 'assignedBy', visit.assignedBy, userIds)
    checkOptionalRef('visits', visit._id, 'marketingHeadAtAssignment', visit.marketingHeadAtAssignment, userIds)
    checkOptionalRef('visits', visit._id, 'cancelledBy', visit.cancelledBy, userIds)
    checkOptionalRef('visits', visit._id, 'exceptionAuthorizedBy', visit.exceptionAuthorizedBy, userIds)
    checkOptionalRef(
      'visits',
      visit._id,
      'checkIn.exceptionApprovedBy',
      (visit.checkIn as { exceptionApprovedBy?: unknown } | undefined)?.exceptionApprovedBy,
      userIds
    )
    checkOptionalRef(
      'visits',
      visit._id,
      'checkOut.exceptionApprovedBy',
      (visit.checkOut as { exceptionApprovedBy?: unknown } | undefined)?.exceptionApprovedBy,
      userIds
    )
    checkRefArray('visits', visit._id, 'photoAssets', visit.photoAssets, fileAssetIds)
    checkRefArray('visits', visit._id, 'attachmentAssets', visit.attachmentAssets, fileAssetIds)
  }

  let pendingOrganizationLogosCount = 0
  for await (const asset of targetConnection
    .collection('fileassets')
    .find({})
    .project({ _id: 1, uploadedBy: 1, ownerType: 1, ownerId: 1, isArchived: 1, metadata: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    checkOptionalRef('fileassets', asset._id, 'uploadedBy', asset.uploadedBy, userIds)

    // Archived assets are pending orphan cleanup and may no longer have active owner records
    if (asset.isArchived === true) continue

    const ownerType = String(asset.ownerType || '')
    const ownerId = asset.ownerId
    const ownershipStatus = (asset.metadata as { ownershipStatus?: string } | undefined)?.ownershipStatus

    if (ownerId === undefined || ownerId === null || String(ownerId) === '') {
      recordViolation('fileassets', asset._id, 'ownerId', '<missing>')
      continue
    }

    switch (ownerType) {
      case 'USER_AVATAR':
        checkOptionalRef('fileassets', asset._id, 'ownerId', ownerId, userIds)
        break
      case 'CLIENT_VISITING_CARD':
      case 'CLIENT_DOCUMENT':
        checkOptionalRef('fileassets', asset._id, 'ownerId', ownerId, clientIds)
        break
      case 'VISIT_PHOTO':
      case 'VISIT_ATTACHMENT':
        checkOptionalRef('fileassets', asset._id, 'ownerId', ownerId, visitIds)
        break
      case 'ORGANIZATION_EXPANDED_LOGO':
      case 'ORGANIZATION_COLLAPSED_LOGO':
        if (
          ownershipStatus === 'PENDING_ORGANIZATION' &&
          String(ownerId) === PENDING_ORGANIZATION_OWNER_ID
        ) {
          pendingOrganizationLogosCount += 1
        } else {
          checkOptionalRef('fileassets', asset._id, 'ownerId', ownerId, organizationIds)
        }
        break
      case 'GENERAL':
        break
      default:
        recordViolation('fileassets', asset._id, 'ownerType', ownerType || '<missing>')
        break
    }
  }

  for await (const task of targetConnection
    .collection('followuptasks')
    .find({})
    .project({
      _id: 1,
      sourceVisit: 1,
      client: 1,
      assignedTo: 1,
      marketingHeadAtCreation: 1,
      completedBy: 1,
      cancelledBy: 1,
    })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    checkOptionalRef('followuptasks', task._id, 'sourceVisit', task.sourceVisit, visitIds)
    checkOptionalRef('followuptasks', task._id, 'client', task.client, clientIds)
    checkOptionalRef('followuptasks', task._id, 'assignedTo', task.assignedTo, userIds)
    checkOptionalRef('followuptasks', task._id, 'marketingHeadAtCreation', task.marketingHeadAtCreation, userIds)
    checkOptionalRef('followuptasks', task._id, 'completedBy', task.completedBy, userIds)
    checkOptionalRef('followuptasks', task._id, 'cancelledBy', task.cancelledBy, userIds)
  }

  for await (const notif of targetConnection
    .collection('notifications')
    .find({})
    .project({ _id: 1, recipient: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    checkOptionalRef('notifications', notif._id, 'recipient', notif.recipient, userIds)
  }

  for await (const audit of targetConnection
    .collection('auditevents')
    .find({})
    .project({ _id: 1, actor: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    checkOptionalRef('auditevents', audit._id, 'actor', audit.actor, userIds)
  }

  let pushSubscriptionsCount = 0
  for await (const sub of targetConnection
    .collection('pushsubscriptions')
    .find({})
    .project({ _id: 1, user: 1 })
    .batchSize(BACKUP_CURSOR_BATCH_SIZE)) {
    pushSubscriptionsCount += 1
    checkOptionalRef('pushsubscriptions', sub._id, 'user', sub.user, userIds)
  }

  return {
    countsMatched,
    restoredCounts,
    expectedCounts,
    usersWithPasswordHash,
    totalUsers,
    pushSubscriptionsCount,
    pendingOrganizationLogosCount,
    preservedIndexesByCollection,
    integrityViolations,
    consistencyWarnings,
  }
}

export async function reconcileCloudinaryMetadata(
  dbConnection: Connection = mongoose.connection,
  options?: { maxPages?: number; maxDurationMs?: number; maxResults?: number }
): Promise<CloudinaryReconciliationReport> {
  if (dbConnection.readyState !== 1 || !dbConnection.db) {
    throw new AppError(503, 'MongoDB connection is not ready for storage reconciliation')
  }

  const provider = getStorageProvider()
  const isLiveCloudinary = provider.name === 'Cloudinary'

  const activeAssets: Array<{
    _id: unknown
    cloudinaryPublicId?: unknown
    cloudinaryResourceType?: unknown
    resourceType?: unknown
    ownerType?: unknown
    ownerId?: unknown
    secureStorageReference?: unknown
  }> = []
  const dbAllCompositeKeys = new Set<string>()
  const dbAllPublicIds = new Set<string>()

  // Scan ALL fileassets records via cursor batching — no silent 500 or 2000 document truncation
  const assetCursor = dbConnection
    .collection('fileassets')
    .find({})
    .project({
      _id: 1,
      cloudinaryPublicId: 1,
      cloudinaryResourceType: 1,
      resourceType: 1,
      ownerType: 1,
      ownerId: 1,
      secureStorageReference: 1,
      isArchived: 1,
    })
    .batchSize(250)

  for await (const doc of assetCursor) {
    if (doc.cloudinaryPublicId) {
      const pubId = String(doc.cloudinaryPublicId)
      const rType = String(doc.cloudinaryResourceType || doc.resourceType || 'image')
      dbAllPublicIds.add(pubId)
      dbAllCompositeKeys.add(`${rType}:authenticated:${pubId}`)
    }
    if (doc.isArchived === false) {
      activeAssets.push({
        _id: doc._id,
        cloudinaryPublicId: doc.cloudinaryPublicId,
        cloudinaryResourceType: doc.cloudinaryResourceType,
        resourceType: doc.resourceType,
        ownerType: doc.ownerType,
        ownerId: doc.ownerId,
        secureStorageReference: doc.secureStorageReference,
      })
    }
  }

  const archivedPending = await dbConnection
    .collection('fileassets')
    .countDocuments({ isArchived: true, 'metadata.pendingCloudDelete': true })

  const dedupedCloudMap = new Map<
    string,
    { publicId: string; resourceType: string; deliveryType: string; bytes: number }
  >()
  let complete = true
  let truncated = false
  let scanError: string | undefined

  if (typeof provider.listAllAssetsByPrefix === 'function') {
    try {
      const [images, raws] = await Promise.all([
        provider.listAllAssetsByPrefix('etech_crm/', 'image', options),
        provider.listAllAssetsByPrefix('etech_crm/', 'raw', options),
      ])
      for (const item of [...images.items, ...raws.items]) {
        const deliveryType = item.type || 'authenticated'
        const compositeKey = `${item.resourceType}:${deliveryType}:${item.publicId}`
        if (!dedupedCloudMap.has(compositeKey)) {
          dedupedCloudMap.set(compositeKey, {
            publicId: item.publicId,
            resourceType: item.resourceType,
            deliveryType,
            bytes: item.bytes,
          })
        }
      }
      if (images.truncated || raws.truncated) {
        complete = false
        truncated = true
        const reasons = [images.terminationReason, raws.terminationReason]
          .filter((r) => r && r !== 'COMPLETED')
          .join(', ')
        scanError = `Cloud asset enumeration incomplete (${reasons || 'truncated'})`
      }
    } catch (err) {
      complete = false
      truncated = true
      scanError = err instanceof Error ? err.message : 'Cloud asset enumeration failed'
    }
  } else if (typeof provider.listAssetsByPrefix === 'function') {
    // Bounded fallback cannot guarantee complete enumeration — never mark complete=true or emit false missingInCloud
    complete = false
    truncated = true
    scanError = 'Storage provider only implements bounded listAssetsByPrefix; complete cloud scan unavailable'
    try {
      const [images, raws] = await Promise.all([
        provider.listAssetsByPrefix('etech_crm/', 'image'),
        provider.listAssetsByPrefix('etech_crm/', 'raw'),
      ])
      for (const item of [...images, ...raws]) {
        const deliveryType = item.type || 'authenticated'
        const compositeKey = `${item.resourceType}:${deliveryType}:${item.publicId}`
        if (!dedupedCloudMap.has(compositeKey)) {
          dedupedCloudMap.set(compositeKey, {
            publicId: item.publicId,
            resourceType: item.resourceType,
            deliveryType,
            bytes: item.bytes,
          })
        }
      }
    } catch (err) {
      scanError = err instanceof Error ? err.message : 'Cloud asset enumeration failed'
    }
  } else if (isLiveCloudinary) {
    complete = false
    truncated = true
    scanError = 'Cloud storage provider does not implement asset listing'
  }

  const uniqueCloudItems = Array.from(dedupedCloudMap.values())
  const unregisteredInDb = uniqueCloudItems
    .filter((item) => {
      const compositeKey = `${item.resourceType}:${item.deliveryType}:${item.publicId}`
      return !dbAllCompositeKeys.has(compositeKey) && !dbAllPublicIds.has(item.publicId)
    })
    .map((item) => ({
      publicId: item.publicId,
      resourceType: item.resourceType,
      deliveryType: item.deliveryType,
      bytes: item.bytes,
    }))

  // CRITICAL: Only classify assets as missingInCloud when cloud enumeration completed cleanly without truncation or errors
  const missingInCloud: CloudinaryReconciliationReport['missingInCloud'] = []
  if (complete && (uniqueCloudItems.length > 0 || activeAssets.length > 0) && typeof provider.listAllAssetsByPrefix === 'function') {
    for (const asset of activeAssets) {
      const isMockRef = String(asset.secureStorageReference || '').includes('mock-storage.local')
      if (isLiveCloudinary && isMockRef) continue
      const pubId = String(asset.cloudinaryPublicId || '')
      if (!pubId) continue
      const rType = String(asset.cloudinaryResourceType || asset.resourceType || 'image')
      const deliveryType = 'authenticated'
      const compositeKey = `${rType}:${deliveryType}:${pubId}`
      if (!dedupedCloudMap.has(compositeKey)) {
        missingInCloud.push({
          assetId: String(asset._id),
          publicId: pubId,
          resourceType: rType,
          deliveryType,
          ownerType: String(asset.ownerType || ''),
          ownerId: String(asset.ownerId || ''),
        })
      }
    }
  }

  return {
    storageProvider: provider.name,
    complete,
    truncated,
    ...(scanError ? { scanError } : {}),
    activeDbAssets: activeAssets.length,
    cloudAssetsScanned: uniqueCloudItems.length,
    missingInCloud,
    unregisteredInDb,
    archivedPendingCloudDelete: archivedPending,
  }
}
