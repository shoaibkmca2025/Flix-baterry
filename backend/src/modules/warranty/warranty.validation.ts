import { z } from 'zod';

const reason = z.string().trim().min(5, 'Give a short reason (at least 5 characters).').max(300);

export const OverrideRequestBody = z.object({
  batteryCode: z.string().trim().min(1, 'Enter the battery code.'), // as printed ('M1000 26090676'), or digits + modelId
  modelId: z.string().trim().min(1).optional(),
  days: z.coerce.number().int().positive('Ask for at least one extra day.'),
  reason,
});
export type OverrideRequestBody = z.infer<typeof OverrideRequestBody>;

export const OverrideDecisionBody = z.object({ reason });
export type OverrideDecisionBody = z.infer<typeof OverrideDecisionBody>;

export const OverrideListQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type OverrideListQuery = z.infer<typeof OverrideListQuery>;
