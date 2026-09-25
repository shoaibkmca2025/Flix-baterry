import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './entries.controller';
import { EntryCreateBody, EntryDecisionBody, EntryListQuery, EntrySettleBody } from './entries.validation';

// M-14 entries — architecture.md §19. The real, permanent replacement for the temporary
// POST /batteries/sell, POST /batteries/replace, and POST /claims (see logs.md 2026-09-17).
export async function registerEntryRoutes(app: FastifyInstance) {
  app.post<{ Body: EntryCreateBody }>('/', { preHandler: [requireAuth, requirePermission('entries.create')], schema: { body: EntryCreateBody } }, controller.create);
  app.get<{ Querystring: EntryListQuery }>('/', { preHandler: [requireAuth, requirePermission('entries.read')], schema: { querystring: EntryListQuery } }, controller.list);
  app.get<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth, requirePermission('entries.read')] }, controller.getById);
  app.post<{ Params: { id: string }; Body: EntryDecisionBody }>(
    '/:id/approve',
    { preHandler: [requireAuth, requirePermission('entries.approve')], schema: { body: EntryDecisionBody } },
    controller.approve,
  );
  app.post<{ Params: { id: string }; Body: EntryDecisionBody }>(
    '/:id/reject',
    { preHandler: [requireAuth, requirePermission('entries.reject')], schema: { body: EntryDecisionBody } },
    controller.reject,
  );
  // approve/refuse a replacement in one step once its old battery is at the factory
  app.post<{ Params: { id: string }; Body: EntrySettleBody }>(
    '/:id/settle',
    { preHandler: [requireAuth, requirePermission('entries.approve'), requirePermission('claims.decide')], schema: { body: EntrySettleBody } },
    controller.settle,
  );
}
