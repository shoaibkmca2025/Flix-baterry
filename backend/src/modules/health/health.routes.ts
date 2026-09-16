import type { FastifyInstance } from 'fastify';
import { checkConnection } from '../../database/client';

// M-01 health — architecture.md §19: GET /health (liveness), GET /ready (readiness).
export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/health', { config: { public: true } }, async () => ({ ok: true, version: process.env.npm_package_version ?? '0.1.0' }));

  app.get('/ready', { config: { public: true } }, async (_request, reply) => {
    const dbOk = await checkConnection();
    // Redis/storage checks are added as those modules land (P1+).
    const ready = dbOk;
    reply.status(ready ? 200 : 503).send({ ready, checks: { database: dbOk } });
  });
}
