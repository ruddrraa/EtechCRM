import mongoose from 'mongoose'
import { Client } from '../models/Client.js'
import { Visit } from '../models/Visit.js'
import { User } from '../models/User.js'
import { FollowUpTask } from '../models/FollowUpTask.js'
import { AppError } from '../utils/errors.js'
import { recordAudit } from './audit.js'
import { createNotification } from './notification.js'
import { isExecutiveRole, isHeadRole } from '../middleware/auth.js'
import type { AuthUser } from '../middleware/auth.js'
import { calculateHaversineDistance, getGeofenceConfig } from './setting.js'

async function ownFilter(user: AuthUser) {
  if (isExecutiveRole(user.role)) return { assignedTo: user.id }
  if (isHeadRole(user.role)) {
    const team = await User.find({ reportingTo: user.id, role: { $in: ['MARKETING_EXECUTIVE', 'USER'] } }).select('_id').lean()
    return { assignedTo: { $in: team.map((item) => item._id) } }
  }
  return {}
}

export const CLIENT_POPULATE_FIELDS = 'organisationName category address latitude longitude geofenceRadius formattedAddress placeId'

export async function listVisits(user: AuthUser, query: { page?: number; limit?: number; status?: string; clientId?: string }) {
  const page = Math.max(1, query.page ?? 1)
  const limit = Math.min(100, Math.max(1, query.limit ?? 20))
  const filter = { ...(await ownFilter(user)), ...(query.status ? { status: query.status } : {}), ...(query.clientId ? { client: query.clientId } : {}) }
  const [items, total] = await Promise.all([
    Visit.find(filter)
      .populate('client', CLIENT_POPULATE_FIELDS)
      .populate('assignedTo', 'name email')
      .populate('assignedBy', 'name')
      .sort({ plannedDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
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
  if (!mongoose.isValidObjectId(id)) throw new AppError(422, 'Invalid visit ID')
  const visit = await Visit.findById(id)
  if (!visit) throw new AppError(404, 'Visit not found')
  if (isExecutiveRole(actor.role) && String(visit.assignedTo) !== actor.id) throw new AppError(404, 'Visit not found')
  if (actor.role === 'MARKETING_HEAD') {
    const assigned = await User.findOne({ _id: visit.assignedTo, reportingTo: actor.id })
    if (!assigned) throw new AppError(404, 'Visit not found')
  }
  return visit
}

export async function getVisit(id: string, actor: AuthUser) {
  const visit = await ownVisit(id, actor)
  await visit.populate('client', CLIENT_POPULATE_FIELDS)
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
  await visit.populate('client', CLIENT_POPULATE_FIELDS)
  await visit.populate('assignedTo', 'name email')
  await visit.populate('assignedBy', 'name')
  return visit
}

export async function checkIn(id: string, location: Record<string, unknown>, actor: AuthUser) {
  const visit = await ownVisit(id, actor)
  if (visit.status !== 'ARRIVED') throw new AppError(409, 'Visit must be marked arrived before check-in')

  const client = await Client.findById(visit.client)
  if (!client) throw new AppError(404, 'Client not found')

  const geofenceConfig = await getGeofenceConfig()
  const allowedRadius = client.geofenceRadius || geofenceConfig.defaultRadius

  const lat = typeof location.latitude === 'number' ? location.latitude : undefined
  const lng = typeof location.longitude === 'number' ? location.longitude : undefined
  const accuracy = typeof location.accuracy === 'number' ? location.accuracy : undefined
  const locationStatus = location.locationStatus === 'LOCATION_UNAVAILABLE' ? 'LOCATION_UNAVAILABLE' : 'AVAILABLE'
  const isExceptionRequested = Boolean(location.allowException || location.exceptionReason)

  // Exception path
  if (isExceptionRequested || visit.exceptionAuthorized) {
    const isManagerOrAdmin = actor.role === 'SUPER_ADMIN' || (actor.role === 'MARKETING_HEAD' && String(visit.assignedBy) === actor.id)
    if (!isManagerOrAdmin && !visit.exceptionAuthorized) {
      throw new AppError(403, 'Check-in exception has not been authorized by your manager or Super Admin')
    }

    const exceptionReason = String(location.exceptionReason || visit.exceptionReason || 'Authorized location exception')
    const approvedBy = visit.exceptionAuthorizedBy || actor.id

    let distance: number | undefined = undefined
    if (typeof client.latitude === 'number' && typeof client.longitude === 'number' && typeof lat === 'number' && typeof lng === 'number') {
      distance = calculateHaversineDistance(client.latitude, client.longitude, lat, lng)
    }

    const recordedAt = location.recordedAt ? new Date(String(location.recordedAt)) : new Date()

    visit.checkIn = {
      latitude: lat,
      longitude: lng,
      accuracy,
      recordedAt,
      locationStatus,
      distanceFromClient: distance,
      allowedRadius,
      verificationStatus: 'EXCEPTION_APPROVED',
      exceptionReason,
      exceptionApprovedBy: approvedBy as never,
    } as never

    visit.status = 'CHECKED_IN'
    visit.exceptionAuthorized = false
    await visit.save()

    await recordAudit(actor.id, 'VISIT_CHECKED_IN_EXCEPTION', 'Visit', id, {
      exceptionReason,
      approvedBy: String(approvedBy),
      distanceFromClient: distance,
      allowedRadius,
    })

    if (String(visit.assignedBy) !== actor.id) {
      await createNotification({
        recipient: String(visit.assignedBy),
        title: 'Visit checked in (Exception)',
        message: `An assigned visit was checked in with an approved location exception: ${exceptionReason}`,
        type: 'VISIT_UPDATED',
        entityType: 'Visit',
        entityId: id,
      })
    }

    await visit.populate('client', CLIENT_POPULATE_FIELDS)
    await visit.populate('assignedTo', 'name email')
    await visit.populate('assignedBy', 'name')
    return visit
  }

  // Normal check-in verification
  // 1. Must have GPS available
  if (locationStatus === 'LOCATION_UNAVAILABLE' || lat === undefined || lng === undefined) {
    throw new AppError(422, 'GPS location is required to verify check-in within the geofence. Request an exception if GPS is unavailable.', {
      verificationStatus: 'LOCATION_UNAVAILABLE',
    })
  }

  // 2. Client must have registered coordinates
  if (typeof client.latitude !== 'number' || typeof client.longitude !== 'number') {
    throw new AppError(422, 'Client does not have registered GPS coordinates. Please request a check-in exception.', {
      verificationStatus: 'MISSING_CLIENT_COORDINATES',
    })
  }

  // 3. Reject stale GPS readings
  const recordedTime = location.recordedAt ? new Date(String(location.recordedAt)).getTime() : Date.now()
  const now = Date.now()
  if (now - recordedTime > geofenceConfig.maxStalenessSeconds * 1000) {
    throw new AppError(422, 'GPS reading is stale. Please capture a fresh location reading.', {
      verificationStatus: 'STALE_GPS',
    })
  }
  if (recordedTime - now > 60000) {
    throw new AppError(422, 'GPS timestamp is invalid (in the future).', {
      verificationStatus: 'STALE_GPS',
    })
  }

  // 4. Reject poor GPS accuracy
  const maxAllowedAccuracy = Math.max(geofenceConfig.maxAccuracy, allowedRadius)
  if (accuracy !== undefined && accuracy > maxAllowedAccuracy) {
    throw new AppError(
      422,
      `GPS accuracy is insufficient (±${Math.round(accuracy)}m, required within ±${maxAllowedAccuracy}m). Please wait for a better GPS signal.`,
      {
        verificationStatus: 'ACCURACY_INSUFFICIENT',
        accuracy,
        maxAllowedAccuracy,
      }
    )
  }

  // 5. Calculate Haversine distance independently on the backend
  const distance = calculateHaversineDistance(client.latitude, client.longitude, lat, lng)

  // 6. Enforce geofence radius
  if (distance > allowedRadius) {
    throw new AppError(
      422,
      `You are ${distance}m away from the client location. Check-in is only permitted within ${allowedRadius}m.`,
      {
        distanceFromClient: distance,
        allowedRadius,
        verificationStatus: 'OUTSIDE_GEOFENCE',
      }
    )
  }

  // 7. Verified check-in
  visit.checkIn = {
    latitude: lat,
    longitude: lng,
    accuracy,
    recordedAt: new Date(recordedTime),
    locationStatus: 'AVAILABLE',
    distanceFromClient: distance,
    allowedRadius,
    verificationStatus: 'VERIFIED',
  } as never

  visit.status = 'CHECKED_IN'
  await visit.save()

  await recordAudit(actor.id, 'VISIT_CHECKED_IN', 'Visit', id, {
    verificationStatus: 'VERIFIED',
    distanceFromClient: distance,
    allowedRadius,
    accuracy,
  })

  if (String(visit.assignedBy) !== actor.id) {
    await createNotification({
      recipient: String(visit.assignedBy),
      title: 'Visit checked in',
      message: `An assigned visit has been checked in (${distance}m from client).`,
      type: 'VISIT_UPDATED',
      entityType: 'Visit',
      entityId: id,
    })
  }

  await visit.populate('client', CLIENT_POPULATE_FIELDS)
  await visit.populate('assignedTo', 'name email')
  await visit.populate('assignedBy', 'name')
  return visit
}

export async function complete(
  id: string,
  input: {
    remarks: string
    followUpDate?: Date
    location: Record<string, unknown>
  },
  actor: AuthUser
) {
  const visit = await ownVisit(id, actor)
  if (visit.status !== 'CHECKED_IN') throw new AppError(409, 'Visit must be checked in before checkout')

  const client = await Client.findById(visit.client)
  const geofenceConfig = await getGeofenceConfig()
  const allowedRadius = client?.geofenceRadius || geofenceConfig.defaultRadius

  const lat = typeof input.location.latitude === 'number' ? input.location.latitude : undefined
  const lng = typeof input.location.longitude === 'number' ? input.location.longitude : undefined
  const accuracy = typeof input.location.accuracy === 'number' ? input.location.accuracy : undefined
  const locationStatus = input.location.locationStatus === 'LOCATION_UNAVAILABLE' ? 'LOCATION_UNAVAILABLE' : 'AVAILABLE'

  let verificationStatus: 'VERIFIED' | 'OUTSIDE_GEOFENCE' | 'LOCATION_UNAVAILABLE' | 'MISSING_CLIENT_COORDINATES' = 'LOCATION_UNAVAILABLE'
  let distance: number | undefined = undefined

  if (locationStatus === 'AVAILABLE' && lat !== undefined && lng !== undefined) {
    if (typeof client?.latitude === 'number' && typeof client?.longitude === 'number') {
      distance = calculateHaversineDistance(client.latitude, client.longitude, lat, lng)
      verificationStatus = distance <= allowedRadius ? 'VERIFIED' : 'OUTSIDE_GEOFENCE'
    } else {
      verificationStatus = 'MISSING_CLIENT_COORDINATES'
    }
  } else {
    verificationStatus = 'LOCATION_UNAVAILABLE'
  }

  const recordedTime = input.location.recordedAt ? new Date(String(input.location.recordedAt)) : new Date()

  visit.checkOut = {
    latitude: lat,
    longitude: lng,
    accuracy,
    recordedAt: recordedTime,
    locationStatus,
    distanceFromClient: distance,
    allowedRadius,
    verificationStatus,
  } as never

  visit.remarks = input.remarks
  visit.followUpDate = input.followUpDate
  visit.status = 'COMPLETED'
  await visit.save()

  if (input.followUpDate) {
    let marketingHeadAtCreation = visit.marketingHeadAtAssignment
    if (!marketingHeadAtCreation) {
      const executive = await User.findById(visit.assignedTo).select('reportingTo').lean()
      marketingHeadAtCreation = executive?.reportingTo ?? undefined
    }

    const followUpTask = await FollowUpTask.findOneAndUpdate(
      { sourceVisit: visit._id },
      {
        $setOnInsert: {
          sourceVisit: visit._id,
          client: visit.client,
          assignedTo: visit.assignedTo,
          marketingHeadAtCreation,
          dueDate: input.followUpDate,
          remarks: input.remarks,
          status: 'PENDING',
        },
      },
      { upsert: true, new: true }
    )

    await recordAudit(actor.id, 'FOLLOW_UP_TASK_CREATED', 'FollowUpTask', String(followUpTask._id), {
      sourceVisit: id,
      dueDate: input.followUpDate,
      ...(marketingHeadAtCreation ? { marketingHeadAtCreation: String(marketingHeadAtCreation) } : {}),
    })
  }

  await recordAudit(actor.id, 'VISIT_COMPLETED', 'Visit', id, {
    verificationStatus,
    distanceFromClient: distance,
    allowedRadius,
    locationStatus,
  })

  if (String(visit.assignedBy) !== actor.id) {
    await createNotification({
      recipient: String(visit.assignedBy),
      title: 'Visit completed',
      message: `An assigned visit has been completed (${verificationStatus}).`,
      type: 'VISIT_UPDATED',
      entityType: 'Visit',
      entityId: id,
    })
  }

  await visit.populate('client', CLIENT_POPULATE_FIELDS)
  await visit.populate('assignedTo', 'name email')
  await visit.populate('assignedBy', 'name')
  return visit
}

export async function authorizeException(id: string, reason: string, actor: AuthUser) {
  if (!mongoose.isValidObjectId(id)) throw new AppError(422, 'Invalid visit ID')
  const visit = await Visit.findById(id)
  if (!visit) throw new AppError(404, 'Visit not found')
  if (visit.status === 'COMPLETED' || visit.status === 'CANCELLED') {
    throw new AppError(409, 'Cannot authorize exception for a completed or cancelled visit')
  }

  if (actor.role !== 'SUPER_ADMIN') {
    if (actor.role === 'MARKETING_HEAD') {
      const executive = await User.findById(visit.assignedTo).select('reportingTo').lean()
      if (String(executive?.reportingTo ?? '') !== actor.id) {
        throw new AppError(403, 'You can only authorize exceptions for your own team')
      }
    } else {
      throw new AppError(403, 'Only a Marketing Head or Super Admin can authorize exceptions')
    }
  }

  visit.exceptionAuthorized = true
  visit.exceptionAuthorizedBy = actor.id as never
  visit.exceptionAuthorizedAt = new Date()
  visit.exceptionReason = reason
  await visit.save()

  await recordAudit(actor.id, 'VISIT_EXCEPTION_AUTHORIZED', 'Visit', id, { reason })

  await createNotification({
    recipient: String(visit.assignedTo),
    title: 'Check-in exception authorized',
    message: `Your manager or Super Admin has authorized a location exception for your visit: ${reason}`,
    type: 'VISIT_UPDATED',
    entityType: 'Visit',
    entityId: id,
  })

  await visit.populate('client', CLIENT_POPULATE_FIELDS)
  await visit.populate('assignedTo', 'name email')
  await visit.populate('assignedBy', 'name')
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
