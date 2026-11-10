import { Client } from '../models/Client.js'
import { User } from '../models/User.js'
import { Visit } from '../models/Visit.js'
import { Types } from 'mongoose'
import type { AuthUser } from '../middleware/auth.js'
import { isExecutiveRole } from '../middleware/auth.js'
import { AppError } from '../utils/errors.js'

type DashboardQuery = { preset?: string; startDate?: string; endDate?: string }

function startOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(23, 59, 59, 999)
  return date
}

function rangeFor(query: DashboardQuery) {
  const now = new Date()
  const preset = query.preset ?? 'this_month'
  if (preset === 'custom') {
    if (!query.startDate || !query.endDate) throw new AppError(422, 'Custom dashboard ranges require startDate and endDate')
    const from = startOfDay(new Date(query.startDate))
    const to = endOfDay(new Date(query.endDate))
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new AppError(422, 'Invalid dashboard date range')
    return { from, to, preset, bucket: to.getTime() - from.getTime() <= 31 * 86400000 ? '%Y-%m-%d' : '%Y-%m' }
  }
  const today = startOfDay(now)
  if (preset === 'today') return { from: today, to: endOfDay(today), preset, bucket: '%Y-%m-%d' }
  if (preset === 'this_week') {
    const from = new Date(today)
    from.setDate(from.getDate() - ((from.getDay() + 6) % 7))
    return { from, to: endOfDay(new Date(from.getTime() + 6 * 86400000)), preset, bucket: '%Y-%m-%d' }
  }
  if (preset === 'last_month') {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const to = new Date(today.getFullYear(), today.getMonth(), 0)
    return { from, to: endOfDay(to), preset, bucket: '%Y-%m-%d' }
  }
  const from = new Date(today.getFullYear(), today.getMonth(), 1)
  return { from, to: endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)), preset: 'this_month', bucket: '%Y-%m-%d' }
}

async function scopeFor(user: AuthUser) {
  if (isExecutiveRole(user.role)) return { assignedTo: new Types.ObjectId(user.id), teamIds: [user.id] }
  if (user.role === 'MARKETING_HEAD') {
    const team = await User.find({ reportingTo: user.id, role: { $in: ['MARKETING_EXECUTIVE', 'USER'] } }).select('_id').lean()
    return { assignedTo: { $in: team.map((item) => item._id) }, teamIds: team.map((item) => String(item._id)) }
  }
  return { teamIds: [] }
}

export async function getDashboardSummary(user: AuthUser, query: DashboardQuery = {}) {
  const range = rangeFor(query)
  const scope = await scopeFor(user)
  const visitScope = scope.assignedTo ? { assignedTo: scope.assignedTo } : {}
  const periodFilter = { ...visitScope, plannedDate: { $gte: range.from, $lte: range.to } }
  const allScope = { ...visitScope }
  const now = new Date()
  const statusCounts = await Visit.aggregate([
    { $match: periodFilter },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  const statusMap = Object.fromEntries(statusCounts.map((item) => [item._id, item.count as number]))
  const [activeClients, totalHeads, totalExecutives, teamVisits, trend, executivePerformance, headPerformance, topClients, followUps, upcoming, recentCompleted] = await Promise.all([
    user.role === 'SUPER_ADMIN' ? Client.countDocuments({ isActive: true }) : Visit.distinct('client', allScope).then((ids) => Client.countDocuments({ _id: { $in: ids }, isActive: true })),
    user.role === 'SUPER_ADMIN' ? User.countDocuments({ role: { $in: ['MARKETING_HEAD', 'ADMIN'] }, isActive: true, isArchived: { $ne: true } }) : Promise.resolve(user.role === 'MARKETING_HEAD' ? 1 : 0),
    user.role === 'SUPER_ADMIN' ? User.countDocuments({ role: { $in: ['MARKETING_EXECUTIVE', 'USER'] }, isActive: true, isArchived: { $ne: true } }) : user.role === 'MARKETING_HEAD' ? User.countDocuments({ _id: { $in: scope.teamIds }, isActive: true }) : Promise.resolve(0),
    Visit.countDocuments(periodFilter),
    Visit.aggregate([
      { $match: periodFilter },
      { $group: { _id: { $dateToString: { format: range.bucket, date: '$plannedDate' } }, visits: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
      { $limit: 366 },
    ]),
    user.role === 'MARKETING_EXECUTIVE' ? Promise.resolve([]) : Visit.aggregate([
      { $match: periodFilter },
      { $group: { _id: '$assignedTo', visits: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'executive' } },
      { $unwind: '$executive' },
      { $project: { _id: 0, name: '$executive.name', visits: 1, completed: 1, completionRate: { $cond: [{ $eq: ['$visits', 0] }, 0, { $multiply: [{ $divide: ['$completed', '$visits'] }, 100] }] } } },
      { $sort: { visits: -1 } },
      { $limit: 10 },
    ]),
    user.role === 'SUPER_ADMIN' ? Visit.aggregate([
      { $match: periodFilter },
      { $lookup: { from: 'users', localField: 'assignedTo', foreignField: '_id', as: 'executive' } },
      { $unwind: '$executive' },
      { $addFields: { headId: { $ifNull: ['$marketingHeadAtAssignment', '$executive.reportingTo'] } } },
      { $group: { _id: '$headId', visits: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'head' } },
      { $unwind: { path: '$head', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, name: { $ifNull: ['$head.name', 'Unassigned head'] }, visits: 1, completed: 1, completionRate: { $cond: [{ $eq: ['$visits', 0] }, 0, { $multiply: [{ $divide: ['$completed', '$visits'] }, 100] }] } } },
      { $sort: { visits: -1 } },
      { $limit: 50 },
    ]) : Promise.resolve([]),
    Visit.aggregate([
      { $match: periodFilter },
      { $group: { _id: '$client', visits: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } } } },
      { $lookup: { from: 'clients', localField: '_id', foreignField: '_id', as: 'client' } },
      { $unwind: '$client' },
      { $project: { _id: 0, name: '$client.organisationName', visits: 1, completed: 1 } },
      { $sort: { visits: -1 } },
      { $limit: 5 },
    ]),
    Visit.aggregate([
      { $match: { ...allScope, followUpDate: { $exists: true, $ne: null } } },
      { $group: { _id: { $cond: [{ $lt: ['$followUpDate', now] }, 'overdue', 'upcoming'] }, count: { $sum: 1 } } },
    ]),
    Visit.find({ ...allScope, plannedDate: { $gte: now, $lte: range.to }, status: { $in: ['PLANNED', 'ASSIGNED', 'ARRIVED', 'CHECKED_IN'] } }).populate('client', 'organisationName').populate('assignedTo', 'name').sort({ plannedDate: 1 }).limit(8).lean(),
    Visit.find({ ...allScope, status: 'COMPLETED', plannedDate: { $lte: range.to } }).populate('client', 'organisationName').sort({ plannedDate: -1 }).limit(8).lean(),
  ])
  const pendingVisits = (statusMap.PLANNED ?? 0) + (statusMap.ASSIGNED ?? 0) + (statusMap.ARRIVED ?? 0) + (statusMap.CHECKED_IN ?? 0)
  const pendingFollowUps = followUps.find((item) => item._id === 'upcoming')?.count ?? 0
  const overdueFollowUps = followUps.find((item) => item._id === 'overdue')?.count ?? 0
  return {
    range: { preset: range.preset, from: range.from, to: range.to },
    metrics: {
      totalClients: activeClients,
      activeStaff: totalExecutives,
      totalHeads,
      totalExecutives,
      assignedVisits: teamVisits,
      completedVisits: statusMap.COMPLETED ?? 0,
      pendingVisits,
      cancelledVisits: statusMap.CANCELLED ?? 0,
      pendingFollowUps,
      overdueFollowUps,
      completionRate: teamVisits ? Math.round(((statusMap.COMPLETED ?? 0) / teamVisits) * 100) : 0,
    },
    activity: trend.map((item) => ({ day: item._id, visits: item.visits, completed: item.completed })),
    executivePerformance,
    headPerformance,
    topClients,
    upcomingVisits: upcoming,
    recentCompleted,
  }
}
