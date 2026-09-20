import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dealers } from './identity.model';
import { batteries } from './batteries.model';
import { warrantyChains } from './warranty.model';

// architecture.md §8.3 warranty_claims, trimmed for V1: no entry_id/entry_item_id (entries
// doesn't exist yet — a claim is created directly off a replacement instead, via
// claims.createFromReplacement). "in_transit" folded in as `awaiting_return` (already an
// architecture.md status) rather than building a separate challan/returns module for V1 —
// see modules.md's returns module for the full design when that's actually needed.
export const claimStatus = pgEnum('claim_status', ['raised', 'awaiting_return', 'received', 'checked', 'approved', 'refused']);
export const claimDisposition = pgEnum('claim_disposition', ['repair', 'scrap', 'hold']);

export const warrantyClaims = pgTable(
  'warranty_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ref: text('ref').notNull().unique(), // 'CLM-26-09-0212'
    dealerId: uuid('dealer_id')
      .notNull()
      .references(() => dealers.id),
    chainId: uuid('chain_id')
      .notNull()
      .references(() => warrantyChains.id),
    oldBatteryId: uuid('old_battery_id')
      .notNull()
      .references(() => batteries.id),
    newBatteryId: uuid('new_battery_id')
      .notNull()
      .unique()
      .references(() => batteries.id),
    status: claimStatus('status').notNull().default('raised'),
    findingCode: text('finding_code'),
    conditionNote: text('condition_note'),
    disposition: claimDisposition('disposition'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    creditNoteId: uuid('credit_note_id'), // -> credit_notes.id, set once approved
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('warranty_claims_dealer_idx').on(t.dealerId, t.status)],
);

// credit_notes moved to credits.model.ts (owned by the credits module, modules.md §4).
