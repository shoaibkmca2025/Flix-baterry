import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './dealers.service';
import type {
  DealerApproveBody,
  DealerCreateBody,
  DealerListQuery,
  DealerProfileUpdateBody,
  DealerReasonBody,
  DealerRegisterBody,
} from './dealers.validation';

export async function register(request: FastifyRequest<{ Body: DealerRegisterBody }>, reply: FastifyReply) {
  const result = await service.register(buildCtx(request), request.body);
  reply.status(201).send(result);
}

export async function me(request: FastifyRequest, reply: FastifyReply) {
  const result = await service.getMe(buildCtx(request));
  reply.status(200).send(result);
}

export async function updateMe(request: FastifyRequest<{ Body: DealerProfileUpdateBody }>, reply: FastifyReply) {
  const result = await service.updateMe(buildCtx(request), request.body);
  reply.status(200).send(result);
}

export async function approve(request: FastifyRequest<{ Params: { id: string }; Body: DealerApproveBody }>, reply: FastifyReply) {
  const result = await service.approve(buildCtx(request), request.params.id, request.body);
  reply.status(200).send(result);
}

export async function reject(request: FastifyRequest<{ Params: { id: string }; Body: DealerReasonBody }>, reply: FastifyReply) {
  const result = await service.reject(buildCtx(request), request.params.id, request.body);
  reply.status(200).send(result);
}

export async function suspend(request: FastifyRequest<{ Params: { id: string }; Body: DealerReasonBody }>, reply: FastifyReply) {
  const result = await service.suspend(buildCtx(request), request.params.id, request.body);
  reply.status(200).send(result);
}

export async function activate(request: FastifyRequest<{ Params: { id: string }; Body: DealerReasonBody }>, reply: FastifyReply) {
  const result = await service.activate(buildCtx(request), request.params.id, request.body);
  reply.status(200).send(result);
}

export async function list(request: FastifyRequest<{ Querystring: DealerListQuery }>, reply: FastifyReply) {
  const result = await service.list(buildCtx(request), request.query);
  reply.status(200).send(result);
}

export async function getById(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const result = await service.getById(buildCtx(request), request.params.id);
  reply.status(200).send(result);
}

// a distributor's own dealers
export async function listMyDealers(request: FastifyRequest, reply: FastifyReply) {
  reply.status(200).send(await service.listMyDealers(buildCtx(request)));
}

export async function createMyDealer(request: FastifyRequest<{ Body: DealerCreateBody }>, reply: FastifyReply) {
  reply.status(201).send(await service.createMyDealer(buildCtx(request), request.body));
}

export async function suspendMyDealer(request: FastifyRequest<{ Params: { id: string }; Body: DealerReasonBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.setMyDealerStatus(buildCtx(request), request.params.id, 'suspended', request.body));
}

export async function activateMyDealer(request: FastifyRequest<{ Params: { id: string }; Body: DealerReasonBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.setMyDealerStatus(buildCtx(request), request.params.id, 'active', request.body));
}
