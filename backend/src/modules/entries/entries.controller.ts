import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './entries.service';
import type { EntryCreateBody, EntryDecisionBody, EntryListQuery, EntrySettleBody } from './entries.validation';

export async function create(request: FastifyRequest<{ Body: EntryCreateBody }>, reply: FastifyReply) {
  const result = await service.create(buildCtx(request), request.body);
  reply.status(201).send(result);
}

export async function approve(request: FastifyRequest<{ Params: { id: string }; Body: EntryDecisionBody }>, reply: FastifyReply) {
  const result = await service.approve(buildCtx(request), request.params.id, request.body.reason);
  reply.status(200).send(result);
}

export async function reject(request: FastifyRequest<{ Params: { id: string }; Body: EntryDecisionBody }>, reply: FastifyReply) {
  const result = await service.reject(buildCtx(request), request.params.id, request.body.reason);
  reply.status(200).send(result);
}

export async function getById(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const result = await service.getById(buildCtx(request), request.params.id);
  reply.status(200).send(result);
}

export async function list(request: FastifyRequest<{ Querystring: EntryListQuery }>, reply: FastifyReply) {
  const result = await service.list(buildCtx(request), request.query);
  reply.status(200).send(result);
}

export async function settle(request: FastifyRequest<{ Params: { id: string }; Body: EntrySettleBody }>, reply: FastifyReply) {
  const result = await service.settle(buildCtx(request), request.params.id, request.body);
  reply.status(200).send(result);
}
