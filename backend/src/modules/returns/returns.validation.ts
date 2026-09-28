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

// The plant that MADE the battery, read off its label by the admin on arrival (memory.md D-19).
const plantId = z.string({ required_error: 'Choose the plant that made this battery.' }).uuid('Choose a plant from the list.');

export const ChallanReceiveBody = z.object({
  reason: reason.optional(),
  missingBatteryCodes: z.array(z.string().trim().min(1)).default([]), // on the challan, not in the van
  // "Confirm all arrived": one plant for every battery arriving now (D-19)
  plantId,
});
export type ChallanReceiveBody = z.infer<typeof ChallanReceiveBody>;

// One battery off the van: it arrives and is tagged with its plant in the same step (D-19).
export const LineReceiveBody = z.object({
  plantId,
  reason: reason.optional(),
});
export type LineReceiveBody = z.infer<typeof LineReceiveBody>;

// Correcting a misread label — or tagging a battery that arrived before plants existed.
export const LinePlantBody = z.object({ plantId, reason });
export type LinePlantBody = z.infer<typeof LinePlantBody>;

// Returned batteries by plant. plantId=none lists the ones that arrived but have no plant yet.
export const ReturnLineListQuery = z.object({
  plantId: z.union([z.string().uuid(), z.literal('none')]).optional(),
  stage: z.enum(['in_transit', 'received', 'testing', 'repaired', 'scrapped', 'closed']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type ReturnLineListQuery = z.infer<typeof ReturnLineListQuery>;

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
