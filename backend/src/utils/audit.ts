import type { Tx } from '../database/client';
import { auditEvents } from '../models/governance.model';
import type { Ctx } from './context';

type AuditInput = {
  ctx: Ctx;
  action: string; // 'entry.approved' style — entity.verb_past (rules.md §4)
  entityType: string;
  entityId: string;
  entityRef?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  outcome: 'ok' | 'denied' | 'failed';
};

// The only writer of audit_events (rules.md §6) — every state change goes through this,
// in the same transaction as the write it describes.
export function audit(tx: Tx, input: AuditInput) {
  return tx.insert(auditEvents).values({
    actorId: input.ctx.user?.id ?? null,
    actorRole: input.ctx.user?.role ?? 'system',
    actorScope: input.ctx.user?.scope ?? 'system',
    actorDealerId: input.ctx.user?.dealerId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    entityRef: input.entityRef,
    before: input.before,
    after: input.after,
    reason: input.reason,
    outcome: input.outcome,
    requestId: input.ctx.request.id,
    ip: input.ctx.request.ip,
    deviceId: input.ctx.request.deviceId,
    userAgent: input.ctx.request.userAgent,
  });
}
