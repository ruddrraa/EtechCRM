import { z } from 'zod';
export const updateOrganizationSchema = z.object({
    name: z.string().trim().min(1, 'Organization name is required').max(150, 'Organization name is too long'),
    email: z.string().trim().email('Invalid email address').optional().or(z.literal('')),
    phone: z.string().trim().max(30).optional().or(z.literal('')),
    address: z.string().trim().max(500).optional().or(z.literal('')),
    expandedLogo: z.string().trim().optional(),
    collapsedLogo: z.string().trim().optional(),
});
