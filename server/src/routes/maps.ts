import { Router } from 'express'
import { getAutocomplete, getDetails } from '../controllers/maps.js'
import { requireAuth } from '../middleware/auth.js'

export const mapsRouter = Router()

mapsRouter.use(requireAuth)

mapsRouter.get('/autocomplete', getAutocomplete)
mapsRouter.get('/details', getDetails)

