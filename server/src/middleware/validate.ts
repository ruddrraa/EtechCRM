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
      schema.parse(req.query)
      next()
    } catch (error) { next(error) }
  }
}
