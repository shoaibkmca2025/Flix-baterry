import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

export const EntryItemInput = z.object({
  modelId: z.string().trim().min(1, 'Choose a model.'),
  code: z.string().trim().min(1, 'Enter the battery code.'),
  oldCode: z.string().trim().optional(), // required for 'replacement', checked in the service (matches d11/d13's per-type fields)
  faultCode: z.string().trim().optional(),
  remarks: z.string().trim().optional(),
});
export type EntryItemInput = z.infer<typeof EntryItemInput>;

// Matches src/dealer/Capture.tsx's d10-d16 flow field-for-field, so wiring the real UI to
// this later is a straight swap, not a redesign.
export const EntryCreateBody = z.object({
  entryType: z.enum(['replacement', 'sales_return', 'regular_sales']),
  entryDate: isoDate.optional(), // defaults to today (server-side, Kolkata) if omitted
  place: z.string().trim().min(1, 'Enter the place.'),
  customerName: z.string().trim().optional(),
  remarks: z.string().trim().optional(),
  items: z.array(EntryItemInput).min(1, 'Add at least one battery.'),
  gps: z.string().trim().optional(),
  signature: z.string().trim().optional(),
  coverTold: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if (v.entryType === 'replacement') {
    v.items.forEach((item, i) => {
      if (!item.oldCode) ctx.addIssue({ code: 'custom', message: 'Enter the old battery code.', path: ['items', i, 'oldCode'] });
      if (!item.faultCode) ctx.addIssue({ code: 'custom', message: 'Choose what is wrong with the old battery.', path: ['items', i, 'faultCode'] });
    });
  }
});
export type EntryCreateBody = z.infer<typeof EntryCreateBody>;

const reason = z.string().trim().min(5, 'Give a short reason (at least 5 characters).');

export const EntryDecisionBody = z.object({ reason });
export type EntryDecisionBody = z.infer<typeof EntryDecisionBody>;

export const EntryListQuery = z.object({
  status: z.enum(['submitted', 'approved', 'rejected'] as const).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type EntryListQuery = z.infer<typeof EntryListQuery>;
