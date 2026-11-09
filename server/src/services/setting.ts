import { Setting } from '../models/Setting.js'
import { recordAudit } from './audit.js'

export const DEFAULT_GEOFENCE_RADIUS = 50 // meters
export const MAX_GPS_ACCURACY = 100 // meters
export const MAX_GPS_STALENESS_SECONDS = 300 // 5 minutes

export interface GeofenceConfig {
  defaultRadius: number
  maxAccuracy: number
  maxStalenessSeconds: number
}

/**
 * Calculates great-circle distance between two GPS coordinates in meters using Haversine formula.
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000 // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c)
}

export async function getGeofenceConfig(): Promise<GeofenceConfig> {
  const doc = await Setting.findOne({ key: 'GEOFENCE_CONFIG' }).lean()
  if (!doc || typeof doc.value !== 'object' || !doc.value) {
    return {
      defaultRadius: DEFAULT_GEOFENCE_RADIUS,
      maxAccuracy: MAX_GPS_ACCURACY,
      maxStalenessSeconds: MAX_GPS_STALENESS_SECONDS,
    }
  }
  const val = doc.value as Record<string, number>
  return {
    defaultRadius: typeof val.defaultRadius === 'number' && val.defaultRadius > 0 ? val.defaultRadius : DEFAULT_GEOFENCE_RADIUS,
    maxAccuracy: typeof val.maxAccuracy === 'number' && val.maxAccuracy > 0 ? val.maxAccuracy : MAX_GPS_ACCURACY,
    maxStalenessSeconds: typeof val.maxStalenessSeconds === 'number' && val.maxStalenessSeconds > 0 ? val.maxStalenessSeconds : MAX_GPS_STALENESS_SECONDS,
  }
}

export async function updateGeofenceConfig(
  actorId: string,
  input: { defaultRadius: number; maxAccuracy?: number; maxStalenessSeconds?: number }
): Promise<GeofenceConfig> {
  const current = await getGeofenceConfig()
  const updatedValue: GeofenceConfig = {
    defaultRadius: input.defaultRadius,
    maxAccuracy: input.maxAccuracy ?? current.maxAccuracy,
    maxStalenessSeconds: input.maxStalenessSeconds ?? current.maxStalenessSeconds,
  }

  const updatedDoc = await Setting.findOneAndUpdate(
    { key: 'GEOFENCE_CONFIG' },
    {
      $set: {
        value: updatedValue,
        updatedBy: actorId,
        description: 'System-wide GPS geofencing radius and verification settings',
      },
    },
    { upsert: true, new: true }
  )

  await recordAudit(actorId, 'SETTING_UPDATED', 'Setting', String(updatedDoc._id), {
    key: 'GEOFENCE_CONFIG',
    previous: current,
    updated: updatedValue,
  })

  return updatedValue
}

