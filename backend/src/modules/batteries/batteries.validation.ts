import { z } from 'zod';

export const BatteryLookupQuery = z.object({
  code: z.string().trim().min(1, 'Enter a battery code.'),
});
export type BatteryLookupQuery = z.infer<typeof BatteryLookupQuery>;

export const BatteryListQuery = z.object({
  state: z.enum(['available', 'allocated', 'sold', 'returned', 'replacement', 'repair', 'damaged', 'scrap']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type BatteryListQuery = z.infer<typeof BatteryListQuery>;
