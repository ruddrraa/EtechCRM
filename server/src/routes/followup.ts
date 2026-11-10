import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import {
  getFollowUps,
  postCancelFollowUp,
  postCompleteFollowUp,
} from '../controllers/followup.js'
import { cancelFollowUpSchema, completeFollowUpSchema } from '../validators/followup.js'

export const followUpRouter = Router()

followUpRouter.use(requireAuth)
followUpRouter.get('/', getFollowUps)
followUpRouter.post('/:id/complete', validate(completeFollowUpSchema), postCompleteFollowUp)
followUpRouter.post('/:id/cancel', validate(cancelFollowUpSchema), postCancelFollowUp)

