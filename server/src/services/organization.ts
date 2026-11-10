import { Organization, type IOrganization } from '../models/Organization.js'
import { FileAsset } from '../models/FileAsset.js'
import { recordAudit } from './audit.js'

export const DEFAULT_ORGANIZATION_NAME = 'Excel Technologies and Services'

export interface OrganizationInput {
  name: string
  email?: string
  phone?: string
  address?: string
  expandedLogo?: string
  collapsedLogo?: string
}

export async function getOrganizationConfig(): Promise<IOrganization> {
  const doc = await Organization.findOne().lean()
  if (!doc) {
    const created = await Organization.create({
      name: DEFAULT_ORGANIZATION_NAME,
    })
    return created.toObject() as IOrganization
  }
  const org = doc as unknown as IOrganization
  if (org.expandedLogoAsset) {
    org.expandedLogo = `/api/files/${org.expandedLogoAsset}/view`
  }
  if (org.collapsedLogoAsset) {
    org.collapsedLogo = `/api/files/${org.collapsedLogoAsset}/view`
  }
  return org
}

export async function updateOrganizationConfig(
  actorId: string,
  input: OrganizationInput
): Promise<IOrganization> {
  const current = await getOrganizationConfig()

  const updatedDoc = await Organization.findOneAndUpdate(
    {},
    {
      $set: {
        name: input.name.trim(),
        email: input.email?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        address: input.address?.trim() || undefined,
        ...(input.expandedLogo !== undefined ? { expandedLogo: input.expandedLogo } : {}),
        ...(input.collapsedLogo !== undefined ? { collapsedLogo: input.collapsedLogo } : {}),
        updatedBy: actorId,
      },
    },
    { upsert: true, new: true }
  ).lean()

  const resolvedOrgId = (updatedDoc as { _id?: unknown })?._id
  if (resolvedOrgId) {
    const assetIdsToAssign = [
      (updatedDoc as { expandedLogoAsset?: unknown }).expandedLogoAsset,
      (updatedDoc as { collapsedLogoAsset?: unknown }).collapsedLogoAsset,
    ].filter(Boolean)

    await FileAsset.updateMany(
      {
        isArchived: false,
        ownerType: { $in: ['ORGANIZATION_EXPANDED_LOGO', 'ORGANIZATION_COLLAPSED_LOGO'] },
        $or: [
          ...(assetIdsToAssign.length > 0 ? [{ _id: { $in: assetIdsToAssign } }] : []),
          { 'metadata.ownershipStatus': 'PENDING_ORGANIZATION' },
        ],
      },
      {
        $set: {
          ownerId: resolvedOrgId,
          'metadata.ownershipStatus': 'ASSIGNED',
        },
      }
    )
  }

  await recordAudit(actorId, 'ORGANIZATION_UPDATED', 'Organization', String(resolvedOrgId ?? 'org'), {
    previous: { name: current.name, email: current.email, phone: current.phone },
    updated: { name: input.name, email: input.email, phone: input.phone },
  })

  return updatedDoc as unknown as IOrganization
}
