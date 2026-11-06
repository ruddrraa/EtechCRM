import { Schema, model } from 'mongoose';
const locationSchema = new Schema({
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    recordedAt: { type: Date },
    locationStatus: { type: String, enum: ['AVAILABLE', 'LOCATION_UNAVAILABLE'], required: true },
}, { _id: false });
const visitSchema = new Schema({
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
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
    checkIn: locationSchema,
    checkOut: locationSchema,
    remarks: { type: String, trim: true, maxlength: 5000 },
    followUpDate: { type: Date },
}, { timestamps: true, versionKey: false });
visitSchema.index({ assignedTo: 1, plannedDate: -1 });
visitSchema.index({ client: 1, plannedDate: -1 });
export const Visit = model('Visit', visitSchema);
