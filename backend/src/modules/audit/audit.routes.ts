import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './audit.controller';
import { AuditListQuery } from './audit.validation';

// M-08 audit — read side of audit_events (modules.md). Registered at /api/v1 (not /api/v1/audit)
// because it also owns GET /entries/:id/audit, which the spec places under entries' path.
// No export endpoint yet — that waits for the reports job runner (P3-17).
export async function registerAuditRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AuditListQuery }>('/audit', { preHandler: [requireAuth, requirePermission('audit.read')], schema: { querystring: AuditListQuery } }, controller.list);
  app.get<{ Params: { entityType: string; entityId: string } }>('/audit/:entityType/:entityId', { preHandler: [requireAuth, requirePermission('audit.read')] }, controller.trail);
  // dealers read their own entry's history with entries.read — no audit.read needed
  app.get<{ Params: { id: string } }>('/entries/:id/audit', { preHandler: [requireAuth, requirePermission('entries.read')] }, controller.entryTrail);
}
