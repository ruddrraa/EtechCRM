import { Schema, model } from 'mongoose';
const notificationSchema = new Schema({
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    type: { type: String, required: true, enum: ['VISIT_ASSIGNED', 'VISIT_CANCELLED', 'VISIT_UPDATED', 'TEST'] },
    entityType: { type: String, enum: ['Visit', 'Client'] },
    entityId: { type: Schema.Types.ObjectId },
    readAt: { type: Date },
    createdAt: { type: Date, default: Date.now, index: true },
}, { versionKey: false });
notificationSchema.index({ recipient: 1, createdAt: -1 });
export const Notification = model('Notification', notificationSchema);
