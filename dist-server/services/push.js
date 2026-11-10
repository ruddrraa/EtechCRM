import { setVapidDetails, sendNotification } from 'web-push';
import { PushSubscription } from '../models/PushSubscription.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
let isVapidConfigured = false;
// Initialize VAPID details if configured
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    try {
        setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
        isVapidConfigured = true;
        console.log(`[WebPush] VAPID configured: true (Subject: ${env.VAPID_SUBJECT})`);
    }
    catch (err) {
        console.warn(`[WebPush] VAPID configured: false (Initialization failed: ${err.message})`);
    }
}
else {
    console.log('[WebPush] VAPID configured: false (Keys not provided in environment)');
}
export function isVapidReady() {
    return isVapidConfigured;
}
export function getVapidPublicKey() {
    return env.VAPID_PUBLIC_KEY || '';
}
export async function saveSubscription(userId, subscription, userAgent) {
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        throw new AppError(422, 'Invalid push subscription payload');
    }
    const existing = await PushSubscription.findOneAndUpdate({ endpoint: subscription.endpoint }, {
        $set: {
            user: userId,
            keys: subscription.keys,
            userAgent,
            updatedAt: new Date(),
        },
    }, { upsert: true, new: true });
    return existing;
}
export async function deleteSubscription(endpoint, userId) {
    const result = await PushSubscription.deleteOne({ endpoint, user: userId });
    return { deleted: result.deletedCount > 0 };
}
export async function sendPushToUser(userId, payload) {
    if (!isVapidConfigured) {
        return { sent: 0, failed: 0 };
    }
    // Respect user preference: if user has disabled mobilePush, skip push delivery
    const recipient = await User.findById(userId).select('notificationPreferences isActive').lean();
    if (!recipient || !recipient.isActive || recipient.notificationPreferences?.mobilePush === false) {
        return { sent: 0, failed: 0 };
    }
    const subscriptions = await PushSubscription.find({ user: userId });
    if (!subscriptions.length) {
        return { sent: 0, failed: 0 };
    }
    const jsonPayload = JSON.stringify(payload);
    let sent = 0;
    let failed = 0;
    await Promise.all(subscriptions.map(async (sub) => {
        try {
            await sendNotification({
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.keys.p256dh,
                    auth: sub.keys.auth,
                },
            }, jsonPayload);
            sent++;
        }
        catch (err) {
            failed++;
            // Status 410 Gone or 404 Not Found indicates expired or unsubscribed subscription
            const status = err?.statusCode;
            if (status === 410 || status === 404) {
                await PushSubscription.deleteOne({ _id: sub._id }).catch(() => { });
            }
        }
    }));
    return { sent, failed };
}
