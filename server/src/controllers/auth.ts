import bcrypt from 'bcryptjs'
import type { Request, Response } from 'express'
import { User } from '../models/User.js'
import { authenticate, clearCookieOptions, cookieOptions, tokenFor } from '../services/auth.js'
import { recordAudit } from '../services/audit.js'
import { success } from '../utils/api.js'
import { AppError } from '../utils/errors.js'
import { env } from '../config/env.js'
import { timingSafeEqual } from 'node:crypto'
import { isHeadRole } from '../middleware/auth.js'

function safeUser(user: { toObject: () => Record<string, unknown> }) {
  const object = user.toObject()
  delete object.passwordHash
  return object
}

export async function login(req: Request, res: Response) {
  const user = await authenticate(req.body.email, req.body.password)
  res.cookie('accessToken', tokenFor(String(user._id), user.role, user.tokenVersion), cookieOptions())
  return success(res, safeUser(user))
}

export async function logout(req: Request, res: Response) {
  if (req.authUser) await User.findByIdAndUpdate(req.authUser.id, { $inc: { tokenVersion: 1 } })
  res.clearCookie('accessToken', clearCookieOptions())
  return success(res, { loggedOut: true })
}

export async function logoutAll(req: Request, res: Response) {
  if (req.authUser) await User.findByIdAndUpdate(req.authUser.id, { $inc: { tokenVersion: 1 } })
  res.clearCookie('accessToken', clearCookieOptions())
  return success(res, { loggedOutAll: true })
}

export async function me(req: Request, res: Response) {
  const user = await User.findById(req.authUser!.id)
  if (!user) throw new AppError(401, 'Session is no longer valid')
  return success(res, safeUser(user))
}

export async function createUser(req: Request, res: Response) {
  const actor = req.authUser!
  const role = req.body.role === 'ADMIN' ? 'MARKETING_HEAD' : req.body.role === 'USER' ? 'MARKETING_EXECUTIVE' : req.body.role
  if (role === 'MARKETING_HEAD' && actor.role !== 'SUPER_ADMIN') throw new AppError(403, 'Only Super Admin can create Marketing Head accounts')
  if (role === 'MARKETING_EXECUTIVE' && actor.role !== 'SUPER_ADMIN' && !isHeadRole(actor.role)) throw new AppError(403, 'Only a Marketing Head or Super Admin can create executives')
  let reportingTo = req.body.reportingTo ?? null
  if (role === 'MARKETING_EXECUTIVE') {
    if (actor.role === 'MARKETING_HEAD') reportingTo = actor.id
    const manager = reportingTo ? await User.findOne({ _id: reportingTo, role: { $in: ['MARKETING_HEAD', 'ADMIN'] }, isActive: true, isArchived: { $ne: true } }) : null
    if (!manager) throw new AppError(422, 'An active Marketing Head is required')
    if (actor.role === 'MARKETING_HEAD' && String(manager._id) !== actor.id) throw new AppError(403, 'You can only create executives for your own team')
  } else if (req.body.reportingTo) {
    throw new AppError(422, 'Marketing Heads cannot have a reporting manager')
  }

  const normalizedEmail = req.body.email.toLowerCase().trim()
  const existingUser = await User.findOne({ email: normalizedEmail })

  if (existingUser) {
    if (!existingUser.isArchived) {
      throw new AppError(409, 'A staff member with this email already exists')
    }
    // Re-activating and updating previously archived/deleted staff member
    const passwordHash = await bcrypt.hash(req.body.password, 12)
    existingUser.name = req.body.name
    existingUser.phone = req.body.phone
    existingUser.role = role
    existingUser.designation = req.body.designation
    existingUser.reportingTo = reportingTo
    existingUser.passwordHash = passwordHash
    existingUser.isActive = true
    existingUser.isArchived = false
    existingUser.tokenVersion = (existingUser.tokenVersion || 0) + 1
    await existingUser.save()
    await recordAudit(actor.id, 'USER_CREATED', 'User', String(existingUser._id), { role: existingUser.role, restored: true })
    return success(res, safeUser(existingUser), 201)
  }

  const passwordHash = await bcrypt.hash(req.body.password, 12)
  const user = await User.create({ ...req.body, email: normalizedEmail, role, passwordHash, reportingTo, isActive: true, isArchived: false })
  await recordAudit(actor.id, 'USER_CREATED', 'User', String(user._id), { role: user.role })
  return success(res, safeUser(user), 201)
}

export async function bootstrap(req: Request, res: Response) {
  if (!env.BOOTSTRAP_TOKEN) throw new AppError(404, 'Bootstrap is not enabled')
  const suppliedToken = req.header('x-bootstrap-token') ?? ''
  const expected = Buffer.from(env.BOOTSTRAP_TOKEN)
  const supplied = Buffer.from(suppliedToken)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new AppError(401, 'Invalid bootstrap token')
  if (await User.exists({})) throw new AppError(409, 'Initial account has already been created')
  const passwordHash = await bcrypt.hash(req.body.password, 12)
  const user = await User.create({ name: req.body.name, email: req.body.email, passwordHash, role: 'SUPER_ADMIN', isActive: true })
  return success(res, safeUser(user), 201)
}

export async function changePassword(req: Request, res: Response) {
  const user = await User.findById(req.authUser!.id).select('+passwordHash')
  if (!user || !(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) throw new AppError(400, 'Current password is incorrect')
  user.passwordHash = await bcrypt.hash(req.body.newPassword, 12)
  user.tokenVersion += 1
  await user.save()
  return success(res, { changed: true })
}
