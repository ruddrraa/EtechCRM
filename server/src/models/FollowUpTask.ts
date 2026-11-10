import { Schema, model, type HydratedDocument, type Types } from 'mongoose'

export const followUpTaskStatuses = ['PENDING', 'COMPLETED', 'CANCELLED'] as const
export type FollowUpTaskStatus = (typeof followUpTaskStatuses)[number]

export interface IFollowUpTask {
  sourceVisit: Types.ObjectId
  client: Types.ObjectId
  assignedTo: Types.ObjectId
  marketingHeadAtCreation?: Types.ObjectId
  dueDate: Date
  remarks?: string
  status: FollowUpTaskStatus
  completedAt?: Date
  completedBy?: Types.ObjectId
  completionNotes?: string
  cancelledAt?: Date
  cancelledBy?: Types.ObjectId
  cancellationReason?: string
  createdAt: Date
  updatedAt: Date
}

const followUpTaskSchema = new Schema<IFollowUpTask>(
  {
    sourceVisit: { type: Schema.Types.ObjectId, ref: 'Visit', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    marketingHeadAtCreation: { type: Schema.Types.ObjectId, ref: 'User' },
    dueDate: { type: Date, required: true },
    remarks: { type: String, trim: true, maxlength: 5000 },
    status: { type: String, enum: followUpTaskStatuses, required: true, default: 'PENDING' },
    completedAt: { type: Date },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completionNotes: { type: String, trim: true, maxlength: 2000 },
    cancelledAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancellationReason: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true, versionKey: false }
)

// Idempotent 1:1 follow-up task guarantee per checkout visit
followUpTaskSchema.index({ sourceVisit: 1 }, { unique: true })
// Daily cron bounded scan index
followUpTaskSchema.index({ dueDate: 1, status: 1 })
// Executive / team listing index
followUpTaskSchema.index({ assignedTo: 1, status: 1, dueDate: 1 })
// Historical Marketing Head attribution queries
followUpTaskSchema.index({ marketingHeadAtCreation: 1, status: 1 })

export type FollowUpTaskDocument = HydratedDocument<IFollowUpTask>
export const FollowUpTask = model<IFollowUpTask>('FollowUpTask', followUpTaskSchema)

