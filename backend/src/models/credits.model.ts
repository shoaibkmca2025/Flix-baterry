import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dealers } from './identity.model';
import { warrantyClaims } from './claims.model';

export const creditNoteStatus = pgEnum('credit_note_status', ['issued', 'settled', 'reversed']);

// architecture.md §8.3 credit_notes, trimmed for V1: no rate_id (credit_rates master table
// doesn't exist yet — memory.md D-08 is still open; amounts come from a hardcoded demo map
// in credits.service.ts until the client supplies real rates). Owned by the credits module;
// claims.decide issues through credits.issueInTx, never by inserting here directly.
export const creditNotes = pgTable(
  'credit_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    no: text('no').notNull().unique(), // 'CN-26-09-0188'
    dealerId: uuid('dealer_id')
      .notNull()
      .references(() => dealers.id),
    claimId: uuid('claim_id')
      .notNull()
      .unique()
      .references(() => warrantyClaims.id),
    amount: integer('amount').notNull(), // integer rupees, architecture.md §8.1
    issuedBy: uuid('issued_by').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    status: creditNoteStatus('status').notNull().default('issued'),
    // settle: the invoice/ledger reference the credit was set against (architecture.md §9.7).
    settledRef: text('settled_ref'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    // reverse: only while still 'issued' — a settled note is already on an invoice.
    reversedReason: text('reversed_reason'),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    adjustedBy: uuid('adjusted_by'), // who settled or reversed it
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('credit_notes_dealer_idx').on(t.dealerId, t.status), index('credit_notes_issued_idx').on(t.dealerId, t.issuedAt)],
);
