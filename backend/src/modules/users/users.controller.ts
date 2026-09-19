import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './users.service';
import type { AdminCreateBody, AdminUpdateBody, MeUpdateBody, StaffInviteBody, StaffUpdateBody, UserStatusBody } from './users.validation';

type DealerParams = { dealerId: string };
type StaffParams = { dealerId: string; userId: string };
type IdParams = { id: string };

export async function me(request: FastifyRequest, reply: FastifyReply) {
  reply.status(200).send(await service.getMe(buildCtx(request)));
}
export async function updateMe(request: FastifyRequest<{ Body: MeUpdateBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.updateMe(buildCtx(request), request.body));
}

export async function listStaff(request: FastifyRequest<{ Params: DealerParams }>, reply: FastifyReply) {
  reply.status(200).send({ items: await service.listStaff(buildCtx(request), request.params.dealerId) });
}
export async function inviteStaff(request: FastifyRequest<{ Params: DealerParams; Body: StaffInviteBody }>, reply: FastifyReply) {
  reply.status(201).send(await service.inviteStaff(buildCtx(request), request.params.dealerId, request.body));
}
export async function updateStaff(request: FastifyRequest<{ Params: StaffParams; Body: StaffUpdateBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.updateStaff(buildCtx(request), request.params.dealerId, request.params.userId, request.body));
}
export async function setStaffStatus(request: FastifyRequest<{ Params: StaffParams; Body: UserStatusBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.setStaffStatus(buildCtx(request), request.params.dealerId, request.params.userId, request.body));
}

export async function listAdmins(request: FastifyRequest, reply: FastifyReply) {
  reply.status(200).send({ items: await service.listAdmins(buildCtx(request)) });
}
export async function createAdmin(request: FastifyRequest<{ Body: AdminCreateBody }>, reply: FastifyReply) {
  reply.status(201).send(await service.createAdmin(buildCtx(request), request.body));
}
export async function updateAdmin(request: FastifyRequest<{ Params: IdParams; Body: AdminUpdateBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.updateAdmin(buildCtx(request), request.params.id, request.body));
}
export async function setAdminStatus(request: FastifyRequest<{ Params: IdParams; Body: UserStatusBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.setAdminStatus(buildCtx(request), request.params.id, request.body));
}
export async function resetAccess(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) {
  reply.status(200).send(await service.resetAccess(buildCtx(request), request.params.id));
}
export async function listRoles(request: FastifyRequest, reply: FastifyReply) {
  reply.status(200).send({ items: await service.listRoles(buildCtx(request)) });
}
