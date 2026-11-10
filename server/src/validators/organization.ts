import { z } from 'zod'

const crmAssetViewRegex = /^\/api\/files\/[a-f\d]{24}\/view$/i

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required').max(150, 'Organization name is too long'),
  email: z.string().trim().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  address: z.string().trim().max(500).optional().or(z.literal('')),
  expandedLogo: z.string().trim().regex(crmAssetViewRegex, 'Logo must reference a valid CRM file asset').optional().or(z.literal('')),
  collapsedLogo: z.string().trim().regex(crmAssetViewRegex, 'Logo must reference a valid CRM file asset').optional().or(z.literal('')),
})

