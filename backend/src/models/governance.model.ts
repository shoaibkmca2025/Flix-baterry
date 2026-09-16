import { bigserial, index, inet, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// architecture.md §9.1 — atomic, gap-free reference numbering (ENT-, CLM-, FBI-RT-, CN-).
export const counters = pgTable(
  'counters',
  {
    kind: text('kind').notNull(),
    period: text('period').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.kind, t.period] })],
);

// architecture.md §8.3 — runtime configuration, read/written only by the settings module.
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  // fk -> users once P1-02 lands; left as a bare uuid until that table exists.
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditOutcome = pgEnum('audit_outcome', ['ok', 'denied', 'failed']);

// architecture.md §8.3 / I-7 — append-only, sole writer is utils/audit.ts. See forbid_change() trigger.
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    // fk -> users once P1-02 lands.
    actorId: uuid('actor_id'),
    actorRole: text('actor_role').notNull(),
    actorScope: text('actor_scope').notNull(),
    actorDealerId: uuid('actor_dealer_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    entityRef: text('entity_ref'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    outcome: auditOutcome('outcome').notNull(),
    requestId: text('request_id'),
    ip: inet('ip'),
    deviceId: text('device_id'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('audit_events_entity_idx').on(t.entityType, t.entityId),
    index('audit_events_actor_at_idx').on(t.actorId, t.at),
    index('audit_events_at_idx').on(t.at),
  ],
);
