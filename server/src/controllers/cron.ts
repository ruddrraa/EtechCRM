import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { AppError } from '../utils/errors.js'
import { success } from '../utils/api.js'
import { runDailyFollowUpAutomation } from '../services/followup.js'
import { CronJobRun } from '../models/CronJobRun.js'
import { maskSensitiveText } from '../middleware/error.js'
import { isVapidReady } from '../services/push.js'

const cronQuerySchema = z.object({
  date: z.coerce.date().optional(),
  timeZone: z.string().trim().min(1).max(64).optional(),
})

function extractCronToken(req: Request): string | null {
  const authHeader = req.get('authorization')
  if (authHeader && /^bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^bearer\s+/i, '').trim()
    return token || null
  }
  const headerToken = req.get('x-cron-secret')?.trim()
  return headerToken || null
}

function constantTimeSecretEqual(expected: string, provided: string): boolean {
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest()
  const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest()
  return crypto.timingSafeEqual(expectedDigest, providedDigest)
}

export function requireCronSecret(req: Request, _res: Response, next: NextFunction): void {
  const configuredSecret = process.env.CRON_SECRET ?? env.CRON_SECRET
  if (!configuredSecret || configuredSecret.trim().length < 32) {
    next(new AppError(503, 'CRON_SECRET must be configured with at least 32 characters on the server'))
    return
  }

  const providedToken = extractCronToken(req)
  if (!providedToken || !constantTimeSecretEqual(configuredSecret.trim(), providedToken)) {
    next(new AppError(401, 'Unauthorized cron request'))
    return
  }

  next()
}

export async function handleDailyFollowUpsCron(req: Request, res: Response) {
  const rawInput = req.method === 'POST' && req.body && Object.keys(req.body).length > 0 ? req.body : req.query
  const parsed = cronQuerySchema.parse(rawInput)
  const result = await runDailyFollowUpAutomation({
    referenceDate: parsed.date,
    timeZone: parsed.timeZone,
  })
  return success(res, result)
}

export async function handleListCronRuns(req: Request, res: Response) {
  const requestedLimit = Number(req.query.limit)
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(10, Math.floor(requestedLimit)) : 10
  const docs = await CronJobRun.find({})
    .select('_id jobName dateKey timeZone status startedAt finishedAt durationMs counters errorMessage')
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean()

  const runs = docs.map((doc) => ({
    _id: String(doc._id),
    jobName: doc.jobName,
    dateKey: doc.dateKey,
    timeZone: doc.timeZone,
    status: doc.status,
    startedAt: doc.startedAt,
    finishedAt: doc.finishedAt,
    durationMs: doc.durationMs,
    counters: doc.counters,
    ...(doc.errorMessage ? { errorMessage: maskSensitiveText(doc.errorMessage) } : {}),
  }))

  const configuredSecret = process.env.CRON_SECRET ?? env.CRON_SECRET
  return success(res, {
    runs,
    limit,
    diagnostics: {
      cronSecretConfigured: Boolean(configuredSecret && configuredSecret.trim().length >= 32),
      vapidConfigured: isVapidReady(),
      followUpTimezone: env.FOLLOWUP_TIMEZONE,
    },
  })
}

