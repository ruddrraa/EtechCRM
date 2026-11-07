import { z } from 'zod';
export const dashboardQuerySchema = z.object({
    preset: z.enum(['today', 'this_week', 'this_month', 'last_month', 'custom']).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
}).superRefine((value, context) => {
    if (value.preset === 'custom' && (!value.startDate || !value.endDate)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'Custom ranges require startDate and endDate' });
    }
    const dateFields = [['startDate', value.startDate], ['endDate', value.endDate]];
    for (const [field, date] of dateFields) {
        if (date && Number.isNaN(new Date(date).getTime()))
            context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Date must be valid' });
    }
});
