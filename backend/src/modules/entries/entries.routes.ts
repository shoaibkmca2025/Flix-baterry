import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './entries.controller';
import { EntryCreateBody, EntryDecisionBody, EntryListQuery, EntryPhotoBody, EntrySettleBody } from './entries.validation';

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
  // the dealer's photos (D-10): sent one at a time right after the request; head office reads
  // them through signed links. A phone photo in base64 is over Fastify's 1 MB default.
  app.post<{ Params: { id: string }; Body: EntryPhotoBody }>(
    '/:id/photos',
    { preHandler: [requireAuth, requirePermission('entries.create')], schema: { body: EntryPhotoBody }, bodyLimit: 10 * 1024 * 1024 },
    controller.addPhoto,
  );
  app.get<{ Params: { id: string } }>('/:id/photos', { preHandler: [requireAuth, requirePermission('entries.read')] }, controller.listPhotos);
}
