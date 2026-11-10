import mongoose from 'mongoose'
import { env } from './env.js'

type MongooseCache = {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
  uri: string | null
  listenersAttached: boolean
}

const globalForMongoose = globalThis as typeof globalThis & {
  __etechMongooseCache?: MongooseCache
}

const cached: MongooseCache = (globalForMongoose.__etechMongooseCache ??= {
  conn: null,
  promise: null,
  uri: null,
  listenersAttached: false,
})

if (!cached.listenersAttached) {
  cached.listenersAttached = true
  mongoose.connection.on('disconnected', () => {
    cached.conn = null
    cached.promise = null
  })
  mongoose.connection.on('error', () => {
    cached.conn = null
    cached.promise = null
  })
}

export const ATLAS_M0_POOL_OPTIONS: mongoose.ConnectOptions = {
  maxPoolSize: 5,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 20000,
}

export async function connectDatabase(uri?: string): Promise<typeof mongoose> {
  const targetUri = uri || process.env.MONGODB_URI || env.MONGODB_URI
  if (!targetUri) {
    throw new Error('MONGODB_URI is required to establish a database connection')
  }

  // Handle explicit URI switches safely (primarily used by automated tests)
  if (cached.uri && cached.uri !== targetUri) {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect()
    }
    cached.conn = null
    cached.promise = null
  }

  if (cached.conn && mongoose.connection.readyState === 1 && cached.uri === targetUri) {
    return cached.conn
  }

  if (!cached.promise) {
    cached.uri = targetUri
    cached.promise = mongoose
      .connect(targetUri, ATLAS_M0_POOL_OPTIONS)
      .then((connection) => {
        cached.conn = connection
        return connection
      })
      .catch((error) => {
        // Clear rejected promise so future warm invocations can recover cleanly
        cached.promise = null
        cached.conn = null
        throw error
      })
  }

  return cached.promise
}

export function getDatabaseCacheStatus() {
  return {
    readyState: mongoose.connection.readyState,
    hasCachedConnection: Boolean(cached.conn),
    hasInFlightPromise: Boolean(cached.promise),
    poolConfig: {
      maxPoolSize: ATLAS_M0_POOL_OPTIONS.maxPoolSize,
      minPoolSize: ATLAS_M0_POOL_OPTIONS.minPoolSize,
      serverSelectionTimeoutMS: ATLAS_M0_POOL_OPTIONS.serverSelectionTimeoutMS,
      socketTimeoutMS: ATLAS_M0_POOL_OPTIONS.socketTimeoutMS,
    },
  }
}
