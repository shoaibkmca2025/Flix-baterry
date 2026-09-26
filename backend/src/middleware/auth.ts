import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../modules/auth/auth.tokens';
import { assertAccountActive } from '../modules/users/users.service';
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
  let claims;
  try {
    claims = await verifyAccessToken(header.slice(7));
  } catch (err) {
    // jose raises JWTExpired with the stable code ERR_JWT_EXPIRED: the app refreshes and retries on it
    if ((err as { code?: string }).code === 'ERR_JWT_EXPIRED') throw new AppError('token_expired', 401, 'Your session needs refreshing.');
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
  // INV-status-every-request (rules.md): a blocked user or a suspended dealer's staff is
  // refused on the very next request, not at the next sign-in. Cached 30 s in users.service.
  await assertAccountActive(claims.sub);
  request.authUser = { id: claims.sub, scope: claims.scope, role: claims.role, dealerId: claims.dealerId };
}
