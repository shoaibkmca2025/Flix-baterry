import { randomUUID } from 'node:crypto';
import { db, withTransaction, type Tx } from '../../database/client';
import { anyDigitLengths, deriveCode, digitsOfFull, fullCode, lengthsSentence, readStored, NEW_BATTERY_DIGIT_LENGTHS } from '../../domain/serials';
import { coverCase, coverFromMfg } from '../../domain/warranty';
import { graceMonths, serialDigitLengths } from '../../utils/settings';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { decodeCursor } from '../../utils/cursor';
import { putObject, signedUrl } from '../../utils/storage';
import { monthKey, nextFormattedRef } from '../../utils/ids';
import * as batteriesRepo from '../batteries/batteries.repository';
import * as claimsRepo from '../claims/claims.repository';
import * as claimsService from '../claims/claims.service';
import { findDealerById } from '../dealers/dealers.repository';
import { requireDistributor, visibleShopIds } from '../dealers/dealers.service';
import { postMovementInTx } from '../stock/stock.service';
import * as returnsRepo from '../returns/returns.repository';
import * as repo from './entries.repository';
import { shopEntryIssues } from './entries.validation';
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
  // A dealer's request goes to its distributor first; a distributor's own straight to head
  // office (client, 2 Oct 2026). Head office recording one itself skips the distributor.
  const shop = user.scope === 'dealer' ? await findDealerById(db, dealerId) : undefined;
  const status = shop?.kind === 'dealer' ? 'with_distributor' as const : 'submitted' as const;

  /**
   * Head office records what it finds, not what the rules expect (client, 3 Oct 2026).
   *
   * A shop's request is held to every rule — length, month, product, no duplicate, a fault on a
   * replacement, a kind on a sales return. Head office is putting right what is already true in
   * the world: an old serial in a form nobody issues any more, a battery whose model was retired,
   * a request with no fault recorded because nobody wrote one down. Those checks are judgement,
   * and head office is the judgement.
   *
   * Two things are still checked, because they are not judgement: the shop and the product must
   * exist (both are foreign keys — a row naming neither cannot be written), and a code cannot be
   * blank, or the battery could never be found again. Approving an entry whose new battery
   * duplicates one already on record is still refused there, where the battery row is made.
   */
  const byAdmin = user.scope === 'admin';

  /*
   * A plain sale is head office's to record, not a shop's.
   *
   * entries.model.ts has said so since the type existed — it is what first establishes a
   * battery's warranty, and neither app offers it — but nothing enforced it, so a dealer token
   * could create one and walk it through approval (QA, 6 Oct 2026).
   */
  if (!byAdmin && input.entryType === 'regular_sales') {
    throw new AppError('entry_type_not_allowed', 403, 'A sale is recorded by head office, not from the app.', { field: 'entryType' });
  }
  if (!byAdmin) {
    const issue = shopEntryIssues(input, todayIso(ctx));
    if (issue) throw new AppError('validation_error', 422, issue.message, { field: issue.field });
  }

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
    // head office may enter a form deriveCode cannot read; keep what was typed, normalised
    if (byAdmin && !newDerived.valid) newDerived.normalised = item.code.trim().toUpperCase().replace(/\s/g, '');
    if (!byAdmin && !newDerived.valid) throw new AppError('format_mismatch', 422, badNewFormat, { field: `items.${i}.code` });
    if (!item.code.trim()) throw new AppError('code_required', 422, 'Enter the battery number — without it the battery can never be found again.', { field: `items.${i}.code` });
    const oldDerived = item.oldCode ? deriveCode(item.oldCode, modelIds, lengths) : null;
    if (!byAdmin && item.oldCode && !oldDerived!.valid) throw new AppError('format_mismatch', 422, badFormat, { field: `items.${i}.oldCode` });
    // the old battery's product: what the dealer chose, else what its label prefix says, else like-for-like
    const modelId = newDerived.modelId ?? item.modelId;
    const oldModelId = item.oldCode ? (item.oldModelId ?? oldDerived?.modelId ?? item.modelId) : null;
    // A battery is identified by product + digits together, so two batteries only clash when
    // BOTH match — 'M1000 26090001' and 'S1000 26090001' are different batteries.
    const batteryCode = fullCode(modelId, newDerived.normalised);
    const oldBatteryCode = oldDerived ? fullCode(oldModelId!, oldDerived.normalised) : null;
    if (!byAdmin && oldBatteryCode && oldBatteryCode === batteryCode) throw new AppError('old_equals_new', 422, 'Old and new batteries must be different.', { field: `items.${i}.oldCode` });
    return { ...item, modelId, newDerived, oldDerived, oldModelId, batteryCode, oldBatteryCode };
  });
  const codes = derivedItems.map((i) => i.batteryCode);
  const dupe = codes.find((c, i) => codes.indexOf(c) !== i);
  if (!byAdmin && dupe) throw new AppError('duplicate_serial', 422, 'The same battery appears twice in this entry.', { field: 'items' });
  // every (plate, model) named must be a combination the factory makes — that row carries the warranty term
  for (const [i, item] of derivedItems.entries()) {
    for (const [field, id] of [['modelId', item.modelId], ['oldModelId', item.oldModelId]] as const) {
      if (!id) continue;
      const model = await batteriesRepo.findModelById(db, id);
      if (!model) throw new AppError('model_unknown', 422, `${id} is not a known plate + model combination.`, { field: `items.${i}.${field}` });
      // a retired model is still a real product, and head office may be recording an old battery of one
      if (!byAdmin && !model.active && field === 'modelId') throw new AppError('model_inactive', 422, `${id} is no longer sold.`, { field: `items.${i}.${field}` });
    }
  }

  // The old battery's cover decides the route (client, 3 Oct 2026): within the term it is a
  // normal request; past it — inside the grace months, or past the cover — it is a SPECIAL one.
  // Judged here, on the server, so it does not depend on what the phone showed.
  const grace = input.entryType === 'replacement' ? await graceMonths(db) : 0;
  const covers: Awaited<ReturnType<typeof oldBatteryCover>>[] = [];
  for (const [i, item] of derivedItems.entries()) {
    covers.push(input.entryType === 'replacement' && item.oldBatteryCode ? await oldBatteryCover(item.oldBatteryCode, item.oldModelId!, entryDate, grace, i) : null);
  }
  const special = covers.some((c) => c && c.case !== 'normal');

  return withTransaction(async (tx) => {
    // Each kind carries its own tag and its own series, so a reference says what it is at a
    // glance — on screen, on the challan and over the phone (client, 3 Oct 2026). Requests
    // numbered before this keep their ENT- reference: a number already spoken about and printed
    // must not be rewritten underneath people.
    const tag = input.entryType === 'sales_return' ? 'SR' : 'RP';
    const ref = await nextFormattedRef(tx, tag, `entry_${tag.toLowerCase()}`, monthKey(ctx.now()));
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
      status,
      specialStatus: special ? 'pending' : null,
      byAdmin,
      returnKind: input.entryType === 'sales_return' ? input.returnKind ?? null : null,
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
        coverCase: covers[i] && covers[i]!.case !== 'normal' ? (covers[i]!.case as 'extension' | 'expired') : null,
        coverTermEnd: covers[i]?.termEnd ?? null,
        coverEnd: covers[i]?.coverEnd ?? null,
      });
    }

    await audit(tx, { ctx, action: special ? 'entry.submitted_special' : 'entry.submitted', entityType: 'entry', entityId: entry.id, entityRef: entry.ref, outcome: 'ok' });
    return entry;
  });
}

const NO_WARRANTY = (why: string | null) => `This battery has no warranty — ${why ?? 'it was given as a special replacement'}. It cannot be replaced under warranty.`;

/** The old battery's cover on the day of the request: from its chain if it is on record, else from its label (D-11). */
async function oldBatteryCover(oldBatteryCode: string, oldModelId: string, onDate: string, grace: number, seq: number) {
  const old = await batteriesRepo.findBatteryByCode(db, oldBatteryCode);
  if (old?.noWarranty) throw new AppError('no_warranty', 422, NO_WARRANTY(old.noWarrantyReason), { field: `items.${seq}.oldCode` });
  const chain = old?.chainId ? await batteriesRepo.findChainById(db, old.chainId) : undefined;
  let cover: { startDate: string; expiryDate: string; termMonths: number };
  if (chain) cover = { startDate: chain.warrantyStart, expiryDate: chain.warrantyExpiry, termMonths: chain.termMonths };
  else {
    const model = await batteriesRepo.findModelById(db, oldModelId);
    const mfgMonth = readStored(digitsOfFull(oldBatteryCode, oldModelId)).mfgMonth;
    if (!mfgMonth) return null; // create's format check already refused anything without a month
    cover = coverFromMfg(mfgMonth, model?.warrantyMonths ?? 24, grace);
  }
  return { ...coverCase(cover, onDate), coverEnd: cover.expiryDate };
}

/**
 * A special request that was refused — by the distributor, by head office in Correction requests,
 * or at the factory (client, 3 Oct 2026). The customer already has the new battery, so it is put
 * on record with NO warranty: it can never be claimed on, and never sold on as a fresh battery.
 * A code that is already on record belongs to some other request and is left alone.
 */
async function recordWithoutWarranty(tx: Tx, ctx: Ctx, entry: { id: string; ref: string; dealerId: string; entryDate: string }) {
  for (const item of await repo.findItemsByEntryId(tx, entry.id)) {
    if (item.batteryId || await batteriesRepo.findBatteryByCode(tx, item.batteryCode)) continue;
    const derived = readStored(digitsOfFull(item.batteryCode, item.modelId));
    const battery = await batteriesRepo.insertBattery(tx, {
      batteryCode: item.batteryCode,
      batteryCodeEntered: item.batteryCodeEntered,
      serialNo: derived.serialNo,
      modelId: item.modelId,
      mfgMonth: derived.mfgMonth,
      state: 'replacement',
      custodian: 'customer',
      dealerId: entry.dealerId,
      origin: 'entry',
      noWarranty: true,
      noWarrantyReason: `given on ${entry.entryDate} against ${item.oldBatteryCode ?? 'an old battery'} on ${entry.ref}, a special request that was refused`,
    });
    await postMovementInTx(tx, ctx, { battery: null, batteryId: battery.id, toState: 'replacement', toCustodian: 'customer', toDealerId: entry.dealerId, entryId: entry.id, reasonCode: 'manual', reasonText: 'Given against a special request that was refused — no warranty' });
    await repo.updateEntryItemLinks(tx, item.id, { batteryId: battery.id });
  }
}

/** Head office decides a special request in Correction requests before anything else can happen to it. */
function assertSpecialDecided(entry: { specialStatus: string | null }) {
  if (entry.specialStatus === 'pending') {
    throw new AppError('special_pending', 409, 'This is a special replacement request — the old battery is past its warranty term. Approve or reject it in Correction requests first.');
  }
}

async function approveReplacementItem(tx: Tx, ctx: Ctx, entry: { id: string; dealerId: string; entryDate: string; specialStatus?: string | null }, item: Awaited<ReturnType<typeof repo.findItemsByEntryId>>[number]) {
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
  if (old.noWarranty) throw new AppError('no_warranty', 422, NO_WARRANTY(old.noWarrantyReason), { field: `items.${item.seq}.oldBatteryCode` });

  const chain = await batteriesRepo.findChainById(tx, old.chainId!);
  if (!chain) throw new AppError('chain_missing', 500, 'This battery is missing its warranty record.');
  // Past the cover, a replacement is only ever a SPECIAL request head office approved in
  // Correction requests — and then the new battery carries no warranty (client, 3 Oct 2026).
  const pastCover = Date.parse(chain.warrantyExpiry) < Date.parse(entry.entryDate);
  if (pastCover && entry.specialStatus !== 'approved') {
    // Head office is the only one who ever reaches this — it runs on approval, not on the
    // dealer's submit — so it says what THEY can do about it, not "ask an admin" (client, 2 Oct
    // 2026). The dates are in the message because the console often has no cover on record for a
    // battery that was sold before this system: the server works it out from the label.
    throw new AppError('warranty_expired', 422, `This battery's cover ran out on ${chain.warrantyExpiry}, before the replacement on ${entry.entryDate}, so it cannot be approved as a warranty claim. Record a warranty override if it should be covered anyway, or refuse it with the reason.`, {
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
    ...(pastCover ? { noWarranty: true, noWarrantyReason: `given on ${entry.entryDate} as a special replacement for ${item.oldBatteryCode}, whose cover ended on ${chain.warrantyExpiry}` } : {}),
  });
  // Ledger (stock module): new battery created straight into replacement/customer; the old one
  // comes back to the dealer's counter awaiting the company pickup (architecture.md §9.6).
  await postMovementInTx(tx, ctx, { battery: null, batteryId: newBattery.id, toState: 'replacement', toCustodian: 'customer', toDealerId: entry.dealerId, entryId: entry.id, reasonCode: 'entry_approved' });
  await postMovementInTx(tx, ctx, { battery: old, toState: 'returned', toCustodian: 'dealer', toDealerId: entry.dealerId, entryId: entry.id, reasonCode: 'entry_approved' });
  await batteriesRepo.updateBatteryReplacedBy(tx, old.id, newBattery.id);
  await batteriesRepo.insertReplacementLink(tx, { oldBatteryId: old.id, newBatteryId: newBattery.id, chainId: chain.id, replacedAt: entry.entryDate });
  await batteriesRepo.incrementChainReplacementCount(tx, chain.id, chain.replacementCount + 1);

  const claimRef = await nextFormattedRef(tx, 'CLM', 'claim', monthKey(ctx.now()));
  const claim = await claimsRepo.insertClaim(tx, { ref: claimRef, dealerId: entry.dealerId, kind: 'replacement', chainId: chain.id, oldBatteryId: old.id, newBatteryId: newBattery.id });

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
  // A sales return runs the same course as a replacement from here: the battery goes back, is
  // checked, and head office decides (client, 3 Oct 2026). It has no warranty chain and no new
  // battery — the same one comes home, working, with its serial unchanged.
  const claimRef = await nextFormattedRef(tx, 'CLM', 'claim', monthKey(ctx.now()));
  const claim = await claimsRepo.insertClaim(tx, { ref: claimRef, dealerId: entry.dealerId, kind: 'sales_return', oldBatteryId: battery.id });
  await repo.updateEntryItemLinks(tx, item.id, { batteryId: battery.id, claimId: claim.id });
  return { battery, claim };
}

export async function approve(ctx: Ctx, entryId: string, reason: string) {
  if (!ctx.user || ctx.user.scope !== 'admin') {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
  const entry = await repo.findEntryById(db, entryId);
  if (!entry) throw new AppError('entry_not_found', 404, 'Entry not found.');
  if (entry.status === 'with_distributor') throw new AppError('with_distributor', 409, 'This request is still with the dealer’s distributor. It reaches you once they approve it.');
  if (entry.status !== 'submitted') {
    throw new AppError('invalid_transition', 409, `Cannot approve an entry that is already ${entry.status}.`);
  }
  assertSpecialDecided(entry);
  const items = await repo.findItemsByEntryId(db, entryId);
  // Head office decides a replacement only once the old battery is physically at the factory
  // (client rule, 25 Sep 2026): they verify it offline, then approve or refuse.
  if (entry.entryType !== 'regular_sales') await assertBatteriesArrived(entry.entryType, items);
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

/**
 * Nothing is decided before the battery is in the company's hands.
 *
 * A replacement's OLD battery travels; a sales return sends the battery itself (client,
 * 3 Oct 2026). Either way it reaches the factory on a challan line, and that line's stage is
 * what says it is here.
 */
async function assertBatteriesArrived(
  entryType: 'replacement' | 'sales_return' | 'regular_sales',
  items: { id: string; seq: number; batteryCode: string; oldBatteryCode: string | null; claimId?: string | null }[],
) {
  const sr = entryType === 'sales_return';
  const withOld = items.filter((it) => (sr ? it.batteryCode : it.oldBatteryCode));
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
    throw new AppError('old_battery_not_arrived', 409, `The ${sr ? 'returned battery' : 'old battery'} has not reached the factory yet. Approve or refuse it from Old battery returns once it arrives.`, {
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
  if (entry.status === 'with_distributor') throw new AppError('with_distributor', 409, 'This request is still with the dealer’s distributor. It reaches you once they approve it.');
  if (entry.status !== 'submitted' && entry.status !== 'approved') {
    throw new AppError('invalid_transition', 409, `This request is already ${entry.status}.`);
  }
  assertSpecialDecided(entry);
  const items = await repo.findItemsByEntryId(db, entryId);
  // one battery of the entry, or all of them
  const target = input.itemId ? items.filter((it) => it.id === input.itemId) : items;
  if (input.itemId && !target.length) throw new AppError('item_not_found', 404, 'That battery is not on this request.');
  await assertBatteriesArrived(entry.entryType, target);

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
    // 'passed' stops here: the battery has been checked and is good, and now sits in the challan's
    // Approved group waiting for the Claim button. Approving for refund is a separate press.
    if (input.decision === 'passed') continue;
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
  if (entry.status === 'with_distributor' && ctx.user.scope === 'admin') throw new AppError('with_distributor', 409, 'This request is still with the dealer’s distributor. It reaches you once they approve it.');
  if (entry.status !== 'submitted') {
    throw new AppError('invalid_transition', 409, `Cannot reject an entry that is already ${entry.status}.`);
  }
  assertSpecialDecided(entry);
  return withTransaction(async (tx) => {
    const updated = await repo.updateEntryStatus(tx, entryId, { status: 'rejected', decidedBy: ctx.user!.id, decisionReason: reason });
    // a special request refused at the factory: the battery the customer has carries no warranty
    if (entry.specialStatus) await recordWithoutWarranty(tx, ctx, entry);
    await audit(tx, { ctx, action: 'entry.rejected', entityType: 'entry', entityId: entry.id, entityRef: entry.ref, before: { status: 'submitted' }, after: { status: 'rejected' }, reason, outcome: 'ok' });
    return updated;
  });
}

export async function getById(ctx: Ctx, id: string) {
  const user = requireDealer(ctx);
  const entry = await repo.findEntryById(db, id);
  if (!entry) throw new AppError('entry_not_found', 404, 'Entry not found.');
  // a distributor also reads his dealers' requests (client, 2 Oct 2026)
  if (user.scope === 'dealer' && !(await visibleShopIds(ctx)).has(entry.dealerId)) {
    throw new AppError('entry_not_found', 404, 'Entry not found.'); // 404 not 403 — no existence leak (I-3)
  }
  const items = await repo.findItemsByEntryId(db, id);
  return { ...forViewer(entry, user), items };
}

/**
 * Each tier knows only the party it deals with directly (client, 3 Oct 2026).
 *
 *   dealer → customer      the dealer records who they sold to
 *   distributor → dealer   the dealer's customer is the dealer's business, not the distributor's
 *   head office → distributor
 *
 * So the customer's name is stripped for everyone except the shop that wrote it. Hiding it in the
 * console would not be enough — it travels in the API response, and anyone can open a browser's
 * network tab — so it is removed here, before it leaves the server.
 */
function forViewer<T extends { dealerId: string; customerName: string | null }>(row: T, user: { scope: string; dealerId?: string | null }): T {
  const ownShop = user.scope === 'dealer' && user.dealerId === row.dealerId;
  return ownShop ? row : { ...row, customerName: null };
}

export async function list(ctx: Ctx, query: EntryListQuery) {
  const user = requireDealer(ctx);
  // a shop reads its own requests; a distributor his dealers' too (client, 2 Oct 2026)
  const page = user.scope === 'dealer'
    ? await repo.listEntries(db, { status: query.status, dealerIds: [...(await visibleShopIds(ctx))], limit: query.limit, cursor: decodeCursor(query.cursor, 'createdAt') })
    : await repo.listEntries(db, { status: query.status, dealerId: query.dealerId, limit: query.limit, cursor: decodeCursor(query.cursor, 'createdAt') });
  return { ...page, items: page.items.map((e) => forViewer(e, user)) };
}

/**
 * The dealer has handed the old battery over: the distributor marks it arrived (client, 3 Oct
 * 2026). Only for HIS dealers' replacements, only once he has approved the request, and once per
 * battery. Without `itemId` every battery still to arrive on the request is marked.
 */
export async function markArrived(ctx: Ctx, entryId: string, itemId?: string) {
  const me = await requireDistributor(ctx);
  const entry = await repo.findEntryById(db, entryId);
  const shop = entry ? await findDealerById(db, entry.dealerId) : undefined;
  if (!entry || !shop || shop.distributorId !== me.id) throw new AppError('entry_not_found', 404, 'Entry not found.'); // I-3
  // A sales return's battery is handed over the same way a replacement's old one is — the
  // dealer brings it in, the distributor marks it arrived, then it goes on the challan
  // (client, 3 Oct 2026).
  if (entry.entryType === 'regular_sales') throw new AppError('nothing_to_receive', 422, `${entry.ref} is a sale — there is no battery to receive.`);
  const sr = entry.entryType === 'sales_return';
  if (entry.status === 'with_distributor') throw new AppError('not_approved_yet', 422, `Approve ${entry.ref} first — the dealer hands the battery over after you approve it.`);
  if (entry.status === 'rejected') throw new AppError('nothing_to_receive', 422, `${entry.ref} was refused — there is nothing to receive.`);
  const items = (await repo.findItemsByEntryId(db, entryId)).filter((it) => (sr ? it.batteryCode : it.oldBatteryCode));
  const target = itemId ? items.filter((it) => it.id === itemId) : items.filter((it) => !it.distributorReceivedAt);
  if (itemId && !target.length) throw new AppError('item_not_found', 404, 'That battery is not on this request.');
  if (target.some((it) => it.distributorReceivedAt)) throw new AppError('already_arrived', 409, 'This battery is already marked as arrived.');
  if (!target.length) throw new AppError('already_arrived', 409, 'Every battery on this request has already arrived.');
  return withTransaction(async (tx) => {
    const now = ctx.now();
    const done = [];
    for (const it of target) {
      done.push(await repo.updateEntryItem(tx, it.id, { distributorReceivedAt: now, distributorReceivedBy: ctx.user!.id }));
      await audit(tx, { ctx, action: 'entry_item.arrived_at_distributor', entityType: 'entry', entityId: entry.id, entityRef: entry.ref, after: { battery: sr ? it.batteryCode : it.oldBatteryCode, distributor: me.name, dealer: shop.name }, outcome: 'ok' });
    }
    return { entryId: entry.id, ref: entry.ref, items: done };
  });
}

/**
 * The distributor's decision on a dealer's request (client, 2 Oct 2026). Approving forwards it
 * to head office, which still decides it at the factory; refusing ends it with the reason the
 * dealer sees. Approving also says the distributor has the old battery in hand — the dealer
 * gives it to him; there is no separate "received" step.
 */
export async function distributorDecide(ctx: Ctx, entryId: string, decision: 'approve' | 'refuse', reason: string) {
  const me = await requireDistributor(ctx);
  const entry = await repo.findEntryById(db, entryId);
  const shop = entry ? await findDealerById(db, entry.dealerId) : undefined;
  if (!entry || !shop || shop.distributorId !== me.id) throw new AppError('entry_not_found', 404, 'Entry not found.'); // I-3
  if (entry.status !== 'with_distributor') {
    throw new AppError('invalid_transition', 409, entry.status === 'rejected' ? 'This request was already refused.' : 'This request has already gone to head office.');
  }
  return withTransaction(async (tx) => {
    const updated = await repo.setDistributorDecision(tx, entryId, { approve: decision === 'approve', by: ctx.user!.id, reason });
    if (!updated) throw new AppError('invalid_transition', 409, 'This request was decided a moment ago. Refresh and check it.');
    // his refusal ends a special request too: it never reaches head office, and the battery the
    // customer already has carries no warranty (client, 3 Oct 2026)
    if (decision === 'refuse' && entry.specialStatus === 'pending') {
      await repo.setSpecialDecision(tx, entryId, { approve: false, by: ctx.user!.id, reason });
      await recordWithoutWarranty(tx, ctx, entry);
    }
    await audit(tx, {
      ctx, action: decision === 'approve' ? 'entry.distributor_approved' : 'entry.distributor_refused', entityType: 'entry', entityId: entry.id, entityRef: entry.ref,
      before: { status: 'with_distributor' }, after: { status: updated.status, distributor: me.name, dealer: shop.name }, reason, outcome: 'ok',
    });
    return updated;
  });
}

/**
 * Head office's decision on a SPECIAL request, taken in Correction requests after inspecting it
 * by hand (client, 3 Oct 2026). Approving opens the way: the distributor may now dispatch the old
 * battery, and the request is decided at the factory like any other — with the new battery
 * inheriting the chain's end date (grace months) or carrying no warranty (past the cover).
 * Rejecting ends it: no credit, the old battery stays where it is, and the new battery the
 * customer already has is put on record with no warranty.
 */
export async function decideSpecial(ctx: Ctx, entryId: string, decision: 'approve' | 'reject', reason: string) {
  if (!ctx.user || ctx.user.scope !== 'admin') throw new AppError('unauthenticated', 401, 'Sign in required.');
  const entry = await repo.findEntryById(db, entryId);
  if (!entry) throw new AppError('entry_not_found', 404, 'Entry not found.');
  if (!entry.specialStatus) throw new AppError('not_special', 422, `${entry.ref} is not a special replacement request.`);
  if (entry.status === 'with_distributor') throw new AppError('with_distributor', 409, 'This request is still with the dealer’s distributor. It reaches you once they approve it.');
  if (entry.specialStatus !== 'pending' || entry.status !== 'submitted') {
    throw new AppError('invalid_transition', 409, `This special request was already ${entry.specialStatus === 'pending' ? entry.status : entry.specialStatus}.`);
  }
  return withTransaction(async (tx) => {
    const updated = await repo.setSpecialDecision(tx, entryId, { approve: decision === 'approve', by: ctx.user!.id, reason });
    if (!updated) throw new AppError('invalid_transition', 409, 'This request was decided a moment ago. Refresh and check it.');
    if (decision === 'reject') await recordWithoutWarranty(tx, ctx, entry);
    await audit(tx, {
      ctx, action: decision === 'approve' ? 'entry.special_approved' : 'entry.special_rejected', entityType: 'entry', entityId: entry.id, entityRef: entry.ref,
      before: { special: 'pending' }, after: { special: updated.specialStatus }, reason, outcome: 'ok',
    });
    return updated;
  });
}


/* ---------- photos (D-10: Neon Object Storage) ---------- */

/** The request, if this caller may see it: head office any, a dealer only their own (404 otherwise, I-3). */
async function visibleEntry(ctx: Ctx, entryId: string) {
  const user = requireDealer(ctx);
  const entry = await repo.findEntryById(db, entryId);
  // the distributor reviews his dealers' photos before approving (client, 2 Oct 2026)
  if (!entry || (user.scope === 'dealer' && !(await visibleShopIds(ctx)).has(entry.dealerId))) throw new AppError('entry_not_found', 404, 'Entry not found.');
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
  // Deliberately NOT gated on the entry's status. Approving one battery of a replacement flips
  // the whole request to 'approved', and gating on that refused every other battery on it — which
  // is exactly the case this feature exists for (client, 2 Oct 2026). What matters is this
  // battery: see `correctItem`, which refuses once THIS one is on record.
  if (entry.status === 'rejected') {
    throw new AppError('invalid_transition', 409, 'This request was refused — there is nothing left to change on it.');
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
  // Once THIS battery is on record a warranty chain hangs off these codes, and rewriting them
  // would silently re-point that history at a different battery. Its siblings are unaffected.
  if (item.batteryId) {
    throw new AppError('already_on_record', 409, 'This battery has been approved and put on record — its number cannot be changed now. Void the request and record it again if the number is wrong.');
  }

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

  // An explicit choice wins over one read out of a code: head office now picks the plate and
  // model from a list and sends the digits on their own, and if the stored "as entered" value
  // happens to carry a model prefix, deriving from it would quietly undo that choice. The old
  // battery's model has always been read this way round; the new one's now matches.
  const modelId = input.modelId ?? newDerived.modelId ?? item.modelId;
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
