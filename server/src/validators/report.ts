import { z } from 'zod'

const objectId = z.string().regex(/^[a-f\d]{24}$/i)
const statuses = ['ASSIGNED', 'COMPLETED', 'CANCELLED'] as const

export const reportQuerySchema = z.object({
  preset: z.enum(['today', 'this_week', 'this_month', 'last_month', 'custom']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(statuses).optional(),
  clientId: objectId.optional(),
  category: z.string().trim().max(100).optional(),
  categoryId: objectId.optional(),
  headId: objectId.optional(),
  staffId: objectId.optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.enum(['plannedDate', 'clientName', 'executiveName', 'totalVisits', 'completionRate']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
}).superRefine((value, context) => {
  if (value.preset === 'custom' && (!value.startDate || !value.endDate)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'Custom ranges require startDate and endDate' })
  }
  const start = value.startDate ? new Date(value.startDate) : null
  const end = value.endDate ? new Date(value.endDate) : null
  if (start && Number.isNaN(start.getTime())) context.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'Invalid start date' })
  if (end && Number.isNaN(end.getTime())) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'Invalid end date' })
  if (start && end && (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be after start date' })
  if (start && end && end.getTime() - start.getTime() > 366 * 86400000) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'Report range cannot exceed one year' })
})

export const exportQuerySchema = reportQuerySchema.extend({
  format: z.enum(['csv', 'xlsx', 'pdf']),
  view: z.enum(['client', 'staff']),
})

export type ReportQuery = z.infer<typeof reportQuerySchema>
