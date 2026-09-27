import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import * as controller from './sync.controller';

// GET /api/v1/sync — the whole app refresh in one request (see sync.service.ts).
export async function registerSyncRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireAuth }, controller.snapshot);
}
