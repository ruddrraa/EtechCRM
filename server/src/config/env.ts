import { z } from 'zod'
import 'dotenv/config'

const schema = z.object({
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('1d'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  BOOTSTRAP_TOKEN: z.string().min(32).optional(),
  OLA_MAPS_API_KEY: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  STORAGE_PROVIDER: z.enum(['cloudinary', 'mock']).optional(),
})

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
})
