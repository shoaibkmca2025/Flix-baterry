import { db, withTransaction, type Tx } from '../../database/client';
import { deriveCode, fullCode } from '../../domain/serials';
import { coverFromMfg } from '../../domain/warranty';
import { graceMonths } from '../../utils/settings';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { monthKey, nextFormattedRef } from '../../utils/ids';
import * as batteriesRepo from '../batteries/batteries.repository';
import * as claimsRepo from '../claims/claims.repository';
import * as claimsService from '../claims/claims.service';
import { findDealerById } from '../dealers/dealers.repository';
import { postMovementInTx } from '../stock/stock.service';
import * as returnsRepo from '../returns/returns.repository';
import * as repo from './entries.repository';
import type { EntryCreateBody, EntryListQuery, EntrySettleBody } from './entries.validation';

// This module is the real, permanent home for what three temporary endpoints used to do
// separately (POST /batteries/sell, POST /batteries/replace, POST /claims) — see logs.md
// 2026-09-17. Reads batteries.repository/claims.repository directly rather than through
// their service layers, the same pragmatic pattern already used elsewhere in this codebase
// (e.g. dealers.service reading masters.repository) since those modules don't expose
// service-level functions shaped for this internal use.

function todayIso(ctx: Ctx): string {
  return ctx.now().toISOString().slice(0, 10);
}

function requireDealer(ctx: Ctx) {
  if (!ctx.user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  return ctx.user;
}

export async function create(ctx: Ctx, input: EntryCreateBody) {
  const user = requireDealer(ctx);
  if (!user.dealerId && user.scope === 'dealer') {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
  // A dealer's scope is always the token; head office names the dealer it is recording for
  // ("Record an entry" in the console) and that dealer must be able to trade.
  const dealerId = user.scope === 'dealer' ? user.dealerId! : (input.dealerId ?? null);
  if (!dealerId) {
    throw new AppError('dealer_required', 422, 'Choose the dealer this entry belongs to.', { field: 'dealerId' });
  }
  if (user.scope === 'admin') {
    const dealer = await findDealerById(db, dealerId);
    if (!dealer) throw new AppError('dealer_not_found', 404, 'Dealer not found.', { field: 'dealerId' });
    if (dealer.status !== 'active') throw new AppError('dealer_not_active', 422, `This dealer is ${dealer.status.replace('_', ' ')}.`, { field: 'dealerId' });
  }

  const entryDate = input.entryDate ?? todayIso(ctx);

  // format-validate every item up front, and reject duplicate codes WITHIN the same entry —
  // before opening a transaction, matching architecture.md §9.3's "errors first" pipeline.
  const modelIds = (await batteriesRepo.listModels(db)).map((m) => m.id);
  const derivedItems = input.items.map((item, i) => {
    const newDerived = deriveCode(item.code, modelIds);
    if (!newDerived.valid) throw new AppError('format_mismatch', 422, 'Use an 8-digit code with a valid YYMM prefix.', { field: `items.${i}.code` });
    const oldDerived = item.oldCode ? deriveCode(item.oldCode, modelIds) : null;
    if (item.oldCode && !oldDerived!.valid) throw new AppError('format_mismatch', 422, 'Use an 8-digit code with a valid YYMM prefix.', { field: `items.${i}.oldCode` });
    // the old battery's product: what the dealer chose, else what its label prefix says, else like-for-like
    const modelId = newDerived.modelId ?? item.modelId;
    const oldModelId = item.oldCode ? (item.oldModelId ?? oldDerived?.modelId ?? item.modelId) : null;
    // A battery is identified by product + digits together, so two batteries only clash when
    // BOTH match — 'M1000 26090001' and 'S1000 26090001' are different batteries.
    const batteryCode = fullCode(modelId, newDerived.normalised);
    const oldBatteryCode = oldDerived ? fullCode(oldModelId!, oldDerived.normalised) : null;
    if (oldBatteryCode && oldBatteryCode === batteryCode) throw new AppError('old_equals_new', 422, 'Old and new batteries must be different.', { field: `items.${i}.oldCode` });
    return { ...item, modelId, newDerived, oldDerived, oldModelId, batteryCode, oldBatteryCode };
  });
  const codes = derivedItems.map((i) => i.batteryCode);
  const dupe = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dupe) throw new AppError('duplicate_serial', 422, 'The same battery appears twice in this entry.', { field: 'items' });
  // every (plate, model) named must be a combination the factory makes — that row carries the warranty term
  for (const [i, item] of derivedItems.entries()) {
    for (const [field, id] of [['modelId', item.modelId], ['oldModelId', item.oldModelId]] as const) {
      if (!id) continue;
      const model = await batteriesRepo.findModelById(db, id);
      if (!model) throw new AppError('model_unknown', 422, `${id} is not a known plate + model combination.`, { field: `items.${i}.${field}` });
      if (!model.active && field === 'modelId') throw new AppError('model_inactive', 422, `${id} is no longer sold.`, { field: `items.${i}.${field}` });
    }
  }

  return withTransaction(async (tx) => {
    const ref = await nextFormattedRef(tx, 'ENT', 'entry', monthKey(ctx.now()));
    const entry = await repo.insertEntry(tx, {
      ref,
      dealerId,
      entryType: input.entryType,
      entryDate,
      place: input.place,
      customerName: input.customerName ?? null,
      remarks: input.remarks ?? null,
      totalQty: derivedItems.length,
      gps: input.gps ?? null,
      signature: input.signature ?? null,
      coverToldAt: input.coverTold ? ctx.now() : null,
      submittedBy: user.id,
    });

    for (const [i, item] of derivedItems.entries()) {
      await repo.insertEntryItem(tx, {
        entryId: entry.id,
        seq: i,
        modelId: item.modelId,
        batteryCode: item.batteryCode,
        batteryCodeEntered: item.code,
        oldBatteryCode: item.oldBatteryCode,
        oldBatteryCodeEntered: item.oldCode ?? null,
        oldModelId: item.oldModelId,
        faultCode: item.faultCode ?? null,
        remarks: item.remarks ?? null,
      });
    }

    await audit(tx, { ctx, action: 'entry.submitted', entityType: 'entry', entityId: entry.id, entityRef: entry.ref, outcome: 'ok' });
    return entry;
  });
}

async function approveReplacementItem(tx: Tx, ctx: Ctx, entry: { id: string; dealerId: string; entryDate: string }, item: Awaited<ReturnType<typeof repo.findItemsByEntryId>>[number]) {
  if (!item.oldBatteryCode) throw new AppError('old_serial_required', 422, 'Old battery code is required for a replacement.', { field: `items.${item.seq}.oldBatteryCode` });

  let old = await batteriesRepo.findBatteryByCode(db, item.oldBatteryCode);
  if (!old || !old.chainId) {
    // Not on record (sold before the app, or a legacy import without dates): since 22 Sep 2026
    // (memory.md D-11) the cover is counted from the MANUFACTURE month in the code for the
    // (plate, model) the dealer named, so the battery can be put on record here and judged.
    old = await putOldBatteryOnRecord(tx, ctx, entry, item, old);
  }
  if (old.custodian === 'dealer' && old.dealerId !== entry.dealerId) {
    throw new AppError('custody_conflict', 409, 'This old battery belongs to another dealer.', { field: `items.${item.seq}.oldBatteryCode` });
  }
  if (old.replacedById) {
    throw new AppError('already_replaced', 409, 'This battery has already been replaced. Use the current battery in the chain.', { field: `items.${item.seq}.oldBatteryCode` });
  }

  const chain = await batteriesRepo.findChainById(tx, old.chainId!);
  if (!chain) throw new AppError('chain_missing', 500, 'This battery is missing its warranty record.');
  if (Date.parse(chain.warrantyExpiry) < Date.parse(entry.entryDate)) {
    throw new AppError('warranty_expired', 422, `Warranty expired on ${chain.warrantyExpiry}. Request an admin override before submitting.`, {
      field: `items.${item.seq}.oldBatteryCode`,
      details: { warrantyStart: chain.warrantyStart, warrantyExpiry: chain.warrantyExpiry },
    });
  }

  const existingNew = await batteriesRepo.findBatteryByCode(db, item.batteryCode);
  if (existingNew) throw new AppError('duplicate_serial', 409, 'This new battery code is already registered.', { field: `items.${item.seq}.batteryCode` });

  const newDerived = deriveCode(item.batteryCode.slice(-8));
  const newBattery = await batteriesRepo.insertBattery(tx, {
    batteryCode: item.batteryCode,
    batteryCodeEntered: item.batteryCodeEntered,
    serialNo: newDerived.serialNo,
    modelId: item.modelId,
    mfgMonth: newDerived.mfgMonth,
    state: 'replacement',
    custodian: 'customer',
    dealerId: entry.dealerId,
    origin: 'entry',
    chainId: chain.id,
    replacedFromId: old.id,
  });
  // Ledger (stock module): new battery created straight into replacement/customer; the old one
  // comes back to the dealer's counter awaiting the company pickup (architecture.md §9.6).
  await postMovementInTx(tx, ctx, { battery: null, batteryId: newBattery.id, toState: 'replacement', toCustodian: 'customer', toDealerId: entry.dealerId, entryId: entry.id, reasonCode: 'entry_approved' });
  await postMovementInTx(tx, ctx, { battery: old, toState: 'returned', toCustodian: 'dealer', toDealerId: entry.dealerId, entryId: entry.id, reasonCode: 'entry_approved' });
  await batteriesRepo.updateBatteryReplacedBy(tx, old.id, newBattery.id);
  await batteriesRepo.insertReplacementLink(tx, { oldBatteryId: old.id, newBatteryId: newBattery.id, chainId: chain.id, replacedAt: entry.entryDate });
  await batteriesRepo.incrementChainReplacementCount(tx, chain.id, chain.replacementCount + 1);

  const claimRef = await nextFormattedRef(tx, 'CLM', 'claim', monthKey(ctx.now()));
  const claim = await claimsRepo.insertClaim(tx, { ref: claimRef, dealerId: entry.dealerId, chainId: chain.id, oldBatteryId: old.id, newBatteryId: newBattery.id });

  await repo.updateEntryItemLinks(tx, item.id, { batteryId: newBattery.id, oldBatteryId: old.id, claimId: claim.id });
  return { newBattery, claim };
}

// An old battery the app has never seen: create it (notOnRecord) with the dealer as custodian
// and a chain anchored on its manufacture month, so the replacement rule can judge it.
async function putOldBatteryOnRecord(
  tx: Tx,
  ctx: Ctx,
  entry: { id: string; dealerId: string },
  item: Awaited<ReturnType<typeof repo.findItemsByEntryId>>[number],
  existing: Awaited<ReturnType<typeof batteriesRepo.findBatteryByCode>>,
) {
  const modelId = item.oldModelId ?? item.modelId;
  const derived = deriveCode(item.oldBatteryCode!.slice(-8));
  const model = await batteriesRepo.findModelById(tx, modelId);
  if (!model) throw new AppError('model_unknown', 422, `${modelId} is not a known plate + model combination.`, { field: `items.${item.seq}.oldModelId` });
  const cover = coverFromMfg(derived.mfgMonth!, model.warrantyMonths, await graceMonths(tx));

  let battery = existing;
  if (!battery) {
    battery = await batteriesRepo.insertBattery(tx, {
      batteryCode: item.oldBatteryCode!,
      batteryCodeEntered: item.oldBatteryCodeEntered ?? item.oldBatteryCode!,
      serialNo: derived.serialNo,
      modelId,
      mfgMonth: derived.mfgMonth,
      state: 'sold',
      custodian: 'customer',
      dealerId: entry.dealerId,
      origin: 'entry',
      notOnRecord: true,
    } as never);
    await postMovementInTx(tx, ctx, { battery: null, batteryId: battery.id, toState: 'sold', toCustodian: 'customer', toDealerId: entry.dealerId, entryId: entry.id, reasonCode: 'entry_approved', reasonText: 'Put on record at replacement (not sold through the app)' });
  }
  const chain = await batteriesRepo.insertChain(tx, { rootBatteryId: battery.id, warrantyStart: cover.startDate, warrantyExpiry: cover.expiryDate, termMonths: cover.termMonths + cover.graceMonths });
  return batteriesRepo.updateBatteryChainId(tx, battery.id, chain.id);
}

async function approveRegularSaleItem(tx: Tx, ctx: Ctx, entry: { id: string; dealerId: string; entryDate: string }, item: Awaited<ReturnType<typeof repo.findItemsByEntryId>>[number]) {
  const existing = await batteriesRepo.findBatteryByCode(db, item.batteryCode);
  if (existing) throw new AppError('duplicate_serial', 409, 'This battery code is already registered.', { field: `items.${item.seq}.batteryCode` });

  const derived = deriveCode(item.batteryCode.slice(-8));
  const model = await batteriesRepo.findModelById(db, item.modelId);
  const cover = coverFromMfg(derived.mfgMonth!, model?.warrantyMonths ?? 24, await graceMonths(tx));

  const battery = await batteriesRepo.insertBattery(tx, {
    batteryCode: item.batteryCode,
    batteryCodeEntered: item.batteryCodeEntered,
    serialNo: derived.serialNo,
    modelId: item.modelId,
    mfgMonth: derived.mfgMonth,
    state: 'sold',
    custodian: 'customer',
    dealerId: entry.dealerId,
    origin: 'entry',
  });
  const chain = await batteriesRepo.insertChain(tx, {
    rootBatteryId: battery.id,
    warrantyStart: cover.startDate,
    warrantyExpiry: cover.expiryDate,
    termMonths: cover.termMonths + cover.graceMonths,
  });
  const updated = await batteriesRepo.updateBatteryChainId(tx, battery.id, chain.id);
  await postMovementInTx(tx, ctx, { battery: null, batteryId: battery.id, toState: 'sold', toCustodian: 'customer', toDealerId: entry.dealerId, entryId: entry.id, reasonCode: 'entry_approved' });
  await repo.updateEntryItemLinks(tx, item.id, { batteryId: updated.id });
  return { battery: updated, chain };
}

async function approveSalesReturnItem(tx: Tx, ctx: Ctx, entry: { id: string; dealerId: string }, item: Awaited<ReturnType<typeof repo.findItemsByEntryId>>[number]) {
  const existing = await batteriesRepo.findBatteryByCode(db, item.batteryCode);
  let battery;
  if (existing) {
    battery = (await postMovementInTx(tx, ctx, { battery: existing, toState: 'returned', toCustodian: 'dealer', toDealerId: entry.dealerId, entryId: entry.id, reasonCode: 'entry_approved' })).battery!;
  } else {
    const derived = deriveCode(item.batteryCode.slice(-8));
    battery = await batteriesRepo.insertBattery(tx, {
      batteryCode: item.batteryCode,
      batteryCodeEntered: item.batteryCodeEntered,
      serialNo: derived.serialNo,
      modelId: item.modelId,
      mfgMonth: derived.mfgMonth,
      state: 'returned',
      custodian: 'dealer',
      dealerId: entry.dealerId,
      origin: 'entry',
      notOnRecord: true,
    } as never);
    await postMovementInTx(tx, ctx, { battery: null, batteryId: battery.id, toState: 'returned', toCustodian: 'dealer', toDealerId: entry.dealerId, entryId: entry.id, reasonCode: 'entry_approved' });
  }
  await repo.updateEntryItemLinks(tx, item.id, { batteryId: battery.id });
  return { battery };
}

export async function approve(ctx: Ctx, entryId: string, reason: string) {
  if (!ctx.user || ctx.user.scope !== 'admin') {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
  const entry = await repo.findEntryById(db, entryId);
  if (!entry) throw new AppError('entry_not_found', 404, 'Entry not found.');
  if (entry.status !== 'submitted') {
    throw new AppError('invalid_transition', 409, `Cannot approve an entry that is already ${entry.status}.`);
  }
  const items = await repo.findItemsByEntryId(db, entryId);
  // Head office decides a replacement only once the old battery is physically at the factory
  // (client rule, 25 Sep 2026): they verify it offline, then approve or refuse.
  if (entry.entryType === 'replacement') await assertOldBatteriesArrived(items);

  return withTransaction(async (tx) => {
    const results = [];
    for (const item of items) {
      if (entry.entryType === 'replacement') results.push(await approveReplacementItem(tx, ctx, entry, item));
      else if (entry.entryType === 'regular_sales') results.push(await approveRegularSaleItem(tx, ctx, entry, item));
      else results.push(await approveSalesReturnItem(tx, ctx, entry, item));
    }
    const updated = await repo.updateEntryStatus(tx, entryId, { status: 'approved', decidedBy: ctx.user!.id, decisionReason: reason });
    await audit(tx, { ctx, action: 'entry.approved', entityType: 'entry', entityId: entry.id, entityRef: entry.ref, before: { status: 'submitted' }, after: { status: 'approved' }, reason, outcome: 'ok' });
    return { entry: updated, items: results };
  });
}

// A challan line at any of these stages means the old battery has reached the factory.
const ARRIVED_STAGES = new Set(['received', 'testing', 'repaired', 'scrapped', 'closed']);
const ARRIVED_CLAIM = new Set(['received', 'checked']);

async function assertOldBatteriesArrived(items: { id: string; seq: number; oldBatteryCode: string | null; claimId?: string | null }[]) {
  const withOld = items.filter((it) => it.oldBatteryCode);
  if (!withOld.length) return;
  const lines = await returnsRepo.findLinesByEntryItemIds(db, withOld.map((it) => it.id));
  const arrived = new Set(lines.filter((l) => ARRIVED_STAGES.has(l.stage)).map((l) => l.entryItemId));
  const missing: typeof withOld = [];
  for (const it of withOld) {
    if (arrived.has(it.id)) continue;
    // entries approved before this rule reached the factory through claims.receive, not a challan
    const claim = it.claimId ? await claimsRepo.findClaimById(db, it.claimId) : undefined;
    if (!claim || !ARRIVED_CLAIM.has(claim.status)) missing.push(it);
  }
  if (missing.length) {
    throw new AppError('old_battery_not_arrived', 409, 'The old battery has not reached the factory yet. Approve or refuse it from Old battery returns once it arrives.', {
      details: { items: missing.map((it) => it.seq) },
    });
  }
}

/**
 * Head office's one decision on a replacement, taken once the old battery is at the factory
 * and verified offline. Approve = entry approved (stock, chain, claim) + claim carried to
 * received + checked + approved, which issues the dealer's credit note. Refuse = the entry
 * (or, for an already-approved entry, its claim) is refused with the reason.
 * Each step is its own transaction in the owning module; a failure part-way leaves the entry
 * at a valid earlier state and settling again resumes from there.
 */
export async function settle(ctx: Ctx, entryId: string, input: EntrySettleBody) {
  if (!ctx.user || ctx.user.scope !== 'admin') throw new AppError('unauthenticated', 401, 'Sign in required.');
  const entry = await repo.findEntryById(db, entryId);
  if (!entry) throw new AppError('entry_not_found', 404, 'Entry not found.');
  if (entry.entryType !== 'replacement') throw new AppError('not_a_replacement', 422, 'Only replacements are decided on arrival. Use Approve for this entry.');
  if (entry.status !== 'submitted' && entry.status !== 'approved') {
    throw new AppError('invalid_transition', 409, `This request is already ${entry.status}.`);
  }
  await assertOldBatteriesArrived(await repo.findItemsByEntryId(db, entryId));

  if (entry.status === 'submitted') {
    if (input.decision === 'refused') {
      const r = await reject(ctx, entryId, input.reason);
      return { entry: r, creditNotes: [] };
    }
    await approve(ctx, entryId, input.reason);
  }

  const creditNotes = [];
  for (const it of await repo.findItemsByEntryId(db, entryId)) {
    if (!it.claimId) continue;
    let claim = await claimsRepo.findClaimById(db, it.claimId);
    if (!claim) continue;
    if (claim.status === 'raised') claim = await claimsService.dispatch(ctx, claim.id);
    if (claim.status === 'awaiting_return') claim = await claimsService.receive(ctx, claim.id);
    if (input.decision === 'refused') {
      if (claim.status === 'received') await claimsService.check(ctx, claim.id, { findingCode: 'refused_on_arrival', conditionNote: input.reason, disposition: 'hold', disqualify: true, reason: input.reason });
      else if (claim.status === 'checked') await claimsService.decide(ctx, claim.id, { outcome: 'refused', reason: input.reason });
      continue;
    }
    if (claim.status === 'received') claim = await claimsService.check(ctx, claim.id, { findingCode: 'verified_on_arrival', conditionNote: input.reason, disposition: 'hold', disqualify: false });
    if (claim.status === 'checked') {
      const decided = await claimsService.decide(ctx, claim.id, { outcome: 'approved', reason: input.reason });
      if (decided.creditNote) creditNotes.push(decided.creditNote);
    }
  }
  return { entry: await repo.findEntryById(db, entryId), creditNotes };
}

export async function reject(ctx: Ctx, entryId: string, reason: string) {
  if (!ctx.user || ctx.user.scope !== 'admin') {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
  const entry = await repo.findEntryById(db, entryId);
  if (!entry) throw new AppError('entry_not_found', 404, 'Entry not found.');
  if (entry.status !== 'submitted') {
    throw new AppError('invalid_transition', 409, `Cannot reject an entry that is already ${entry.status}.`);
  }
  return withTransaction(async (tx) => {
    const updated = await repo.updateEntryStatus(tx, entryId, { status: 'rejected', decidedBy: ctx.user!.id, decisionReason: reason });
    await audit(tx, { ctx, action: 'entry.rejected', entityType: 'entry', entityId: entry.id, entityRef: entry.ref, before: { status: 'submitted' }, after: { status: 'rejected' }, reason, outcome: 'ok' });
    return updated;
  });
}

export async function getById(ctx: Ctx, id: string) {
  const user = requireDealer(ctx);
  const entry = await repo.findEntryById(db, id);
  if (!entry) throw new AppError('entry_not_found', 404, 'Entry not found.');
  if (user.scope === 'dealer' && entry.dealerId !== user.dealerId) {
    throw new AppError('entry_not_found', 404, 'Entry not found.'); // 404 not 403 — no existence leak (I-3)
  }
  const items = await repo.findItemsByEntryId(db, id);
  return { ...entry, items };
}

export async function list(ctx: Ctx, query: EntryListQuery) {
  const user = requireDealer(ctx);
  const dealerId = user.scope === 'dealer' ? user.dealerId : query.dealerId;
  return repo.listEntries(db, { status: query.status, dealerId, limit: query.limit, cursor: decodeCursor(query.cursor) });
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
