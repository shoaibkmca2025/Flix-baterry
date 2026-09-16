import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './masters.service';
import type { CityCreateBody, CityUpdateBody } from './masters.validation';

export async function bundle(_request: FastifyRequest, reply: FastifyReply) {
  const result = await service.bundle();
  reply.status(200).send(result);
}

export async function listCities(request: FastifyRequest, reply: FastifyReply) {
  const result = await service.listCitiesAdmin(buildCtx(request));
  reply.status(200).send(result);
}

export async function createCity(request: FastifyRequest<{ Body: CityCreateBody }>, reply: FastifyReply) {
  const result = await service.createCity(buildCtx(request), request.body);
  reply.status(201).send(result);
}

export async function updateCity(request: FastifyRequest<{ Params: { id: string }; Body: CityUpdateBody }>, reply: FastifyReply) {
  const result = await service.updateCity(buildCtx(request), request.params.id, request.body);
  reply.status(200).send(result);
}
