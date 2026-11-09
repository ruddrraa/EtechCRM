import { z } from 'zod';
export const createCategorySchema = z.object({
    name: z.string().trim().min(1, 'Category name is required').max(100, 'Category name cannot exceed 100 characters'),
});
export const updateCategorySchema = z.object({
    name: z.string().trim().min(1, 'Category name cannot be empty').max(100, 'Category name cannot exceed 100 characters').optional(),
    isActive: z.boolean().optional(),
}).refine((data) => data.name !== undefined || data.isActive !== undefined, {
    message: 'At least one field (name or isActive) must be provided',
});
export const categoryQuerySchema = z.object({
    activeOnly: z.enum(['true', 'false']).optional(),
    q: z.string().trim().optional(),
});
