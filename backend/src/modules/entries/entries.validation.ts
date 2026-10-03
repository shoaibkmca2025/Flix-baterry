import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

export const EntryItemInput = z.object({
  modelId: z.string().trim().min(1, 'Choose a model.'),
  code: z.string().trim().min(1, 'Enter the battery code.'),
  oldCode: z.string().trim().optional(), // required for 'replacement', checked in the service (matches d11/d13's per-type fields)
  oldModelId: z.string().trim().min(1).optional(), // the old battery's plate+model when it is not on record; defaults to modelId
  faultCode: z.string().trim().optional(),
  remarks: z.string().trim().optional(),
});
export type EntryItemInput = z.infer<typeof EntryItemInput>;

// Matches src/dealer/Capture.tsx's d10-d16 flow field-for-field, so wiring the real UI to
// this later is a straight swap, not a redesign.
export const EntryCreateBody = z.object({
  entryType: z.enum(['replacement', 'sales_return', 'regular_sales']),
  dealerId: z.string().uuid().optional(), // head office recording on a dealer's behalf (P2-09); ignored for a dealer session
  entryDate: isoDate.optional(), // defaults to today (server-side, Kolkata) if omitted
  place: z.string().trim().min(1, 'Enter the place.'),
  customerName: z.string().trim().optional(),
  remarks: z.string().trim().optional(),
  items: z.array(EntryItemInput).min(1, 'Add at least one battery.'),
  gps: z.string().trim().optional(),
  signature: z.string().trim().optional(),
  coverTold: z.boolean().default(false),
  // Which kind of sales return: stock that never sold, or one that is faulty (client, 3 Oct 2026).
  returnKind: z.enum(['unsold', 'defective']).optional(),
}).superRefine((v, ctx) => {
  if (v.entryType === 'replacement') {
    v.items.forEach((item, i) => {
      if (!item.oldCode) ctx.addIssue({ code: 'custom', message: 'Enter the old battery code.', path: ['items', i, 'oldCode'] });
      if (!item.faultCode) ctx.addIssue({ code: 'custom', message: 'Choose what is wrong with the old battery.', path: ['items', i, 'faultCode'] });
    });
  }
  // A sales return must say which kind it is; the fault stays optional, because stock coming
  // back unsold has nothing wrong with it to name.
  if (v.entryType === 'sales_return' && !v.returnKind) {
    ctx.addIssue({ code: 'custom', message: 'Say whether this is unsold stock or a faulty battery.', path: ['returnKind'] });
  }
});
export type EntryCreateBody = z.infer<typeof EntryCreateBody>;

const reason = z.string().trim().min(5, 'Give a short reason (at least 5 characters).');

export const EntryDecisionBody = z.object({ reason });
export type EntryDecisionBody = z.infer<typeof EntryDecisionBody>;

// the final decision on a replacement once its old battery is at the factory (entries.settle)
// Approving is "approved for refund" — no amount (memory.md D-20).
// `itemId` decides ONE battery of a multi-battery replacement on its own (client, 2 Oct 2026);
// without it, every battery on the entry is decided together.
export const EntrySettleBody = z.object({
  // 'passed' is the engineer's verdict: this battery is good, but it is NOT approved for refund
  // yet — that is the Claim button on the challan (client, 2 Oct 2026). 'approved' still does
  // both in one call, which is what a single battery decided on its own uses.
  decision: z.enum(['approved', 'passed', 'refused']),
  reason,
  itemId: z.string().uuid().optional(),
});
export type EntrySettleBody = z.infer<typeof EntrySettleBody>;

// One battery at a time (client, 2 Oct 2026). Marking a battery as being looked at needs no
// reason — it records intent, not a decision — so the note is optional.
export const EntryItemReviewBody = z.object({ note: z.string().trim().max(500).optional() });
export type EntryItemReviewBody = z.infer<typeof EntryItemReviewBody>;

// Correcting one battery's serials. Every field but the reason is optional: a correction that
// only fixes the old battery leaves the new one exactly as the dealer sent it.
export const EntryItemCorrectBody = z.object({
  code: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
  oldCode: z.string().trim().min(1).optional(),
  oldModelId: z.string().trim().min(1).optional(),
  reason,
}).refine((v) => v.code || v.modelId || v.oldCode || v.oldModelId, {
  message: 'Change at least one of the battery number, its model, or the old battery.',
});
export type EntryItemCorrectBody = z.infer<typeof EntryItemCorrectBody>;

export const EntryListQuery = z.object({
  status: z.enum(['submitted', 'approved', 'rejected', 'with_distributor'] as const).optional(),
  dealerId: z.string().uuid().optional(), // admins only; a dealer's scope always comes from the token
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type EntryListQuery = z.infer<typeof EntryListQuery>;

// A photo for a request (D-10). The dealer app sends it base64 right after the request is
// accepted; `itemSeq` is the battery on the request it shows (0 = the first), absent for the
// request as a whole. ~8 MB of base64 is ~6 MB of JPEG — far above what the app's 40% quality
// camera produces.
// the distributor marks a dealer's old battery arrived — one battery, or all still to come
export const EntryArrivedBody = z.object({ itemId: z.string().uuid().optional() });
export type EntryArrivedBody = z.infer<typeof EntryArrivedBody>;

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const EntryPhotoBody = z.object({
  tag: z.string().trim().min(1).max(60),
  itemSeq: z.number().int().min(0).optional(),
  contentType: z.enum(PHOTO_TYPES),
  data: z.string().min(1).max(8_000_000).regex(/^[A-Za-z0-9+/=\r\n]+$/, 'The photo must be base64.'),
});
export type EntryPhotoBody = z.infer<typeof EntryPhotoBody>;
