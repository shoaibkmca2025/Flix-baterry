import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './dealers.controller';
import {
  DealerApproveBody,
  DealerListQuery,
  DealerProfileUpdateBody,
  DealerReasonBody,
  DealerRegisterBody,
} from './dealers.validation';

// M-05 dealers — architecture.md §19. `/register` is public (gated by auth's verifiedToken,
// not a session); everything else needs a signed-in dealer or admin with the right permission.
export async function registerDealerRoutes(app: FastifyInstance) {
  app.post<{ Body: DealerRegisterBody }>('/register', { schema: { body: DealerRegisterBody } }, controller.register);
  app.get('/me', { preHandler: requireAuth }, controller.me);
  app.patch<{ Body: DealerProfileUpdateBody }>('/me', { preHandler: requireAuth, schema: { body: DealerProfileUpdateBody } }, controller.updateMe);

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
