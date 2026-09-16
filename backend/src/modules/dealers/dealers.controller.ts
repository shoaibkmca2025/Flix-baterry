import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './dealers.service';
import type {
  DealerApproveBody,
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
