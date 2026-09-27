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

export const ClaimDecideBody = z
  .object({
    outcome: z.enum(['approved', 'refused']),
    reason,
    // Felix's accounts team settles the money itself; the credit note only tells the dealer
    // what is coming, so head office types the figure rather than the system inventing one
    // (memory.md D-08). Whole rupees; 0 is allowed and means "approved, nothing to credit".
    amount: z.coerce.number().int('Enter whole rupees.').min(0, 'The amount cannot be negative.').max(10_000_000).optional(),
  })
  .refine((v) => v.outcome !== 'approved' || v.amount !== undefined, {
    message: 'Enter the credit amount for this claim.',
    path: ['amount'],
  });
export type ClaimDecideBody = z.infer<typeof ClaimDecideBody>;

export const ClaimListQuery = z.object({
  status: z.enum(['raised', 'awaiting_return', 'received', 'checked', 'approved', 'refused']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type ClaimListQuery = z.infer<typeof ClaimListQuery>;
