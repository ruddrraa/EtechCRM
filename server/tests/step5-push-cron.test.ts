import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MockStorageProvider } from '../src/services/storage/mock.provider.js'
import { setStorageProvider } from '../src/services/storage/storage.service.js'
import { setPushTransportForTest, sendPushToUserDetailed } from '../src/services/push.js'
import { createIdempotentNotification, createNotification } from '../src/services/notification.js'
import { resolveBusinessDayWindow, runDailyFollowUpAutomation } from '../src/services/followup.js'

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt'
process.env.JWT_EXPIRES_IN = '1d'
process.env.CLIENT_URL = 'http://localhost:5173'
process.env.NODE_ENV = 'test'
process.env.PORT = '3001'
process.env.CRON_SECRET = 'test-cron-secret-step5-very-secure-1234'

let mongo: MongoMemoryServer
let app: ReturnType<typeof import('../src/app.js')['createApp']>
let User: typeof import('../src/models/User.js')['User']
let Client: typeof import('../src/models/Client.js')['Client']
let Visit: typeof import('../src/models/Visit.js')['Visit']
let Notification: typeof import('../src/models/Notification.js')['Notification']
let PushSubscription: typeof import('../src/models/PushSubscription.js')['PushSubscription']
let CronJobRun: typeof import('../src/models/CronJobRun.js')['CronJobRun']
let FollowUpTask: typeof import('../src/models/FollowUpTask.js')['FollowUpTask']

const mockStorage = new MockStorageProvider()

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  setStorageProvider(mockStorage)

  const [
    { createApp },
    userMod,
    clientMod,
    visitMod,
    notifMod,
    pushSubMod,
    cronRunMod,
    followUpTaskMod,
    { connectDatabase },
  ] = await Promise.all([
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/Client.js'),
    import('../src/models/Visit.js'),
    import('../src/models/Notification.js'),
    import('../src/models/PushSubscription.js'),
    import('../src/models/CronJobRun.js'),
    import('../src/models/FollowUpTask.js'),
    import('../src/config/db.js'),
  ])

  app = createApp()
  User = userMod.User
  Client = clientMod.Client
  Visit = visitMod.Visit
  Notification = notifMod.Notification
  PushSubscription = pushSubMod.PushSubscription
  CronJobRun = cronRunMod.CronJobRun
  FollowUpTask = followUpTaskMod.FollowUpTask

  await connectDatabase(mongo.getUri())
  await Promise.all([
    Notification.syncIndexes(),
    CronJobRun.syncIndexes(),
    PushSubscription.syncIndexes(),
    FollowUpTask.syncIndexes(),
  ])
}, 120000)

beforeEach(async () => {
  setPushTransportForTest(null, null)
  process.env.CRON_SECRET = 'test-cron-secret-step5-very-secure-1234'
  await Promise.all([
    User.deleteMany({}),
    Client.deleteMany({}),
    Visit.deleteMany({}),
    Notification.deleteMany({}),
    PushSubscription.deleteMany({}),
    CronJobRun.deleteMany({}),
    FollowUpTask.deleteMany({}),
  ])
})

afterAll(async () => {
  setPushTransportForTest(null, null)
  const mongoose = await import('mongoose')
  await mongoose.default.disconnect()
  if (mongo) await mongo.stop()
})

async function createStaffUser(
  email: string,
  role: 'SUPER_ADMIN' | 'MARKETING_HEAD' | 'MARKETING_EXECUTIVE' = 'MARKETING_EXECUTIVE',
  notificationPreferences?: Record<string, boolean>,
  reportingTo?: string
) {
  const passwordHash = await bcrypt.hash('password123', 10)
  return User.create({
    name: email.split('@')[0],
    email,
    passwordHash,
    role,
    reportingTo: reportingTo ?? null,
    isActive: true,
    isArchived: false,
    ...(notificationPreferences ? { notificationPreferences } : {}),
  })
}

async function loginStaffUser(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
  if (res.status !== 200 || !res.headers['set-cookie']) {
    throw new Error(`Login failed for ${email}: status=${res.status}`)
  }
  return res.headers['set-cookie']
}

describe('Phase 3.5 Step 5: Serverless Push Delivery & Daily Follow-up Cron Automation', () => {
  it('1. Awaits push delivery inside createNotification, cleans up expired (410/404) subscriptions, and isolates partial device failures', async () => {
    const user = await createStaffUser('push1@test.com')
    await PushSubscription.create([
      {
        user: user._id,
        endpoint: 'https://push.example.com/valid-device',
        keys: { p256dh: 'key1', auth: 'auth1' },
      },
      {
        user: user._id,
        endpoint: 'https://push.example.com/expired-410',
        keys: { p256dh: 'key2', auth: 'auth2' },
      },
      {
        user: user._id,
        endpoint: 'https://push.example.com/missing-404',
        keys: { p256dh: 'key3', auth: 'auth3' },
      },
    ])

    let completedInHandler = false
    const deliveredEndpoints: string[] = []
    setPushTransportForTest(async (sub, payload) => {
      await new Promise((r) => setTimeout(r, 20))
      if (sub.endpoint.endsWith('expired-410')) {
        const err = new Error('Gone') as Error & { statusCode: number }
        err.statusCode = 410
        throw err
      }
      if (sub.endpoint.endsWith('missing-404')) {
        const err = new Error('Not Found') as Error & { statusCode: number }
        err.statusCode = 404
        throw err
      }
      deliveredEndpoints.push(sub.endpoint)
      const parsed = JSON.parse(payload) as { tag?: string; notificationId?: string }
      expect(parsed.tag).toMatch(/^crm-notif-/)
      expect(parsed.notificationId).toBeTruthy()
      completedInHandler = true
      return { statusCode: 201 }
    }, true)

    const notif = await createNotification({
      recipient: String(user._id),
      title: 'New visit assigned',
      message: 'Follow up with Apollo Diagnostics.',
      type: 'VISIT_ASSIGNED',
      entityType: 'Visit',
    })

    // Must have completed BEFORE createNotification resolved (no unawaited fire-and-forget!)
    expect(completedInHandler).toBe(true)
    expect(deliveredEndpoints).toEqual(['https://push.example.com/valid-device'])

    const remainingSubs = await PushSubscription.find({ user: user._id }).lean()
    expect(remainingSubs).toHaveLength(1)
    expect(remainingSubs[0].endpoint).toBe('https://push.example.com/valid-device')

    const savedNotif = await Notification.findById(notif._id).lean()
    expect(savedNotif?.pushStatus).toBe('PARTIAL')
    expect(savedNotif?.pushStats?.sent).toBe(1)
    expect(savedNotif?.pushStats?.failed).toBe(2)
    expect(savedNotif?.pushStats?.removedExpired).toBe(2)
  })

  it('2. Performs bounded retries on transient 503 errors, aborts on timeouts, and prevents duplicate pushes on retried requests', async () => {
    const user = await createStaffUser('push-retry@test.com')
    await PushSubscription.create({
      user: user._id,
      endpoint: 'https://push.example.com/flaky-device',
      keys: { p256dh: 'keyA', auth: 'authA' },
    })

    // 2a. Transient 503 followed by 201 recovery
    let attemptCount = 0
    setPushTransportForTest(async () => {
      attemptCount += 1
      if (attemptCount === 1) {
        const err = new Error('Upstream temporarily unavailable') as Error & { statusCode: number }
        err.statusCode = 503
        throw err
      }
      return { statusCode: 201 }
    }, true)

    const { notification, deduplicated, pushResult } = await createIdempotentNotification({
      recipient: String(user._id),
      title: 'Visit update',
      message: 'Retry test',
      type: 'VISIT_UPDATED',
      deliveryKey: 'retry-event-1',
    })
    expect(deduplicated).toBe(false)
    expect(attemptCount).toBe(2)
    expect(pushResult.sent).toBe(1)
    expect(pushResult.retried).toBe(1)

    // 2b. Re-calling sendPushToUserDetailed with the same notificationId must suppress duplicate push
    const dupPushResult = await sendPushToUserDetailed(String(user._id), {
      title: 'Visit update',
      body: 'Retry test',
      notificationId: String(notification._id),
    })
    expect(dupPushResult.sent).toBe(0)
    expect(dupPushResult.skippedReason).toBe('ALREADY_DISPATCHED')
    expect(attemptCount).toBe(2)

    // 2c. Re-calling createIdempotentNotification with same deliveryKey deduplicates cleanly
    const dupCreate = await createIdempotentNotification({
      recipient: String(user._id),
      title: 'Visit update',
      message: 'Retry test',
      type: 'VISIT_UPDATED',
      deliveryKey: 'retry-event-1',
    })
    expect(dupCreate.deduplicated).toBe(true)
    expect(String(dupCreate.notification._id)).toBe(String(notification._id))
    expect(attemptCount).toBe(2)

    // 2d. Hung push endpoint triggers bounded timeout guard and does not hang
    let timeoutAttempts = 0
    setPushTransportForTest(() => {
      timeoutAttempts += 1
      return new Promise((resolve) => setTimeout(resolve, 5000))
    }, true)

    const timeoutSummary = await sendPushToUserDetailed(
      String(user._id),
      { title: 'Timeout check', body: 'Slow network' },
      { timeoutMs: 40, maxRetries: 1, retryDelayMs: 10 }
    )
    expect(timeoutAttempts).toBe(2)
    expect(timeoutSummary.sent).toBe(0)
    expect(timeoutSummary.failed).toBe(1)
    expect(timeoutSummary.timedOut).toBe(1)
    expect(timeoutSummary.retried).toBe(1)
  })

  it('3. Secures /api/cron/follow-ups with constant-time CRON_SECRET verification and fails closed when unconfigured', async () => {
    const noAuth = await request(app).get('/api/cron/follow-ups')
    expect(noAuth.status).toBe(401)
    expect(JSON.stringify(noAuth.body)).not.toContain(process.env.CRON_SECRET!)

    const wrongAuth = await request(app)
      .post('/api/cron/follow-ups')
      .set('Authorization', 'Bearer wrong-secret-value')
    expect(wrongAuth.status).toBe(401)

    const originalSecret = process.env.CRON_SECRET
    process.env.CRON_SECRET = ''
    const missingConfig = await request(app)
      .get('/api/cron/follow-ups')
      .set('Authorization', `Bearer ${originalSecret}`)
    expect(missingConfig.status).toBe(503)

    // Weak secret (< 32 chars) must also fail closed with 503
    process.env.CRON_SECRET = 'too-short-secret-value'
    const weakSecretRes = await request(app)
      .get('/api/cron/follow-ups')
      .set('Authorization', 'Bearer too-short-secret-value')
    expect(weakSecretRes.status).toBe(503)

    process.env.CRON_SECRET = originalSecret
    const okRes = await request(app)
      .get('/api/cron/follow-ups')
      .set('Authorization', `Bearer ${originalSecret}`)
    expect(okRes.status).toBe(200)
    expect(okRes.body.success).toBe(true)
    expect(okRes.body.data.status).toBe('COMPLETED')
    expect(JSON.stringify(okRes.body)).not.toContain(originalSecret!)
  })

  it('4. Enforces IST timezone boundaries, completed/cancelled exclusion, user preferences, partial failure isolation, and idempotent repeats', async () => {
    const execEligible = await createStaffUser('due-ok@test.com', 'MARKETING_EXECUTIVE', {
      dailyProductivity: true,
      mobilePush: true,
      desktopAlerts: true,
    })
    const execNoPush = await createStaffUser('due-nopush@test.com', 'MARKETING_EXECUTIVE', {
      dailyProductivity: true,
      mobilePush: false,
      desktopAlerts: true,
    })
    const execOptOut = await createStaffUser('due-optout@test.com', 'MARKETING_EXECUTIVE', {
      dailyProductivity: false,
      mobilePush: true,
    })

    await PushSubscription.create([
      {
        user: execEligible._id,
        endpoint: 'https://push.example.com/eligible-device',
        keys: { p256dh: 'p1', auth: 'a1' },
      },
      {
        user: execNoPush._id,
        endpoint: 'https://push.example.com/disabled-pref-device',
        keys: { p256dh: 'p2', auth: 'a2' },
      },
    ])

    const client = await Client.create({
      organisationName: 'Metro Heart Institute',
      category: 'Hospital',
      address: 'Park Street, Kolkata',
      createdBy: execEligible._id,
    })

    // Reference instant: 2026-11-10T03:30:00.000Z === 2026-11-10 09:00:00 IST (Asia/Kolkata)
    // Valid 2026-11-10 IST window is [2026-11-09T18:30:00.000Z, 2026-11-10T18:29:59.999Z]
    const referenceDate = new Date('2026-11-10T03:30:00.000Z')
    const window = resolveBusinessDayWindow(referenceDate, 'Asia/Kolkata')
    expect(window.dateKey).toBe('2026-11-10')
    expect(window.startOfDayUtc.toISOString()).toBe('2026-11-09T18:30:00.000Z')
    expect(window.endOfDayUtc.toISOString()).toBe('2026-11-10T18:29:59.999Z')

    // Due today early IST (2026-11-10 00:30 IST = Nov 9 19:00Z) + active status -> INCLUDE
    const visitDueEarly = await Visit.create({
      client: client._id,
      assignedTo: execEligible._id,
      assignedBy: execEligible._id,
      source: 'SELF_ASSIGNED',
      plannedDate: new Date('2026-11-08T05:00:00.000Z'),
      status: 'ASSIGNED',
      followUpDate: new Date('2026-11-09T19:00:00.000Z'),
    })

    // Due today late IST (2026-11-10 23:30 IST = Nov 10 18:00Z) + mobilePush:false -> create in-app, skip Web Push
    const visitDueLateNoPush = await Visit.create({
      client: client._id,
      assignedTo: execNoPush._id,
      assignedBy: execNoPush._id,
      source: 'SELF_ASSIGNED',
      plannedDate: new Date('2026-11-08T05:00:00.000Z'),
      status: 'PLANNED',
      followUpDate: new Date('2026-11-10T18:00:00.000Z'),
    })

    // Due today but user disabled dailyProductivity -> SKIP
    await Visit.create({
      client: client._id,
      assignedTo: execOptOut._id,
      assignedBy: execOptOut._id,
      source: 'SELF_ASSIGNED',
      plannedDate: new Date('2026-11-08T05:00:00.000Z'),
      status: 'ARRIVED',
      followUpDate: new Date('2026-11-10T00:00:00.000Z'),
    })

    // Boundary exclusions: yesterday (23:30 IST Nov 9) & tomorrow (00:30 IST Nov 11)
    await Visit.create([
      {
        client: client._id,
        assignedTo: execEligible._id,
        assignedBy: execEligible._id,
        source: 'SELF_ASSIGNED',
        plannedDate: new Date('2026-11-07T05:00:00.000Z'),
        status: 'ASSIGNED',
        followUpDate: new Date('2026-11-09T18:00:00.000Z'),
      },
      {
        client: client._id,
        assignedTo: execEligible._id,
        assignedBy: execEligible._id,
        source: 'SELF_ASSIGNED',
        plannedDate: new Date('2026-11-08T05:00:00.000Z'),
        status: 'ASSIGNED',
        followUpDate: new Date('2026-11-10T19:00:00.000Z'),
      },
    ])

    // Status exclusions: COMPLETED & CANCELLED due today MUST be ignored
    await Visit.create([
      {
        client: client._id,
        assignedTo: execEligible._id,
        assignedBy: execEligible._id,
        source: 'SELF_ASSIGNED',
        plannedDate: new Date('2026-11-08T05:00:00.000Z'),
        status: 'COMPLETED',
        followUpDate: new Date('2026-11-10T00:00:00.000Z'),
      },
      {
        client: client._id,
        assignedTo: execEligible._id,
        assignedBy: execEligible._id,
        source: 'SELF_ASSIGNED',
        plannedDate: new Date('2026-11-08T05:00:00.000Z'),
        status: 'CANCELLED',
        followUpDate: new Date('2026-11-10T00:00:00.000Z'),
      },
    ])

    const pushedEndpoints: string[] = []
    setPushTransportForTest(async (sub) => {
      pushedEndpoints.push(sub.endpoint)
      return { statusCode: 201 }
    }, true)

    // Run 1 via API endpoint
    const run1Res = await request(app)
      .get('/api/cron/follow-ups')
      .query({ date: referenceDate.toISOString(), timeZone: 'Asia/Kolkata' })
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`)

    expect(run1Res.status).toBe(200)
    const run1 = run1Res.body.data
    expect(run1.status).toBe('COMPLETED')
    expect(run1.counters.dueVisits).toBe(3)
    expect(run1.counters.skippedPreferences).toBe(1)
    expect(run1.counters.notificationsCreated).toBe(2)
    expect(run1.counters.pushSent).toBe(1)
    expect(pushedEndpoints).toEqual(['https://push.example.com/eligible-device'])

    const notifs = await Notification.find({ type: 'FOLLOW_UP_REMINDER' }).lean()
    expect(notifs).toHaveLength(2)
    expect(notifs.map((n) => String(n.entityId)).sort()).toEqual(
      [String(visitDueEarly._id), String(visitDueLateNoPush._id)].sort()
    )

    const noPushNotif = notifs.find((n) => String(n.recipient) === String(execNoPush._id))
    expect(noPushNotif?.pushStatus).toBe('SKIPPED')
    expect(noPushNotif?.pushStats?.skippedReason).toBe('MOBILE_PUSH_DISABLED')

    // Run 2 (repeated cron execution same day) must create 0 new notifications and 0 pushes
    const run2Res = await request(app)
      .post('/api/cron/follow-ups')
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`)
      .send({ date: referenceDate.toISOString(), timeZone: 'Asia/Kolkata' })

    expect(run2Res.status).toBe(200)
    const run2 = run2Res.body.data
    expect(run2.counters.notificationsCreated).toBe(0)
    expect(run2.counters.deduplicatedSkipped).toBe(2)
    expect(run2.counters.pushSent).toBe(0)
    expect(await Notification.countDocuments({ type: 'FOLLOW_UP_REMINDER' })).toBe(2)
  })

  it('5. Prevents overlapping concurrent cron runs via lease lock and isolates individual recipient errors', async () => {
    const exec1 = await createStaffUser('iso1@test.com')
    const exec2 = await createStaffUser('iso2@test.com')
    const client = await Client.create({
      organisationName: 'Apollo Clinic',
      category: 'Clinic',
      address: 'Salt Lake Sector V',
      createdBy: exec1._id,
    })

    const refDate = new Date('2026-11-10T04:00:00.000Z')
    await Visit.create([
      {
        client: client._id,
        assignedTo: exec1._id,
        assignedBy: exec1._id,
        source: 'SELF_ASSIGNED',
        plannedDate: new Date('2026-11-08T05:00:00.000Z'),
        status: 'ASSIGNED',
        followUpDate: new Date('2026-11-10T00:00:00.000Z'),
      },
      {
        client: client._id,
        assignedTo: exec2._id,
        assignedBy: exec2._id,
        source: 'SELF_ASSIGNED',
        plannedDate: new Date('2026-11-08T05:00:00.000Z'),
        status: 'ASSIGNED',
        followUpDate: new Date('2026-11-10T00:00:00.000Z'),
      },
    ])

    // 5a. Simulate active concurrent cron lease
    await CronJobRun.create({
      jobName: 'DAILY_FOLLOWUPS',
      dateKey: '2026-11-10',
      timeZone: 'Asia/Kolkata',
      status: 'RUNNING',
      lockKey: 'ACTIVE:DAILY_FOLLOWUPS',
      lockExpiresAt: new Date(Date.now() + 30_000),
      startedAt: new Date(),
    })

    const concurrentRes = await runDailyFollowUpAutomation({ referenceDate: refDate, timeZone: 'Asia/Kolkata' })
    expect(concurrentRes.status).toBe('SKIPPED_CONCURRENT_RUN')

    await CronJobRun.deleteMany({})

    // 5b. Fail Notification.create once on first visit -> second recipient still completes cleanly!
    const origCreate = Notification.create.bind(Notification)
    let calls = 0
    const createSpy = vi.spyOn(Notification, 'create').mockImplementation((...args: Parameters<typeof Notification.create>) => {
      calls += 1
      if (calls === 1) {
        return Promise.reject(new Error('Simulated transient recipient write failure'))
      }
      return origCreate(...args)
    })

    const partialRes = await runDailyFollowUpAutomation({
      referenceDate: refDate,
      timeZone: 'Asia/Kolkata',
      maxVisits: 50,
    })
    createSpy.mockRestore()

    expect(partialRes.status).toBe('PARTIAL')
    expect(partialRes.counters.errors).toBe(1)
    expect(partialRes.counters.notificationsCreated).toBe(1)
    expect(await Notification.countDocuments({ type: 'FOLLOW_UP_REMINDER' })).toBe(1)

    // Subsequent retry creates the missed reminder while deduplicating the already-succeeded one
    const recoveryRes = await runDailyFollowUpAutomation({ referenceDate: refDate, timeZone: 'Asia/Kolkata' })
    expect(recoveryRes.status).toBe('COMPLETED')
    expect(recoveryRes.counters.notificationsCreated).toBe(1)
    expect(recoveryRes.counters.deduplicatedSkipped).toBe(1)
    expect(await Notification.countDocuments({ type: 'FOLLOW_UP_REMINDER' })).toBe(2)
  })

  it('6. Checkout followUpDate creates an independent PENDING FollowUpTask while keeping Visit COMPLETED, tracks COMPLETED/CANCELLED task states, and triggers cron reminders idempotently', async () => {
    const head = await createStaffUser('head-checkout@test.com', 'MARKETING_HEAD')
    const exec = await createStaffUser(
      'exec-checkout@test.com',
      'MARKETING_EXECUTIVE',
      { dailyProductivity: true, mobilePush: true, desktopAlerts: true },
      String(head._id)
    )
    const headCookie = await loginStaffUser('head-checkout@test.com')
    const execCookie = await loginStaffUser('exec-checkout@test.com')

    await PushSubscription.create({
      user: exec._id,
      endpoint: 'https://push.example.com/checkout-exec-device',
      keys: { p256dh: 'p-co', auth: 'a-co' },
    })

    const client = await Client.create({
      organisationName: 'Bengal Surgical Centre',
      category: 'Hospital',
      address: 'Park Circus, Kolkata',
      createdBy: head._id,
    })

    // Helper to create an assigned checked-in visit cleanly
    const makeCheckedInVisit = async () => {
      const assignRes = await request(app)
        .post('/api/visits')
        .set('Cookie', headCookie)
        .send({
          clientId: String(client._id),
          assignedTo: String(exec._id),
          plannedDate: '2026-11-09T05:00:00.000Z',
        })
      expect(assignRes.status).toBe(201)
      const visitId = assignRes.body.data._id as string
      await Visit.findByIdAndUpdate(visitId, { $set: { status: 'CHECKED_IN' } })
      return visitId
    }

    const vPendingId = await makeCheckedInVisit()
    const vCompletedTaskId = await makeCheckedInVisit()
    const vCancelledTaskId = await makeCheckedInVisit()

    const followUpDueDate = '2026-11-10T00:00:00.000Z'

    // Complete all three visits via HTTP checkout endpoint with followUpDate
    for (const vid of [vPendingId, vCompletedTaskId, vCancelledTaskId]) {
      const checkoutRes = await request(app)
        .post(`/api/visits/${vid}/complete`)
        .set('Cookie', execCookie)
        .send({
          remarks: 'Demo done, schedule follow-up call',
          followUpDate: followUpDueDate,
          location: { locationStatus: 'LOCATION_UNAVAILABLE' },
        })
      expect(checkoutRes.status).toBe(200)
      // Original visit MUST stay COMPLETED (never reopened!)
      expect(checkoutRes.body.data.status).toBe('COMPLETED')
      expect(new Date(checkoutRes.body.data.followUpDate).toISOString()).toBe(followUpDueDate)
    }

    // Clear visit completion notifications so only cron reminders are asserted below
    await Notification.deleteMany({})

    const tasks = await FollowUpTask.find({}).lean()
    expect(tasks).toHaveLength(3)
    const pendingTask = tasks.find((t) => String(t.sourceVisit) === vPendingId)!
    const completedTask = tasks.find((t) => String(t.sourceVisit) === vCompletedTaskId)!
    const cancelledTask = tasks.find((t) => String(t.sourceVisit) === vCancelledTaskId)!

    expect(pendingTask.status).toBe('PENDING')
    expect(String(pendingTask.client)).toBe(String(client._id))
    expect(String(pendingTask.assignedTo)).toBe(String(exec._id))
    expect(String(pendingTask.marketingHeadAtCreation)).toBe(String(head._id))

    // Mark second task COMPLETED and third task CANCELLED via API endpoints
    const compTaskRes = await request(app)
      .post(`/api/follow-ups/${completedTask._id}/complete`)
      .set('Cookie', execCookie)
      .send({ notes: 'Client confirmed order on phone' })
    expect(compTaskRes.status).toBe(200)
    expect(compTaskRes.body.data.status).toBe('COMPLETED')

    const cancelTaskRes = await request(app)
      .post(`/api/follow-ups/${cancelledTask._id}/cancel`)
      .set('Cookie', headCookie)
      .send({ reason: 'Follow-up no longer needed' })
    expect(cancelTaskRes.status).toBe(200)
    expect(cancelTaskRes.body.data.status).toBe('CANCELLED')

    // Original visits MUST still remain COMPLETED
    const visitsCheck = await Visit.find({ _id: { $in: [vPendingId, vCompletedTaskId, vCancelledTaskId] } }).lean()
    expect(visitsCheck.every((v) => v.status === 'COMPLETED')).toBe(true)

    const pushedEndpoints: string[] = []
    setPushTransportForTest(async (sub) => {
      pushedEndpoints.push(sub.endpoint)
      return { statusCode: 201 }
    }, true)

    // Run cron -> ONLY the PENDING checkout follow-up task generates a reminder
    const cronRes1 = await request(app)
      .get('/api/cron/follow-ups')
      .query({ date: '2026-11-10T03:30:00.000Z', timeZone: 'Asia/Kolkata' })
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`)

    expect(cronRes1.status).toBe(200)
    expect(cronRes1.body.data.counters.dueVisits).toBe(1)
    expect(cronRes1.body.data.counters.notificationsCreated).toBe(1)
    expect(cronRes1.body.data.counters.pushSent).toBe(1)
    expect(pushedEndpoints).toEqual(['https://push.example.com/checkout-exec-device'])

    const reminder = await Notification.findOne({ type: 'FOLLOW_UP_REMINDER' }).lean()
    expect(String(reminder?.entityId)).toBe(vPendingId)

    // Re-running cron on same day creates 0 duplicate reminders and 0 duplicate pushes
    const cronRes2 = await request(app)
      .post('/api/cron/follow-ups')
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`)
      .send({ date: '2026-11-10T05:00:00.000Z', timeZone: 'Asia/Kolkata' })

    expect(cronRes2.status).toBe(200)
    expect(cronRes2.body.data.counters.notificationsCreated).toBe(0)
    expect(cronRes2.body.data.counters.deduplicatedSkipped).toBe(1)
    expect(cronRes2.body.data.counters.pushSent).toBe(0)
  })

  it('7. Preserves historical Marketing Head attribution & RBAC isolation across executive reassignment and deduplicates across visit + task sources', async () => {
    const superAdmin = await createStaffUser('super-reassign@test.com', 'SUPER_ADMIN')
    const headA = await createStaffUser('head-a-fu@test.com', 'MARKETING_HEAD')
    const headB = await createStaffUser('head-b-fu@test.com', 'MARKETING_HEAD')
    const exec = await createStaffUser('exec-reassign-fu@test.com', 'MARKETING_EXECUTIVE', undefined, String(headA._id))

    const adminCookie = await loginStaffUser(superAdmin.email)
    const headACookie = await loginStaffUser(headA.email)
    const headBCookie = await loginStaffUser(headB.email)
    const execCookie = await loginStaffUser(exec.email)

    const client = await Client.create({
      organisationName: 'Peerless Diagnostics',
      category: 'Diagnostic Lab',
      address: 'Garia, Kolkata',
      createdBy: headA._id,
    })

    const assignRes = await request(app)
      .post('/api/visits')
      .set('Cookie', headACookie)
      .send({
        clientId: String(client._id),
        assignedTo: String(exec._id),
        plannedDate: '2026-11-09T04:00:00.000Z',
      })
    expect(assignRes.status).toBe(201)
    const visitId = assignRes.body.data._id as string
    await Visit.findByIdAndUpdate(visitId, { $set: { status: 'CHECKED_IN' } })

    const checkoutRes = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Cookie', execCookie)
      .send({
        remarks: 'Needs quote revision follow-up',
        followUpDate: '2026-11-10T00:00:00.000Z',
        location: { locationStatus: 'LOCATION_UNAVAILABLE' },
      })
    expect(checkoutRes.status).toBe(200)

    const taskBeforeReassign = await FollowUpTask.findOne({ sourceVisit: visitId }).lean()
    expect(String(taskBeforeReassign?.marketingHeadAtCreation)).toBe(String(headA._id))

    // Reassign executive from Head A to Head B
    const reassignRes = await request(app)
      .patch(`/api/users/${exec._id}/reporting`)
      .set('Cookie', adminCookie)
      .send({ reportingTo: String(headB._id) })
    expect(reassignRes.status).toBe(200)

    // Operational RBAC moves to Head B; Head A can no longer access/complete executive's task
    const listHeadA = await request(app).get('/api/follow-ups').set('Cookie', headACookie)
    expect(listHeadA.status).toBe(200)
    expect(listHeadA.body.data.items).toHaveLength(0)

    const completeByHeadA = await request(app)
      .post(`/api/follow-ups/${taskBeforeReassign!._id}/complete`)
      .set('Cookie', headACookie)
      .send({})
    expect(completeByHeadA.status).toBe(404)

    const listHeadB = await request(app).get('/api/follow-ups').set('Cookie', headBCookie)
    expect(listHeadB.status).toBe(200)
    expect(listHeadB.body.data.items).toHaveLength(1)
    // Historical Marketing Head attribution on FollowUpTask & original Visit remains Head A!
    expect(String(listHeadB.body.data.items[0].marketingHeadAtCreation?._id)).toBe(String(headA._id))

    const persistedVisit = await Visit.findById(visitId).lean()
    expect(String(persistedVisit?.marketingHeadAtAssignment)).toBe(String(headA._id))

    // Simulate an overlapping direct-visit followUpDate on an active visit ALSO having a FollowUpTask
    const overlapVisit = await Visit.create({
      client: client._id,
      assignedTo: exec._id,
      assignedBy: headB._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date('2026-11-09T06:00:00.000Z'),
      status: 'ASSIGNED',
      followUpDate: new Date('2026-11-10T00:00:00.000Z'),
    })
    await FollowUpTask.create({
      sourceVisit: overlapVisit._id,
      client: client._id,
      assignedTo: exec._id,
      marketingHeadAtCreation: headB._id,
      dueDate: new Date('2026-11-10T00:00:00.000Z'),
      status: 'PENDING',
    })

    // Cron runs -> must emit 1 reminder for checkout task + 1 for overlapVisit (never 2 for overlapVisit!)
    await Notification.deleteMany({})
    const cronRes = await runDailyFollowUpAutomation({
      referenceDate: new Date('2026-11-10T03:30:00.000Z'),
      timeZone: 'Asia/Kolkata',
    })
    expect(cronRes.counters.dueVisits).toBe(2)
    expect(cronRes.counters.notificationsCreated).toBe(2)
    expect(await Notification.countDocuments({ type: 'FOLLOW_UP_REMINDER' })).toBe(2)
  })
})

