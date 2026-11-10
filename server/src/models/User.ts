import { Schema, model, type HydratedDocument } from 'mongoose'

export const roles = ['SUPER_ADMIN', 'MARKETING_HEAD', 'MARKETING_EXECUTIVE', 'ADMIN', 'USER'] as const
export type Role = typeof roles[number]

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: roles, required: true, default: 'MARKETING_EXECUTIVE', index: true },
  designation: { type: String, trim: true, maxlength: 120 },
  reportingTo: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  avatar: { type: String },
  avatarAsset: { type: Schema.Types.ObjectId, ref: 'FileAsset' },
  isActive: { type: Boolean, default: true, index: true },
  isArchived: { type: Boolean, default: false, index: true },
  tokenVersion: { type: Number, default: 0 },
  notificationPreferences: {
    dailyProductivity: { type: Boolean, default: true },
    newEventCreated: { type: Boolean, default: true },
    mobilePush: { type: Boolean, default: true },
    desktopAlerts: { type: Boolean, default: true },
    emailSummary: { type: Boolean, default: false },
  },
}, { timestamps: true, versionKey: false })

userSchema.methods.toSafeObject = function () {
  const object = this.toObject()
  delete object.passwordHash
  return object
}

userSchema.index({ reportingTo: 1, isActive: 1 })
export type UserDocument = HydratedDocument<{ name: string; email: string; phone?: string; passwordHash: string; role: Role; designation?: string; reportingTo?: Schema.Types.ObjectId | null; avatar?: string; isActive: boolean; tokenVersion: number }>
export const User = model('User', userSchema)
