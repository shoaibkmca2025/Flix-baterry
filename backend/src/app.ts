import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { loggerOptions } from './utils/logger';
import { registerErrorHandler } from './middleware/errorHandler';
import { registerHealthRoutes } from './modules/health/health.routes';

// architecture.md §4 — buildApp() registers plugins + modules; used by both server.ts and tests (Fastify `inject`).
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
  });

  await app.register(helmet);
  await app.register(cors, { origin: true }); // tightened to an allow-list once app origins are known (P4-04)

  registerErrorHandler(app);
  await app.register(registerHealthRoutes, { prefix: '/api/v1' });

  return app;
}
