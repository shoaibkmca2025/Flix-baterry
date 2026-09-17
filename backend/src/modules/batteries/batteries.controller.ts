import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './batteries.service';
import type { BatteryListQuery, BatteryLookupQuery, BatteryReplaceBody, BatterySaleBody } from './batteries.validation';

export async function lookup(request: FastifyRequest<{ Querystring: BatteryLookupQuery }>, reply: FastifyReply) {
  const result = await service.lookup(buildCtx(request), request.query.code);
  reply.status(200).send(result);
}

export async function list(request: FastifyRequest<{ Querystring: BatteryListQuery }>, reply: FastifyReply) {
  const result = await service.list(buildCtx(request), request.query);
  reply.status(200).send(result);
}

export async function sell(request: FastifyRequest<{ Body: BatterySaleBody }>, reply: FastifyReply) {
  const result = await service.recordSale(buildCtx(request), request.body);
  reply.status(201).send(result);
}

export async function replace(request: FastifyRequest<{ Body: BatteryReplaceBody }>, reply: FastifyReply) {
  const result = await service.recordReplacement(buildCtx(request), request.body);
  reply.status(201).send(result);
}
