import { Schema, model } from 'mongoose';
const clientSchema = new Schema({
    organisationName: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, required: true, trim: true, maxlength: 100 },
    address: { type: String, required: true, trim: true, maxlength: 500 },
    contactPerson: { type: String, trim: true, maxlength: 120 },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    notes: { type: String, trim: true, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    createdByName: { type: String, trim: true, maxlength: 120 },
    isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, versionKey: false });
clientSchema.index({ organisationName: 'text', category: 'text', address: 'text' });
export const Client = model('Client', clientSchema);
