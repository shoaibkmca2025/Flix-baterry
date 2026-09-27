import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './warranty.controller';
import { OverrideDecisionBody, OverrideListQuery, OverrideRequestBody } from './warranty.validation';

// M-10 warranty — the V1 slice: cover overrides. Chains are written by entries.approve; this
// is the only path that moves a chain's expiry afterwards, and every step is audited.
export async function registerWarrantyRoutes(app: FastifyInstance) {
  app.get<{ Querystring: OverrideListQuery }>(
    '/overrides',
    { preHandler: [requireAuth, requirePermission('warranty.read')], schema: { querystring: OverrideListQuery } },
    controller.list,
  );
  app.post<{ Body: OverrideRequestBody }>(
    '/overrides',
    { preHandler: [requireAuth, requirePermission('warranty.override.request')], schema: { body: OverrideRequestBody } },
    controller.request,
  );
  app.post<{ Params: { id: string }; Body: OverrideDecisionBody }>(
    '/overrides/:id/approve',
    { preHandler: [requireAuth, requirePermission('warranty.override.decide')], schema: { body: OverrideDecisionBody } },
    controller.approve,
  );
  app.post<{ Params: { id: string }; Body: OverrideDecisionBody }>(
    '/overrides/:id/reject',
    { preHandler: [requireAuth, requirePermission('warranty.override.decide')], schema: { body: OverrideDecisionBody } },
    controller.reject,
  );
}
