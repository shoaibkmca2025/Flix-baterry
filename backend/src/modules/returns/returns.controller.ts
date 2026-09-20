import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './returns.service';
import type { ChallanCreateBody, ChallanListQuery, ChallanReceiveBody, LineStageBody } from './returns.validation';

export async function dispatch(request: FastifyRequest<{ Body: ChallanCreateBody }>, reply: FastifyReply) {
  reply.status(201).send(await service.dispatch(buildCtx(request), request.body));
}

export async function list(request: FastifyRequest<{ Querystring: ChallanListQuery }>, reply: FastifyReply) {
  reply.status(200).send(await service.list(buildCtx(request), request.query));
}

export async function getById(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  reply.status(200).send(await service.getById(buildCtx(request), request.params.id));
}

export async function receive(request: FastifyRequest<{ Params: { id: string }; Body: ChallanReceiveBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.receive(buildCtx(request), request.params.id, request.body));
}

export async function stage(request: FastifyRequest<{ Params: { lineId: string }; Body: LineStageBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.stage(buildCtx(request), request.params.lineId, request.body));
}
