import { readFileSync } from 'node:fs'
import http from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt'
process.env.JWT_EXPIRES_IN = '1d'
process.env.CLIENT_URL = 'http://localhost:5173'
process.env.NODE_ENV = 'test'
process.env.PORT = '3001'

let mongo: MongoMemoryServer

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
})

beforeEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const { User } = await import('../src/models/User.js')
    await User.deleteMany({})
  }
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongo.stop()
})

describe('Step 1 — Vercel Serverless Architecture & MongoDB Atlas M0 Pooling', () => {
  it('1. vercel.json defines valid API rewrites, SPA fallback, and non-stale caching headers', () => {
    const raw = readFileSync('vercel.json', 'utf8')
    const config = JSON.parse(raw) as {
      outputDirectory: string
      rewrites: Array<{ source: string; destination: string }>
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
      functions: Record<string, { maxDuration: number }>
    }

    expect(config.outputDirectory).toBe('dist')
    expect(config.functions['api/index.ts']?.maxDuration).toBeLessThanOrEqual(10)
    expect(config.rewrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: '/api/(.*)', destination: '/api' }),
        expect.objectContaining({ destination: '/index.html' }),
      ])
    )
    const swHeaders = config.headers.find((h) => h.source === '/sw.js')
    expect(swHeaders?.headers.some((h) => h.key === 'Cache-Control' && h.value.includes('no-cache'))).toBe(true)
    const apiHeaders = config.headers.find((h) => h.source === '/api/(.*)')
    expect(apiHeaders?.headers.some((h) => h.key === 'Cache-Control' && h.value.includes('no-store'))).toBe(true)
  })

  it('2. Importing api/index.ts never invokes app.listen() / net.Server.listen()', async () => {
    const listenSpy = vi.spyOn(http.Server.prototype, 'listen')
    const mod = await import('../../api/index.js')
    expect(typeof mod.default).toBe('function')
    expect(listenSpy).not.toHaveBeenCalled()
    listenSpy.mockRestore()
  })

  it('3. connectDatabase reuses cached connection & concurrent promise with Atlas M0 safe pool limits', async () => {
    await mongoose.disconnect()
    const { connectDatabase, ATLAS_M0_POOL_OPTIONS, getDatabaseCacheStatus } = await import('../src/config/db.js')

    expect(ATLAS_M0_POOL_OPTIONS.maxPoolSize).toBe(5)
    expect(ATLAS_M0_POOL_OPTIONS.serverSelectionTimeoutMS).toBe(5000)
    expect(ATLAS_M0_POOL_OPTIONS.socketTimeoutMS).toBe(20000)

    const connectSpy = vi.spyOn(mongoose, 'connect')

    // Concurrent cold-start calls share the single connection promise
    const [c1, c2, c3] = await Promise.all([connectDatabase(), connectDatabase(), connectDatabase()])
    expect(c1).toBe(c2)
    expect(c2).toBe(c3)
    expect(connectSpy).toHaveBeenCalledTimes(1)

    // Subsequent warm call reuses cached connection without calling mongoose.connect
    const c4 = await connectDatabase()
    expect(c4).toBe(c1)
    expect(connectSpy).toHaveBeenCalledTimes(1)

    const stats = getDatabaseCacheStatus()
    expect(stats.readyState).toBe(1)
    expect(stats.hasCachedConnection).toBe(true)
    expect(stats.poolConfig.maxPoolSize).toBe(5)

    connectSpy.mockRestore()
  })

  it('4. connectDatabase clears stale rejected promise on failure and recovers cleanly', async () => {
    await mongoose.disconnect()
    const { connectDatabase } = await import('../src/config/db.js')

    const connectSpy = vi
      .spyOn(mongoose, 'connect')
      .mockRejectedValueOnce(new Error('mongodb+srv://user:supersecret@cluster0.mongodb.net timed out'))

    await expect(connectDatabase()).rejects.toThrow(/timed out/)
    connectSpy.mockRestore()

    // Second invocation must NOT stay stuck on the rejected promise
    const recovered = await connectDatabase()
    expect(recovered.connection.readyState).toBe(1)
  })

  it('5. Serverless handler reuses Express app, serves /api/health with no-store, and sanitizes DB init errors', async () => {
    const { default: handler, getServerlessApp } = await import('../../api/index.js')
    const app1 = getServerlessApp()
    const app2 = getServerlessApp()
    expect(app1).toBe(app2)

    const server = http.createServer((req, res) => {
      void handler(req, res)
    })

    const okRes = await request(server).get('/api/health')
    expect(okRes.status).toBe(200)
    expect(okRes.headers['cache-control']).toContain('no-store')
    expect(okRes.body.success).toBe(true)
    expect(okRes.body.data.status).toBe('ok')

    // Simulated DB outage returns sanitized 503 without leaking credentials
    await mongoose.disconnect()
    const connectSpy = vi
      .spyOn(mongoose, 'connect')
      .mockRejectedValueOnce(new Error('connect failed mongodb+srv://admin:SecretPass123@cluster.mongodb.net/crm'))
    const errLogSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failRes = await request(server).get('/api/health')
    expect(failRes.status).toBe(503)
    expect(failRes.text).not.toContain('SecretPass123')
    expect(errLogSpy.mock.calls.flat().join(' ')).not.toContain('SecretPass123')
    connectSpy.mockRestore()
    errLogSpy.mockRestore()
    server.close()
    await import('../src/config/db.js').then((m) => m.connectDatabase())
  })

  it('6. migrateLegacyRoles executes zero updateMany writes when no legacy accounts exist', async () => {
    const { connectDatabase } = await import('../src/config/db.js')
    await connectDatabase()
    const { User } = await import('../src/models/User.js')
    const { migrateLegacyRoles } = await import('../src/services/migration.js')

    const updateSpy = vi.spyOn(User, 'updateMany')
    const res1 = await migrateLegacyRoles()
    expect(res1.migrated).toBe(false)
    expect(res1.modifiedCount).toBe(0)
    expect(updateSpy).not.toHaveBeenCalled()

    await User.create({
      name: 'Legacy User',
      email: 'legacy-check@example.com',
      passwordHash: 'hashhashhash',
      role: 'USER',
    })

    const res2 = await migrateLegacyRoles()
    expect(res2.migrated).toBe(true)
    expect(res2.modifiedCount).toBe(1)
    expect(updateSpy).toHaveBeenCalled()
    updateSpy.mockRestore()
  })

  it('7. isAllowedOrigin supports production Vercel origin and rejects arbitrary cross-origins', async () => {
    const { isAllowedOrigin } = await import('../src/middleware/auth.js')
    process.env.VERCEL_URL = 'etech-crm-preview-123.vercel.app'
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('https://etech-crm-preview-123.vercel.app')).toBe(true)
    expect(isAllowedOrigin('https://attacker.vercel.app')).toBe(false)
    delete process.env.VERCEL_URL
  })
})
