import { Client } from '../models/Client.js'
import { Visit } from '../models/Visit.js'
import { User } from '../models/User.js'
import { AppError } from '../utils/errors.js'
import { recordAudit } from './audit.js'
import { createNotification } from './notification.js'
import { isExecutiveRole, isHeadRole } from '../middleware/auth.js'
import type { AuthUser } from '../middleware/auth.js'

async function ownFilter(user: AuthUser) {
  if (isExecutiveRole(user.role)) return { assignedTo: user.id }
  if (isHeadRole(user.role)) {
    const team = await User.find({ reportingTo: user.id, role: { $in: ['MARKETING_EXECUTIVE', 'USER'] } }).select('_id').lean()
    return { assignedTo: { $in: team.map((item) => item._id) } }
  }
  return {}
}

export async function listVisits(user: AuthUser, query: { page?: number; limit?: number; status?: string; clientId?: string }) {
  const page = Math.max(1, query.page ?? 1)
  const limit = Math.min(100, Math.max(1, query.limit ?? 20))
  const filter = { ...(await ownFilter(user)), ...(query.status ? { status: query.status } : {}), ...(query.clientId ? { client: query.clientId } : {}) }
  const [items, total] = await Promise.all([
    Visit.find(filter).populate('client', 'organisationName category address').populate('assignedTo', 'name email').populate('assignedBy', 'name').sort({ plannedDate: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Visit.countDocuments(filter),
  ])
  return { items, page, limit, total, pages: Math.ceil(total / limit) }
}

async function ensureClient(clientId: string) {
  const client = await Client.findOne({ _id: clientId, isActive: true })
  if (!client) throw new AppError(404, 'Client not found')
  return client
}

export async function createAssignedVisit(input: { clientId: string; assignedTo: string; plannedDate: Date; instructions?: string }, actor: AuthUser) {
  if (isExecutiveRole(actor.role)) throw new AppError(403, 'Executives may only self-assign visits')
  await ensureClient(input.clientId)
  const executive = await User.findOne({ _id: input.assignedTo, role: { $in: ['MARKETING_EXECUTIVE', 'USER'] }, isActive: true, isArchived: { $ne: true } })
  if (!executive) throw new AppError(400, 'Assigned user must be an active Marketing Executive')
  if (actor.role === 'MARKETING_HEAD' && String(executive.reportingTo ?? '') !== actor.id) throw new AppError(403, 'You can only assign visits to your own team')
  const visit = await Visit.create({ client: input.clientId, assignedTo: input.assignedTo, assignedBy: actor.id, marketingHeadAtAssignment: actor.role === 'MARKETING_HEAD' ? actor.id : undefined, source: 'ADMIN_ASSIGNED', plannedDate: input.plannedDate, instructions: input.instructions, status: 'ASSIGNED' })
  await recordAudit(actor.id, 'VISIT_ASSIGNED', 'Visit', String(visit._id), { assignedTo: input.assignedTo })
  await createNotification({ recipient: input.assignedTo, title: 'New visit assigned', message: `You have a visit scheduled for ${visit.plannedDate.toLocaleString()}.`, type: 'VISIT_ASSIGNED', entityType: 'Visit', entityId: String(visit._id) })
  if (actor.role === 'SUPER_ADMIN' && executive.reportingTo) await createNotification({ recipient: String(executive.reportingTo), title: 'Team visit assigned', message: `${executive.name} has received a new visit assignment.`, type: 'VISIT_ASSIGNED', entityType: 'Visit', entityId: String(visit._id) })
  return visit
}

export async function selfAssignVisit(input: { clientId: string; plannedDate: Date; instructions?: string }, actor: AuthUser) {
  await ensureClient(input.clientId)
  const visit = await Visit.create({ client: input.clientId, assignedTo: actor.id, assignedBy: actor.id, source: 'SELF_ASSIGNED', plannedDate: input.plannedDate, instructions: input.instructions, status: 'ASSIGNED' })
  await recordAudit(actor.id, 'VISIT_SELF_ASSIGNED', 'Visit', String(visit._id))
  return visit
}

async function ownVisit(id: string, actor: AuthUser) {
  const visit = await Visit.findById(id)
  if (!visit) throw new AppError(404, 'Visit not found')
  if (isExecutiveRole(actor.role) && String(visit.assignedTo) !== actor.id) throw new AppError(404, 'Visit not found')
  if (actor.role === 'MARKETING_HEAD' && String(visit.assignedBy) !== actor.id) {
    const assigned = await User.findOne({ _id: visit.assignedTo, reportingTo: actor.id })
    if (!assigned) throw new AppError(404, 'Visit not found')
  }
  return visit
}

export async function getVisit(id: string, actor: AuthUser) {
  const visit = await ownVisit(id, actor)
  await visit.populate('client', 'organisationName category address')
  await visit.populate('assignedTo', 'name email')
  await visit.populate('assignedBy', 'name')
  return visit
}

export async function markArrived(id: string, actor: AuthUser) {
  const visit = await ownVisit(id, actor)
  if (visit.status !== 'ASSIGNED' && visit.status !== 'PLANNED') throw new AppError(409, 'Visit cannot be marked arrived from its current status')
  visit.arrivedAt = new Date()
  visit.status = 'ARRIVED'
  await visit.save()
  await recordAudit(actor.id, 'VISIT_ARRIVED', 'Visit', id)
  if (String(visit.assignedBy) !== actor.id) await createNotification({ recipient: String(visit.assignedBy), title: 'Executive arrived', message: 'An assigned visit was marked arrived.', type: 'VISIT_UPDATED', entityType: 'Visit', entityId: id })
  return visit
}

export async function checkIn(id: string, location: Record<string, unknown>, actor: AuthUser) {
  const visit = await ownVisit(id, actor)
  if (visit.status !== 'ARRIVED') throw new AppError(409, 'Visit must be marked arrived before check-in')
  visit.checkIn = { ...location, recordedAt: new Date() } as never
  visit.status = 'CHECKED_IN'
  await visit.save()
  await recordAudit(actor.id, 'VISIT_CHECKED_IN', 'Visit', id, { locationStatus: location.locationStatus })
  if (String(visit.assignedBy) !== actor.id) await createNotification({ recipient: String(visit.assignedBy), title: 'Visit checked in', message: 'An assigned visit has been checked in.', type: 'VISIT_UPDATED', entityType: 'Visit', entityId: id })
  return visit
}

export async function complete(id: string, input: { remarks: string; followUpDate?: Date; location: Record<string, unknown> }, actor: AuthUser) {
  const visit = await ownVisit(id, actor)
  if (visit.status !== 'CHECKED_IN') throw new AppError(409, 'Visit must be checked in before checkout')
  visit.checkOut = { ...input.location, recordedAt: new Date() } as never
  visit.remarks = input.remarks
  visit.followUpDate = input.followUpDate
  visit.status = 'COMPLETED'
  await visit.save()
  await recordAudit(actor.id, 'VISIT_COMPLETED', 'Visit', id, { locationStatus: input.location.locationStatus })
  if (String(visit.assignedBy) !== actor.id) await createNotification({ recipient: String(visit.assignedBy), title: 'Visit completed', message: 'An assigned visit has been completed.', type: 'VISIT_UPDATED', entityType: 'Visit', entityId: id })
  return visit
}

export async function cancel(id: string, reason: string, actor: AuthUser) {
  const visit = await ownVisit(id, actor)
  if (visit.status === 'COMPLETED' || visit.status === 'CANCELLED') throw new AppError(409, 'Visit cannot be cancelled from its current status')
  if (visit.source === 'ADMIN_ASSIGNED' && isExecutiveRole(actor.role)) throw new AppError(403, 'Executives cannot cancel Admin-assigned visits')
  if (visit.source === 'ADMIN_ASSIGNED' && actor.role === 'MARKETING_HEAD' && String(visit.assignedBy) !== actor.id) throw new AppError(403, 'Only the assigning Marketing Head or Super Admin can cancel this visit')
  visit.status = 'CANCELLED'
  visit.cancellationReason = reason
  visit.cancelledBy = actor.id as never
  visit.cancelledAt = new Date()
  await visit.save()
  await recordAudit(actor.id, 'VISIT_CANCELLED', 'Visit', id, { reason })
  const cancellationRecipients = new Set([String(visit.assignedTo), String(visit.assignedBy)])
  cancellationRecipients.delete(actor.id)
  await Promise.all([...cancellationRecipients].map((recipient) => createNotification({ recipient, title: 'Visit cancelled', message: reason, type: 'VISIT_CANCELLED', entityType: 'Visit', entityId: id })))
  return visit
}

export async function reschedule(id: string, plannedDate: Date, actor: AuthUser) {
  const visit = await ownVisit(id, actor)
  if (visit.status === 'COMPLETED' || visit.status === 'CANCELLED' || visit.status === 'CHECKED_IN') throw new AppError(409, 'Visit cannot be rescheduled from its current status')
  if (visit.source === 'ADMIN_ASSIGNED' && actor.role === 'MARKETING_HEAD' && String(visit.assignedBy) !== actor.id) throw new AppError(403, 'Only the assigning Marketing Head or Super Admin can reschedule this visit')
  if (visit.source === 'ADMIN_ASSIGNED' && isExecutiveRole(actor.role)) throw new AppError(403, 'Executives cannot reschedule Admin-assigned visits')
  visit.plannedDate = plannedDate
  await visit.save()
  await recordAudit(actor.id, 'VISIT_RESCHEDULED', 'Visit', id, { plannedDate })
  return visit
}
