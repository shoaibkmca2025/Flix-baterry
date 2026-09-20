import { z } from 'zod';

const reason = z.string().trim().min(5, 'Give a short reason (at least 5 characters).');

// Dealer d33: tick the replacement entries being handed to the van. Every replacement item on
// those entries goes on the challan (the app shows one old battery per entry today).
export const ChallanCreateBody = z.object({
  entryIds: z.array(z.string().uuid()).min(1, 'Tick at least one battery to hand over.'),
  vehicleNo: z.string().trim().max(20).optional(),
  driverName: z.string().trim().max(80).optional(),
});
export type ChallanCreateBody = z.infer<typeof ChallanCreateBody>;

export const ChallanReceiveBody = z.object({
  reason: reason.optional(),
  missingBatteryCodes: z.array(z.string().trim().min(1)).default([]), // on the challan, not in the van
});
export type ChallanReceiveBody = z.infer<typeof ChallanReceiveBody>;

export const LineStageBody = z.object({
  stage: z.enum(['testing', 'repaired', 'scrapped', 'closed']),
  reason,
});
export type LineStageBody = z.infer<typeof LineStageBody>;

export const ChallanListQuery = z.object({
  status: z.enum(['dispatched', 'received']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type ChallanListQuery = z.infer<typeof ChallanListQuery>;
