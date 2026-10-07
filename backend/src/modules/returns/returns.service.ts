import { db, withTransaction } from '../../database/client';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { decodeCursor } from '../../utils/cursor';
import { monthKey, nextFormattedRef } from '../../utils/ids';
import * as batteriesRepo from '../batteries/batteries.repository';
import * as claimsRepo from '../claims/claims.repository';
import * as claimsService from '../claims/claims.service';
import * as entriesRepo from '../entries/entries.repository';
import * as mastersRepo from '../masters/masters.repository';
import { distributorShopIds } from '../dealers/dealers.service';
import * as repo from './returns.repository';
import type { ChallanClaimBody, ChallanCreateBody, ChallanListQuery, ChallanReceiveBody, LinePlantBody, LineReceiveBody, LineStageBody, ReturnLineListQuery } from './returns.validation';

// M-19 returns (modules.md), V1: a dealer hands old batteries to the van (dispatch), head
// office confirms each battery arrived and tags the plant that made it (receiveLine — or
// receive, for the whole van at once), then each battery moves through testing →
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
  if (user.scope !== 'dealer' || !user.dealerId) throw new AppError('permission_denied', 403, 'Only a distributor can dispatch old batteries.');
  // Only a distributor dispatches — his own old batteries and those his dealers handed him
  // (client, 2 Oct 2026). A dealer gets 403 distributor_only here.
  const dealerId = user.dealerId;
  const shops = await distributorShopIds(ctx);

  const ids = [...new Set(input.entryIds)];
  const found = await entriesRepo.findEntriesByIds(db, ids);
  const byId = new Map(found.map((e) => [e.id, e]));
  for (const id of ids) {
    const e = byId.get(id);
    // 404 not 403 for another dealer's entry — no existence leak (I-3)
    if (!e || !shops.has(e.dealerId)) throw new AppError('entry_not_found', 404, 'Entry not found.');
    // One challan carries both kinds in two sections (client, 3 Oct 2026): a replacement's old
    // battery, and a sales return's battery going back to be put right.
    if (e.entryType === 'regular_sales') throw new AppError('nothing_to_dispatch', 422, `${e.ref} is a sale — there is no battery to send back.`);
    if (e.status === 'rejected') throw new AppError('nothing_to_dispatch', 422, `${e.ref} was refused — nothing to send back.`);
    if (e.status === 'void') throw new AppError('nothing_to_dispatch', 422, `${e.ref} was voided by head office — nothing to send back.`);
    // a dealer's request is sent back only once its distributor has approved it (client, 2 Oct 2026)
    if (e.status === 'with_distributor') throw new AppError('not_approved_yet', 422, `${e.ref} is waiting for your approval. Approve it first, then send its old battery.`);
    // a special request's old battery leaves only once head office has approved it (client, 3 Oct 2026)
    if (e.specialStatus === 'pending') throw new AppError('special_pending', 422, `${e.ref} is a special request — its old battery is past the warranty term. It can be sent only after head office approves it.`);
  }

  // Which battery travels: a replacement sends its OLD one back, a sales return sends the battery
  // itself — the same one that will come home working.
  const kindOf = (entryId: string): 'replacement' | 'sales_return' => (byId.get(entryId)?.entryType === 'sales_return' ? 'sales_return' : 'replacement');
  const travellingCode = (it: { entryId: string; oldBatteryCode: string | null; batteryCode: string | null }) =>
    kindOf(it.entryId) === 'sales_return' ? it.batteryCode : it.oldBatteryCode;
  const items = (await entriesRepo.findItemsByEntryIds(db, ids)).filter((it) => !!travellingCode(it));
  if (!items.length) throw new AppError('nothing_to_dispatch', 422, 'None of these entries has a battery to send back.');
  // A dealer's old battery leaves only once it has reached the distributor and he marked it
  // arrived — a challan must never list a battery he does not have (client, 3 Oct 2026).
  const notHere = items.find((it) => byId.get(it.entryId)?.dealerId !== dealerId && !it.distributorReceivedAt);
  if (notHere) {
    const ref = byId.get(notHere.entryId)?.ref ?? notHere.entryId;
    throw new AppError('not_arrived', 422, `Battery ${travellingCode(notHere)} on ${ref} has not reached you yet. Mark it arrived when the dealer hands it over, then send it.`);
  }
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
      challanId: challan.id, entryId: it.entryId, entryItemId: it.id, kind: kindOf(it.entryId),
      // carried from the entry so a van's load reads without joining back through every request
      byAdmin: !!byId.get(it.entryId)?.byAdmin,
      batteryCode: travellingCode(it) as string, modelId: it.modelId, faultCode: it.faultCode,
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

// A plant the admin can tag a battery with: it exists and is switched on (D-19).
async function activePlant(plantId: string) {
  const plant = await mastersRepo.findPlantById(db, plantId);
  if (!plant) throw new AppError('plant_not_found', 422, 'Choose a plant from the list.', { field: 'plantId' });
  if (!plant.active) throw new AppError('plant_inactive', 422, `${plant.name} is switched off. Choose another plant, or switch it back on first.`, { field: 'plantId' });
  return plant;
}

// Moves the claim of each arrived battery to received (best effort, after the commit).
async function carryArrived(ctx: Ctx, arrived: { entryId: string; entryItemId: string }[]) {
  if (!arrived.length) return;
  const items = await entriesRepo.findItemsByEntryIds(db, [...new Set(arrived.map((l) => l.entryId))]);
  const itemIds = new Set(arrived.map((l) => l.entryItemId));
  await carryClaims(ctx, items.filter((it) => itemIds.has(it.id)).map((it) => it.claimId), 'received');
}

/**
 * "Confirm all arrived" — every battery still on the way arrives at once, all tagged with the
 * one plant given. A battery already confirmed on its own (receiveLine) keeps its stage
 * and its plant: this used to reset every line on the challan back to "received".
 */
export async function receive(ctx: Ctx, id: string, input: ChallanReceiveBody) {
  const user = requireAdmin(ctx);
  const challan = await repo.findChallanById(db, id);
  if (!challan) throw new AppError('challan_not_found', 404, 'Challan not found.');
  if (challan.status !== 'dispatched') throw new AppError('challan_already_received', 409, `${challan.no} was already confirmed as arrived.`);
  const lines = await repo.findLinesByChallanId(db, id);
  const missing = new Set(input.missingBatteryCodes.map((c) => c.replace(/\s/g, '').toUpperCase()));
  for (const code of missing) {
    const line = lines.find((l) => l.batteryCode === code);
    if (!line) throw new AppError('line_not_on_challan', 422, `${code} is not on ${challan.no}.`);
    if (line.stage !== 'in_transit') throw new AppError('line_already_received', 422, `${code} was already confirmed as arrived, so it cannot be missing.`);
  }
  const plant = await activePlant(input.plantId);
  const pending = lines.filter((l) => l.stage === 'in_transit');
  const arriving = pending.filter((l) => !missing.has(l.batteryCode));

  return withTransaction(async (tx) => {
    const now = ctx.now();
    const updated = await repo.markReceived(tx, id, user.id, now);
    const out = [];
    for (const line of lines) {
      if (line.stage !== 'in_transit') { out.push(line); continue; }
      const short = missing.has(line.batteryCode);
      const tag = short ? {} : { plantId: plant.id };
      out.push(await repo.updateLineStage(tx, line.id, { stage: short ? 'in_transit' : 'received', shortage: short, stageNote: input.reason ?? null, stagedBy: user.id, stagedAt: now, ...tag }));
      if (tag.plantId) await batteriesRepo.setBatteryPlant(tx, line.batteryCode, tag.plantId, now);
    }
    await audit(tx, {
      ctx, action: 'challan.received', entityType: 'challan', entityId: id, entityRef: challan.no,
      before: { status: 'dispatched' },
      after: { status: 'received', shortages: [...missing], arrived: arriving.map((l) => l.batteryCode), plantId: plant.id, plant: plant.name },
      reason: input.reason, outcome: 'ok',
    });
    return { ...updated, lines: out };
  }).then(async (result) => {
    await carryArrived(ctx, arriving);
    return result;
  });
}

/**
 * One battery off the van (D-19). The admin reads its label and says which plant made it; it
 * arrives tagged with that plant. The challan reads "arrived" once nothing on it is on the way.
 */
export async function receiveLine(ctx: Ctx, lineId: string, input: LineReceiveBody) {
  const user = requireAdmin(ctx);
  const line = await repo.findLineById(db, lineId);
  if (!line) throw new AppError('line_not_found', 404, 'That battery is not on any challan.');
  if (line.stage !== 'in_transit') throw new AppError('line_already_received', 409, `${line.batteryCode} was already confirmed as arrived.`);
  const plant = await activePlant(input.plantId);
  const challan = await repo.findChallanById(db, line.challanId);
  if (!challan) throw new AppError('challan_not_found', 404, 'Challan not found.');

  return withTransaction(async (tx) => {
    const now = ctx.now();
    const updated = await repo.updateLineStage(tx, line.id, { stage: 'received', shortage: false, plantId: plant.id, stageNote: input.reason ?? null, stagedBy: user.id, stagedAt: now });
    await batteriesRepo.setBatteryPlant(tx, line.batteryCode, plant.id, now);
    const others = await repo.findLinesByChallanId(tx, line.challanId);
    const stillOnTheWay = others.filter((l) => l.id !== line.id && l.stage === 'in_transit').length;
    if (!stillOnTheWay && challan.status === 'dispatched') await repo.markReceived(tx, challan.id, user.id, now);
    await audit(tx, {
      ctx, action: 'return.received', entityType: 'challan_line', entityId: line.id, entityRef: line.batteryCode,
      before: { stage: 'in_transit' },
      after: { stage: 'received', challan: challan.no, plantId: plant.id, plant: plant.name, stillOnTheWay },
      reason: input.reason, outcome: 'ok',
    });
    return { ...updated, challanNo: challan.no, stillOnTheWay };
  }).then(async (result) => {
    await carryArrived(ctx, [line]);
    return result;
  });
}

/**
 * Re-tag an arrived battery (D-19): the label was misread, or it arrived before plants existed.
 * A reason is required because this changes what the per-plant failure counts say.
 */
export async function setLinePlant(ctx: Ctx, lineId: string, input: LinePlantBody) {
  requireAdmin(ctx);
  const line = await repo.findLineById(db, lineId);
  if (!line) throw new AppError('line_not_found', 404, 'That battery is not on any challan.');
  if (line.stage === 'in_transit') throw new AppError('line_not_arrived', 409, `${line.batteryCode} has not arrived yet. Choose its plant when you confirm it arrived.`);
  const plant = await activePlant(input.plantId);
  if (line.plantId === plant.id) throw new AppError('plant_unchanged', 409, `${line.batteryCode} is already tagged ${plant.name}.`, { field: 'plantId' });
  const was = line.plantId ? await mastersRepo.findPlantById(db, line.plantId) : null;

  return withTransaction(async (tx) => {
    const now = ctx.now();
    const updated = await repo.setLinePlant(tx, line.id, plant.id);
    await batteriesRepo.setBatteryPlant(tx, line.batteryCode, plant.id, now);
    await audit(tx, {
      ctx, action: 'return.plant_changed', entityType: 'challan_line', entityId: line.id, entityRef: line.batteryCode,
      before: { plantId: line.plantId, plant: was?.name ?? null }, after: { plantId: plant.id, plant: plant.name },
      reason: input.reason, outcome: 'ok',
    });
    return updated;
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
  const page = await repo.listChallans(db, { status: query.status, dealerId, limit: query.limit, cursor: decodeCursor(query.cursor, 'createdAt') });
  // The outcome has to be on the LIST too, not just on one challan: the console and the dealer
  // app both build their whole store from this endpoint, and without it every battery read as
  // "still travelling" — so the Approved and Rejected groups were always empty however many
  // batteries had been decided (client, 2 Oct 2026). One extra query for the whole page.
  const allLines = await withOutcomes(await repo.findLinesByChallanIds(db, page.items.map((c) => c.id)));
  const byChallan = new Map<string, typeof allLines>();
  for (const line of allLines) byChallan.set(line.challanId, [...(byChallan.get(line.challanId) ?? []), line]);
  return { items: page.items.map((c) => ({ ...c, lines: byChallan.get(c.id) ?? [] })), nextCursor: page.nextCursor };
}

export async function listLines(ctx: Ctx, query: ReturnLineListQuery) {
  const user = requireUser(ctx);
  const dealerId = user.scope === 'dealer' ? user.dealerId : undefined;
  return repo.listLines(db, { plantId: query.plantId, stage: query.stage, dealerId, limit: query.limit, cursor: decodeCursor(query.cursor, 'createdAt') });
}

/**
 * What a returned battery's claim is doing, in the words the challan screens use. The dealer and
 * head office both think per challan — "10 went back, 7 are approved" — so every line carries its
 * own outcome and the screens group by it (client, 2 Oct 2026).
 *
 * 'passed' is the gap the Claim button fills: the engineer has checked the battery and it is good,
 * but nobody has approved it for refund yet. 'claimed' is after that — the credit note exists.
 */
export type LineOutcome = 'travelling' | 'arrived' | 'passed' | 'claimed' | 'rejected';
const OUTCOME: Record<string, LineOutcome> = {
  raised: 'travelling', awaiting_return: 'travelling', received: 'arrived',
  checked: 'passed', approved: 'claimed', refused: 'rejected',
};

async function withOutcomes(lines: Awaited<ReturnType<typeof repo.findLinesByChallanId>>) {
  const states = await repo.findClaimStateByEntryItemIds(db, lines.map((l) => l.entryItemId));
  const byItem = new Map(states.map((s) => [s.entryItemId, s]));
  return lines.map((l) => {
    const s = byItem.get(l.entryItemId);
    return {
      ...l,
      claimId: s?.claimId ?? null,
      // no claim yet means the request itself has not been approved — the battery is still travelling
      outcome: (s?.status ? OUTCOME[s.status] : undefined) ?? 'travelling',
      outcomeReason: s?.decisionReason ?? s?.conditionNote ?? null,
    };
  });
}

export async function getById(ctx: Ctx, id: string) {
  const user = requireUser(ctx);
  const challan = await repo.findChallanById(db, id);
  if (!challan || (user.scope === 'dealer' && challan.dealerId !== user.dealerId)) throw new AppError('challan_not_found', 404, 'Challan not found.');
  return { ...challan, lines: await withOutcomes(await repo.findLinesByChallanId(db, id)) };
}

/**
 * Approve for refund every battery on this challan that passed its check, in one go.
 *
 * Head office works a challan battery by battery, then approves the ones that passed together —
 * so this is the Claim button (client, 2 Oct 2026). Only claims sitting at 'checked' move: a
 * battery still travelling, not yet checked, already refused or already claimed is left exactly
 * as it is and counted in `skipped`, so clicking twice cannot double-pay a dealer.
 */
export async function claimChecked(ctx: Ctx, id: string, input: ChallanClaimBody) {
  if (!ctx.user || ctx.user.scope !== 'admin') throw new AppError('unauthenticated', 401, 'Sign in required.');
  const challan = await repo.findChallanById(db, id);
  if (!challan) throw new AppError('challan_not_found', 404, 'Challan not found.');

  const lines = await repo.findLinesByChallanId(db, id);
  const states = await repo.findClaimStateByEntryItemIds(db, lines.map((l) => l.entryItemId));
  const ready = states.filter((s) => s.claimId && s.status === 'checked');
  if (!ready.length) {
    throw new AppError('nothing_to_claim', 422, 'No battery on this challan is waiting to be approved for refund. Check them first.');
  }

  const creditNotes: { no: string }[] = [];
  for (const s of ready) {
    const decided = await claimsService.decide(ctx, s.claimId!, { outcome: 'approved', reason: input.reason });
    if (decided.creditNote) creditNotes.push(decided.creditNote);
  }
  return {
    challanNo: challan.no,
    claimed: ready.length,
    skipped: states.length - ready.length,
    creditNotes,
    lines: await withOutcomes(lines),
  };
}

