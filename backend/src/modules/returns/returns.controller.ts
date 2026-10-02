import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './returns.service';
import type { ChallanClaimBody, ChallanCreateBody, ChallanListQuery, ChallanReceiveBody, LinePlantBody, LineReceiveBody, LineStageBody, ReturnLineListQuery } from './returns.validation';

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

export async function listLines(request: FastifyRequest<{ Querystring: ReturnLineListQuery }>, reply: FastifyReply) {
  reply.status(200).send(await service.listLines(buildCtx(request), request.query));
}

export async function receiveLine(request: FastifyRequest<{ Params: { lineId: string }; Body: LineReceiveBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.receiveLine(buildCtx(request), request.params.lineId, request.body));
}

export async function setLinePlant(request: FastifyRequest<{ Params: { lineId: string }; Body: LinePlantBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.setLinePlant(buildCtx(request), request.params.lineId, request.body));
}

export async function claim(request: FastifyRequest<{ Params: { id: string }; Body: ChallanClaimBody }>, reply: FastifyReply) {
  const result = await service.claimChecked(buildCtx(request), request.params.id, request.body);
  reply.status(200).send(result);
}
