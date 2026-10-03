import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { claimKind } from './claims.model';
import { dealers } from './identity.model';
import { entries, entryItems } from './entries.model';
import { plants } from './masters.model';

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
    // One challan carries both kinds in two sections (client, 3 Oct 2026); the line says which.
    kind: claimKind('kind').notNull().default('replacement'),
    byAdmin: boolean('by_admin').notNull().default(false), // from an entry head office recorded
    batteryCode: text('battery_code').notNull(), // the battery travelling: a replacement's OLD one, or the returned one
    modelId: text('model_id').notNull(),
    faultCode: text('fault_code'),
    stage: returnStage('stage').notNull().default('in_transit'),
    stageNote: text('stage_note'),
    stagedBy: uuid('staged_by'),
    stagedAt: timestamp('staged_at', { withTimezone: true }),
    shortage: boolean('shortage').notNull().default(false), // on the challan but not in the van
    // the plant that MADE this battery, read off its label by the admin on arrival (D-19);
    // null while it is still on the way, or if it arrived before plants existed
    plantId: uuid('plant_id').references(() => plants.id),
  },
  (t) => [index('challan_lines_challan_idx').on(t.challanId), index('challan_lines_entry_idx').on(t.entryId), index('challan_lines_plant_idx').on(t.plantId)],
);
