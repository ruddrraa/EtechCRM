import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { env } from '../config/env.js'
import { User } from '../models/User.js'
import { AppError } from '../utils/errors.js'

export type AuthUser = { id: string; role: 'SUPER_ADMIN' | 'MARKETING_HEAD' | 'MARKETING_EXECUTIVE' | 'ADMIN' | 'USER'; tokenVersion: number }
declare module 'express-serve-static-core' { interface Request { authUser?: AuthUser } }

export function isAllowedOrigin(origin: string) {
  const configuredOrigins = env.CLIENT_URL.split(',').map((item) => item.trim()).filter(Boolean)
  if (configuredOrigins.includes(origin)) return true
  if (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`) return true
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL && origin === `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) return true
  return env.NODE_ENV === 'development' && /^https?:\/\/(localhost|127\.0\.0\.1):517[34]$/.test(origin)
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.accessToken
    if (!token || typeof token !== 'string') throw new AppError(401, 'Authentication required')
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as Partial<AuthUser>
    if (!payload.id || !mongoose.isValidObjectId(payload.id) || typeof payload.tokenVersion !== 'number') {
      throw new AppError(401, 'Authentication required')
    }
    const user = await User.findOne({ _id: payload.id, isActive: true, isArchived: { $ne: true } }).select('_id role tokenVersion').lean()
    if (!user) throw new AppError(401, 'Session is no longer valid')
    const tokenVersion = user.tokenVersion ?? 0
    if (payload.tokenVersion !== tokenVersion) throw new AppError(401, 'Session is no longer valid')
    req.authUser = { id: String(user._id), role: user.role as AuthUser['role'], tokenVersion }
    next()
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(401, 'Authentication required'))
  }
}

export function requireRoles(...allowed: AuthUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.authUser || !allowed.includes(req.authUser.role)) return next(new AppError(403, 'You do not have permission for this action'))
    next()
  }
}

export function requireSameOrigin(req: Request, _res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()

  const fetchSite = req.get('sec-fetch-site')
  if (fetchSite === 'cross-site') {
    return next(new AppError(403, 'Cross-site request is not allowed'))
  }

  const origin = req.get('origin')
  if (origin) {
    if (!isAllowedOrigin(origin)) return next(new AppError(403, 'Origin is not allowed'))
    return next()
  }

  const referer = req.get('referer')
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin
      if (!isAllowedOrigin(refererOrigin)) return next(new AppError(403, 'Origin is not allowed'))
    } catch {
      return next(new AppError(403, 'Origin is not allowed'))
    }
  }

  next()
}

export function isExecutiveRole(role: AuthUser['role']) {
  return role === 'MARKETING_EXECUTIVE' || role === 'USER'
}

export function isHeadRole(role: AuthUser['role']) {
  return role === 'MARKETING_HEAD' || role === 'ADMIN'
}
