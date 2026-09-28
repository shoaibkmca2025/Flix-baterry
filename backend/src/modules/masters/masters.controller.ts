import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './masters.service';
import type { CityCreateBody, CityUpdateBody, PlantCreateBody, PlantUpdateBody } from './masters.validation';

export async function bundle(_request: FastifyRequest, reply: FastifyReply) {
  const result = await service.bundle();
  reply.header('cache-control', 'public, max-age=300'); // plates/models/cities change rarely
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

export async function listPlants(request: FastifyRequest, reply: FastifyReply) {
  reply.status(200).send(await service.listPlantsAdmin(buildCtx(request)));
}

export async function createPlant(request: FastifyRequest<{ Body: PlantCreateBody }>, reply: FastifyReply) {
  reply.status(201).send(await service.createPlant(buildCtx(request), request.body));
}

export async function updatePlant(request: FastifyRequest<{ Params: { id: string }; Body: PlantUpdateBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.updatePlant(buildCtx(request), request.params.id, request.body));
}
