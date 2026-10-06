import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './entries.controller';
import { EntryArrivedBody, EntryCreateBody, EntryDecisionBody, EntryItemCorrectBody, EntryItemReviewBody, EntryListQuery, EntryPhotoBody, EntrySettleBody } from './entries.validation';

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
  // one battery of a request at a time (client, 2 Oct 2026). Reviewing is a note about work in
  // progress, so it rides on entries.read + entries.approve; correcting rewrites what the dealer
  // sent, so it needs the same right as rejecting it.
  app.post<{ Params: { id: string; itemId: string }; Body: EntryItemReviewBody }>(
    '/:id/items/:itemId/review',
    { preHandler: [requireAuth, requirePermission('entries.approve')], schema: { body: EntryItemReviewBody } },
    controller.reviewItem,
  );
  app.post<{ Params: { id: string; itemId: string }; Body: EntryItemCorrectBody }>(
    '/:id/items/:itemId/correct',
    { preHandler: [requireAuth, requirePermission('entries.reject')], schema: { body: EntryItemCorrectBody } },
    controller.correctItem,
  );
  // the dealer's photos (D-10): sent one at a time right after the request; head office reads
  // them through signed links. A phone photo in base64 is over Fastify's 1 MB default.
  app.post<{ Params: { id: string }; Body: EntryPhotoBody }>(
    '/:id/photos',
    { preHandler: [requireAuth, requirePermission('entries.create')], schema: { body: EntryPhotoBody }, bodyLimit: 10 * 1024 * 1024 },
    controller.addPhoto,
  );
  // the distributor marks a dealer's old battery arrived; only arrived batteries can be dispatched
  app.post<{ Params: { id: string }; Body: EntryArrivedBody }>('/:id/arrived', { preHandler: [requireAuth], schema: { body: EntryArrivedBody } }, controller.markArrived);
  // a distributor approves (→ head office) or refuses a dealer's request; the service checks it is his dealer's
  app.post<{ Params: { id: string }; Body: EntryDecisionBody }>('/:id/distributor/approve', { preHandler: [requireAuth], schema: { body: EntryDecisionBody } }, controller.distributorApprove);
  app.post<{ Params: { id: string }; Body: EntryDecisionBody }>('/:id/distributor/refuse', { preHandler: [requireAuth], schema: { body: EntryDecisionBody } }, controller.distributorRefuse);
  // a special replacement request (old battery past its term) is decided by head office in Correction requests
  app.post<{ Params: { id: string }; Body: EntryDecisionBody }>('/:id/special/approve', { preHandler: [requireAuth, requirePermission('entries.approve')], schema: { body: EntryDecisionBody } }, controller.specialApprove);
  app.post<{ Params: { id: string }; Body: EntryDecisionBody }>('/:id/special/reject', { preHandler: [requireAuth, requirePermission('entries.reject')], schema: { body: EntryDecisionBody } }, controller.specialReject);
  // voiding takes a request out of every live queue — the same right as refusing it
  app.post<{ Params: { id: string }; Body: EntryDecisionBody }>('/:id/void', { preHandler: [requireAuth, requirePermission('entries.reject')], schema: { body: EntryDecisionBody } }, controller.voidEntry);
  app.get<{ Params: { id: string } }>('/:id/photos', { preHandler: [requireAuth, requirePermission('entries.read')] }, controller.listPhotos);
}
