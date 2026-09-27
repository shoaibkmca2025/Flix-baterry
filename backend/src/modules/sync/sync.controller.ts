import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './sync.service';

export async function snapshot(request: FastifyRequest, reply: FastifyReply) {
  reply.status(200).send(await service.snapshot(buildCtx(request)));
}
