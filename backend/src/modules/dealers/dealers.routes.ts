import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './dealers.controller';
import {
  DealerApproveBody,
  DealerCreateBody,
  DealerListQuery,
  DealerProfileUpdateBody,
  DealerReasonBody,
  DealerRegisterBody,
  AdminDealerCreateBody,
  DealerAssignBody,
} from './dealers.validation';

// M-05 dealers — architecture.md §19. `/register` is public (gated by auth's verifiedToken,
// not a session); everything else needs a signed-in dealer or admin with the right permission.
export async function registerDealerRoutes(app: FastifyInstance) {
  app.post<{ Body: DealerRegisterBody }>('/register', { schema: { body: DealerRegisterBody } }, controller.register);
  app.get('/me', { preHandler: requireAuth }, controller.me);
  app.patch<{ Body: DealerProfileUpdateBody }>('/me', { preHandler: requireAuth, schema: { body: DealerProfileUpdateBody } }, controller.updateMe);

  // a distributor's own dealers (the service checks the shop is a distributor)
  app.get('/me/dealers', { preHandler: requireAuth }, controller.listMyDealers);
  app.post<{ Body: DealerCreateBody }>('/me/dealers', { preHandler: requireAuth, schema: { body: DealerCreateBody } }, controller.createMyDealer);
  app.post<{ Params: { id: string }; Body: DealerReasonBody }>('/me/dealers/:id/suspend', { preHandler: requireAuth, schema: { body: DealerReasonBody } }, controller.suspendMyDealer);
  app.post<{ Params: { id: string }; Body: DealerReasonBody }>('/me/dealers/:id/activate', { preHandler: requireAuth, schema: { body: DealerReasonBody } }, controller.activateMyDealer);

  // head office adds a dealer under a distributor it names, and moves one between distributors.
  // Guarded by dealers.approve: the same right as deciding who may trade (client, 3 Oct 2026).
  app.post<{ Body: AdminDealerCreateBody }>(
    '/', { preHandler: [requireAuth, requirePermission('dealers.approve')], schema: { body: AdminDealerCreateBody } }, controller.createDealerForDistributor,
  );
  app.post<{ Params: { id: string }; Body: DealerAssignBody }>(
    '/:id/distributor', { preHandler: [requireAuth, requirePermission('dealers.approve')], schema: { body: DealerAssignBody } }, controller.assignDistributor,
  );

  app.get<{ Querystring: DealerListQuery }>('/', { preHandler: [requireAuth, requirePermission('dealers.read')] }, controller.list);
  app.get<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth, requirePermission('dealers.read')] }, controller.getById);

  app.post<{ Params: { id: string }; Body: DealerApproveBody }>(
    '/:id/approve',
    { preHandler: [requireAuth, requirePermission('dealers.approve')], schema: { body: DealerApproveBody } },
    controller.approve,
  );
  app.post<{ Params: { id: string }; Body: DealerReasonBody }>(
    '/:id/reject',
    { preHandler: [requireAuth, requirePermission('dealers.approve')], schema: { body: DealerReasonBody } },
    controller.reject,
  );
  app.post<{ Params: { id: string }; Body: DealerReasonBody }>(
    '/:id/suspend',
    { preHandler: [requireAuth, requirePermission('dealers.suspend')], schema: { body: DealerReasonBody } },
    controller.suspend,
  );
  app.post<{ Params: { id: string }; Body: DealerReasonBody }>(
    '/:id/activate',
    { preHandler: [requireAuth, requirePermission('dealers.suspend')], schema: { body: DealerReasonBody } },
    controller.activate,
  );
}
