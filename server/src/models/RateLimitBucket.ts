import { Schema, model } from 'mongoose'

const rateLimitBucketSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 1 },
    resetAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
)

// Atlas M0 TTL index automatically purges expired rate-limit windows (~60s sweep)
rateLimitBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RateLimitBucket = model('RateLimitBucket', rateLimitBucketSchema)

