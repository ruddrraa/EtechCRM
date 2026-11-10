import mongoose from 'mongoose'
import { Client } from '../models/Client.js'
import { Category } from '../models/Category.js'
import { recordAudit } from './audit.js'
import { AppError } from '../utils/errors.js'
import { User } from '../models/User.js'
import type { AuthUser } from '../middleware/auth.js'
import { isHeadRole } from '../middleware/auth.js'

async function resolveCategory(input: Record<string, unknown>) {
  if (input.categoryId) {
    const categoryDoc = await Category.findById(input.categoryId)
    if (!categoryDoc) throw new AppError(400, 'Selected category does not exist')
    if (!categoryDoc.isActive) throw new AppError(400, 'Selected category is inactive')
    input.categoryId = categoryDoc._id
    input.category = categoryDoc.name
  } else if (input.category) {
    const categoryDoc = await Category.findOne({ normalizedName: String(input.category).trim().toLowerCase() })
    if (categoryDoc) {
      if (!categoryDoc.isActive) throw new AppError(400, 'Selected category is inactive')
      input.categoryId = categoryDoc._id
      input.category = categoryDoc.name
    } else {
      const categoryCount = await Category.countDocuments({})
      if (categoryCount > 0) {
        throw new AppError(400, 'Invalid category. Please select an active category from the Category Master')
      }
    }
  }
}

export async function listClients(query: { q?: string; page?: number; limit?: number }) {
  const page = Math.max(1, query.page ?? 1)
  const limit = Math.min(100, Math.max(1, query.limit ?? 20))
  const filter = { isActive: true, ...(query.q ? { $text: { $search: query.q } } : {}) }
  const [items, total] = await Promise.all([
    Client.find(filter)
      .populate('createdBy', 'name')
      .populate('categoryId', 'name isActive')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Client.countDocuments(filter),
  ])
  return { items, page, limit, total, pages: Math.ceil(total / limit) }
}

export async function createClient(input: Record<string, unknown>, actor: string) {
  const creator = await User.findById(actor).select('name').lean()
  if (!creator) throw new AppError(401, 'Authenticated user not found')
  await resolveCategory(input)
  const client = await Client.create({ ...input, createdBy: actor, createdByName: creator.name })
  await recordAudit(actor, 'CLIENT_CREATED', 'Client', String(client._id), { organisationName: client.organisationName })
  return client
}

export async function updateClient(id: string, input: Record<string, unknown>, actor: AuthUser | string) {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(422, 'Invalid client ID')
  }

  const actorObj: AuthUser | null = typeof actor === 'string' ? null : actor
  const actorId = typeof actor === 'string' ? actor : actor.id

  const existing = await Client.findOne({ _id: id, isActive: true })
  if (!existing) throw new AppError(404, 'Client not found')

  // Enforce Marketing Head team isolation on client updates while keeping Super Admin org-wide access
  if (actorObj && actorObj.role !== 'SUPER_ADMIN') {
    if (isHeadRole(actorObj.role)) {
      const createdById = String(existing.createdBy)
      if (createdById !== actorId) {
        const isTeamCreator = await User.exists({ _id: existing.createdBy, reportingTo: actorId })
        if (!isTeamCreator) {
          throw new AppError(403, 'You can only edit clients created by yourself or your team')
        }
      }
    } else {
      throw new AppError(403, 'You do not have permission to edit clients')
    }
  }

  await resolveCategory(input)
  const client = await Client.findOneAndUpdate({ _id: id, isActive: true }, { $set: input }, { new: true, runValidators: true })
  if (!client) throw new AppError(404, 'Client not found')
  await recordAudit(actorId, 'CLIENT_UPDATED', 'Client', id)
  return client
}

export async function archiveClient(id: string, actor: string) {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(422, 'Invalid client ID')
  }
  const client = await Client.findOneAndUpdate({ _id: id, isActive: true }, { $set: { isActive: false } }, { new: true })
  if (!client) throw new AppError(404, 'Client not found')
  await recordAudit(actor, 'CLIENT_ARCHIVED', 'Client', id)
  return client
}
