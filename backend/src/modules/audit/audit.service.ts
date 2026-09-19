import { db } from '../../database/client';
import type { auditEvents } from '../../models/governance.model';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { findEntryById } from '../entries/entries.repository';
import * as repo from './audit.repository';
import type { AuditListQuery } from './audit.validation';

// M-08 audit — the READ side only. Writing is utils/audit.ts, in the same transaction as the
// change it records; nothing here ever writes.

type AuditRow = typeof auditEvents.$inferSelect;

const BUSINESS_TZ_OFFSET_MS = 5.5 * 60 * 60 * 1000; // Asia/Kolkata (memory.md §12)

function requireUser(ctx: Ctx) {
  if (!ctx.user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  return ctx.user;
}

// 'YYYY-MM-DD' business date → the UTC instant that day starts in Asia/Kolkata.
function businessDayStart(isoDate: string): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - BUSINESS_TZ_OFFSET_MS);
}

// Protected fields inside before/after snapshots (modules.md M-08 redaction): anyone below
// main_admin sees mobiles/emails masked; read_only additionally loses customer names.
const CONTACT_KEY = /mobile|phone|email/i;
const CUSTOMER_NAME_KEY = /^customer(Name)?$|customer_name/i;

export function redactSnapshot(value: unknown, level: 'none' | 'contacts' | 'contacts_and_names'): unknown {
  if (level === 'none' || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSnapshot(v, level));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (CONTACT_KEY.test(k) && typeof v === 'string') out[k] = maskContact(v);
    else if (level === 'contacts_and_names' && CUSTOMER_NAME_KEY.test(k) && typeof v === 'string') out[k] = '[redacted]';
    else out[k] = redactSnapshot(v, level);
  }
  return out;
}

// '98xxxxxx10' / 'p…@example.com' — enough to recognise, not enough to contact.
function maskContact(v: string): string {
  if (v.includes('@')) {
    const [local, domain] = v.split('@');
    return `${local!.slice(0, 1)}…@${domain}`;
  }
  const digits = v.replace(/\D/g, '');
  return digits.length >= 4 ? `${digits.slice(0, 2)}${'x'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}` : 'xxxx';
}

function redactionLevelFor(role: string): 'none' | 'contacts' | 'contacts_and_names' {
  if (role === 'main_admin') return 'none';
  if (role === 'read_only') return 'contacts_and_names';
  return 'contacts';
}

type Viewer = { level: 'none' | 'contacts' | 'contacts_and_names'; hideAdminIdentity: boolean };

async function present(rows: AuditRow[], viewer: Viewer) {
  const names = await repo.findActorNames(db, [...new Set(rows.map((r) => r.actorId).filter((id): id is string => !!id))]);
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    actor:
      viewer.hideAdminIdentity && r.actorScope === 'admin'
        ? { id: null, name: 'Head office', role: 'admin', scope: 'admin' } // dealers never learn which admin acted
        : { id: r.actorId, name: r.actorId ? (names.get(r.actorId) ?? null) : r.actorRole, role: r.actorRole, scope: r.actorScope },
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    entityRef: r.entityRef,
    before: redactSnapshot(r.before, viewer.level),
    after: redactSnapshot(r.after, viewer.level),
    reason: r.reason,
    outcome: r.outcome,
    requestId: viewer.hideAdminIdentity ? undefined : r.requestId,
    ip: viewer.level === 'none' ? r.ip : undefined, // network identifiers only for main_admin
    deviceId: viewer.level === 'none' ? r.deviceId : undefined,
  }));
}

// GET /audit — admins only (audit.read). Filters + keyset cursor.
export async function list(ctx: Ctx, query: AuditListQuery) {
  const user = requireUser(ctx);
  if (user.scope !== 'admin') throw new AppError('permission_denied', 403, 'You do not have permission to do this.');
  if (query.from && query.to && query.from > query.to) throw new AppError('filter_invalid', 422, '"from" must not be after "to".');

  const page = await repo.listAuditEvents(db, {
    actorId: query.actorId,
    action: query.action,
    entityType: query.entityType,
    entityId: query.entityId,
    outcome: query.outcome,
    from: query.from ? businessDayStart(query.from) : undefined,
    to: query.to ? new Date(businessDayStart(query.to).getTime() + 86_400_000) : undefined,
    limit: query.limit,
    cursor: decodeCursor(query.cursor),
  });
  return { items: await present(page.items, { level: redactionLevelFor(user.role), hideAdminIdentity: false }), nextCursor: page.nextCursor };
}

// GET /audit/:entityType/:entityId — one entity's whole trail (admins).
export async function trail(ctx: Ctx, entityType: string, entityId: string) {
  const user = requireUser(ctx);
  if (user.scope !== 'admin') throw new AppError('permission_denied', 403, 'You do not have permission to do this.');
  const rows = await repo.listAuditEventsForEntity(db, entityType, entityId);
  return present(rows, { level: redactionLevelFor(user.role), hideAdminIdentity: false });
}

// GET /entries/:id/audit — a dealer sees their own entry's history with head-office actors
// reduced to "Head office" (modules.md M-08); admins see it in full (subject to redaction).
export async function entryTrail(ctx: Ctx, entryId: string) {
  const user = requireUser(ctx);
  const entry = await findEntryById(db, entryId);
  if (!entry || (user.scope === 'dealer' && entry.dealerId !== user.dealerId)) {
    throw new AppError('entry_not_found', 404, 'Entry not found.'); // 404, not 403 — no existence leak (I-3)
  }
  const rows = await repo.listAuditEventsForEntity(db, 'entry', entry.id);
  const isDealer = user.scope === 'dealer';
  return present(rows, { level: isDealer ? 'contacts' : redactionLevelFor(user.role), hideAdminIdentity: isDealer });
}

function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  try {
    const { at, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof id !== 'number' || Number.isNaN(Date.parse(at))) throw new Error('bad cursor');
    return { at: new Date(at), id };
  } catch {
    throw new AppError('filter_invalid', 422, 'That page link is not valid — start from the first page again.');
  }
}
