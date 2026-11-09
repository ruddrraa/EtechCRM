import { z } from 'zod';
const phone = z.string().trim().regex(/^[+]?[\d\s().-]{7,20}$/, 'Enter a valid phone number').optional().or(z.literal(''));
const email = z.string().trim().email('Enter a valid email address').optional().or(z.literal(''));
export const clientSchema = z.object({
    organisationName: z.string().trim().min(1, 'Organisation name is required').max(200),
    categoryId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid category ID').optional(),
    category: z.string().trim().min(1).max(100).optional(),
    address: z.string().trim().min(1, 'Address is required').max(500),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    placeId: z.string().trim().max(200).optional().nullable(),
    formattedAddress: z.string().trim().max(500).optional().nullable(),
    geofenceRadius: z.number().int().min(10).max(2000).optional().nullable(),
    contactPerson: z.string().trim().max(120).optional(),
    phone,
    email,
    notes: z.string().trim().max(2000).optional(),
}).refine((value) => Boolean(value.phone || value.email), {
    message: 'Phone or email is required',
    path: ['phone'],
}).refine((value) => Boolean(value.categoryId || value.category), {
    message: 'Category is required',
    path: ['category'],
});
