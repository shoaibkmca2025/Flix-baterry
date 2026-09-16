import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../modules/auth/auth.tokens';
import { AppError } from '../utils/errors';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: { id: string; scope: 'dealer' | 'admin'; role: string; dealerId?: string };
  }
}

// Explicit opt-in per route (`preHandler: requireAuth`) for now, rather than a global
// hook with a `config.public` escape hatch — simpler until the rbac/accountStatus
// plugins exist too and a real pipeline (architecture.md §6) replaces this.
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
  try {
    const claims = await verifyAccessToken(header.slice(7));
    request.authUser = { id: claims.sub, scope: claims.scope, role: claims.role, dealerId: claims.dealerId };
  } catch {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
}
