import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './returns.controller';
import { ChallanCreateBody, ChallanListQuery, ChallanReceiveBody, LineStageBody } from './returns.validation';

// M-19 returns — modules.md. Mounted at /api/v1/challans.
export async function registerReturnRoutes(app: FastifyInstance) {
  app.post<{ Body: ChallanCreateBody }>('/', { preHandler: [requireAuth, requirePermission('returns.dispatch')], schema: { body: ChallanCreateBody } }, controller.dispatch);
  app.get<{ Querystring: ChallanListQuery }>('/', { preHandler: [requireAuth, requirePermission('claims.read')], schema: { querystring: ChallanListQuery } }, controller.list);
  app.get<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth, requirePermission('claims.read')] }, controller.getById);
  app.post<{ Params: { id: string }; Body: ChallanReceiveBody }>(
    '/:id/receive',
    { preHandler: [requireAuth, requirePermission('returns.receive')], schema: { body: ChallanReceiveBody } },
    controller.receive,
  );
  app.post<{ Params: { lineId: string }; Body: LineStageBody }>(
    '/lines/:lineId/stage',
    { preHandler: [requireAuth, requirePermission('returns.process')], schema: { body: LineStageBody } },
    controller.stage,
  );
}
