import { Client } from '../models/Client.js'
import { User } from '../models/User.js'
import { Visit } from '../models/Visit.js'
import type { AuthUser } from '../middleware/auth.js'
import { isExecutiveRole } from '../middleware/auth.js'

export async function getDashboardSummary(user: AuthUser) {
  const team = user.role === 'MARKETING_HEAD' ? await User.find({ reportingTo: user.id }).select('_id').lean() : []
  const own = isExecutiveRole(user.role) ? { assignedTo: user.id } : user.role === 'MARKETING_HEAD' ? { assignedTo: { $in: team.map((item) => item._id) } } : {}
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const upcoming = await Visit.find({ ...own, plannedDate: { $gte: today }, status: { $in: ['PLANNED', 'ASSIGNED', 'ARRIVED', 'CHECKED_IN'] } }).populate('client', 'organisationName').populate('assignedTo', 'name').sort({ plannedDate: 1 }).limit(5).lean()
  const [totalClients, activeStaff, assignedVisits, completedVisits] = await Promise.all([
    Client.countDocuments({ isActive: true }),
    User.countDocuments({ isActive: true, role: { $in: ['MARKETING_EXECUTIVE', 'USER'] }, ...(user.role === 'MARKETING_HEAD' ? { reportingTo: user.id } : {}) }),
    Visit.countDocuments({ ...own, status: { $in: ['PLANNED', 'ASSIGNED', 'ARRIVED', 'CHECKED_IN'] } }),
    Visit.countDocuments({ ...own, status: 'COMPLETED' }),
  ])
  const activity = await Visit.aggregate([
    { $match: { ...own, plannedDate: { $gte: new Date(today.getTime() - 6 * 86400000) } } },
    { $group: { _id: { day: { $dayOfWeek: '$plannedDate' } }, visits: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } } } },
  ])
  return { metrics: { totalClients, activeStaff, assignedVisits, completedVisits }, upcomingVisits: upcoming, activity }
}
