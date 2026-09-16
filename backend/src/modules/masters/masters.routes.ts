import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './masters.controller';
import { CityCreateBody, CityUpdateBody } from './masters.validation';

// M-06 masters — architecture.md §19. GET /masters is public: a not-yet-registered
// dealer needs the city list before they have any token (d04's city picker).
export async function registerMastersRoutes(app: FastifyInstance) {
  app.get('/', controller.bundle);
  app.get('/cities', { preHandler: [requireAuth, requirePermission('masters.manage')] }, controller.listCities);
  app.post<{ Body: CityCreateBody }>(
    '/cities',
    { preHandler: [requireAuth, requirePermission('masters.manage')], schema: { body: CityCreateBody } },
    controller.createCity,
  );
  app.patch<{ Params: { id: string }; Body: CityUpdateBody }>(
    '/cities/:id',
    { preHandler: [requireAuth, requirePermission('masters.manage')], schema: { body: CityUpdateBody } },
    controller.updateCity,
  );
}
