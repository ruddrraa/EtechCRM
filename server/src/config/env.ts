import { z } from 'zod'
import 'dotenv/config'

const schema = z.object({
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('1d'),
  CLIENT_URL: z
    .string()
    .default('http://localhost:5173')
    .refine(
      (val) =>
        val
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .every((item) => z.string().url().safeParse(item).success),
      { message: 'CLIENT_URL must be a valid URL or comma-separated list of URLs' }
    ),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  BOOTSTRAP_TOKEN: z.string().min(32).optional(),
  OLA_MAPS_API_KEY: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  STORAGE_PROVIDER: z.enum(['cloudinary', 'mock']).optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@exceltechnologies.in'),
  CRON_SECRET: z.string().optional(),
  FOLLOWUP_TIMEZONE: z
    .string()
    .default('Asia/Kolkata')
    .refine(
      (tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz })
          return true
        } catch {
          return false
        }
      },
      { message: 'FOLLOWUP_TIMEZONE must be a valid IANA timezone' }
    ),
}).refine(
  (data) => !data.CRON_SECRET || data.NODE_ENV === 'test' || data.CRON_SECRET.trim().length >= 32,
  { message: 'CRON_SECRET must be at least 32 characters when configured', path: ['CRON_SECRET'] }
)

export const env = schema.parse({
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  CLIENT_URL: process.env.CLIENT_URL,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  BOOTSTRAP_TOKEN: process.env.BOOTSTRAP_TOKEN,
  OLA_MAPS_API_KEY: process.env.OLA_MAPS_API_KEY,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER as 'cloudinary' | 'mock' | undefined,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:admin@exceltechnologies.in',
  CRON_SECRET: process.env.CRON_SECRET,
  FOLLOWUP_TIMEZONE: process.env.FOLLOWUP_TIMEZONE || 'Asia/Kolkata',
})
