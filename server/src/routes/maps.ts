import { Router } from 'express'
import { getAutocomplete, getDetails } from '../controllers/maps.js'
import { requireAuth } from '../middleware/auth.js'
import { mapsRateLimiter } from '../middleware/rateLimit.js'

export const mapsRouter = Router()

mapsRouter.use(requireAuth, mapsRateLimiter)

mapsRouter.get('/autocomplete', getAutocomplete)
mapsRouter.get('/details', getDetails)

