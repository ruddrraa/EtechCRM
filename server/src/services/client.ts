import { Client } from '../models/Client.js'
import { recordAudit } from './audit.js'
import { AppError } from '../utils/errors.js'
import { User } from '../models/User.js'

export async function listClients(query: { q?: string; page?: number; limit?: number }) {
  const page = Math.max(1, query.page ?? 1)
  const limit = Math.min(100, Math.max(1, query.limit ?? 20))
  const filter = { isActive: true, ...(query.q ? { $text: { $search: query.q } } : {}) }
  const [items, total] = await Promise.all([
    Client.find(filter).populate('createdBy', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Client.countDocuments(filter),
  ])
  return { items, page, limit, total, pages: Math.ceil(total / limit) }
}

export async function createClient(input: Record<string, unknown>, actor: string) {
  const creator = await User.findById(actor).select('name').lean()
  if (!creator) throw new AppError(401, 'Authenticated user not found')
  const client = await Client.create({ ...input, createdBy: actor, createdByName: creator.name })
  await recordAudit(actor, 'CLIENT_CREATED', 'Client', String(client._id), { organisationName: client.organisationName })
  return client
}

export async function updateClient(id: string, input: Record<string, unknown>, actor: string) {
  const client = await Client.findOneAndUpdate({ _id: id, isActive: true }, { $set: input }, { new: true, runValidators: true })
  if (!client) throw new AppError(404, 'Client not found')
  await recordAudit(actor, 'CLIENT_UPDATED', 'Client', id)
  return client
}

export async function archiveClient(id: string, actor: string) {
  const client = await Client.findOneAndUpdate({ _id: id, isActive: true }, { $set: { isActive: false } }, { new: true })
  if (!client) throw new AppError(404, 'Client not found')
  await recordAudit(actor, 'CLIENT_ARCHIVED', 'Client', id)
  return client
}
