import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import express from 'express'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MockStorageProvider } from '../src/services/storage/mock.provider.js'
import { setStorageProvider } from '../src/services/storage/storage.service.js'
import { requestContextMiddleware, resolveRequestId } from '../src/middleware/requestContext.js'
import { maskSensitiveText } from '../src/middleware/error.js'
import { apiFetch, onUnauthorizedResponse, type ApiError } from '../../src/lib/api.js'
import { ErrorBoundary } from '../../src/components/ui/ErrorBoundary.js'

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt'
process.env.JWT_EXPIRES_IN = '1d'
process.env.CLIENT_URL = 'http://localhost:5173'
process.env.NODE_ENV = 'test'
process.env.PORT = '3001'
process.env.CRON_SECRET = 'test-cron-secret-step6-very-secure-1234'

let mongo: MongoMemoryServer
let app: ReturnType<typeof import('../src/app.js')['createApp']>
let User: typeof import('../src/models/User.js')['User']
let CronJobRun: typeof import('../src/models/CronJobRun.js')['CronJobRun']

const mockStorage = new MockStorageProvider()
const originalFetch = globalThis.fetch

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  setStorageProvider(mockStorage)

  const [{ createApp }, userMod, cronRunMod, { connectDatabase }] = await Promise.all([
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/CronJobRun.js'),
    import('../src/config/db.js'),
  ])

  app = createApp()
  User = userMod.User
  CronJobRun = cronRunMod.CronJobRun

  await connectDatabase(mongo.getUri())
  await CronJobRun.syncIndexes()
}, 120000)

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) {
    const { connectDatabase } = await import('../src/config/db.js')
    await connectDatabase(mongo.getUri())
  }
  await Promise.all([User.deleteMany({}), CronJobRun.deleteMany({})])
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
})

async function createUserAndLogin(role: 'SUPER_ADMIN' | 'MARKETING_HEAD' | 'MARKETING_EXECUTIVE', email: string) {
  const passwordHash = await bcrypt.hash('password123', 10)
  const user = await User.create({
    name: email.split('@')[0],
    email,
    passwordHash,
    role,
    isActive: true,
    isArchived: false,
  })
  const loginRes = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
  if (loginRes.status !== 200 || !loginRes.headers['set-cookie']) {
    throw new Error(`Login failed for ${email}: status=${loginRes.status}`)
  }
  return { user, cookie: loginRes.headers['set-cookie'] }
}

describe('Phase 3.5 Step 6: Observability, Readiness Diagnostics & Frontend Resilience', () => {
  it('1. Health endpoint verifies real MongoDB connectivity (200 connected / 503 disconnected) with zero secret leaks', async () => {
    const healthyRes = await request(app).get('/api/health')
    expect(healthyRes.status).toBe(200)
    expect(healthyRes.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(healthyRes.body).toMatchObject({
      success: true,
      data: {
        status: 'ok',
        database: 'connected',
      },
    })
    expect(JSON.stringify(healthyRes.body)).not.toContain(process.env.JWT_SECRET!)
    expect(JSON.stringify(healthyRes.body)).not.toContain(process.env.CRON_SECRET!)
    expect(JSON.stringify(healthyRes.body)).not.toContain(process.env.MONGODB_URI!)

    // Simulated DB ping failure returns 503 degraded without leaking URIs or stacks
    const dbRef = mongoose.connection.db!
    const pingSpy = vi.spyOn(dbRef, 'admin').mockReturnValue({
      ping: vi.fn().mockRejectedValueOnce(new Error('mongodb+srv://user:TopSecretPass@cluster0/prod down')),
    } as never)

    const degradedRes = await request(app).get('/api/health')
    pingSpy.mockRestore()
    expect(degradedRes.status).toBe(503)
    expect(degradedRes.body.success).toBe(false)
    expect(degradedRes.body.data).toMatchObject({ status: 'degraded', database: 'disconnected' })
    expect(degradedRes.body.error.requestId).toBe(degradedRes.headers['x-request-id'])
    expect(degradedRes.text).not.toContain('TopSecretPass')

    // Full disconnect returns 503 cleanly and then reconnects for subsequent tests
    await mongoose.disconnect()
    const disconnectedRes = await request(app).get('/api/health')
    expect(disconnectedRes.status).toBe(503)
    expect(disconnectedRes.body.data.database).toBe('disconnected')

    const { connectDatabase } = await import('../src/config/db.js')
    await connectDatabase(mongo.getUri())
  })

  it('2. Validates X-Request-Id, replaces malformed headers, propagates requestId to errors, and logs slow requests safely', async () => {
    const validId = 'req-client_2026-abcdef12'
    const validRes = await request(app).get('/api/health').set('X-Request-Id', validId)
    expect(validRes.headers['x-request-id']).toBe(validId)

    // Invalid IDs (short, invalid chars, >64 chars) are replaced with a UUID
    expect(resolveRequestId('bad!id$with*chars')).not.toBe('bad!id$with*chars')
    expect(resolveRequestId('short')).not.toBe('short')
    expect(resolveRequestId('x'.repeat(65))).not.toBe('x'.repeat(65))

    const malformedRes = await request(app).get('/api/health').set('X-Request-Id', 'bad!id$with*chars')
    expect(malformedRes.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/i)

    // Unhandled/error responses include requestId and mask sensitive error strings in logs
    const errLogSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const errRes = await request(app)
      .post('/api/auth/login')
      .set('X-Request-Id', validId)
      .send({ email: 'not-an-email', password: '' })
    expect(errRes.status).toBe(422)
    expect(errRes.body.error.requestId).toBe(validId)
    expect(errRes.headers['x-request-id']).toBe(validId)

    const masked = maskSensitiveText(
      'Failed mongodb+srv://admin:Pass123@host/db cloudinary://key:sec@cloud Bearer abc.def.ghi ?cron_secret=mysecret&api_key=olatoken'
    )
    expect(masked).not.toContain('Pass123')
    expect(masked).not.toContain('sec@')
    expect(masked).not.toContain('abc.def.ghi')
    expect(masked).not.toContain('mysecret')
    expect(masked).not.toContain('olatoken')
    errLogSpy.mockRestore()

    // Slow-request warning telemetry logs metadata without bodies/headers/secrets
    vi.useFakeTimers()
    const slowWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const testApp = express()
    testApp.use(requestContextMiddleware)
    testApp.post('/slow-probe', (_req, res) => {
      vi.advanceTimersByTime(2600)
      res.status(200).json({ ok: true })
    })
    const slowRes = await request(testApp)
      .post('/slow-probe')
      .set('X-Request-Id', 'slow-req-12345')
      .set('Cookie', 'accessToken=super-secret-jwt-value')
      .send({ password: 'PlaintextPassword!' })

    expect(slowRes.status).toBe(200)
    expect(slowWarnSpy).toHaveBeenCalledTimes(1)
    const loggedText = JSON.stringify(slowWarnSpy.mock.calls[0])
    expect(loggedText).toContain('slow-req-12345')
    expect(loggedText).toContain('/slow-probe')
    expect(loggedText).not.toContain('PlaintextPassword!')
    expect(loggedText).not.toContain('super-secret-jwt-value')
    vi.useRealTimers()
  })

  it('3. Enforces SUPER_ADMIN auth on GET /api/cron/runs, caps at 10 runs, and leaks zero secrets', async () => {
    const { cookie: adminCookie } = await createUserAndLogin('SUPER_ADMIN', 'diag-admin@test.com')
    const { cookie: headCookie } = await createUserAndLogin('MARKETING_HEAD', 'diag-head@test.com')
    const { cookie: execCookie } = await createUserAndLogin('MARKETING_EXECUTIVE', 'diag-exec@test.com')

    // Insert 12 runs to verify hard cap at 10 newest runs
    const baseTime = new Date('2026-11-10T03:30:00.000Z').getTime()
    await CronJobRun.insertMany(
      Array.from({ length: 12 }, (_, idx) => ({
        jobName: 'DAILY_FOLLOWUPS',
        dateKey: `2026-11-${String(idx + 1).padStart(2, '0')}`,
        timeZone: 'Asia/Kolkata',
        status: idx === 11 ? 'PARTIAL' : 'COMPLETED',
        startedAt: new Date(baseTime + idx * 60_000),
        finishedAt: new Date(baseTime + idx * 60_000 + 250),
        durationMs: 250,
        errorMessage: idx === 11 ? 'mongodb+srv://u:HiddenDbPass@cluster/crm timeout' : undefined,
        counters: { notificationsCreated: idx },
      }))
    )

    expect((await request(app).get('/api/cron/runs')).status).toBe(401)
    expect((await request(app).get('/api/cron/runs').set('Cookie', headCookie)).status).toBe(403)
    expect((await request(app).get('/api/cron/runs').set('Cookie', execCookie)).status).toBe(403)

    const adminRes = await request(app).get('/api/cron/runs?limit=50').set('Cookie', adminCookie)
    expect(adminRes.status).toBe(200)
    expect(adminRes.body.data.limit).toBe(10)
    expect(adminRes.body.data.runs).toHaveLength(10)
    // Sorted newest first
    expect(adminRes.body.data.runs[0].dateKey).toBe('2026-11-12')
    expect(adminRes.body.data.runs[0].errorMessage).not.toContain('HiddenDbPass')
    expect(adminRes.body.data.runs[0].lockKey).toBeUndefined()
    expect(adminRes.body.data.diagnostics.cronSecretConfigured).toBe(true)
    expect(JSON.stringify(adminRes.body)).not.toContain(process.env.CRON_SECRET!)
    expect(JSON.stringify(adminRes.body)).not.toContain(process.env.JWT_SECRET!)
  })

  it('4. apiFetch enforces AbortController timeout, honors external AbortSignal, cleans up timers, and handles 401 expiry without redirect loops', async () => {
    // 4a. Timeout error distinguished from ordinary network error + cleans up timer
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('Aborted')
          abortErr.name = 'AbortError'
          reject(abortErr)
        })
      })
    }) as typeof fetch

    await expect(apiFetch('/visits', { timeoutMs: 25 })).rejects.toMatchObject({
      code: 'TIMEOUT',
      isTimeout: true,
    } satisfies Partial<ApiError>)
    expect(clearSpy).toHaveBeenCalled()

    // 4b. Ordinary network error -> code: 'NETWORK'
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')) as typeof fetch
    await expect(apiFetch('/visits', { timeoutMs: 500 })).rejects.toMatchObject({
      code: 'NETWORK',
    } satisfies Partial<ApiError>)

    // 4c. External caller AbortSignal forwarded & preserves request options
    const callerController = new AbortController()
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>)['X-Custom']).toBe('yes')
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('Caller aborted')
          abortErr.name = 'AbortError'
          reject(abortErr)
        })
      })
    }) as typeof fetch

    const reqPromise = apiFetch('/clients', {
      method: 'POST',
      headers: { 'X-Custom': 'yes' },
      signal: callerController.signal,
      timeoutMs: 5000,
    })
    callerController.abort()
    await expect(reqPromise).rejects.toMatchObject({ code: 'ABORTED' } satisfies Partial<ApiError>)

    // 4d. Session-expiry listener fires for protected endpoints (/visits) but NOT /auth/login or /auth/me
    const unauthSpy = vi.fn()
    const unsubscribe = onUnauthorizedResponse(unauthSpy)

    const make401 = () =>
      new Response(JSON.stringify({ success: false, error: { message: 'Authentication required', requestId: 'rid-401' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })

    globalThis.fetch = vi.fn().mockResolvedValueOnce(make401()) as typeof fetch
    await expect(apiFetch('/auth/login', { method: 'POST' })).rejects.toMatchObject({ status: 401 })
    expect(unauthSpy).not.toHaveBeenCalled()

    globalThis.fetch = vi.fn().mockResolvedValueOnce(make401()) as typeof fetch
    await expect(apiFetch('/auth/me')).rejects.toMatchObject({ status: 401 })
    expect(unauthSpy).not.toHaveBeenCalled()

    globalThis.fetch = vi.fn().mockResolvedValueOnce(make401()) as typeof fetch
    await expect(apiFetch('/visits')).rejects.toMatchObject({ status: 401, requestId: 'rid-401' })
    expect(unauthSpy).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('5. ErrorBoundary captures render errors without exposing raw stack traces, recovers on reset/route change, and lazy routes split cleanly', async () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const boundary = new ErrorBoundary({
      children: React.createElement('div', null, 'Healthy Child'),
      resetKey: '/visits',
    })
    boundary.componentDidCatch(new Error('Confidential internal stack detail'))
    expect(warnSpy).toHaveBeenCalled()

    // Render error fallback safely without leaking Error stack trace
    const setStateSpy = vi.fn((updater) => {
      if (typeof updater === 'object') {
        boundary.state = { ...boundary.state, ...updater }
      }
    })
    boundary.setState = setStateSpy as never
    boundary.state = { hasError: true }

    const fallbackHtml = renderToStaticMarkup(boundary.render() as React.ReactElement)
    expect(fallbackHtml).toContain('Something went wrong loading this view')
    expect(fallbackHtml).toContain('Try again')
    expect(fallbackHtml).toContain('Return to Dashboard')
    expect(fallbackHtml).not.toContain('Confidential internal stack detail')
    expect(fallbackHtml).not.toContain('at ErrorBoundary')

    // Manual reset & route resetKey transition clear error state cleanly
    boundary.handleReset()
    expect(setStateSpy).toHaveBeenCalledWith({ hasError: false })

    boundary.state = { hasError: true }
    boundary.props = { ...boundary.props, resetKey: '/dashboard' }
    boundary.componentDidUpdate({ children: React.createElement('div'), resetKey: '/visits' })
    expect(boundary.state.hasError).toBe(false)

    // Verify App preserves loading state, route guards, and lazy-split routes in MemoryRouter without breaking login
    const [{ MemoryRouter }, { QueryClient, QueryClientProvider }, { AuthContext }, { App }] = await Promise.all([
      import('react-router-dom'),
      import('@tanstack/react-query'),
      import('../../src/features/auth/AuthContext.js'),
      import('../../src/app/App.js'),
    ])
    const qc = new QueryClient()

    const loadingHtml = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(
          AuthContext.Provider,
          {
            value: {
              user: null,
              isLoading: true,
              updateUser: () => {},
              login: async () => {},
              logout: async () => {},
            },
          },
          React.createElement(MemoryRouter, { initialEntries: ['/visits'] }, React.createElement(App))
        )
      )
    )
    expect(loadingHtml).toContain('Loading preview')

    const restrictedHtml = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(
          AuthContext.Provider,
          {
            value: {
              user: {
                _id: '507f1f77bcf86cd799439011',
                name: 'Exec',
                email: 'exec@test.com',
                role: 'MARKETING_EXECUTIVE',
              },
              isLoading: false,
              updateUser: () => {},
              login: async () => {},
              logout: async () => {},
            },
          },
          React.createElement(MemoryRouter, { initialEntries: ['/staff'] }, React.createElement(App))
        )
      )
    )
    expect(restrictedHtml).toContain('Unable to load this preview')
  })
})

