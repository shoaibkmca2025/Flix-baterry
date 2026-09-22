import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dealers } from './identity.model';
import { batteryModels } from './masters.model';

// architecture.md §8.3 entries/entry_items, trimmed for V1: no entry_type_id (entry_types
// master table doesn't exist — the two dealer-visible types from the app, 'replacement' and
// 'sales_return', are a fixed enum instead, matching D-07's default alias), no evidence_asset
// FKs (evidence/Cloudinary is explicitly out of V1 scope — memory.md §1a), no client_key
// idempotency column yet (offline sync isn't built). gps/signature are stored exactly as the
// app already produces them: plain strings, not structured JSON (see src/dealer/media.tsx).
// 'regular_sales' isn't dealer-visible (D-02 — dealers see Replacement + Sales Return only)
// but is what actually establishes a battery's FIRST warranty chain (architecture.md's
// warranty_effect: starts_warranty). Admin-only for now, since the app has no dealer screen
// for it; this is what replaces the temporary POST /batteries/sell.
export const entryType = pgEnum('entry_type', ['replacement', 'sales_return', 'regular_sales']);
export const entryStatus = pgEnum('entry_status', ['submitted', 'approved', 'rejected']);

export const entries = pgTable(
  'entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ref: text('ref').notNull().unique(), // 'ENT-26-09-0414'
    dealerId: uuid('dealer_id')
      .notNull()
      .references(() => dealers.id),
    entryType: entryType('entry_type').notNull(),
    entryDate: text('entry_date').notNull(), // 'YYYY-MM-DD', business date (architecture.md §6.1)
    place: text('place').notNull(),
    customerName: text('customer_name'),
    remarks: text('remarks'),
    totalQty: integer('total_qty').notNull().default(0), // recomputed from items on every write
    status: entryStatus('status').notNull().default('submitted'),
    gps: text('gps'),
    signature: text('signature'),
    coverToldAt: timestamp('cover_told_at', { withTimezone: true }),
    submittedBy: uuid('submitted_by').notNull(),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('entries_dealer_status_idx').on(t.dealerId, t.status)],
);

export const entryItems = pgTable(
  'entry_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entries.id),
    seq: integer('seq').notNull(),
    modelId: text('model_id')
      .notNull()
      .references(() => batteryModels.id),
    batteryCode: text('battery_code').notNull(), // normalised
    batteryCodeEntered: text('battery_code_entered').notNull(),
    oldBatteryCode: text('old_battery_code'), // normalised; required for 'replacement', null for 'sales_return'
    oldBatteryCodeEntered: text('old_battery_code_entered'),
    // the OLD battery's (plate, model) when it is not on record yet — that is what its warranty
    // term is read from (memory.md D-11). Null = same as modelId (a like-for-like replacement).
    oldModelId: text('old_model_id'),
    faultCode: text('fault_code'),
    remarks: text('remarks'),
    // filled in once the entry is approved (architecture.md §8.3 entry_items.battery_id) —
    // null while status = 'submitted'.
    batteryId: uuid('battery_id'),
    oldBatteryId: uuid('old_battery_id'),
    claimId: uuid('claim_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('entry_items_entry_idx').on(t.entryId)],
);
