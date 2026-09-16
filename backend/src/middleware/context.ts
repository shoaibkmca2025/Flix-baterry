import type { FastifyRequest } from 'fastify';
import type { Ctx } from '../utils/context';

// Builds the shared Ctx from a request. `user` is populated only on routes that ran
// `requireAuth` first (middleware/auth.ts) — public routes always see `user: null`.
export function buildCtx(request: FastifyRequest): Ctx {
  return {
    user: request.authUser ?? null,
    request: {
      id: request.id,
      ip: request.ip ?? null,
      deviceId: (request.headers['x-device-id'] as string) || undefined,
      userAgent: request.headers['user-agent'],
    },
    now: () => new Date(),
  };
}
