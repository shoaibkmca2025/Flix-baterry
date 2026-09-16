import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, withTransaction } from '../database/client';
import { roles, userPermissions } from '../models/identity.model';
import { audit } from '../utils/audit';
import { AppError } from '../utils/errors';
import { buildCtx } from './context';

// Temporary home for effective-permission computation — architecture.md §7.3 assigns this
// to `users.effectivePermissions()`, which moves here once the `users` module exists
// (modules.md §4 single-writer rule; this only reads, never writes).
export async function getEffectivePermissions(userId: string, role: string): Promise<Set<string>> {
  const [roleRow] = await db.select().from(roles).where(eq(roles.key, role));
  const grants = await db.select({ permission: userPermissions.permission }).from(userPermissions).where(eq(userPermissions.userId, userId));
  return new Set([...(roleRow?.templatePermissions ?? []), ...grants.map((g) => g.permission)]);
}

// Supports exact match, '*' (main_admin — everything), 'domain.*' (e.g. 'entries.*'),
// and '*.verb' (e.g. read_only's '*.read').
export function permissionGranted(perms: Set<string>, required: string): boolean {
  if (perms.has('*') || perms.has(required)) return true;
  const [domain, verb] = required.split('.');
  return perms.has(`${domain}.*`) || (!!verb && perms.has(`*.${verb}`));
}

// Route-level guard: `{ preHandler: [requireAuth, requirePermission('dealers.approve')] }`.
// Must run after requireAuth (middleware/auth.ts), which populates request.authUser.
export function requirePermission(permission: string) {
  return async function requirePermissionHandler(request: FastifyRequest, _reply: FastifyReply) {
    if (!request.authUser) {
      throw new AppError('unauthenticated', 401, 'Sign in required.');
    }
    const perms = await getEffectivePermissions(request.authUser.id, request.authUser.role);
    if (!permissionGranted(perms, permission)) {
      // rules.md §6 — denied attempts are audited outside the failed transaction.
      await withTransaction((tx) =>
        audit(tx, { ctx: buildCtx(request), action: `${permission}.denied`, entityType: 'permission', entityId: permission, outcome: 'denied' }),
      );
      throw new AppError('permission_denied', 403, 'You do not have permission to do this.');
    }
  };
}
