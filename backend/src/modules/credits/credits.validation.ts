import { z } from 'zod';

const reason = z.string().trim().min(5, 'Give a short reason (at least 5 characters).');

export const CreditNoteListQuery = z.object({
  status: z.enum(['issued', 'settled', 'reversed']).optional(),
  dealerId: z.string().uuid().optional(), // admins only; ignored for a dealer session (own notes always)
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type CreditNoteListQuery = z.infer<typeof CreditNoteListQuery>;

export const CreditNoteSummaryQuery = z.object({
  dealerId: z.string().uuid().optional(), // admins only (dealer profile KPI); dealers get their own
});
export type CreditNoteSummaryQuery = z.infer<typeof CreditNoteSummaryQuery>;

export const CreditNoteSettleBody = z.object({
  ref: z.string().trim().min(1, 'Enter the invoice or ledger reference the credit was set against.').max(60),
});
export type CreditNoteSettleBody = z.infer<typeof CreditNoteSettleBody>;

export const CreditNoteReverseBody = z.object({ reason });
export type CreditNoteReverseBody = z.infer<typeof CreditNoteReverseBody>;
