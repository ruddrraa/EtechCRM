import { Router } from 'express'
import { getNotifications, readAllNotifications, readNotification } from '../controllers/notification.js'
import { requireAuth } from '../middleware/auth.js'

export const notificationRouter = Router()
notificationRouter.use(requireAuth)
notificationRouter.get('/', getNotifications)
notificationRouter.post('/read-all', readAllNotifications)
notificationRouter.post('/:id/read', readNotification)
