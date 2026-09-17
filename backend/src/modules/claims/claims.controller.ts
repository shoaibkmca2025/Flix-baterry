import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './claims.service';
import type { ClaimCheckBody, ClaimDecideBody, ClaimListQuery } from './claims.validation';

export async function dispatch(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const result = await service.dispatch(buildCtx(request), request.params.id);
  reply.status(200).send(result);
}

export async function receive(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const result = await service.receive(buildCtx(request), request.params.id);
  reply.status(200).send(result);
}

export async function check(request: FastifyRequest<{ Params: { id: string }; Body: ClaimCheckBody }>, reply: FastifyReply) {
  const result = await service.check(buildCtx(request), request.params.id, request.body);
  reply.status(200).send(result);
}

export async function decide(request: FastifyRequest<{ Params: { id: string }; Body: ClaimDecideBody }>, reply: FastifyReply) {
  const result = await service.decide(buildCtx(request), request.params.id, request.body);
  reply.status(200).send(result);
}

export async function list(request: FastifyRequest<{ Querystring: ClaimListQuery }>, reply: FastifyReply) {
  const result = await service.list(buildCtx(request), request.query);
  reply.status(200).send(result);
}

export async function getById(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const result = await service.getById(buildCtx(request), request.params.id);
  reply.status(200).send(result);
}
