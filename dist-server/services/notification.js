import { Notification } from '../models/Notification.js';
export function createNotification(input) {
    return Notification.create(input);
}
export async function listNotifications(recipient, page = 1, limit = 20) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const filter = { recipient };
    const [items, total, unread] = await Promise.all([
        Notification.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
        Notification.countDocuments(filter),
        Notification.countDocuments({ ...filter, readAt: { $exists: false } }),
    ]);
    return { items, total, unread, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
}
export async function markNotificationRead(id, recipient) {
    return Notification.findOneAndUpdate({ _id: id, recipient }, { $set: { readAt: new Date() } }, { new: true }).lean();
}
export async function markAllNotificationsRead(recipient) {
    const result = await Notification.updateMany({ recipient, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
    return { updated: result.modifiedCount };
}
