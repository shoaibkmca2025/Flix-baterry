import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { loggerOptions } from './utils/logger';
import { env } from './config/env';
import { registerErrorHandler } from './middleware/errorHandler';
import { registerHealthRoutes } from './modules/health/health.routes';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import { registerDealerRoutes } from './modules/dealers/dealers.routes';
import { registerMastersRoutes } from './modules/masters/masters.routes';
import { registerBatteryRoutes } from './modules/batteries/batteries.routes';
import { registerClaimRoutes } from './modules/claims/claims.routes';
import { registerEntryRoutes } from './modules/entries/entries.routes';
import { registerReturnRoutes } from './modules/returns/returns.routes';
import { registerCreditRoutes } from './modules/credits/credits.routes';
import { registerAuditRoutes } from './modules/audit/audit.routes';
import { registerStockRoutes } from './modules/stock/stock.routes';
import { registerUserRoutes } from './modules/users/users.routes';
import { registerSyncRoutes } from './modules/sync/sync.routes';
import { registerWarrantyRoutes } from './modules/warranty/warranty.routes';

// architecture.md §4 — buildApp() registers plugins + modules; used by both server.ts and tests (Fastify `inject`).
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  /*
   * Only the company's own apps may call this API from a browser.
   *
   * `origin: true` reflected whatever Origin was sent, so any site on the internet could make
   * credentialed cross-origin calls from a visitor's browser (QA, 6 Oct 2026). It never bypassed
   * sign-in — a bearer token is still required — but it is one less thing standing between a
   * phished dealer and his own session.
   *
   * The allow-list comes from APP_ORIGINS. Off a browser there is no Origin header at all (curl,
   * the apps' own native builds), and those are left alone.
   */
  const allowed = env.APP_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  const localhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  await app.register(cors, {
    origin(origin, done) {
      if (!origin) return done(null, true);                                  // not a browser
      if (allowed.includes(origin)) return done(null, true);
      if (env.NODE_ENV !== 'production' && localhost.test(origin)) return done(null, true);
      return done(null, false);                                              // no CORS headers back
    },
  });

  registerErrorHandler(app);
  await app.register(registerHealthRoutes, { prefix: '/api/v1' });
  await app.register(registerAuthRoutes, { prefix: '/api/v1/auth' });
  await app.register(registerDealerRoutes, { prefix: '/api/v1/dealers' });
  await app.register(registerMastersRoutes, { prefix: '/api/v1/masters' });
  await app.register(registerBatteryRoutes, { prefix: '/api/v1/batteries' });
  await app.register(registerClaimRoutes, { prefix: '/api/v1/claims' });
  await app.register(registerEntryRoutes, { prefix: '/api/v1/entries' });
  await app.register(registerReturnRoutes, { prefix: '/api/v1/challans' });
  await app.register(registerCreditRoutes, { prefix: '/api/v1/credit-notes' });
  await app.register(registerAuditRoutes, { prefix: '/api/v1' });
  await app.register(registerStockRoutes, { prefix: '/api/v1/stock' });
  await app.register(registerUserRoutes, { prefix: '/api/v1' });
  await app.register(registerSyncRoutes, { prefix: '/api/v1/sync' });
  await app.register(registerWarrantyRoutes, { prefix: '/api/v1/warranty' });

  return app;
}
