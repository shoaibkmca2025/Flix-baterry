import { db, withTransaction } from '../../database/client';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { monthKey, nextFormattedRef } from '../../utils/ids';
import * as claimsRepo from '../claims/claims.repository';
import * as claimsService from '../claims/claims.service';
import * as entriesRepo from '../entries/entries.repository';
import * as repo from './returns.repository';
import type { ChallanCreateBody, ChallanListQuery, ChallanReceiveBody, LineStageBody } from './returns.validation';

// M-19 returns (modules.md), V1: a dealer hands old batteries to the van (dispatch), head
// office confirms the van arrived (receive), then each battery moves through testing →
// repaired/scrapped → closed.
//
// A challan can be raised before head office approves the entry, so it may carry batteries
// that have no claim yet. Where a claim already exists (entry approved), the challan carries
// it along — claims.dispatch/receive own the stock ledger moves, so they are called rather than
// duplicated here, each after this module's own transaction has committed.

function requireUser(ctx: Ctx) {
  if (!ctx.user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  return ctx.user;
}

function requireAdmin(ctx: Ctx) {
  const user = requireUser(ctx);
  if (user.scope !== 'admin') throw new AppError('permission_denied', 403, 'Head office only.');
  return user;
}

export async function dispatch(ctx: Ctx, input: ChallanCreateBody) {
  const user = requireUser(ctx);
  if (user.scope !== 'dealer' || !user.dealerId) throw new AppError('permission_denied', 403, 'Only a dealer can dispatch old batteries.');
  const dealerId = user.dealerId;

  const ids = [...new Set(input.entryIds)];
  const found = await entriesRepo.findEntriesByIds(db, ids);
  const byId = new Map(found.map((e) => [e.id, e]));
  for (const id of ids) {
    const e = byId.get(id);
    // 404 not 403 for another dealer's entry — no existence leak (I-3)
    if (!e || e.dealerId !== dealerId) throw new AppError('entry_not_found', 404, 'Entry not found.');
    if (e.entryType !== 'replacement') throw new AppError('nothing_to_dispatch', 422, `${e.ref} is not a replacement — there is no old battery to send back.`);
    if (e.status === 'rejected') throw new AppError('nothing_to_dispatch', 422, `${e.ref} was refused — nothing to send back.`);
  }

  const items = (await entriesRepo.findItemsByEntryIds(db, ids)).filter((it) => !!it.oldBatteryCode);
  if (!items.length) throw new AppError('nothing_to_dispatch', 422, 'None of these entries has an old battery to send back.');
  const [dup] = await repo.findLinesByEntryItemIds(db, items.map((it) => it.id));
  if (dup) {
    const ref = byId.get(dup.entryId)?.ref ?? dup.entryId;
    throw new AppError('already_dispatched', 409, `${ref} is already on a challan — old battery ${dup.batteryCode} was sent before.`);
  }

  return withTransaction(async (tx) => {
    const now = ctx.now();
    const no = await nextFormattedRef(tx, 'CHL', 'challan', monthKey(now));
    const challan = await repo.insertChallan(tx, {
      no, dealerId, vehicleNo: input.vehicleNo || null, driverName: input.driverName || null, lineCount: items.length, dispatchedBy: user.id, dispatchedAt: now,
    });
    if (!challan) throw new AppError('internal_error', 500, 'Could not create the challan.');
    const lines = await repo.insertLines(tx, items.map((it) => ({
      challanId: challan.id, entryId: it.entryId, entryItemId: it.id, batteryCode: it.oldBatteryCode as string, modelId: it.modelId, faultCode: it.faultCode,
    })));
    await audit(tx, { ctx, action: 'challan.dispatched', entityType: 'challan', entityId: challan.id, entityRef: no, after: { lines: lines.length, entryIds: ids }, outcome: 'ok' });
    return { ...challan, lines };
  }).then(async (result) => {
    await carryClaims(ctx, items.map((it) => it.claimId), 'awaiting_return');
    return result;
  });
}

// Moves each linked claim up to `target` through the claims service (raised → awaiting_return →
// received). Best effort: a claim already past that point, or in a state that cannot move, is
// left alone rather than failing the challan.
async function carryClaims(ctx: Ctx, claimIds: (string | null)[], target: 'awaiting_return' | 'received') {
  for (const id of claimIds) {
    if (!id) continue;
    const claim = await claimsRepo.findClaimById(db, id);
    if (!claim) continue;
    try {
      if (claim.status === 'raised') await claimsService.dispatch(ctx, id);
      if (target === 'received' && (claim.status === 'raised' || claim.status === 'awaiting_return')) await claimsService.receive(ctx, id);
    } catch {
      // the physical challan is the record here; the claim catches up when head office processes it
    }
  }
}

export async function receive(ctx: Ctx, id: string, input: ChallanReceiveBody) {
  const user = requireAdmin(ctx);
  const challan = await repo.findChallanById(db, id);
  if (!challan) throw new AppError('challan_not_found', 404, 'Challan not found.');
  if (challan.status !== 'dispatched') throw new AppError('challan_already_received', 409, `${challan.no} was already confirmed as arrived.`);
  const lines = await repo.findLinesByChallanId(db, id);
  const missing = new Set(input.missingBatteryCodes.map((c) => c.replace(/\s/g, '').toUpperCase()));
  for (const code of missing) {
    if (!lines.some((l) => l.batteryCode === code)) throw new AppError('line_not_on_challan', 422, `${code} is not on ${challan.no}.`);
  }

  return withTransaction(async (tx) => {
    const now = ctx.now();
    const updated = await repo.markReceived(tx, id, user.id, now);
    const out = [];
    for (const line of lines) {
      const short = missing.has(line.batteryCode);
      out.push(await repo.updateLineStage(tx, line.id, { stage: short ? 'in_transit' : 'received', shortage: short, stageNote: input.reason ?? null, stagedBy: user.id, stagedAt: now }));
    }
    await audit(tx, { ctx, action: 'challan.received', entityType: 'challan', entityId: id, entityRef: challan.no, before: { status: 'dispatched' }, after: { status: 'received', shortages: [...missing] }, reason: input.reason, outcome: 'ok' });
    return { ...updated, lines: out };
  }).then(async (result) => {
    const arrived = lines.filter((l) => !missing.has(l.batteryCode));
    const items = await entriesRepo.findItemsByEntryIds(db, [...new Set(arrived.map((l) => l.entryId))]);
    const itemIds = new Set(arrived.map((l) => l.entryItemId));
    await carryClaims(ctx, items.filter((it) => itemIds.has(it.id)).map((it) => it.claimId), 'received');
    return result;
  });
}

// Physical processing after arrival. Each step is its own audited change.
const NEXT: Record<string, LineStageBody['stage'][]> = { received: ['testing'], testing: ['repaired', 'scrapped'], repaired: ['closed'], scrapped: ['closed'] };

export async function stage(ctx: Ctx, lineId: string, input: LineStageBody) {
  const user = requireAdmin(ctx);
  const line = await repo.findLineById(db, lineId);
  if (!line) throw new AppError('line_not_found', 404, 'That battery is not on any challan.');
  if (!(NEXT[line.stage] ?? []).includes(input.stage)) {
    throw new AppError('invalid_transition', 409, `A battery that is ${line.stage.replace('_', ' ')} cannot be marked ${input.stage}.`);
  }
  return withTransaction(async (tx) => {
    const updated = await repo.updateLineStage(tx, lineId, { stage: input.stage, stageNote: input.reason, stagedBy: user.id, stagedAt: ctx.now(), shortage: false });
    await audit(tx, { ctx, action: 'return.staged', entityType: 'challan_line', entityId: lineId, entityRef: line.batteryCode, before: { stage: line.stage }, after: { stage: input.stage }, reason: input.reason, outcome: 'ok' });
    return updated;
  });
}

export async function list(ctx: Ctx, query: ChallanListQuery) {
  const user = requireUser(ctx);
  const dealerId = user.scope === 'dealer' ? user.dealerId : undefined;
  const page = await repo.listChallans(db, { status: query.status, dealerId, limit: query.limit, cursor: decodeCursor(query.cursor) });
  const allLines = await repo.findLinesByChallanIds(db, page.items.map((c) => c.id));
  const byChallan = new Map<string, typeof allLines>();
  for (const line of allLines) byChallan.set(line.challanId, [...(byChallan.get(line.challanId) ?? []), line]);
  return { items: page.items.map((c) => ({ ...c, lines: byChallan.get(c.id) ?? [] })), nextCursor: page.nextCursor };
}

export async function getById(ctx: Ctx, id: string) {
  const user = requireUser(ctx);
  const challan = await repo.findChallanById(db, id);
  if (!challan || (user.scope === 'dealer' && challan.dealerId !== user.dealerId)) throw new AppError('challan_not_found', 404, 'Challan not found.');
  return { ...challan, lines: await repo.findLinesByChallanId(db, id) };
}

function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  try {
    const { createdAt, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return { createdAt: new Date(createdAt), id };
  } catch {
    throw new AppError('filter_invalid', 422, 'That page link is not valid — start from the first page again.');
  }
}
