import { Visit } from '../models/Visit.js'
import { FollowUpTask } from '../models/FollowUpTask.js'
import { CronJobRun } from '../models/CronJobRun.js'
import { createIdempotentNotification } from './notification.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/errors.js'

export const ACTIVE_FOLLOWUP_STATUSES = ['PLANNED', 'ASSIGNED', 'ARRIVED', 'CHECKED_IN'] as const
export const MAX_CRON_VISITS_PER_RUN = 200
export const DEFAULT_CRON_TIME_BUDGET_MS = 7500
const CRON_JOB_NAME = 'DAILY_FOLLOWUPS'
const CRON_ACTIVE_LOCK_KEY = 'ACTIVE:DAILY_FOLLOWUPS'
const CRON_LOCK_LEASE_MS = 60_000
const CONCURRENT_BATCH_SIZE = 5

export interface BusinessDayWindow {
  dateKey: string
  timeZone: string
  startOfDayUtc: Date
  endOfDayUtc: Date
}

export interface FollowUpCronCounters {
  scannedVisits: number
  dueVisits: number
  eligibleVisits: number
  notificationsCreated: number
  deduplicatedSkipped: number
  skippedPreferences: number
  skippedInactiveUsers: number
  pushSent: number
  pushFailed: number
  expiredSubscriptionsRemoved: number
  errors: number
}

export interface FollowUpCronResult {
  jobName: string
  runId?: string
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'SKIPPED_CONCURRENT_RUN'
  dateKey: string
  timeZone: string
  windowStartUtc: string
  windowEndUtc: string
  durationMs: number
  counters: FollowUpCronCounters
}

function validateTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    throw new AppError(422, `Invalid timezone: "${timeZone}"`)
  }
}

function getOffsetMsAt(utcMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(utcMs))
  const lookup: Record<string, number> = {}
  for (const part of parts) {
    if (part.type !== 'literal') {
      lookup[part.type] = Number(part.value)
    }
  }
  const tzAsUtc = Date.UTC(
    lookup.year,
    lookup.month - 1,
    lookup.day,
    lookup.hour === 24 ? 0 : lookup.hour,
    lookup.minute,
    lookup.second
  )
  const truncatedUtc = Math.floor(utcMs / 1000) * 1000
  return tzAsUtc - truncatedUtc
}

function zonedMidnightToUtc(dateKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  const offset1 = getOffsetMsAt(utcMidnight, timeZone)
  const candidate = utcMidnight - offset1
  const offset2 = getOffsetMsAt(candidate, timeZone)
  return new Date(utcMidnight - offset2)
}

export function resolveBusinessDayWindow(
  referenceDate: Date = new Date(),
  requestedTimeZone?: string
): BusinessDayWindow {
  const timeZone = validateTimeZone(requestedTimeZone || env.FOLLOWUP_TIMEZONE || 'Asia/Kolkata')
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(referenceDate)

  const [year, month, day] = dateKey.split('-').map(Number)
  const startOfDayUtc = zonedMidnightToUtc(dateKey, timeZone)
  const nextDayKey = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
  const endOfDayUtc = new Date(zonedMidnightToUtc(nextDayKey, timeZone).getTime() - 1)

  return {
    dateKey,
    timeZone,
    startOfDayUtc,
    endOfDayUtc,
  }
}

function createEmptyCounters(): FollowUpCronCounters {
  return {
    scannedVisits: 0,
    dueVisits: 0,
    eligibleVisits: 0,
    notificationsCreated: 0,
    deduplicatedSkipped: 0,
    skippedPreferences: 0,
    skippedInactiveUsers: 0,
    pushSent: 0,
    pushFailed: 0,
    expiredSubscriptionsRemoved: 0,
    errors: 0,
  }
}

type PopulatedAssignee = {
  _id: unknown
  name?: string
  isActive?: boolean
  isArchived?: boolean
  notificationPreferences?: {
    dailyProductivity?: boolean
    newEventCreated?: boolean
    mobilePush?: boolean
    desktopAlerts?: boolean
  }
}

type PopulatedDueVisit = {
  _id: unknown
  followUpDate: Date
  status: string
  client?: { organisationName?: string } | null
  assignedTo?: PopulatedAssignee | null
}

type PopulatedDueTask = {
  _id: unknown
  dueDate: Date
  status: string
  sourceVisit?: { _id: unknown; status?: string } | null
  client?: { organisationName?: string } | null
  assignedTo?: PopulatedAssignee | null
}

type ReminderCandidate = {
  visitId: string
  clientName: string
  assignee: PopulatedAssignee | null | undefined
}

export async function runDailyFollowUpAutomation(options: {
  referenceDate?: Date
  timeZone?: string
  maxVisits?: number
  timeBudgetMs?: number
} = {}): Promise<FollowUpCronResult> {
  const startedMs = Date.now()
  const referenceDate = options.referenceDate ?? new Date()
  const window = resolveBusinessDayWindow(referenceDate, options.timeZone)
  const maxVisits = Math.min(MAX_CRON_VISITS_PER_RUN, Math.max(1, options.maxVisits ?? MAX_CRON_VISITS_PER_RUN))
  const timeBudgetMs = Math.max(500, Math.min(9000, options.timeBudgetMs ?? DEFAULT_CRON_TIME_BUDGET_MS))
  const counters = createEmptyCounters()

  // Release stale crashed lease locks before attempting lock acquisition
  await CronJobRun.updateMany(
    {
      jobName: CRON_JOB_NAME,
      lockKey: CRON_ACTIVE_LOCK_KEY,
      lockExpiresAt: { $lte: new Date() },
    },
    {
      $set: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: 'Previous serverless execution lease expired',
      },
      $unset: { lockKey: 1 },
    }
  )

  let runDoc: InstanceType<typeof CronJobRun>
  try {
    runDoc = await CronJobRun.create({
      jobName: CRON_JOB_NAME,
      dateKey: window.dateKey,
      timeZone: window.timeZone,
      status: 'RUNNING',
      lockKey: CRON_ACTIVE_LOCK_KEY,
      lockExpiresAt: new Date(startedMs + CRON_LOCK_LEASE_MS),
      startedAt: new Date(startedMs),
      counters,
    })
  } catch (err: unknown) {
    const mongoErr = err as { code?: number }
    if (mongoErr?.code === 11000) {
      return {
        jobName: CRON_JOB_NAME,
        status: 'SKIPPED_CONCURRENT_RUN',
        dateKey: window.dateKey,
        timeZone: window.timeZone,
        windowStartUtc: window.startOfDayUtc.toISOString(),
        windowEndUtc: window.endOfDayUtc.toISOString(),
        durationMs: Date.now() - startedMs,
        counters,
      }
    }
    throw err
  }

  let budgetExceeded = false
  let fatalError: unknown = null
  let finalStatus: 'COMPLETED' | 'PARTIAL' | 'FAILED' = 'COMPLETED'
  let durationMs = 0

  try {
    // 1. Primary path: Pending FollowUpTask items due today (covers checkout follow-ups linked to COMPLETED visits)
    const dueTasks = (await FollowUpTask.find({
      dueDate: { $gte: window.startOfDayUtc, $lte: window.endOfDayUtc },
      status: 'PENDING',
    })
      .sort({ dueDate: 1, _id: 1 })
      .limit(maxVisits)
      .populate('client', 'organisationName')
      .populate('assignedTo', '_id name isActive isArchived notificationPreferences')
      .populate('sourceVisit', '_id status')
      .lean()) as unknown as PopulatedDueTask[]

    // 2. Secondary path: Open active visits with direct followUpDate (excluding COMPLETED/CANCELLED visits)
    const remainingBudget = Math.max(0, maxVisits - dueTasks.length)
    const dueVisits = remainingBudget > 0
      ? ((await Visit.find({
          followUpDate: { $gte: window.startOfDayUtc, $lte: window.endOfDayUtc },
          status: { $in: [...ACTIVE_FOLLOWUP_STATUSES] },
        })
          .sort({ followUpDate: 1, _id: 1 })
          .limit(remainingBudget)
          .populate('client', 'organisationName')
          .populate('assignedTo', '_id name isActive isArchived notificationPreferences')
          .lean()) as unknown as PopulatedDueVisit[])
      : []

    const candidates: ReminderCandidate[] = []
    const seenVisitKeys = new Set<string>()

    for (const task of dueTasks) {
      if (task.sourceVisit?.status === 'CANCELLED') continue
      const visitId = task.sourceVisit?._id ? String(task.sourceVisit._id) : String(task._id)
      const recipientKey = task.assignedTo?._id ? String(task.assignedTo._id) : 'none'
      const candidateKey = `${visitId}:${recipientKey}`
      if (seenVisitKeys.has(candidateKey)) continue
      seenVisitKeys.add(candidateKey)
      candidates.push({
        visitId,
        clientName: task.client?.organisationName || 'Client follow-up',
        assignee: task.assignedTo,
      })
    }

    for (const visit of dueVisits) {
      const visitId = String(visit._id)
      const recipientKey = visit.assignedTo?._id ? String(visit.assignedTo._id) : 'none'
      const candidateKey = `${visitId}:${recipientKey}`
      if (seenVisitKeys.has(candidateKey)) continue
      seenVisitKeys.add(candidateKey)
      candidates.push({
        visitId,
        clientName: visit.client?.organisationName || 'Client follow-up',
        assignee: visit.assignedTo,
      })
    }

    counters.scannedVisits = candidates.length
    counters.dueVisits = candidates.length

    for (let i = 0; i < candidates.length; i += CONCURRENT_BATCH_SIZE) {
      if (Date.now() - startedMs >= timeBudgetMs) {
        budgetExceeded = true
        break
      }

      const batch = candidates.slice(i, i + CONCURRENT_BATCH_SIZE)
      await Promise.allSettled(
        batch.map(async (candidate) => {
          try {
            const assignee = candidate.assignee
            if (!assignee || !assignee._id || !assignee.isActive || assignee.isArchived) {
              counters.skippedInactiveUsers += 1
              return
            }

            if (assignee.notificationPreferences?.dailyProductivity === false) {
              counters.skippedPreferences += 1
              return
            }

            counters.eligibleVisits += 1
            const recipientId = String(assignee._id)
            const deliveryKey = `followup:${window.dateKey}:${candidate.visitId}:${recipientId}`

            const result = await createIdempotentNotification({
              recipient: recipientId,
              title: 'Follow-up reminder',
              message: `Follow-up scheduled today (${window.dateKey}) for ${candidate.clientName}.`,
              type: 'FOLLOW_UP_REMINDER',
              entityType: 'Visit',
              entityId: candidate.visitId,
              deliveryKey,
            })

            if (result.deduplicated) {
              counters.deduplicatedSkipped += 1
              return
            }

            counters.notificationsCreated += 1
            counters.pushSent += result.pushResult.sent
            counters.pushFailed += result.pushResult.failed
            counters.expiredSubscriptionsRemoved += result.pushResult.removedExpired
          } catch {
            counters.errors += 1
          }
        })
      )
    }
  } catch (err) {
    fatalError = err
    counters.errors += 1
  } finally {
    durationMs = Date.now() - startedMs
    finalStatus = fatalError
      ? 'FAILED'
      : budgetExceeded || counters.errors > 0
        ? 'PARTIAL'
        : 'COMPLETED'

    await CronJobRun.updateOne(
      { _id: runDoc._id },
      {
        $set: {
          status: finalStatus,
          finishedAt: new Date(),
          durationMs,
          counters,
          ...(fatalError
            ? { errorMessage: fatalError instanceof Error ? fatalError.message.slice(0, 500) : 'Cron failed' }
            : {}),
        },
        $unset: { lockKey: 1 },
      }
    ).catch(() => {})

    console.log('[Cron:DailyFollowUps]', {
      runId: String(runDoc._id),
      status: finalStatus,
      dateKey: window.dateKey,
      timeZone: window.timeZone,
      durationMs,
      counters,
    })
  }

  if (fatalError) {
    throw fatalError
  }

  return {
    jobName: CRON_JOB_NAME,
    runId: String(runDoc._id),
    status: finalStatus,
    dateKey: window.dateKey,
    timeZone: window.timeZone,
    windowStartUtc: window.startOfDayUtc.toISOString(),
    windowEndUtc: window.endOfDayUtc.toISOString(),
    durationMs,
    counters,
  }
}
