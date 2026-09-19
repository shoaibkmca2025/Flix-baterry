import { and, desc, eq, gte, inArray, like, lt, or } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { auditEvents } from '../../models/governance.model';
import { users } from '../../models/identity.model';

type DbOrTx = typeof db | Tx;

export type AuditListFilter = {
  actorId?: string;
  action?: string; // exact, or 'prefix.*'
  entityType?: string;
  entityId?: string;
  outcome?: 'ok' | 'denied' | 'failed';
  from?: Date;
  to?: Date; // exclusive
  limit: number;
  cursor?: { at: Date; id: number };
};

// Read-only — the table is append-only at the database level (forbid_change trigger) and
// utils/audit.ts is its sole writer. Newest first, keyset on (at, id).
export async function listAuditEvents(dbh: DbOrTx, filter: AuditListFilter) {
  const conditions = [
    filter.actorId ? eq(auditEvents.actorId, filter.actorId) : undefined,
    filter.action ? (filter.action.endsWith('.*') ? like(auditEvents.action, `${filter.action.slice(0, -1)}%`) : eq(auditEvents.action, filter.action)) : undefined,
    filter.entityType ? eq(auditEvents.entityType, filter.entityType) : undefined,
    filter.entityId ? eq(auditEvents.entityId, filter.entityId) : undefined,
    filter.outcome ? eq(auditEvents.outcome, filter.outcome) : undefined,
    filter.from ? gte(auditEvents.at, filter.from) : undefined,
    filter.to ? lt(auditEvents.at, filter.to) : undefined,
    filter.cursor ? or(lt(auditEvents.at, filter.cursor.at), and(eq(auditEvents.at, filter.cursor.at), lt(auditEvents.id, filter.cursor.id))) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await dbh
    .select()
    .from(auditEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ at: last.at.toISOString(), id: last.id })).toString('base64url') : null;
  return { items, nextCursor };
}

// The whole trail for one entity, oldest first — entry detail "history" panels.
export function listAuditEventsForEntity(dbh: DbOrTx, entityType: string, entityId: string) {
  return dbh
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
    .orderBy(auditEvents.at, auditEvents.id);
}

// Names for the actor ids on a page — ids only in the log rows themselves (rules.md §6).
export async function findActorNames(dbh: DbOrTx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await dbh.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
