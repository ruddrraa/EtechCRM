import type { Request, Response } from 'express'
import { fetchPlaceAutocomplete, fetchPlaceDetails } from '../services/maps.js'
import { success } from '../utils/api.js'

export async function getAutocomplete(req: Request, res: Response) {
  const input = typeof req.query.input === 'string' ? req.query.input : ''
  const predictions = await fetchPlaceAutocomplete(input)
  return success(res, { predictions })
}

export async function getDetails(req: Request, res: Response) {
  const placeId = typeof req.query.placeId === 'string' ? req.query.placeId : ''
  const details = await fetchPlaceDetails(placeId)
  return success(res, details)
}

