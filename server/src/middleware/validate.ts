import type { NextFunction, Request, Response } from 'express'
import type { ZodTypeAny } from 'zod'

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1))
  if (typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const clean: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key) || key.startsWith('$') || key.includes('.')) continue
      clean[key] = sanitizeValue(val, depth + 1)
    }
    return clean
  }
  return value
}

export function sanitizeRequestInputs(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    req.body = sanitizeValue(req.body)
  }
  if (req.query && typeof req.query === 'object') {
    const cleanQuery = sanitizeValue(req.query) as Record<string, unknown>
    for (const key of Object.keys(req.query)) {
      if (!(key in cleanQuery)) {
        delete req.query[key]
      } else {
        req.query[key] = cleanQuery[key] as never
      }
    }
  }
  next()
}

export function validate(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body)
      next()
    } catch (error) { next(error) }
  }
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req.query) as Record<string, unknown>
      Object.keys(req.query).forEach((key) => delete req.query[key])
      Object.assign(req.query, parsed)
      next()
    } catch (error) { next(error) }
  }
}
