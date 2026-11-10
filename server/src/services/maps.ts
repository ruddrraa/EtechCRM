import { env } from '../config/env.js'
import { AppError } from '../utils/errors.js'

export type AutocompleteSuggestion = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
  latitude?: number
  longitude?: number
}

export type PlaceDetails = {
  placeId: string
  formattedAddress: string
  latitude?: number
  longitude?: number
}

const OLA_BASE_URL = 'https://api.olamaps.io'
const TIMEOUT_MS = 5000

export async function fetchPlaceAutocomplete(input: string): Promise<AutocompleteSuggestion[]> {
  const query = (input || '').trim()
  if (!query || query.length < 2) {
    throw new AppError(400, 'Search query must be at least 2 characters')
  }

  const apiKey = env.OLA_MAPS_API_KEY
  if (!apiKey) {
    // If provider API key is not configured, return empty suggestions gracefully
    return []
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const url = new URL('/places/v1/autocomplete', OLA_BASE_URL)
    url.searchParams.set('input', query)
    url.searchParams.set('api_key', apiKey)

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Request-Id': `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      console.error(`[Ola Maps Autocomplete] Provider responded with HTTP ${response.status}`)
      return []
    }

    const data = await response.json() as {
      status?: string
      predictions?: Array<{
        place_id?: string
        description?: string
        structured_formatting?: { main_text?: string; secondary_text?: string }
        geometry?: { location?: { lat?: number; lng?: number } }
      }>
    }

    if (!Array.isArray(data.predictions)) {
      return []
    }

    return data.predictions.map((p) => ({
      placeId: p.place_id || '',
      description: p.description || '',
      mainText: p.structured_formatting?.main_text || p.description || '',
      secondaryText: p.structured_formatting?.secondary_text || '',
      latitude: p.geometry?.location?.lat,
      longitude: p.geometry?.location?.lng,
    }))
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[Ola Maps Autocomplete] Request timed out')
      return []
    }
    console.error(
      '[Ola Maps Autocomplete] Provider request failed:',
      (err instanceof Error ? err.message : 'Unknown error').replace(/([?&]api_key=)[^&\s]+/gi, '$1***')
    )
    return []
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const id = (placeId || '').trim()
  if (!id) {
    throw new AppError(400, 'Place ID is required')
  }

  const apiKey = env.OLA_MAPS_API_KEY
  if (!apiKey) {
    return null
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const url = new URL('/places/v1/details', OLA_BASE_URL)
    url.searchParams.set('place_id', id)
    url.searchParams.set('api_key', apiKey)

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Request-Id': `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      console.error(`[Ola Maps Details] Provider responded with HTTP ${response.status}`)
      return null
    }

    const data = await response.json() as {
      status?: string
      result?: {
        name?: string
        place_id?: string
        formatted_address?: string
        geometry?: { location?: { lat?: number; lng?: number } }
      }
    }

    if (!data.result) {
      return null
    }

    return {
      placeId: data.result.place_id || id,
      formattedAddress: data.result.formatted_address || data.result.name || '',
      latitude: data.result.geometry?.location?.lat,
      longitude: data.result.geometry?.location?.lng,
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[Ola Maps Details] Request timed out')
      return null
    }
    console.error(
      '[Ola Maps Details] Provider request failed:',
      (err instanceof Error ? err.message : 'Unknown error').replace(/([?&]api_key=)[^&\s]+/gi, '$1***')
    )
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

