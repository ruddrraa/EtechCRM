import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import zlib from 'node:zlib'
import * as XLSX from 'xlsx'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.TZ = 'UTC'
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt'
process.env.JWT_EXPIRES_IN = '1d'
process.env.CLIENT_URL = 'http://localhost:5173'
process.env.NODE_ENV = 'test'
process.env.PORT = '3001'

let mongo: MongoMemoryServer
let app: typeof import('../src/app.js')['createApp'] extends () => infer T ? T : never
let User: typeof import('../src/models/User.js')['User']
let Client: typeof import('../src/models/Client.js')['Client']
let Visit: typeof import('../src/models/Visit.js')['Visit']
let Notification: typeof import('../src/models/Notification.js')['Notification']

let tzUtils: typeof import('../src/utils/timezone.js')
let frontendTz: typeof import('../../src/lib/timezone.js')

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()

  const [{ createApp }, user, client, visit, notification, { connectDatabase }, serverTimezone, clientTimezone] =
    await Promise.all([
      import('../src/app.js'),
      import('../src/models/User.js'),
      import('../src/models/Client.js'),
      import('../src/models/Visit.js'),
      import('../src/models/Notification.js'),
      import('../src/config/db.js'),
      import('../src/utils/timezone.js'),
      import('../../src/lib/timezone.js'),
    ])

  app = createApp()
  User = user.User
  Client = client.Client
  Visit = visit.Visit
  Notification = notification.Notification
  tzUtils = serverTimezone
  frontendTz = clientTimezone
  await connectDatabase()
}, 120000)

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Client.deleteMany({}), Visit.deleteMany({}), Notification.deleteMany({})])
})

afterAll(async () => {
  const mongoose = await import('mongoose')
  await mongoose.disconnect()
  await mongo.stop()
})

async function createSeedActors() {
  const passwordHash = await bcrypt.hash('password123', 10)
  const admin = await User.create({
    name: 'Super Admin',
    email: 'tz-admin@example.com',
    passwordHash,
    role: 'SUPER_ADMIN',
    isActive: true,
  })
  const head = await User.create({
    name: 'SAIKAT MAITY',
    email: 'tz-head@example.com',
    passwordHash,
    role: 'MARKETING_HEAD',
    isActive: true,
  })
  const executive = await User.create({
    name: 'Sohan Das',
    email: 'tz-exec@example.com',
    designation: 'Field Executive',
    passwordHash,
    role: 'MARKETING_EXECUTIVE',
    reportingTo: head._id,
    isActive: true,
  })
  const client = await Client.create({
    organisationName: 'Priya Cinema',
    category: 'Cinema',
    address: '95, Rash Behari Ave, Kolkata, West Bengal 700029',
    latitude: 22.51778,
    longitude: 88.35431,
    createdBy: admin._id,
  })
  return { admin, head, executive, client }
}

function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1')
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  const parts: string[] = []
  let match: RegExpExecArray | null
  while ((match = streamRegex.exec(raw)) !== null) {
    const chunk = Buffer.from(match[1], 'latin1')
    let decoded: string
    try {
      decoded = zlib.inflateSync(chunk).toString('latin1')
    } catch {
      decoded = chunk.toString('latin1')
    }
    const litRegex = /\(([^()]*(?:\\.[^()]*)*)\)\s*Tj/g
    let lit: RegExpExecArray | null
    while ((lit = litRegex.exec(decoded)) !== null) {
      parts.push(lit[1].replace(/\\([()\\])/g, '$1'))
    }
    const hexRegex = /<([0-9a-fA-F]+)>/g
    let hex: RegExpExecArray | null
    while ((hex = hexRegex.exec(decoded)) !== null) {
      parts.push(Buffer.from(hex[1], 'hex').toString('latin1'))
    }
  }
  return parts.join(' ')
}

describe('Asia/Kolkata (IST) Production Timezone Consistency (under TZ=UTC)', () => {
  it('1. converts IST scheduling input (7:20 PM IST) to exact UTC without double conversion', async () => {
    const { admin, executive, client } = await createSeedActors()
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })

    // Frontend converts datetime-local "2026-11-10T19:20" (IST) -> "2026-11-10T13:50:00.000Z"
    const frontendIso = frontendTz.toIstUtcIso('2026-11-10T19:20')
    expect(frontendIso).toBe('2026-11-10T13:50:00.000Z')
    // Already-offset ISO must never be double-shifted
    expect(frontendTz.toIstUtcIso(frontendIso)).toBe('2026-11-10T13:50:00.000Z')

    const res1 = await request(app)
      .post('/api/visits')
      .set('Cookie', adminLogin.headers['set-cookie'])
      .send({
        clientId: String(client._id),
        assignedTo: String(executive._id),
        plannedDate: frontendIso,
        instructions: 'Evening client visit',
      })
    expect(res1.status).toBe(201)
    expect(new Date(res1.body.data.plannedDate).toISOString()).toBe('2026-11-10T13:50:00.000Z')

    // Backend defense-in-depth: even if naive "2026-11-10T19:25" arrives directly, treat it as IST
    const res2 = await request(app)
      .post('/api/visits')
      .set('Cookie', adminLogin.headers['set-cookie'])
      .send({
        clientId: String(client._id),
        assignedTo: String(executive._id),
        plannedDate: '2026-11-10T19:25',
      })
    expect(res2.status).toBe(201)
    expect(new Date(res2.body.data.plannedDate).toISOString()).toBe('2026-11-10T13:55:00.000Z')

    const notification = await Notification.findOne({ entityId: res1.body.data._id }).lean()
    expect(notification?.message).toContain('10/11/2026, 7:20:00 pm')
  })

  it('2 & 3 & 4. handles IST formatting, midnight rollover, 12:00 AM, and 12:00 PM accurately', () => {
    // 7:20 PM IST on 10 Nov 2026
    expect(tzUtils.formatIstDateTime('2026-11-10T13:50:00.000Z')).toBe('10/11/2026, 7:20:00 pm')
    expect(frontendTz.formatIstDateTime('2026-11-10T13:50:00.000Z')).toBe('10/11/2026, 7:20:00 pm')

    // Midnight rollover: 11:55 PM IST on 10 Nov 2026 = 18:25 UTC
    const lateIst = tzUtils.parseBusinessDateTime('2026-11-10T23:55')
    expect(lateIst?.toISOString()).toBe('2026-11-10T18:25:00.000Z')
    expect(tzUtils.formatIstDateTime(lateIst)).toBe('10/11/2026, 11:55:00 pm')

    // 12:15 AM IST on 11 Nov 2026 = 10 Nov 18:45 UTC (stays 11/11/2026 in IST)
    const afterMidnightIst = tzUtils.parseBusinessDateTime('2026-11-11T00:15')
    expect(afterMidnightIst?.toISOString()).toBe('2026-11-10T18:45:00.000Z')
    expect(tzUtils.formatIstDateTime(afterMidnightIst)).toBe('11/11/2026, 12:15:00 am')

    // 12:00 AM IST on 10 Nov 2026 = 09 Nov 18:30 UTC
    const midnightIst = tzUtils.parseBusinessDateTime('2026-11-10T00:00')
    expect(midnightIst?.toISOString()).toBe('2026-11-09T18:30:00.000Z')
    expect(tzUtils.formatIstDateTime(midnightIst)).toBe('10/11/2026, 12:00:00 am')

    // 12:00 PM IST on 10 Nov 2026 = 10 Nov 06:30 UTC
    const noonIst = tzUtils.parseBusinessDateTime('2026-11-10T12:00')
    expect(noonIst?.toISOString()).toBe('2026-11-10T06:30:00.000Z')
    expect(tzUtils.formatIstDateTime(noonIst)).toBe('10/11/2026, 12:00:00 pm')

    // Null/empty/invalid safe handling
    expect(tzUtils.formatIstDateTime(null)).toBe('—')
    expect(tzUtils.formatIstDate(undefined)).toBe('—')
    expect(tzUtils.parseBusinessDateTime('2026-02-30T10:00')).toBeNull()
  })

  it('5 & 6. formats check-in/check-out instants and follow-up dates consistently in IST across APIs and UI', async () => {
    const { admin, executive, head, client } = await createSeedActors()
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })

    const checkInUtc = new Date('2026-11-11T13:46:36.000Z') // 7:16:36 PM IST
    const checkOutUtc = new Date('2026-11-11T13:47:37.000Z') // 7:17:37 PM IST
    const followUpUtc = tzUtils.parseBusinessDateTime('2026-11-27')! // 2026-11-26T18:30:00.000Z

    expect(followUpUtc.toISOString()).toBe('2026-11-26T18:30:00.000Z')
    expect(tzUtils.formatIstDate(followUpUtc)).toBe('27/11/2026')
    expect(frontendTz.formatIstDate(followUpUtc)).toBe('27/11/2026')

    await Visit.create({
      client: client._id,
      assignedTo: executive._id,
      assignedBy: admin._id,
      marketingHeadAtAssignment: head._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date('2026-11-11T13:46:00.000Z'), // 7:16:00 PM IST
      status: 'COMPLETED',
      checkIn: {
        latitude: 22.51778,
        longitude: 88.35431,
        recordedAt: checkInUtc,
        locationStatus: 'AVAILABLE',
        verificationStatus: 'VERIFIED',
      },
      checkOut: {
        latitude: 22.51776,
        longitude: 88.3543,
        recordedAt: checkOutUtc,
        locationStatus: 'AVAILABLE',
        verificationStatus: 'VERIFIED',
      },
      remarks: 'Meeting completed',
      followUpDate: followUpUtc,
    })

    // Report API + Dashboard IST boundary filtering:
    // A visit at 2026-11-11 00:30 IST (2026-11-10T19:00:00Z) must fall inside custom 2026-11-11 IST filter!
    const earlyMorningVisit = await Visit.create({
      client: client._id,
      assignedTo: executive._id,
      assignedBy: admin._id,
      marketingHeadAtAssignment: head._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date('2026-11-10T19:00:00.000Z'), // 11 Nov 2026 12:30 AM IST
      status: 'ASSIGNED',
    })

    const reportRes = await request(app)
      .get('/api/reports/client?preset=custom&startDate=2026-11-11&endDate=2026-11-11')
      .set('Cookie', adminLogin.headers['set-cookie'])
    expect(reportRes.status).toBe(200)
    expect(reportRes.body.data.items.map((v: { _id: string }) => v._id)).toContain(String(earlyMorningVisit._id))

    const dashRes = await request(app)
      .get('/api/dashboard?preset=custom&startDate=2026-11-11&endDate=2026-11-11')
      .set('Cookie', adminLogin.headers['set-cookie'])
    expect(dashRes.status).toBe(200)
    expect(dashRes.body.data.activity.map((b: { day: string }) => b.day)).toContain('2026-11-11')
  })

  it('7 & 8 & 9. CSV, XLSX, and PDF exports render exact IST timestamps (never server UTC) under TZ=UTC', async () => {
    const { admin, executive, head, client } = await createSeedActors()
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })

    const visit = await Visit.create({
      client: client._id,
      assignedTo: executive._id,
      assignedBy: admin._id,
      marketingHeadAtAssignment: head._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date('2026-11-11T13:55:00.000Z'), // 11/11/2026, 7:25:00 pm IST
      status: 'COMPLETED',
      checkIn: {
        latitude: 22.51778,
        longitude: 88.35431,
        recordedAt: new Date('2026-11-11T13:46:36.000Z'), // 11/11/2026, 7:16:36 pm IST
        locationStatus: 'AVAILABLE',
        verificationStatus: 'VERIFIED',
      },
      checkOut: {
        latitude: 22.51776,
        longitude: 88.3543,
        recordedAt: new Date('2026-11-11T13:47:37.000Z'), // 11/11/2026, 7:17:37 pm IST
        locationStatus: 'AVAILABLE',
        verificationStatus: 'VERIFIED',
      },
      remarks: 'Checked out cleanly',
      followUpDate: new Date('2026-11-26T18:30:00.000Z'), // 27/11/2026
    })

    // 7. CSV Export (Client + Staff views)
    const csvClient = await request(app)
      .get('/api/reports/export?view=client&format=csv&preset=custom&startDate=2026-11-11&endDate=2026-11-11')
      .set('Cookie', adminLogin.headers['set-cookie'])
    expect(csvClient.status).toBe(200)
    expect(csvClient.text).toContain('11/11/2026, 7:25:00 pm')
    expect(csvClient.text).toContain('11/11/2026, 7:16:36 pm')
    expect(csvClient.text).toContain('11/11/2026, 7:17:37 pm')
    expect(csvClient.text).toContain('27/11/2026')
    expect(csvClient.text).not.toContain('1:46:36')
    expect(csvClient.text).not.toContain('1:47:37')

    const csvStaff = await request(app)
      .get('/api/reports/export?view=staff&format=csv&preset=custom&startDate=2026-11-11&endDate=2026-11-11')
      .set('Cookie', adminLogin.headers['set-cookie'])
    expect(csvStaff.status).toBe(200)
    expect(csvStaff.text).toContain('11/11/2026, 7:16:36 pm')
    expect(csvStaff.text).toContain('11/11/2026, 7:17:37 pm')

    // 8. XLSX Export
    const xlsxRes = await request(app)
      .get('/api/reports/export?view=client&format=xlsx&preset=custom&startDate=2026-11-11&endDate=2026-11-11')
      .buffer(true)
      .parse((res, cb) => {
        const data: Buffer[] = []
        res.on('data', (chunk) => data.push(chunk))
        res.on('end', () => cb(null, Buffer.concat(data)))
      })
      .set('Cookie', adminLogin.headers['set-cookie'])
    expect(xlsxRes.status).toBe(200)
    const workbook = XLSX.read(xlsxRes.body as Buffer, { type: 'buffer' })
    const sheetRows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets['Visit Details'])
    expect(sheetRows[0]['Visit Date']).toBe('11/11/2026, 7:25:00 pm')
    expect(sheetRows[0]['Check-in Time']).toBe('11/11/2026, 7:16:36 pm')
    expect(sheetRows[0]['Check-out Time']).toBe('11/11/2026, 7:17:37 pm')
    expect(sheetRows[0]['Follow-up Date']).toBe('27/11/2026')

    // 9. PDF Export (verify decompressed rendered text contains IST timestamps, not UTC)
    const pdfRes = await request(app)
      .get('/api/reports/export?view=client&format=pdf&preset=custom&startDate=2026-11-11&endDate=2026-11-11')
      .buffer(true)
      .parse((res, cb) => {
        const data: Buffer[] = []
        res.on('data', (chunk) => data.push(chunk))
        res.on('end', () => cb(null, Buffer.concat(data)))
      })
      .set('Cookie', adminLogin.headers['set-cookie'])
    expect(pdfRes.status).toBe(200)
    expect((pdfRes.body as Buffer).subarray(0, 4).toString()).toBe('%PDF')
    const pdfText = extractPdfText(pdfRes.body as Buffer)
    expect(pdfText).toContain('7:25:00 pm')
    expect(pdfText).toContain('7:16:36 pm')
    expect(pdfText).toContain('7:17:37 pm')
    expect(pdfText).toContain('27/11/2026')
    expect(pdfText).not.toContain('1:46:36')
    expect(pdfText).not.toContain('1:47:37')

    // 10. Rescheduling an active visit works identically and preserves historical records untouched
    const originalTimestamp = visit.plannedDate.toISOString()
    const rawBefore = await Visit.findById(visit._id).lean()
    expect(new Date(rawBefore!.plannedDate).toISOString()).toBe(originalTimestamp)
    expect(new Date(rawBefore!.checkIn!.recordedAt!).toISOString()).toBe('2026-11-11T13:46:36.000Z')

    const activeVisit = await Visit.create({
      client: client._id,
      assignedTo: executive._id,
      assignedBy: admin._id,
      marketingHeadAtAssignment: head._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date('2026-11-11T13:55:00.000Z'),
      status: 'ASSIGNED',
    })
    const rescheduleRes = await request(app)
      .post(`/api/visits/${activeVisit._id}/reschedule`)
      .set('Cookie', adminLogin.headers['set-cookie'])
      .send({ plannedDate: '2026-11-12T10:30' })
    expect(rescheduleRes.status).toBe(200)
    expect(new Date(rescheduleRes.body.data.plannedDate).toISOString()).toBe('2026-11-12T05:00:00.000Z')
  })

  it('11. Reports page defaults to "Today" using Asia/Kolkata start/end dates and business-day boundaries', async () => {
    expect(frontendTz.DEFAULT_REPORT_PRESET).toBe('today')

    // UTC is still 2026-11-11 19:00 UTC, but in Asia/Kolkata it is already 2026-11-12 00:30 IST
    const afterIstMidnightUtc = new Date('2026-11-11T19:00:00.000Z')
    expect(frontendTz.getDefaultReportFilterState(afterIstMidnightUtc)).toEqual({
      preset: 'today',
      startDate: '2026-11-12',
      endDate: '2026-11-12',
    })

    // 2026-11-11 23:59:59 IST = 2026-11-11 18:29:59 UTC
    const beforeIstMidnightUtc = new Date('2026-11-11T18:29:59.000Z')
    expect(frontendTz.getDefaultReportFilterState(beforeIstMidnightUtc)).toEqual({
      preset: 'today',
      startDate: '2026-11-11',
      endDate: '2026-11-11',
    })

    // Backend business-day boundaries for 'today' in Asia/Kolkata
    const todayRange = tzUtils.resolveBusinessDateRange('today', undefined, undefined, afterIstMidnightUtc)
    expect(todayRange.from.toISOString()).toBe('2026-11-11T18:30:00.000Z')
    expect(todayRange.to.toISOString()).toBe('2026-11-12T18:29:59.999Z')

    // Live API + export behavior with preset=today against real server clock
    const { admin, executive, head, client } = await createSeedActors()
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'password123' })
    const now = new Date()
    const currentRange = tzUtils.resolveBusinessDateRange('today', undefined, undefined, now)
    const todayVisit = await Visit.create({
      client: client._id,
      assignedTo: executive._id,
      assignedBy: admin._id,
      marketingHeadAtAssignment: head._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date(currentRange.from.getTime() + 60_000),
      status: 'COMPLETED',
    })
    const yesterdayVisit = await Visit.create({
      client: client._id,
      assignedTo: executive._id,
      assignedBy: admin._id,
      marketingHeadAtAssignment: head._id,
      source: 'ADMIN_ASSIGNED',
      plannedDate: new Date(currentRange.from.getTime() - 60_000),
      status: 'COMPLETED',
    })

    const clientReport = await request(app)
      .get('/api/reports/client?preset=today')
      .set('Cookie', adminLogin.headers['set-cookie'])
    expect(clientReport.status).toBe(200)
    const returnedIds = clientReport.body.data.items.map((item: { _id: string }) => item._id)
    expect(returnedIds).toContain(String(todayVisit._id))
    expect(returnedIds).not.toContain(String(yesterdayVisit._id))

    const csvToday = await request(app)
      .get('/api/reports/export?view=client&format=csv&preset=today')
      .set('Cookie', adminLogin.headers['set-cookie'])
    expect(csvToday.status).toBe(200)
    expect(csvToday.text).toContain('Priya Cinema')
    expect(csvToday.text).toContain(tzUtils.formatIstDateTime(todayVisit.plannedDate))
    expect(csvToday.text.split('\r\n')).toHaveLength(2)
  })
})

