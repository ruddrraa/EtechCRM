import { z } from 'zod'

const phone = z.string().trim().regex(/^[+]?[\d\s().-]{7,20}$/, 'Enter a valid phone number').optional().or(z.literal(''))
const email = z.string().trim().email('Enter a valid email address').optional().or(z.literal(''))
export const clientSchema = z.object({
  organisationName: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  address: z.string().trim().min(1).max(500),
  contactPerson: z.string().trim().max(120).optional(),
  phone,
  email,
  notes: z.string().trim().max(2000).optional(),
}).refine((value) => Boolean(value.phone || value.email), { message: 'Phone or email is required', path: ['phone'] })
