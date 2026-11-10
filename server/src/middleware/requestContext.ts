import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string
  }
}

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
export const SLOW_REQUEST_THRESHOLD_MS = 2500

export function resolveRequestId(rawHeader: string | undefined): string {
  const candidate = rawHeader?.trim()
  if (candidate && REQUEST_ID_PATTERN.test(candidate)) {
    return candidate
  }
  return crypto.randomUUID()
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.get('x-request-id'))
  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)

  const startedAt = Date.now()
  res.once('finish', () => {
    const durationMs = Date.now() - startedAt
    if (durationMs >= SLOW_REQUEST_THRESHOLD_MS) {
      console.warn('[Slow Request]', {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
      })
    }
  })

  next()
}

