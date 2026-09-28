import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './returns.controller';
import { ChallanCreateBody, ChallanListQuery, ChallanReceiveBody, LinePlantBody, LineReceiveBody, LineStageBody, ReturnLineListQuery } from './returns.validation';

// M-19 returns — modules.md. Mounted at /api/v1/challans.
export async function registerReturnRoutes(app: FastifyInstance) {
  app.post<{ Body: ChallanCreateBody }>('/', { preHandler: [requireAuth, requirePermission('returns.dispatch')], schema: { body: ChallanCreateBody } }, controller.dispatch);
  app.get<{ Querystring: ChallanListQuery }>('/', { preHandler: [requireAuth, requirePermission('claims.read')], schema: { querystring: ChallanListQuery } }, controller.list);
  // returned batteries across challans, filterable by the plant that made them (D-19)
  app.get<{ Querystring: ReturnLineListQuery }>('/lines', { preHandler: [requireAuth, requirePermission('claims.read')], schema: { querystring: ReturnLineListQuery } }, controller.listLines);
  app.get<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth, requirePermission('claims.read')] }, controller.getById);
  app.post<{ Params: { id: string }; Body: ChallanReceiveBody }>(
    '/:id/receive',
    { preHandler: [requireAuth, requirePermission('returns.receive')], schema: { body: ChallanReceiveBody } },
    controller.receive,
  );
  // one battery off the van, tagged with the plant that made it (D-19)
  app.post<{ Params: { lineId: string }; Body: LineReceiveBody }>(
    '/lines/:lineId/receive',
    { preHandler: [requireAuth, requirePermission('returns.receive')], schema: { body: LineReceiveBody } },
    controller.receiveLine,
  );
  app.patch<{ Params: { lineId: string }; Body: LinePlantBody }>(
    '/lines/:lineId/plant',
    { preHandler: [requireAuth, requirePermission('returns.receive')], schema: { body: LinePlantBody } },
    controller.setLinePlant,
  );
  app.post<{ Params: { lineId: string }; Body: LineStageBody }>(
    '/lines/:lineId/stage',
    { preHandler: [requireAuth, requirePermission('returns.process')], schema: { body: LineStageBody } },
    controller.stage,
  );
}
