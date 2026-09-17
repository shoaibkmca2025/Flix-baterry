import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './batteries.controller';
import { BatteryListQuery, BatteryLookupQuery, BatteryReplaceBody, BatterySaleBody } from './batteries.validation';

// M-09 batteries — architecture.md §19. Every route needs a signed-in dealer or admin;
// dealer scoping happens inside the service (rules.md §7.4 — never from the query).
export async function registerBatteryRoutes(app: FastifyInstance) {
  app.get<{ Querystring: BatteryLookupQuery }>(
    '/lookup',
    { preHandler: [requireAuth, requirePermission('batteries.read')], schema: { querystring: BatteryLookupQuery } },
    controller.lookup,
  );
  app.get<{ Querystring: BatteryListQuery }>(
    '/',
    { preHandler: [requireAuth, requirePermission('batteries.read')], schema: { querystring: BatteryListQuery } },
    controller.list,
  );

  // Temporary stand-ins for entries.create (batteries.service.ts header comment) — gated
  // by entries.create, the permission this will actually require once entries exists.
  app.post<{ Body: BatterySaleBody }>(
    '/sell',
    { preHandler: [requireAuth, requirePermission('entries.create')], schema: { body: BatterySaleBody } },
    controller.sell,
  );
  app.post<{ Body: BatteryReplaceBody }>(
    '/replace',
    { preHandler: [requireAuth, requirePermission('entries.create')], schema: { body: BatteryReplaceBody } },
    controller.replace,
  );
}
