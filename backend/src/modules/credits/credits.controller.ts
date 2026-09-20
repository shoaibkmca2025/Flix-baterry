import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './credits.service';
import type { CreditNoteListQuery, CreditNoteReverseBody, CreditNoteSettleBody, CreditNoteSummaryQuery } from './credits.validation';

export async function list(request: FastifyRequest<{ Querystring: CreditNoteListQuery }>, reply: FastifyReply) {
  const result = await service.list(buildCtx(request), request.query);
  reply.status(200).send(result);
}

export async function summary(request: FastifyRequest<{ Querystring: CreditNoteSummaryQuery }>, reply: FastifyReply) {
  const result = await service.summary(buildCtx(request), request.query);
  reply.status(200).send(result);
}

export async function getByNo(request: FastifyRequest<{ Params: { no: string } }>, reply: FastifyReply) {
  const result = await service.getByNo(buildCtx(request), request.params.no);
  reply.status(200).send(result);
}

export async function settle(request: FastifyRequest<{ Params: { no: string }; Body: CreditNoteSettleBody }>, reply: FastifyReply) {
  const result = await service.settle(buildCtx(request), request.params.no, request.body);
  reply.status(200).send(result);
}

export async function reverse(request: FastifyRequest<{ Params: { no: string }; Body: CreditNoteReverseBody }>, reply: FastifyReply) {
  const result = await service.reverse(buildCtx(request), request.params.no, request.body);
  reply.status(200).send(result);
}
