import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './stock.controller';
import { StockMovementListQuery, StockMovementPostBody, StockPositionsQuery } from './stock.validation';

// M-11 stock — modules.md. Thresholds and low-stock alerts are deferred past V1.
export async function registerStockRoutes(app: FastifyInstance) {
  app.get<{ Querystring: StockPositionsQuery }>('/positions', { preHandler: [requireAuth, requirePermission('stock.read')], schema: { querystring: StockPositionsQuery } }, controller.positions);
  app.get<{ Querystring: StockMovementListQuery }>('/movements', { preHandler: [requireAuth, requirePermission('stock.read')], schema: { querystring: StockMovementListQuery } }, controller.ledger);
  app.post<{ Body: StockMovementPostBody }>('/movements', { preHandler: [requireAuth, requirePermission('stock.post')], schema: { body: StockMovementPostBody } }, controller.postMovement);
}
