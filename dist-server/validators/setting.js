import { z } from 'zod';
export const geofenceSettingSchema = z.object({
    defaultRadius: z.number().int().min(10, 'Radius must be at least 10 meters').max(2000, 'Radius cannot exceed 2000 meters'),
    maxAccuracy: z.number().int().min(10, 'Accuracy threshold must be at least 10 meters').max(500, 'Accuracy threshold cannot exceed 500 meters').optional(),
    maxStalenessSeconds: z.number().int().min(30).max(3600).optional(),
});
