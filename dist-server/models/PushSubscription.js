import { Schema, model } from 'mongoose';
const pushSubscriptionSchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true, trim: true },
    keys: {
        p256dh: { type: String, required: true, trim: true },
        auth: { type: String, required: true, trim: true },
    },
    userAgent: { type: String, trim: true },
}, { timestamps: true, versionKey: false });
pushSubscriptionSchema.index({ user: 1, createdAt: -1 });
export const PushSubscription = model('PushSubscription', pushSubscriptionSchema);
