import { Notification } from '../models/Notification.js';
import { sendPushToUser } from './push.js';
export async function createNotification(input) {
    const notif = await Notification.create(input);
    void sendPushToUser(input.recipient, {
        title: input.title,
        body: input.message,
        url: input.entityType === 'Visit' ? '/visits' : '/',
        tag: `crm-notif-${String(notif._id)}`,
        notificationId: String(notif._id),
    }).catch(() => { });
    return notif;
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
export async function clearAllNotifications(recipient) {
    const result = await Notification.deleteMany({ recipient });
    return { deleted: result.deletedCount };
}
export async function deleteNotification(id, recipient) {
    const result = await Notification.deleteOne({ _id: id, recipient });
    return { deleted: result.deletedCount > 0 };
}
