import path from 'node:path'
import 'dotenv/config'
import mongoose from 'mongoose'
import { ATLAS_M0_POOL_OPTIONS } from '../config/db.js'
import { createEncryptedBackupToFile, verifyBackupFile } from '../services/backup.js'
import { maskSensitiveText } from '../middleware/error.js'

async function main() {
  const uri = process.env.MONGODB_URI?.trim()
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is required')
  }

  const args = process.argv.slice(2)
  const shouldVerify = args.includes('--verify')
  const outArg = args.find((a) => !a.startsWith('--'))?.trim()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.resolve(process.cwd(), 'backups')
  const outPath = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.join(backupDir, `etechcrm-backup-${timestamp}.enc`)

  const conn = await mongoose.createConnection(uri, ATLAS_M0_POOL_OPTIONS).asPromise()
  try {
    const result = await createEncryptedBackupToFile(outPath, conn)

    let verified = false
    if (shouldVerify) {
      await verifyBackupFile(outPath)
      verified = true
    }

    console.log('[Backup] Encrypted logical backup created:', {
      file: path.relative(process.cwd(), outPath),
      bytes: result.bytesWritten,
      verified,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
    })
  } finally {
    await conn.close().catch(() => {})
  }
}

main().catch((err) => {
  const msg = maskSensitiveText(err instanceof Error ? err.message : String(err))
  console.error('[Backup] Failed:', msg)
  process.exit(1)
})

