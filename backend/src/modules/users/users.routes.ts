import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './users.controller';
import { AdminCreateBody, AdminUpdateBody, MeUpdateBody, StaffInviteBody, StaffUpdateBody, UserStatusBody } from './users.validation';

// M-03 users + the V1 slice of M-04 admins (modules.md). Registered at /api/v1 because it
// spans three path roots: /me, /dealers/:dealerId/staff and /admins (+ /roles).
export async function registerUserRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: requireAuth }, controller.me);
  app.patch<{ Body: MeUpdateBody }>('/me', { preHandler: requireAuth, schema: { body: MeUpdateBody } }, controller.updateMe);

  const staff = [requireAuth, requirePermission('dealers.staff.manage')];
  app.get<{ Params: { dealerId: string } }>('/dealers/:dealerId/staff', { preHandler: staff }, controller.listStaff);
  app.post<{ Params: { dealerId: string }; Body: StaffInviteBody }>('/dealers/:dealerId/staff', { preHandler: staff, schema: { body: StaffInviteBody } }, controller.inviteStaff);
  app.patch<{ Params: { dealerId: string; userId: string }; Body: StaffUpdateBody }>('/dealers/:dealerId/staff/:userId', { preHandler: staff, schema: { body: StaffUpdateBody } }, controller.updateStaff);
  app.post<{ Params: { dealerId: string; userId: string }; Body: UserStatusBody }>('/dealers/:dealerId/staff/:userId/status', { preHandler: staff, schema: { body: UserStatusBody } }, controller.setStaffStatus);

  const admins = [requireAuth, requirePermission('admins.manage')];
  app.get('/admins', { preHandler: admins }, controller.listAdmins);
  app.post<{ Body: AdminCreateBody }>('/admins', { preHandler: admins, schema: { body: AdminCreateBody } }, controller.createAdmin);
  app.patch<{ Params: { id: string }; Body: AdminUpdateBody }>('/admins/:id', { preHandler: admins, schema: { body: AdminUpdateBody } }, controller.updateAdmin);
  app.post<{ Params: { id: string }; Body: UserStatusBody }>('/admins/:id/status', { preHandler: admins, schema: { body: UserStatusBody } }, controller.setAdminStatus);
  app.post<{ Params: { id: string } }>('/admins/:id/reset-access', { preHandler: admins }, controller.resetAccess);
  app.get('/roles', { preHandler: admins }, controller.listRoles);
}
