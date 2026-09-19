import { db, withTransaction, type Tx } from '../../database/client';
import { deriveCode } from '../../domain/serials';
import { expiryFrom } from '../../domain/warranty';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { monthKey, nextFormattedRef } from '../../utils/ids';
import * as batteriesRepo from '../batteries/batteries.repository';
import * as claimsRepo from '../claims/claims.repository';
import { postMovementInTx } from '../stock/stock.service';
import * as repo from './entries.repository';
import type { EntryCreateBody, EntryListQuery } from './entries.validation';

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
  const dealerId = user.scope === 'dealer' ? user.dealerId! : null;
  if (!dealerId) {
    throw new AppError('dealer_required', 422, 'An entry must belong to a dealer.');
  }

  const entryDate = input.entryDate ?? todayIso(ctx);

  // format-validate every item up front, and reject duplicate codes WITHIN the same entry —
  // before opening a transaction, matching architecture.md §9.3's "errors first" pipeline.
  const derivedItems = input.items.map((item, i) => {
    const newDerived = deriveCode(item.code);
    if (!newDerived.valid) throw new AppError('format_mismatch', 422, 'Use an 8-digit code with a valid YYMM prefix.', { field: `items.${i}.code` });
    const oldDerived = item.oldCode ? deriveCode(item.oldCode) : null;
    if (item.oldCode && !oldDerived!.valid) throw new AppError('format_mismatch', 422, 'Use an 8-digit code with a valid YYMM prefix.', { field: `items.${i}.oldCode` });
    if (oldDerived && oldDerived.normalised === newDerived.normalised) throw new AppError('old_equals_new', 422, 'Old and new batteries must be different.', { field: `items.${i}.oldCode` });
    return { ...item, newDerived, oldDerived };
  });
  const codes = derivedItems.map((i) => i.newDerived.normalised);
  const dupe = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dupe) throw new AppError('duplicate_serial', 422, 'The same battery code appears twice in this entry.', { field: 'items' });

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
        batteryCode: item.newDerived.normalised,
        batteryCodeEntered: item.code,
        oldBatteryCode: item.oldDerived?.normalised ?? null,
        oldBatteryCodeEntered: item.oldCode ?? null,
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

  const old = await batteriesRepo.findBatteryByCode(db, item.oldBatteryCode);
  if (!old || !old.chainId) {
    throw new AppError('old_not_on_record', 422, 'This old battery is not on record — its warranty cannot be verified.', { field: `items.${item.seq}.oldBatteryCode` });
  }
  if (old.custodian === 'dealer' && old.dealerId !== entry.dealerId) {
    throw new AppError('custody_conflict', 409, 'This old battery belongs to another dealer.', { field: `items.${item.seq}.oldBatteryCode` });
  }
  if (old.replacedById) {
    throw new AppError('already_replaced', 409, 'This battery has already been replaced. Use the current battery in the chain.', { field: `items.${item.seq}.oldBatteryCode` });
  }

  const chain = await batteriesRepo.findChainById(db, old.chainId);
  if (!chain) throw new AppError('chain_missing', 500, 'This battery is missing its warranty record.');
  if (Date.parse(chain.warrantyExpiry) < Date.parse(entry.entryDate)) {
    throw new AppError('warranty_expired', 422, `Warranty expired on ${chain.warrantyExpiry}. Request an admin override before submitting.`, {
      field: `items.${item.seq}.oldBatteryCode`,
      details: { warrantyStart: chain.warrantyStart, warrantyExpiry: chain.warrantyExpiry },
    });
  }

  const existingNew = await batteriesRepo.findBatteryByCode(db, item.batteryCode);
  if (existingNew) throw new AppError('duplicate_serial', 409, 'This new battery code is already registered.', { field: `items.${item.seq}.batteryCode` });

  const newDerived = deriveCode(item.batteryCodeEntered);
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

async function approveRegularSaleItem(tx: Tx, ctx: Ctx, entry: { id: string; dealerId: string; entryDate: string }, item: Awaited<ReturnType<typeof repo.findItemsByEntryId>>[number]) {
  const existing = await batteriesRepo.findBatteryByCode(db, item.batteryCode);
  if (existing) throw new AppError('duplicate_serial', 409, 'This battery code is already registered.', { field: `items.${item.seq}.batteryCode` });

  const derived = deriveCode(item.batteryCodeEntered);
  const model = await batteriesRepo.findModelById(db, item.modelId);
  const warrantyMonths = model?.warrantyMonths ?? 24;

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
    warrantyStart: entry.entryDate,
    warrantyExpiry: expiryFrom(entry.entryDate, warrantyMonths),
    termMonths: warrantyMonths,
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
    const derived = deriveCode(item.batteryCodeEntered);
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
  const dealerId = user.scope === 'dealer' ? user.dealerId : undefined;
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
