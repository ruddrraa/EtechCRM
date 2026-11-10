import { Schema, model } from 'mongoose'

export const notificationTypes = [
  'VISIT_ASSIGNED',
  'VISIT_CANCELLED',
  'VISIT_UPDATED',
  'FOLLOW_UP_REMINDER',
  'TEST',
] as const

export type NotificationType = (typeof notificationTypes)[number]

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    type: { type: String, required: true, enum: notificationTypes },
    entityType: { type: String, enum: ['Visit', 'Client'] },
    entityId: { type: Schema.Types.ObjectId },
    deliveryKey: { type: String, trim: true, maxlength: 180 },
    pushStatus: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'SENT', 'PARTIAL', 'SKIPPED', 'FAILED'],
      default: 'PENDING',
    },
    pushAttemptedAt: { type: Date },
    pushStats: {
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      removedExpired: { type: Number, default: 0 },
      retried: { type: Number, default: 0 },
      skippedReason: { type: String, trim: true, maxlength: 120 },
    },
    readAt: { type: Date },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
)

notificationSchema.index({ recipient: 1, createdAt: -1 })
notificationSchema.index({ recipient: 1, readAt: 1 })
notificationSchema.index({ deliveryKey: 1 }, { unique: true, sparse: true })

export const Notification = model('Notification', notificationSchema)
