import { Schema, model } from 'mongoose'

const auditSchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true },
  entityId: { type: Schema.Types.ObjectId, required: true, index: true },
  metadata: { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
}, { versionKey: false })

auditSchema.index({ timestamp: -1 })
auditSchema.index({ actor: 1, timestamp: -1 })
export const AuditEvent = model('AuditEvent', auditSchema)
