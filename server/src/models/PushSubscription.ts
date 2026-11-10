import { Schema, model, type HydratedDocument, type Types } from 'mongoose'

export interface IPushSubscription {
  user: Types.ObjectId
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
  userAgent?: string
  createdAt: Date
  updatedAt: Date
}

const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true, trim: true },
    keys: {
      p256dh: { type: String, required: true, trim: true },
      auth: { type: String, required: true, trim: true },
    },
    userAgent: { type: String, trim: true },
  },
  { timestamps: true, versionKey: false }
)

pushSubscriptionSchema.index({ user: 1, createdAt: -1 })

export type PushSubscriptionDocument = HydratedDocument<IPushSubscription>
export const PushSubscription = model<IPushSubscription>('PushSubscription', pushSubscriptionSchema)

