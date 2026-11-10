import { createHash } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { RateLimitBucket } from '../models/RateLimitBucket.js'
import { AppError } from '../utils/errors.js'

export interface DistributedLimiterOptions {
  name: string
  windowMs: number
  max: number
  message?: string
  keyGenerator?: (req: Request) => string
}

export function hashRateLimitKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function consumeRateLimitWindow(
  namespace: string,
  rawIdentifier: string,
  windowMs: number
): Promise<{ count: number; resetAt: Date }> {
  const key = `${namespace}:${hashRateLimitKey(rawIdentifier)}`
  const now = new Date()
  const nextReset = new Date(now.getTime() + windowMs)

  // Fast path: 1 atomic increment if active window exists and has not expired
  const incremented = await RateLimitBucket.findOneAndUpdate(
    { key, resetAt: { $gt: now } },
    { $inc: { count: 1 } },
    { new: true }
  ).lean()

  if (incremented) {
    return { count: incremented.count, resetAt: incremented.resetAt }
  }

  // Expired or missing window: atomically reset to count=1
  try {
    const resetDoc = await RateLimitBucket.findOneAndUpdate(
      { key, $or: [{ resetAt: { $lte: now } }, { resetAt: { $exists: false } }] },
      { $set: { count: 1, resetAt: nextReset, expiresAt: nextReset } },
      { upsert: true, new: true }
    ).lean()

    if (resetDoc) {
      return { count: resetDoc.count, resetAt: resetDoc.resetAt }
    }
  } catch (err: unknown) {
    // Handle concurrent first-insert duplicate key race (E11000) cleanly
    if ((err as { code?: number })?.code === 11000) {
      const retry = await RateLimitBucket.findOneAndUpdate(
        { key, resetAt: { $gt: now } },
        { $inc: { count: 1 } },
        { new: true }
      ).lean()
      if (retry) {
        return { count: retry.count, resetAt: retry.resetAt }
      }
    }
    throw err
  }

  return { count: 1, resetAt: nextReset }
}

export function createDistributedRateLimiter(options: DistributedLimiterOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identifier = options.keyGenerator
        ? options.keyGenerator(req)
        : req.authUser?.id || req.ip || 'unknown'

      const { count, resetAt } = await consumeRateLimitWindow(options.name, identifier, options.windowMs)
      const remaining = Math.max(0, options.max - count)
      const resetSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))

      res.setHeader('RateLimit-Limit', String(options.max))
      res.setHeader('RateLimit-Remaining', String(remaining))
      res.setHeader('RateLimit-Reset', String(resetSeconds))

      if (count > options.max) {
        res.setHeader('Retry-After', String(resetSeconds))
        return next(new AppError(429, options.message || 'Too many requests. Please try again later.'))
      }

      return next()
    } catch {
      // Fail closed: never allow unlimited security-sensitive requests if the store is unavailable
      return next(new AppError(503, 'Rate limit protection is temporarily unavailable. Please try again shortly.'))
    }
  }
}

export const loginAccountLimiter = createDistributedRateLimiter({
  name: 'auth_login_acct',
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    return `${req.ip || 'unknown'}:${email}`
  },
  message: 'Too many login attempts for this account. Please wait 15 minutes before trying again.',
})

export const loginIpLimiter = createDistributedRateLimiter({
  name: 'auth_login_ip',
  windowMs: 15 * 60 * 1000,
  max: 150,
  keyGenerator: (req) => req.ip || 'unknown',
  message: 'Too many authentication requests from this IP. Please try again later.',
})

export const passwordSessionLimiter = createDistributedRateLimiter({
  name: 'auth_session_sensitive',
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.authUser?.id || req.ip || 'unknown',
  message: 'Too many password or session security requests. Please try again later.',
})

export const uploadRateLimiter = createDistributedRateLimiter({
  name: 'file_upload',
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.authUser?.id || req.ip || 'unknown',
  message: 'Too many file uploads. Please try again later.',
})

export const mapsRateLimiter = createDistributedRateLimiter({
  name: 'maps_proxy',
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.authUser?.id || req.ip || 'unknown',
  message: 'Too many address lookup requests. Please wait a moment.',
})

export const pushRateLimiter = createDistributedRateLimiter({
  name: 'push_api',
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.authUser?.id || req.ip || 'unknown',
  message: 'Too many push notification configuration requests. Please try again later.',
})

