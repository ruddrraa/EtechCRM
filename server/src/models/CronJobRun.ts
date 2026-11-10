import { Schema, model } from 'mongoose'

const cronJobRunSchema = new Schema(
  {
    jobName: { type: String, required: true, trim: true, maxlength: 64 },
    dateKey: { type: String, required: true, trim: true, maxlength: 20 },
    timeZone: { type: String, required: true, trim: true, maxlength: 64 },
    status: {
      type: String,
      required: true,
      enum: ['RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED'],
      default: 'RUNNING',
    },
    lockKey: { type: String, trim: true, maxlength: 80 },
    lockExpiresAt: { type: Date },
    startedAt: { type: Date, required: true, default: Date.now },
    finishedAt: { type: Date },
    durationMs: { type: Number },
    counters: {
      scannedVisits: { type: Number, default: 0 },
      dueVisits: { type: Number, default: 0 },
      eligibleVisits: { type: Number, default: 0 },
      notificationsCreated: { type: Number, default: 0 },
      deduplicatedSkipped: { type: Number, default: 0 },
      skippedPreferences: { type: Number, default: 0 },
      skippedInactiveUsers: { type: Number, default: 0 },
      pushSent: { type: Number, default: 0 },
      pushFailed: { type: Number, default: 0 },
      expiredSubscriptionsRemoved: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
    },
    errorMessage: { type: String, trim: true, maxlength: 500 },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  },
  { versionKey: false }
)

cronJobRunSchema.index({ lockKey: 1 }, { unique: true, sparse: true })
cronJobRunSchema.index({ jobName: 1, dateKey: 1, startedAt: -1 })
cronJobRunSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const CronJobRun = model('CronJobRun', cronJobRunSchema)

