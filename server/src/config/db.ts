import mongoose from 'mongoose'
import { env } from './env.js'
import { migrateLegacyRoles } from '../services/migration.js'

let connectionPromise: Promise<typeof mongoose> | null = null

export function connectDatabase() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose)
  connectionPromise ??= mongoose.connect(env.MONGODB_URI).then(async (connection) => {
    await migrateLegacyRoles()
    return connection
  })
  return connectionPromise
}
