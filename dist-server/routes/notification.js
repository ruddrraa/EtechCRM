import { Router } from 'express';
import { getNotifications, readAllNotifications, readNotification, clearNotifications, removeNotification, createTestNotification, getVapidKey, subscribePush, unsubscribePush, } from '../controllers/notification.js';
import { requireAuth } from '../middleware/auth.js';
export const notificationRouter = Router();
// Public VAPID key is safe to fetch without prior session credentials
notificationRouter.get('/push/vapid-key', getVapidKey);
notificationRouter.use(requireAuth);
notificationRouter.get('/', getNotifications);
notificationRouter.post('/test', createTestNotification);
notificationRouter.post('/read-all', readAllNotifications);
notificationRouter.post('/:id/read', readNotification);
notificationRouter.delete('/', clearNotifications);
notificationRouter.delete('/:id', removeNotification);
// Authenticated Push API routes
notificationRouter.post('/push/subscribe', subscribePush);
notificationRouter.post('/push/unsubscribe', unsubscribePush);
