import { randomUUID } from 'node:crypto';
import { db, withTransaction, type Tx } from '../../database/client';
import { anyDigitLengths, deriveCode, digitsOfFull, fullCode, lengthsSentence, readStored, NEW_BATTERY_DIGIT_LENGTHS } from '../../domain/serials';
import { coverFromMfg } from '../../domain/warranty';
import { graceMonths, serialDigitLengths } from '../../utils/settings';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { putObject, signedUrl } from '../../utils/storage';
import { monthKey, nextFormattedRef } from '../../utils/ids';
import * as batteriesRepo from '../batteries/batteries.repository';
import * as claimsRepo from '../claims/claims.repository';
import * as claimsService from '../claims/claims.service';
import { findDealerById } from '../dealers/dealers.repository';
import { postMovementInTx } from '../stock/stock.service';
import * as returnsRepo from '../returns/returns.repository';
import * as repo from './entries.repository';
import type { EntryCreateBody, EntryItemCorrectBody, EntryItemReviewBody, EntryListQuery, EntryPhotoBody, EntrySettleBody } from './entries.validation';

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
  const [modelRows, setting] = await Promise.all([batteriesRepo.listModels(db), serialDigitLengths(db)]);
  const modelIds = modelRows.map((m) => m.id);
  // An OLD battery (and a sales return) is one already in the field: it can carry any form we have
  // ever issued, including the 9-digit new-battery form, or it could not be sent back to us.
  const lengths = anyDigitLengths(setting);
  const badFormat = `Use ${lengthsSentence(lengths)} that starts with the YYMM it was made.`;
  // `code` is a NEW battery for a replacement or a sale (7, 8 or 9 digits — client, 2 Oct 2026),
  // but for a sales return it is a battery already in the field, so it follows `lengths`.
  const codeLengths: readonly number[] = input.entryType === 'sales_return' ? lengths : NEW_BATTERY_DIGIT_LENGTHS;
  const badNewFormat = input.entryType === 'sales_return' ? badFormat : `A new battery has ${lengthsSentence(NEW_BATTERY_DIGIT_LENGTHS)} that starts with the YYMM it was made.`;
  const derivedItems = input.items.map((item, i) => {
    const newDerived = deriveCode(item.code, modelIds, codeLengths);
    if (!newDerived.valid) throw new AppError('format_mismatch', 422, badNewFormat, { field: `items.${i}.code` });
    const oldDerived = item.oldCode ? deriveCode(item.oldCode, modelIds, lengths) : null;
    if (item.oldCode && !oldDerived!.valid) throw new AppError('format_mismatch', 422, badFormat, { field: `items.${i}.oldCode` });
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

  let old = await batteriesRepo.findBatteryByCode(tx, item.oldBatteryCode);
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

  const existingNew = await batteriesRepo.findBatteryByCode(tx, item.batteryCode);
  if (existingNew) throw new AppError('duplicate_serial', 409, 'This new battery code is already registered.', { field: `items.${item.seq}.batteryCode` });

  const newDerived = readStored(digitsOfFull(item.batteryCode, item.modelId));
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
  const derived = readStored(digitsOfFull(item.oldBatteryCode!, modelId));
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
  const chain = await batteriesRepo.insertChain(tx, { rootBatteryId: battery.id, warrantyStart: cover.startDate, warrantyExpiry: cover.expiryDate, termMonths: cover.termMonths, graceMonths: cover.graceMonths });
  return batteriesRepo.updateBatteryChainId(tx, battery.id, chain.id);
}

async function approveRegularSaleItem(tx: Tx, ctx: Ctx, entry: { id: string; dealerId: string; entryDate: string }, item: Awaited<ReturnType<typeof repo.findItemsByEntryId>>[number]) {
  const existing = await batteriesRepo.findBatteryByCode(tx, item.batteryCode);
  if (existing) throw new AppError('duplicate_serial', 409, 'This battery code is already registered.', { field: `items.${item.seq}.batteryCode` });

  const derived = readStored(digitsOfFull(item.batteryCode, item.modelId));
  const model = await batteriesRepo.findModelById(tx, item.modelId);
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
    termMonths: cover.termMonths,
    graceMonths: cover.graceMonths,
  });
  const updated = await batteriesRepo.updateBatteryChainId(tx, battery.id, chain.id);
  await postMovementInTx(tx, ctx, { battery: null, batteryId: battery.id, toState: 'sold', toCustodian: 'customer', toDealerId: entry.dealerId, entryId: entry.id, reasonCode: 'entry_approved' });
  await repo.updateEntryItemLinks(tx, item.id, { batteryId: updated.id });
  return { battery: updated, chain };
}

async function approveSalesReturnItem(tx: Tx, ctx: Ctx, entry: { id: string; dealerId: string }, item: Awaited<ReturnType<typeof repo.findItemsByEntryId>>[number]) {
  const existing = await batteriesRepo.findBatteryByCode(tx, item.batteryCode);
  let battery;
  if (existing) {
    battery = (await postMovementInTx(tx, ctx, { battery: existing, toState: 'returned', toCustodian: 'dealer', toDealerId: entry.dealerId, entryId: entry.id, reasonCode: 'entry_approved' })).battery!;
  } else {
    const derived = readStored(digitsOfFull(item.batteryCode, item.modelId));
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
  return approveItems(ctx, entry, items, reason);
}

/** The entry approval itself — stock, chains, claims for every battery on it. Callers check arrival first. */
async function approveItems(ctx: Ctx, entry: NonNullable<Awaited<ReturnType<typeof repo.findEntryById>>>, items: Awaited<ReturnType<typeof repo.findItemsByEntryId>>, reason: string) {
  const entryId = entry.id;

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
  const items = await repo.findItemsByEntryId(db, entryId);
  // one battery of the entry, or all of them
  const target = input.itemId ? items.filter((it) => it.id === input.itemId) : items;
  if (input.itemId && !target.length) throw new AppError('item_not_found', 404, 'That battery is not on this request.');
  await assertOldBatteriesArrived(target);

  if (entry.status === 'submitted') {
    // Refusing the only battery (or all of them) refuses the request itself, as before. A
    // single battery of several is decided on its own claim, so the request is approved first
    // — the new batteries are with the customers either way — and only that claim is refused.
    if (input.decision === 'refused' && target.length === items.length) {
      const r = await reject(ctx, entryId, input.reason);
      return { entry: r, creditNotes: [] };
    }
    await approveItems(ctx, entry, items, input.itemId ? `Each battery decided on its own at the factory. ${input.reason}` : input.reason);
  }

  const creditNotes = [];
  const targetIds = new Set(target.map((it) => it.id));
  for (const it of await repo.findItemsByEntryId(db, entryId)) {
    if (!targetIds.has(it.id) || !it.claimId) continue;
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

/* ---------- photos (D-10: Neon Object Storage) ---------- */

/** The request, if this caller may see it: head office any, a dealer only their own (404 otherwise, I-3). */
async function visibleEntry(ctx: Ctx, entryId: string) {
  const user = requireDealer(ctx);
  const entry = await repo.findEntryById(db, entryId);
  if (!entry || (user.scope === 'dealer' && entry.dealerId !== user.dealerId)) throw new AppError('entry_not_found', 404, 'Entry not found.');
  return { user, entry };
}

const EXT: Record<EntryPhotoBody['contentType'], string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function addPhoto(ctx: Ctx, entryId: string, input: EntryPhotoBody) {
  const { user, entry } = await visibleEntry(ctx, entryId);
  const item = input.itemSeq === undefined ? undefined : (await repo.findItemsByEntryId(db, entryId)).find((it) => it.seq === input.itemSeq);
  if (input.itemSeq !== undefined && !item) throw new AppError('item_not_found', 422, 'That battery is not on this request.', { field: 'itemSeq' });
  const bytes = Buffer.from(input.data, 'base64');
  if (!bytes.length) throw new AppError('photo_empty', 422, 'The photo is empty.', { field: 'data' });
  // a fresh key every time, so a retake never serves the old picture from a cache
  const objectKey = `entries/${entry.id}/${randomUUID()}.${EXT[input.contentType]}`;
  await putObject(objectKey, bytes, input.contentType);
  const row = await repo.upsertPhoto(db, { entryId: entry.id, entryItemId: item?.id ?? null, tag: input.tag, objectKey, contentType: input.contentType, sizeBytes: bytes.length, uploadedBy: user.id });
  return { id: row.id, tag: row.tag, itemSeq: item?.seq ?? null, sizeBytes: row.sizeBytes, createdAt: row.createdAt };
}

/** Every photo on the request, each with a link that opens it for an hour. */
export async function listPhotos(ctx: Ctx, entryId: string) {
  await visibleEntry(ctx, entryId);
  const [rows, items] = await Promise.all([repo.findPhotosByEntryId(db, entryId), repo.findItemsByEntryId(db, entryId)]);
  const seqOf = new Map(items.map((it) => [it.id, it.seq]));
  return {
    items: await Promise.all(rows.map(async (r) => ({
      id: r.id, tag: r.tag, itemId: r.entryItemId, itemSeq: r.entryItemId ? (seqOf.get(r.entryItemId) ?? null) : null,
      contentType: r.contentType, sizeBytes: r.sizeBytes, createdAt: r.createdAt, url: await signedUrl(r.objectKey),
    }))),
  };
}

/* ---------- one battery at a time (client, 2 Oct 2026) ----------
 * Head office works a multi-battery replacement battery by battery: each one is approved or
 * refused on its own card, so "I am looking at this one" and "this one's serial is wrong" have
 * to be per battery too. Both act on an entry_item, never on the whole request.
 */

/** Admin-only, and the request must still be open: both of these describe work in progress. */
async function openItem(ctx: Ctx, entryId: string, itemId: string) {
  if (!ctx.user || ctx.user.scope !== 'admin') throw new AppError('unauthenticated', 401, 'Sign in required.');
  const entry = await repo.findEntryById(db, entryId);
  if (!entry) throw new AppError('entry_not_found', 404, 'Entry not found.');
  const item = await repo.findItemById(db, itemId);
  // belongs-to check, not just "exists": an id from another request must not reach through here
  if (!item || item.entryId !== entry.id) throw new AppError('item_not_found', 404, 'That battery is not on this request.');
  if (entry.status !== 'submitted') {
    throw new AppError('invalid_transition', 409, `This request is already ${entry.status} — a battery on it cannot be changed.`);
  }
  return { entry, item, user: ctx.user };
}

/** Mark one battery as being looked at. Repeatable: a second call re-dates it and keeps the note. */
export async function reviewItem(ctx: Ctx, entryId: string, itemId: string, input: EntryItemReviewBody) {
  const { entry, item, user } = await openItem(ctx, entryId, itemId);
  return withTransaction(async (tx) => {
    const updated = await repo.updateEntryItem(tx, item.id, {
      reviewStartedAt: ctx.now(),
      reviewStartedBy: user.id,
      reviewNote: input.note ?? null,
    });
    await audit(tx, {
      ctx, action: 'entry.item.review_started', entityType: 'entry_item', entityId: item.id, entityRef: entry.ref,
      before: { reviewStartedAt: item.reviewStartedAt }, after: { reviewStartedAt: updated.reviewStartedAt },
      reason: input.note ?? 'Review started', outcome: 'ok',
    });
    return updated;
  });
}

/**
 * Rewrite one battery's serials. Only while the request is still 'submitted' — once it is
 * approved a battery row exists and a warranty chain hangs off these codes, and rewriting them
 * then would silently re-point that history at a different battery.
 *
 * Every check `create` makes is made again here, against the corrected values: the length rule
 * for the kind of battery it is, the month, that the (plate, model) is one the factory makes,
 * that old and new are not the same battery, and that the corrected code does not collide with
 * another battery already on this request.
 */
export async function correctItem(ctx: Ctx, entryId: string, itemId: string, input: EntryItemCorrectBody) {
  const { entry, item, user } = await openItem(ctx, entryId, itemId);

  const [modelRows, setting, siblings] = await Promise.all([
    batteriesRepo.listModels(db), serialDigitLengths(db), repo.findItemsByEntryId(db, entry.id),
  ]);
  const modelIds = modelRows.map((m) => m.id);
  const lengths = anyDigitLengths(setting);
  const codeLengths: readonly number[] = entry.entryType === 'sales_return' ? lengths : NEW_BATTERY_DIGIT_LENGTHS;

  // what the correction leaves the item as: a field left out keeps what is already stored
  const enteredCode = input.code ?? item.batteryCodeEntered;
  const enteredOld = input.oldCode ?? item.oldBatteryCodeEntered;

  const newDerived = deriveCode(enteredCode, modelIds, codeLengths);
  if (!newDerived.valid) {
    const says = entry.entryType === 'sales_return'
      ? `Use ${lengthsSentence(lengths)} that starts with the YYMM it was made.`
      : `A new battery has ${lengthsSentence(NEW_BATTERY_DIGIT_LENGTHS)} that starts with the YYMM it was made.`;
    throw new AppError('format_mismatch', 422, says, { field: 'code' });
  }
  const oldDerived = enteredOld ? deriveCode(enteredOld, modelIds, lengths) : null;
  if (enteredOld && !oldDerived!.valid) {
    throw new AppError('format_mismatch', 422, `Use ${lengthsSentence(lengths)} that starts with the YYMM it was made.`, { field: 'oldCode' });
  }

  const modelId = newDerived.modelId ?? input.modelId ?? item.modelId;
  const oldModelId = enteredOld ? (input.oldModelId ?? oldDerived?.modelId ?? item.oldModelId ?? modelId) : null;
  for (const [field, id] of [['modelId', modelId], ['oldModelId', oldModelId]] as const) {
    if (!id) continue;
    const model = await batteriesRepo.findModelById(db, id);
    if (!model) throw new AppError('model_unknown', 422, `${id} is not a known plate + model combination.`, { field });
    if (!model.active && field === 'modelId') throw new AppError('model_inactive', 422, `${id} is no longer sold.`, { field });
  }

  const batteryCode = fullCode(modelId, newDerived.normalised);
  const oldBatteryCode = oldDerived ? fullCode(oldModelId!, oldDerived.normalised) : null;
  if (oldBatteryCode && oldBatteryCode === batteryCode) {
    throw new AppError('old_equals_new', 422, 'Old and new batteries must be different.', { field: 'oldCode' });
  }
  if (siblings.some((s) => s.id !== item.id && s.batteryCode === batteryCode)) {
    throw new AppError('duplicate_serial', 422, 'Another battery on this request already has that number.', { field: 'code' });
  }

  return withTransaction(async (tx) => {
    const before = { batteryCode: item.batteryCode, oldBatteryCode: item.oldBatteryCode, modelId: item.modelId, oldModelId: item.oldModelId };
    const updated = await repo.updateEntryItem(tx, item.id, {
      modelId,
      batteryCode,
      batteryCodeEntered: enteredCode,
      oldBatteryCode,
      oldBatteryCodeEntered: enteredOld ?? null,
      oldModelId,
      correctedAt: ctx.now(),
      correctedBy: user.id,
      correctionReason: input.reason,
    });
    await audit(tx, {
      ctx, action: 'entry.item.corrected', entityType: 'entry_item', entityId: item.id, entityRef: entry.ref,
      before, after: { batteryCode, oldBatteryCode, modelId, oldModelId }, reason: input.reason, outcome: 'ok',
    });
    return updated;
  });
}
