import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './warranty.service';
import type { OverrideDecisionBody, OverrideListQuery, OverrideRequestBody } from './warranty.validation';

export async function request(req: FastifyRequest<{ Body: OverrideRequestBody }>, reply: FastifyReply) {
  reply.status(201).send(await service.requestOverride(buildCtx(req), req.body));
}

export async function list(req: FastifyRequest<{ Querystring: OverrideListQuery }>, reply: FastifyReply) {
  reply.status(200).send(await service.listOverrides(buildCtx(req), req.query));
}

export async function approve(req: FastifyRequest<{ Params: { id: string }; Body: OverrideDecisionBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.approveOverride(buildCtx(req), req.params.id, req.body));
}

export async function reject(req: FastifyRequest<{ Params: { id: string }; Body: OverrideDecisionBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.rejectOverride(buildCtx(req), req.params.id, req.body));
}
