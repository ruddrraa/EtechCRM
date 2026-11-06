import { z } from 'zod'

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(128) })
export const registerUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email(),
  phone: z.string().trim().optional(),
  password: z.string().min(8).max(128),
  role: z.enum(['MARKETING_HEAD', 'MARKETING_EXECUTIVE', 'ADMIN', 'USER']),
  designation: z.string().trim().min(1).max(120).optional(),
  reportingTo: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional(),
})
export const bootstrapSchema = z.object({ name: z.string().trim().min(1).max(120), email: z.string().email(), password: z.string().min(8).max(128) })
export const profileSchema = z.object({ name: z.string().trim().min(1).max(120), phone: z.string().trim().max(30).optional(), avatar: z.string().url().optional().or(z.literal('')) })
export const statusSchema = z.object({ isActive: z.boolean() })
export const passwordSchema = z.object({ currentPassword: z.string().min(8).max(128), newPassword: z.string().min(8).max(128) })
