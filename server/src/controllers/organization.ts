import type { Request, Response } from 'express'
import { getOrganizationConfig, updateOrganizationConfig } from '../services/organization.js'
import { success } from '../utils/api.js'

export async function getOrganization(_req: Request, res: Response) {
  const org = await getOrganizationConfig()
  return success(res, org)
}

export async function patchOrganization(req: Request, res: Response) {
  const actor = req.authUser!
  const updated = await updateOrganizationConfig(actor.id, req.body)
  return success(res, updated)
}

