import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './entries.service';
import type { EntryCreateBody, EntryDecisionBody, EntryItemCorrectBody, EntryItemReviewBody, EntryListQuery, EntryPhotoBody, EntrySettleBody } from './entries.validation';

export async function create(request: FastifyRequest<{ Body: EntryCreateBody }>, reply: FastifyReply) {
  const result = await service.create(buildCtx(request), request.body);
  reply.status(201).send(result);
}

export async function approve(request: FastifyRequest<{ Params: { id: string }; Body: EntryDecisionBody }>, reply: FastifyReply) {
  const result = await service.approve(buildCtx(request), request.params.id, request.body.reason);
  reply.status(200).send(result);
}

export async function reject(request: FastifyRequest<{ Params: { id: string }; Body: EntryDecisionBody }>, reply: FastifyReply) {
  const result = await service.reject(buildCtx(request), request.params.id, request.body.reason);
  reply.status(200).send(result);
}

export async function getById(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const result = await service.getById(buildCtx(request), request.params.id);
  reply.status(200).send(result);
}

export async function list(request: FastifyRequest<{ Querystring: EntryListQuery }>, reply: FastifyReply) {
  const result = await service.list(buildCtx(request), request.query);
  reply.status(200).send(result);
}

export async function settle(request: FastifyRequest<{ Params: { id: string }; Body: EntrySettleBody }>, reply: FastifyReply) {
  const result = await service.settle(buildCtx(request), request.params.id, request.body);
  reply.status(200).send(result);
}

export async function addPhoto(request: FastifyRequest<{ Params: { id: string }; Body: EntryPhotoBody }>, reply: FastifyReply) {
  const result = await service.addPhoto(buildCtx(request), request.params.id, request.body);
  reply.status(201).send(result);
}

export async function listPhotos(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const result = await service.listPhotos(buildCtx(request), request.params.id);
  reply.status(200).send(result);
}

export async function reviewItem(request: FastifyRequest<{ Params: { id: string; itemId: string }; Body: EntryItemReviewBody }>, reply: FastifyReply) {
  const result = await service.reviewItem(buildCtx(request), request.params.id, request.params.itemId, request.body);
  reply.status(200).send(result);
}

export async function correctItem(request: FastifyRequest<{ Params: { id: string; itemId: string }; Body: EntryItemCorrectBody }>, reply: FastifyReply) {
  const result = await service.correctItem(buildCtx(request), request.params.id, request.params.itemId, request.body);
  reply.status(200).send(result);
}

// the dealer handed the old battery over (client, 3 Oct 2026)
export async function markArrived(request: FastifyRequest<{ Params: { id: string }; Body: { itemId?: string } }>, reply: FastifyReply) {
  reply.status(200).send(await service.markArrived(buildCtx(request), request.params.id, request.body?.itemId));
}

// the distributor's decision on a dealer's request (client, 2 Oct 2026)
export async function distributorApprove(request: FastifyRequest<{ Params: { id: string }; Body: EntryDecisionBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.distributorDecide(buildCtx(request), request.params.id, 'approve', request.body.reason));
}

export async function distributorRefuse(request: FastifyRequest<{ Params: { id: string }; Body: EntryDecisionBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.distributorDecide(buildCtx(request), request.params.id, 'refuse', request.body.reason));
}

// head office's decision on a special replacement request, from Correction requests (client, 3 Oct 2026)
export async function specialApprove(request: FastifyRequest<{ Params: { id: string }; Body: EntryDecisionBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.decideSpecial(buildCtx(request), request.params.id, 'approve', request.body.reason));
}

export async function specialReject(request: FastifyRequest<{ Params: { id: string }; Body: EntryDecisionBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.decideSpecial(buildCtx(request), request.params.id, 'reject', request.body.reason));
}

// head office takes a request out of every live queue; nothing is deleted (client, 6 Oct 2026)
export async function voidEntry(request: FastifyRequest<{ Params: { id: string }; Body: EntryDecisionBody }>, reply: FastifyReply) {
  reply.status(200).send(await service.voidEntry(buildCtx(request), request.params.id, request.body.reason));
}
