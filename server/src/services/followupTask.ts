import mongoose from 'mongoose'
import { FollowUpTask, type FollowUpTaskStatus } from '../models/FollowUpTask.js'
import { User } from '../models/User.js'
import { AppError } from '../utils/errors.js'
import { isExecutiveRole, isHeadRole, type AuthUser } from '../middleware/auth.js'
import { recordAudit } from './audit.js'
import { CLIENT_POPULATE_FIELDS } from './visit.js'

async function ownFollowUpFilter(actor: AuthUser): Promise<Record<string, unknown>> {
  if (isExecutiveRole(actor.role)) {
    return { assignedTo: actor.id }
  }
  if (isHeadRole(actor.role)) {
    const team = await User.find({
      reportingTo: actor.id,
      role: { $in: ['MARKETING_EXECUTIVE', 'USER'] },
    })
      .select('_id')
      .lean()
    return { assignedTo: { $in: team.map((u) => u._id) } }
  }
  return {}
}

async function authorizeFollowUpTask(taskId: string, actor: AuthUser) {
  if (!mongoose.isValidObjectId(taskId)) {
    throw new AppError(422, 'Invalid follow-up task ID')
  }
  const task = await FollowUpTask.findById(taskId)
  if (!task) {
    throw new AppError(404, 'Follow-up task not found')
  }

  if (actor.role === 'SUPER_ADMIN') {
    return task
  }

  if (isExecutiveRole(actor.role)) {
    if (String(task.assignedTo) !== actor.id) {
      throw new AppError(404, 'Follow-up task not found')
    }
    return task
  }

  if (isHeadRole(actor.role)) {
    const currentTeamMember = await User.exists({
      _id: task.assignedTo,
      reportingTo: actor.id,
      role: { $in: ['MARKETING_EXECUTIVE', 'USER'] },
    })
    if (!currentTeamMember) {
      throw new AppError(404, 'Follow-up task not found')
    }
    return task
  }

  throw new AppError(403, 'You do not have permission to access this follow-up task')
}

export async function listFollowUpTasks(
  actor: AuthUser,
  query: { page?: number; limit?: number; status?: FollowUpTaskStatus }
) {
  const page = Math.max(1, query.page ?? 1)
  const limit = Math.min(100, Math.max(1, query.limit ?? 20))
  const scopeFilter = await ownFollowUpFilter(actor)
  const filter = {
    ...scopeFilter,
    ...(query.status ? { status: query.status } : {}),
  }

  const [items, total] = await Promise.all([
    FollowUpTask.find(filter)
      .populate('client', CLIENT_POPULATE_FIELDS)
      .populate('assignedTo', 'name email')
      .populate('marketingHeadAtCreation', 'name')
      .populate('sourceVisit', 'plannedDate status remarks followUpDate')
      .sort({ dueDate: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    FollowUpTask.countDocuments(filter),
  ])

  return {
    items,
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  }
}

export async function completeFollowUpTask(
  taskId: string,
  notes: string | undefined,
  actor: AuthUser
) {
  const task = await authorizeFollowUpTask(taskId, actor)
  if (task.status !== 'PENDING') {
    throw new AppError(409, `Follow-up task cannot be completed from status "${task.status}"`)
  }

  task.status = 'COMPLETED'
  task.completedAt = new Date()
  task.completedBy = new mongoose.Types.ObjectId(actor.id) as never
  if (notes) {
    task.completionNotes = notes
  }
  await task.save()

  await recordAudit(actor.id, 'FOLLOW_UP_TASK_COMPLETED', 'FollowUpTask', String(task._id), {
    sourceVisit: String(task.sourceVisit),
    notes,
  })

  return task
}

export async function cancelFollowUpTask(
  taskId: string,
  reason: string,
  actor: AuthUser
) {
  const task = await authorizeFollowUpTask(taskId, actor)
  if (task.status !== 'PENDING') {
    throw new AppError(409, `Follow-up task cannot be cancelled from status "${task.status}"`)
  }

  task.status = 'CANCELLED'
  task.cancelledAt = new Date()
  task.cancelledBy = new mongoose.Types.ObjectId(actor.id) as never
  task.cancellationReason = reason
  await task.save()

  await recordAudit(actor.id, 'FOLLOW_UP_TASK_CANCELLED', 'FollowUpTask', String(task._id), {
    sourceVisit: String(task.sourceVisit),
    reason,
  })

  return task
}

