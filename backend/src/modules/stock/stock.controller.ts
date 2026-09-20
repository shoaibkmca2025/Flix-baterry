import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './stock.service';
import type { StockMovementListQuery, StockMovementPostBody, StockPositionsQuery } from './stock.validation';

export async function postMovement(request: FastifyRequest<{ Body: StockMovementPostBody }>, reply: FastifyReply) {
  const result = await service.postMovement(buildCtx(request), request.body);
  reply.status(201).send(result);
}

export async function ledger(request: FastifyRequest<{ Querystring: StockMovementListQuery }>, reply: FastifyReply) {
  const result = await service.ledger(buildCtx(request), request.query);
  reply.status(200).send(result);
}

export async function positions(request: FastifyRequest<{ Querystring: StockPositionsQuery }>, reply: FastifyReply) {
  const result = await service.positions(buildCtx(request), request.query);
  reply.status(200).send(result);
}
