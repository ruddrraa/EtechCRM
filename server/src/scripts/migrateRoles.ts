import { connectDatabase } from '../config/db.js'
import { migrateLegacyRoles } from '../services/migration.js'
import mongoose from 'mongoose'

async function main() {
  await connectDatabase()
  const result = await migrateLegacyRoles()
  console.log('[Migration] Legacy role migration result:', result)
  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error('[Migration] Failed:', err instanceof Error ? err.message : String(err))
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})

