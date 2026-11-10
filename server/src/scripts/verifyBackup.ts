import fs from 'node:fs/promises'
import path from 'node:path'
import 'dotenv/config'
import { verifyBackupFile } from '../services/backup.js'
import { maskSensitiveText } from '../middleware/error.js'

async function findLatestBackupFile(): Promise<string> {
  const backupDir = path.resolve(process.cwd(), 'backups')
  const entries = await fs.readdir(backupDir)
  const encFiles = entries.filter((f) => f.endsWith('.enc')).sort()
  if (!encFiles.length) {
    throw new Error('No encrypted .enc backup files found in backups/ and no file argument provided')
  }
  return path.join(backupDir, encFiles[encFiles.length - 1])
}

async function main() {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose')
  const fileArg = args.find((a) => !a.startsWith('--'))?.trim()
  const targetFile = fileArg ? path.resolve(process.cwd(), fileArg) : await findLatestBackupFile()

  const verification = await verifyBackupFile(targetFile)
  console.log('[Backup Verify] Integrity & AES-256-GCM authentication succeeded:', {
    file: path.relative(process.cwd(), targetFile),
    version: verification.version,
    verified: true,
    startedAt: verification.startedAt,
    completedAt: verification.completedAt,
    ...(verbose
      ? {
          totalDocuments: verification.totalDocuments,
          collectionCounts: verification.collectionCounts,
          excludedCollections: verification.excludedCollections,
        }
      : {}),
  })
}

main().catch((err) => {
  const msg = maskSensitiveText(err instanceof Error ? err.message : String(err))
  console.error('[Backup Verify] Failed:', msg)
  process.exit(1)
})

