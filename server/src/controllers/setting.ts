import type { Request, Response } from 'express'
import { getGeofenceConfig, updateGeofenceConfig } from '../services/setting.js'
import { success } from '../utils/api.js'

export async function getGeofenceSetting(_req: Request, res: Response) {
  const config = await getGeofenceConfig()
  return success(res, config)
}

export async function patchGeofenceSetting(req: Request, res: Response) {
  const updated = await updateGeofenceConfig(req.authUser!.id, req.body)
  return success(res, updated)
}

