import { Schema, model } from 'mongoose'

const locationSchema = new Schema({
  latitude: { type: Number, min: -90, max: 90 },
  longitude: { type: Number, min: -180, max: 180 },
  accuracy: { type: Number, min: 0 },
  recordedAt: { type: Date },
  locationStatus: { type: String, enum: ['AVAILABLE', 'LOCATION_UNAVAILABLE'], required: true },
  distanceFromClient: { type: Number },
  allowedRadius: { type: Number },
  verificationStatus: {
    type: String,
    enum: [
      'VERIFIED',
      'OUTSIDE_GEOFENCE',
      'LOCATION_UNAVAILABLE',
      'ACCURACY_INSUFFICIENT',
      'STALE_GPS',
      'EXCEPTION_APPROVED',
      'MISSING_CLIENT_COORDINATES',
    ],
  },
  exceptionReason: { type: String, trim: true, maxlength: 1000 },
  exceptionApprovedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { _id: false })

const visitSchema = new Schema({
  client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  marketingHeadAtAssignment: { type: Schema.Types.ObjectId, ref: 'User' },
  source: { type: String, enum: ['ADMIN_ASSIGNED', 'SELF_ASSIGNED'], required: true },
  plannedDate: { type: Date, required: true, index: true },
  instructions: { type: String, trim: true, maxlength: 2000 },
  status: { type: String, enum: ['PLANNED', 'ASSIGNED', 'ARRIVED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED'], required: true, index: true },
  arrivedAt: { type: Date },
  cancellationReason: { type: String, trim: true, maxlength: 1000 },
  cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: { type: Date },
  exceptionAuthorized: { type: Boolean, default: false },
  exceptionAuthorizedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  exceptionAuthorizedAt: { type: Date },
  exceptionReason: { type: String, trim: true, maxlength: 1000 },
  checkIn: locationSchema,
  checkOut: locationSchema,
  remarks: { type: String, trim: true, maxlength: 5000 },
  followUpDate: { type: Date },
  photoAssets: [{ type: Schema.Types.ObjectId, ref: 'FileAsset' }],
  attachmentAssets: [{ type: Schema.Types.ObjectId, ref: 'FileAsset' }],
}, { timestamps: true, versionKey: false })

visitSchema.index({ assignedTo: 1, plannedDate: -1 })
visitSchema.index({ assignedTo: 1, status: 1, plannedDate: -1 })
visitSchema.index({ client: 1, plannedDate: -1 })
visitSchema.index({ plannedDate: -1, status: 1 })
visitSchema.index({ followUpDate: 1, status: 1 })
export const Visit = model('Visit', visitSchema)
