import { z } from 'zod';

const reason = z.string().trim().min(5, 'Give a short reason (at least 5 characters).');

export const ClaimCheckBody = z.object({
  findingCode: z.string().trim().min(1, 'Enter what was found.'),
  conditionNote: z.string().trim().optional(),
  disposition: z.enum(['repair', 'scrap', 'hold']),
  disqualify: z.boolean().default(false),
  reason: reason.optional(),
}).refine((v) => !v.disqualify || !!v.reason, { message: 'Give a reason for rejecting the claim.', path: ['reason'] });
export type ClaimCheckBody = z.infer<typeof ClaimCheckBody>;

// No amount: approving means "approved for refund", nothing more. Felix's accounts team works
// out and pays the refund outside this system (client, 28 Sep 2026 — memory.md D-20). An
// `amount` sent by an older app is ignored (zod drops unknown keys), not refused.
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
