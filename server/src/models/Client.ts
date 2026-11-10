import { Schema, model } from 'mongoose'

const clientSchema = new Schema({
  organisationName: { type: String, required: true, trim: true, maxlength: 200 },
  category: { type: String, required: true, trim: true, maxlength: 100 },
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
  address: { type: String, required: true, trim: true, maxlength: 500 },
  latitude: { type: Number, min: -90, max: 90 },
  longitude: { type: Number, min: -180, max: 180 },
  placeId: { type: String, trim: true, maxlength: 200 },
  formattedAddress: { type: String, trim: true, maxlength: 500 },
  geofenceRadius: { type: Number, min: 10, max: 2000 },
  contactPerson: { type: String, trim: true, maxlength: 120 },
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  notes: { type: String, trim: true, maxlength: 2000 },
  visitingCardAsset: { type: Schema.Types.ObjectId, ref: 'FileAsset' },
  documentAssets: [{ type: Schema.Types.ObjectId, ref: 'FileAsset' }],
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  createdByName: { type: String, trim: true, maxlength: 120 },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, versionKey: false })

clientSchema.index({ isActive: 1, createdAt: -1 })
clientSchema.index({ organisationName: 'text', category: 'text', address: 'text' })
export const Client = model('Client', clientSchema)
