import type { NextFunction, Request, Response } from 'express'
import type { ZodTypeAny } from 'zod'

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
