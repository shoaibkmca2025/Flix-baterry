import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './batteries.controller';
import { BatteryListQuery, BatteryLookupQuery } from './batteries.validation';

// M-09 batteries — architecture.md §19. Every route needs a signed-in dealer or admin;
// dealer scoping happens inside the service (rules.md §7.4 — never from the query).
// POST /sell and /replace (temporary stand-ins) were removed 2026-09-17 once entries.approve
// took over creating batteries/chains for real — see logs.md.
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
}
