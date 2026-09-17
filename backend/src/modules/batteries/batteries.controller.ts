import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './batteries.service';
import type { BatteryListQuery, BatteryLookupQuery } from './batteries.validation';

export async function lookup(request: FastifyRequest<{ Querystring: BatteryLookupQuery }>, reply: FastifyReply) {
  const result = await service.lookup(buildCtx(request), request.query.code);
  reply.status(200).send(result);
}

export async function list(request: FastifyRequest<{ Querystring: BatteryListQuery }>, reply: FastifyReply) {
  const result = await service.list(buildCtx(request), request.query);
  reply.status(200).send(result);
}
