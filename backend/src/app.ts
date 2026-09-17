import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { loggerOptions } from './utils/logger';
import { registerErrorHandler } from './middleware/errorHandler';
import { registerHealthRoutes } from './modules/health/health.routes';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import { registerDealerRoutes } from './modules/dealers/dealers.routes';
import { registerMastersRoutes } from './modules/masters/masters.routes';
import { registerBatteryRoutes } from './modules/batteries/batteries.routes';
import { registerClaimRoutes } from './modules/claims/claims.routes';

// architecture.md §4 — buildApp() registers plugins + modules; used by both server.ts and tests (Fastify `inject`).
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  await app.register(cors, { origin: true }); // tightened to an allow-list once app origins are known (P4-04)

  registerErrorHandler(app);
  await app.register(registerHealthRoutes, { prefix: '/api/v1' });
  await app.register(registerAuthRoutes, { prefix: '/api/v1/auth' });
  await app.register(registerDealerRoutes, { prefix: '/api/v1/dealers' });
  await app.register(registerMastersRoutes, { prefix: '/api/v1/masters' });
  await app.register(registerBatteryRoutes, { prefix: '/api/v1/batteries' });
  await app.register(registerClaimRoutes, { prefix: '/api/v1/claims' });

  return app;
}
