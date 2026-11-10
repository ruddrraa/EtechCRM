import path from 'node:path'
import 'dotenv/config'
import mongoose from 'mongoose'
import { ATLAS_M0_POOL_OPTIONS } from '../config/db.js'
import {
  assertSafeRestoreTargetUri,
  reconcileCloudinaryMetadata,
  RestoreConsistencyError,
  restoreEncryptedBackupFromFile,
} from '../services/backup.js'
import { maskSensitiveText } from '../middleware/error.js'

async function main() {
  const fileArg = process.argv[2]?.trim()
  if (!fileArg) {
    throw new Error('Usage: npm run restore:db:verify -- <path-to-backup.enc>')
  }

  const targetUri = process.env.RESTORE_TARGET_MONGODB_URI?.trim() || ''
  assertSafeRestoreTargetUri(targetUri, process.env.MONGODB_URI)

  const backupPath = path.resolve(process.cwd(), fileArg)

  const targetConn = await mongoose.createConnection(targetUri, ATLAS_M0_POOL_OPTIONS).asPromise()
  try {
    let result: Awaited<ReturnType<typeof restoreEncryptedBackupFromFile>>
    try {
      result = await restoreEncryptedBackupFromFile({
        filePath: backupPath,
        targetConnection: targetConn,
        targetUri,
        productionUri: process.env.MONGODB_URI,
      })
    } catch (err) {
      if (err instanceof RestoreConsistencyError) {
        console.warn('[Restore Verify] Integrity Verification Warnings:', err.consistencyReport.consistencyWarnings)
        process.exitCode = 1
        return
      }
      throw err
    }

    let cloudReport: Awaited<ReturnType<typeof reconcileCloudinaryMetadata>> | null = null
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      cloudReport = await reconcileCloudinaryMetadata(targetConn)
    }

    console.log('[Restore Verify] Non-destructive restore verification completed:', {
      file: path.relative(process.cwd(), backupPath),
      totalRestored: result.totalRestored,
      countsMatched: result.consistencyReport.countsMatched,
      usersWithPasswordHash: result.consistencyReport.usersWithPasswordHash,
      totalUsers: result.consistencyReport.totalUsers,
      consistencyWarningsCount: result.consistencyReport.consistencyWarnings.length,
      ...(cloudReport
        ? {
            cloudinaryReconciliation: {
              complete: cloudReport.complete,
              truncated: cloudReport.truncated,
              activeDbAssets: cloudReport.activeDbAssets,
              cloudAssetsScanned: cloudReport.cloudAssetsScanned,
              missingInCloudCount: cloudReport.missingInCloud.length,
              unregisteredInDbCount: cloudReport.unregisteredInDb.length,
              archivedPendingCloudDelete: cloudReport.archivedPendingCloudDelete,
            },
          }
        : {}),
    })

    if (cloudReport && !cloudReport.complete) {
      console.warn(
        '[Restore Verify] Cloudinary reconciliation did not complete cleanly (truncated/errored); missingInCloud was skipped.'
      )
      process.exitCode = 1
    }
  } finally {
    await targetConn.close().catch(() => {})
  }
}

main().catch((err) => {
  const msg = maskSensitiveText(err instanceof Error ? err.message : String(err))
  console.error('[Restore Verify] Failed:', msg)
  process.exit(1)
})

