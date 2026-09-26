import { date, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { batteries } from './batteries.model';
import { dealers } from './identity.model';

// architecture.md §8.3 warranty_chains, trimmed for V1 (no policy versioning). Confirmed
// 2026-09-17 (memory.md D-03, closed): a replacement inherits the chain's original start date
// unchanged — the chain row is what makes that possible, since every battery in it points to
// the same warrantyStart/warrantyExpiry regardless of how many replacements deep it is.
//
// A chain is permanent while the catalogue and the grace setting can both change, so it keeps
// the numbers it was created from (term + grace, separately) rather than leaving them to be
// re-derived later against different settings — memory.md D-11/D-16.
export const warrantyChains = pgTable('warranty_chains', {
  id: uuid('id').primaryKey().defaultRandom(),
  rootBatteryId: uuid('root_battery_id')
    .notNull()
    .unique()
    .references(() => batteries.id),
  warrantyStart: date('warranty_start').notNull(),
  warrantyExpiry: date('warranty_expiry').notNull(),
  termMonths: integer('term_months').notNull().default(24), // the product's own term, without grace
  graceMonths: integer('grace_months').notNull().default(0), // the shelf-time months added when this chain was opened
  // what the expiry was before a warranty override extended it (architecture.md §8.3)
  expiryBeforeOverride: date('expiry_before_override'),
  replacementCount: integer('replacement_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const overrideStatus = pgEnum('override_status', ['pending', 'approved', 'rejected']);

// A battery whose cover has ended can still be replaced if head office says so — a goodwill
// call Felix makes often enough that the dealer app already points at it ("Request an admin
// override before submitting"). The dealer asks for N extra days with a reason; an admin
// decides; approving extends the CHAIN's expiry and records what it was before.
export const warrantyOverrides = pgTable(
  'warranty_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ref: text('ref').notNull().unique(), // 'OVR-26-09-0007'
    chainId: uuid('chain_id')
      .notNull()
      .references(() => warrantyChains.id),
    batteryId: uuid('battery_id')
      .notNull()
      .references(() => batteries.id), // the battery the dealer actually scanned
    dealerId: uuid('dealer_id').references(() => dealers.id),
    days: integer('days').notNull(),
    reason: text('reason').notNull(),
    status: overrideStatus('status').notNull().default('pending'),
    requestedBy: uuid('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    expiryBefore: date('expiry_before'),
    expiryAfter: date('expiry_after'),
  },
  (t) => [index('warranty_overrides_status_idx').on(t.status, t.requestedAt), index('warranty_overrides_chain_idx').on(t.chainId)],
);

// architecture.md §8.3 replacement_links — APPEND-ONLY (I-2): "the table named replaced
// battery" the team asked for, with the old serial and new serial linked via battery id.
// Lives here, not batteries.model.ts, so it can hold real FKs to both batteries and
// warrantyChains without the circular import batteries.model.ts avoids (see its comment).
export const replacementLinks = pgTable(
  'replacement_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    oldBatteryId: uuid('old_battery_id')
      .notNull()
      .references(() => batteries.id),
    newBatteryId: uuid('new_battery_id')
      .notNull()
      .unique()
      .references(() => batteries.id),
    chainId: uuid('chain_id')
      .notNull()
      .references(() => warrantyChains.id),
    replacedAt: date('replaced_at').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('replacement_links_old_idx').on(t.oldBatteryId), index('replacement_links_chain_idx').on(t.chainId)],
);
