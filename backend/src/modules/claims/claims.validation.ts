import { z } from 'zod';

export const ClaimCreateBody = z.object({
  newBatteryCode: z.string().trim().min(1, 'Enter the new battery code.'),
});
export type ClaimCreateBody = z.infer<typeof ClaimCreateBody>;

const reason = z.string().trim().min(5, 'Give a short reason (at least 5 characters).');

export const ClaimCheckBody = z.object({
  findingCode: z.string().trim().min(1, 'Enter what was found.'),
  conditionNote: z.string().trim().optional(),
  disposition: z.enum(['repair', 'scrap', 'hold']),
  disqualify: z.boolean().default(false),
  reason: reason.optional(),
}).refine((v) => !v.disqualify || !!v.reason, { message: 'Give a reason for rejecting the claim.', path: ['reason'] });
export type ClaimCheckBody = z.infer<typeof ClaimCheckBody>;

export const ClaimDecideBody = z.object({
  outcome: z.enum(['approved', 'refused']),
  reason,
});
export type ClaimDecideBody = z.infer<typeof ClaimDecideBody>;

export const ClaimListQuery = z.object({
  status: z.enum(['raised', 'awaiting_return', 'received', 'checked', 'approved', 'refused']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type ClaimListQuery = z.infer<typeof ClaimListQuery>;
