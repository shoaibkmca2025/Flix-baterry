import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './audit.service';
import type { AuditListQuery } from './audit.validation';

export async function list(request: FastifyRequest<{ Querystring: AuditListQuery }>, reply: FastifyReply) {
  const result = await service.list(buildCtx(request), request.query);
  reply.status(200).send(result);
}

export async function trail(request: FastifyRequest<{ Params: { entityType: string; entityId: string } }>, reply: FastifyReply) {
  const result = await service.trail(buildCtx(request), request.params.entityType, request.params.entityId);
  reply.status(200).send({ items: result });
}

export async function entryTrail(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const result = await service.entryTrail(buildCtx(request), request.params.id);
  reply.status(200).send({ items: result });
}
