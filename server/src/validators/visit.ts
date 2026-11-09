import { z } from 'zod'

const location = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).max(100000).optional(),
  recordedAt: z.coerce.date().optional(),
  locationStatus: z.enum(['AVAILABLE', 'LOCATION_UNAVAILABLE']),
  allowException: z.boolean().optional(),
  exceptionReason: z.string().trim().max(1000).optional(),
  distance: z.number().optional(),
  distanceFromClient: z.number().optional(),
  verificationStatus: z.string().optional(),
})
export const createVisitSchema = z.object({ clientId: z.string().length(24), assignedTo: z.string().length(24), plannedDate: z.coerce.date(), instructions: z.string().trim().max(2000).optional() })
export const selfAssignSchema = z.object({ clientId: z.string().length(24), plannedDate: z.coerce.date(), instructions: z.string().trim().max(2000).optional() })
export const cancelSchema = z.object({ reason: z.string().trim().min(1).max(1000) })
export const outcomeSchema = z.object({ remarks: z.string().trim().min(1).max(5000), followUpDate: z.coerce.date().optional() })
export const rescheduleSchema = z.object({ plannedDate: z.coerce.date() })
export const authorizeExceptionSchema = z.object({ reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(1000) })
export const locationSchema = location.refine((value) => value.locationStatus === 'LOCATION_UNAVAILABLE' || (value.latitude !== undefined && value.longitude !== undefined), { message: 'Coordinates are required when location is available' })
