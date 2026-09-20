import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dealers } from './identity.model';
import { entries, entryItems } from './entries.model';

// modules.md M-19 returns, trimmed for V1: challans + lines only (no stock movements — the
// stock ledger isn't built; no PDF asset; no shortages). A challan is a dealer handing a
// van a set of old batteries; each line is one replacement item's old battery and carries
// its own processing stage once it reaches the company.
export const challanStatus = pgEnum('challan_status', ['dispatched', 'received']);
export const returnStage = pgEnum('return_stage', ['in_transit', 'received', 'testing', 'repaired', 'scrapped', 'closed']);

export const challans = pgTable(
  'challans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    no: text('no').notNull().unique(), // 'CHL-26-09-0003'
    dealerId: uuid('dealer_id')
      .notNull()
      .references(() => dealers.id),
    vehicleNo: text('vehicle_no'),
    driverName: text('driver_name'),
    lineCount: integer('line_count').notNull().default(0),
    status: challanStatus('status').notNull().default('dispatched'),
    dispatchedBy: uuid('dispatched_by').notNull(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
    receivedBy: uuid('received_by'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('challans_dealer_status_idx').on(t.dealerId, t.status)],
);

export const challanLines = pgTable(
  'challan_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    challanId: uuid('challan_id')
      .notNull()
      .references(() => challans.id),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entries.id),
    entryItemId: uuid('entry_item_id')
      .notNull()
      .unique() // an old battery travels back once
      .references(() => entryItems.id),
    batteryCode: text('battery_code').notNull(), // the OLD battery's code, normalised
    modelId: text('model_id').notNull(),
    faultCode: text('fault_code'),
    stage: returnStage('stage').notNull().default('in_transit'),
    stageNote: text('stage_note'),
    stagedBy: uuid('staged_by'),
    stagedAt: timestamp('staged_at', { withTimezone: true }),
    shortage: boolean('shortage').notNull().default(false), // on the challan but not in the van
  },
  (t) => [index('challan_lines_challan_idx').on(t.challanId), index('challan_lines_entry_idx').on(t.entryId)],
);
