import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './claims.controller';
import { ClaimCheckBody, ClaimCreateBody, ClaimDecideBody, ClaimListQuery } from './claims.validation';

// M-17 claims — architecture.md §19. V1 folds the returns/challan transit tracking into
// the claim's own status (dispatch/receive) instead of a separate challan module.
export async function registerClaimRoutes(app: FastifyInstance) {
  app.get<{ Querystring: ClaimListQuery }>('/', { preHandler: [requireAuth, requirePermission('claims.read')], schema: { querystring: ClaimListQuery } }, controller.list);
  app.get<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth, requirePermission('claims.read')] }, controller.getById);

  // temporary stand-in for entries/approvals auto-creating the claim (claims.service.ts header)
  app.post<{ Body: ClaimCreateBody }>('/', { preHandler: [requireAuth, requirePermission('entries.create')], schema: { body: ClaimCreateBody } }, controller.create);

  app.post<{ Params: { id: string } }>('/:id/dispatch', { preHandler: [requireAuth, requirePermission('returns.dispatch')] }, controller.dispatch);
  app.post<{ Params: { id: string } }>('/:id/receive', { preHandler: [requireAuth, requirePermission('returns.receive')] }, controller.receive);
  app.post<{ Params: { id: string }; Body: ClaimCheckBody }>(
    '/:id/check',
    { preHandler: [requireAuth, requirePermission('claims.decide')], schema: { body: ClaimCheckBody } },
    controller.check,
  );
  app.post<{ Params: { id: string }; Body: ClaimDecideBody }>(
    '/:id/decide',
    { preHandler: [requireAuth, requirePermission('claims.decide')], schema: { body: ClaimDecideBody } },
    controller.decide,
  );
}
