import { z } from 'zod';

export const BatteryLookupQuery = z.object({
  code: z.string().trim().min(1, 'Enter a battery code.'),
});
export type BatteryLookupQuery = z.infer<typeof BatteryLookupQuery>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

// Temporary stand-in for entries.create's regular_sales effect (memory.md D-03 log,
// 2026-09-17) — establishes the very first link in a warranty chain. Superseded once the
// real entries module exists; the chain data model itself doesn't change when that happens.
export const BatterySaleBody = z.object({
  code: z.string().trim().min(1, 'Enter the battery code.'),
  modelId: z.string().trim().min(1, 'Choose a model.'),
  saleDate: isoDate.optional(),
});
export type BatterySaleBody = z.infer<typeof BatterySaleBody>;

// Temporary stand-in for entries.create's replacement effect ("continues_chain").
export const BatteryReplaceBody = z.object({
  oldCode: z.string().trim().min(1, 'Enter the old battery code.'),
  newCode: z.string().trim().min(1, 'Enter the new battery code.'),
  newModelId: z.string().trim().min(1, 'Choose a model.'),
  replacementDate: isoDate.optional(),
});
export type BatteryReplaceBody = z.infer<typeof BatteryReplaceBody>;

export const BatteryListQuery = z.object({
  state: z.enum(['available', 'allocated', 'sold', 'returned', 'replacement', 'repair', 'damaged', 'scrap']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type BatteryListQuery = z.infer<typeof BatteryListQuery>;
