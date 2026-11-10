import { z } from 'zod'
import { followUpTaskStatuses } from '../models/FollowUpTask.js'

export const completeFollowUpSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
})

export const cancelFollowUpSchema = z.object({
  reason: z.string().trim().min(1, 'Cancellation reason is required').max(1000),
})

export const listFollowUpsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(followUpTaskStatuses).optional(),
})

