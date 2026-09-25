import { z } from 'zod';

const states = ['available', 'allocated', 'sold', 'returned', 'replacement', 'repair', 'damaged', 'scrap'] as const;
const custodians = ['company', 'dealer', 'customer', 'transit'] as const;

export const StockMovementPostBody = z.object({
  batteryCode: z.string().trim().min(1, 'Enter a battery code.'), // as printed ('M1000 26090676') or just the digits with modelId
  modelId: z.string().trim().min(1).optional(),
  toState: z.enum(states),
  toCustodian: z.enum(custodians).optional(), // defaults to the battery's current custodian
  toDealerId: z.string().uuid().nullable().optional(), // defaults to the battery's current dealer
  reasonText: z.string().trim().min(5, 'Give a short reason (at least 5 characters).').max(300),
  correctionOfId: z.string().uuid().optional(), // this movement compensates an earlier one
});
export type StockMovementPostBody = z.infer<typeof StockMovementPostBody>;

export const StockMovementListQuery = z.object({
  batteryCode: z.string().trim().optional(),
  modelId: z.string().trim().optional(),
  dealerId: z.string().uuid().optional(), // admins only; a dealer always sees their own
  reasonCode: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type StockMovementListQuery = z.infer<typeof StockMovementListQuery>;

export const StockPositionsQuery = z.object({
  by: z.enum(['state', 'model', 'dealer']).default('state'),
  dealerId: z.string().uuid().optional(), // admins only
});
export type StockPositionsQuery = z.infer<typeof StockPositionsQuery>;
