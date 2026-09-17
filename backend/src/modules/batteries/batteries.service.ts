import { withTransaction, db } from '../../database/client';
import { deriveCode } from '../../domain/serials';
import { checkWarranty, expiryFrom } from '../../domain/warranty';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import * as repo from './batteries.repository';
import type { BatteryListQuery, BatteryReplaceBody, BatterySaleBody } from './batteries.validation';

const DEFAULT_WARRANTY_MONTHS = 24;

function todayIso(ctx: Ctx): string {
  return ctx.now().toISOString().slice(0, 10);
}

function coverFromChain(chain: { warrantyStart: string; warrantyExpiry: string }, today: string) {
  const daysRemaining = Math.ceil((Date.parse(chain.warrantyExpiry) - Date.parse(today)) / 86_400_000);
  return { mfgMonth: null, expiryDate: chain.warrantyExpiry, inWarranty: daysRemaining >= 0, daysRemaining, warrantyStart: chain.warrantyStart };
}

// architecture.md §9.9 batteries.lookup — capture-time lookup. Never reveals which OTHER
// dealer holds a battery to a dealer caller (I-3); an admin caller sees the real custodian.
// memory.md D-03 (closed 2026-09-17): a battery that's part of a chain is covered by the
// CHAIN's original start date, never its own manufacture date — the mfg-month rule below
// only ever applies to a battery that has never been sold/replaced through the system.
export async function lookup(ctx: Ctx, code: string) {
  if (!ctx.user) {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }

  const derived = deriveCode(code);
  if (!derived.valid) {
    throw new AppError('format_mismatch', 422, 'Use an 8-digit code with a valid YYMM prefix.', { field: 'code' });
  }

  const battery = await repo.findBatteryByCode(db, derived.normalised);

  if (!battery) {
    // Not on record yet — still useful: shows what warranty WOULD be if this code is used
    // for a brand-new sale (chain doesn't exist yet, so this is the mfg-month preview).
    const cover = checkWarranty(derived.mfgMonth!, todayIso(ctx), DEFAULT_WARRANTY_MONTHS);
    return { found: false as const, mfgMonth: derived.mfgMonth, serialNo: derived.serialNo, model: null, custody: null, cover };
  }

  const model = await repo.findModelById(db, battery.modelId);
  const chain = battery.chainId ? await repo.findChainById(db, battery.chainId) : undefined;
  const cover = chain ? coverFromChain(chain, todayIso(ctx)) : checkWarranty(battery.mfgMonth ?? derived.mfgMonth!, todayIso(ctx), model?.warrantyMonths ?? DEFAULT_WARRANTY_MONTHS);

  // custody never names which OTHER dealer holds it — 'other' is as specific as a dealer
  // caller gets. An admin caller additionally gets the real dealerId via `battery.dealerId`
  // below, so admins aren't limited by this string, only dealers are.
  const isOwnDealer = ctx.user.scope === 'dealer' && battery.dealerId === ctx.user.dealerId;
  const custody: 'yours' | 'other' | 'customer' | 'company' | 'transit' =
    battery.custodian === 'dealer' ? (isOwnDealer ? 'yours' : 'other') : battery.custodian;

  return {
    found: true as const,
    battery: {
      id: battery.id,
      batteryCode: battery.batteryCode,
      serialNo: battery.serialNo,
      state: battery.state,
      dealerId: ctx.user.scope === 'admin' ? battery.dealerId : custody === 'yours' ? battery.dealerId : null,
    },
    model: model ? { id: model.id, type: model.type, capacity: model.capacity, warrantyMonths: model.warrantyMonths } : null,
    custody,
    cover,
  };
}

export async function list(ctx: Ctx, query: BatteryListQuery) {
  if (!ctx.user) {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
  // dealer-scoped rule (rules.md §7.4): a dealer caller only ever sees their own batteries,
  // regardless of what's in the query — the scope always comes from the token.
  const dealerId = ctx.user.scope === 'dealer' ? ctx.user.dealerId : undefined;
  return repo.listBatteries(db, { state: query.state, dealerId, limit: query.limit, cursor: decodeCursor(query.cursor) });
}

// --- temporary stand-ins for entries.create, until the entries module exists ------------
// (memory.md log, 2026-09-17). The chain data model these write to is the real, permanent
// one — only the "how a sale/replacement gets recorded" path is a placeholder.

export async function recordSale(ctx: Ctx, input: BatterySaleBody) {
  if (!ctx.user) {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
  const derived = deriveCode(input.code);
  if (!derived.valid) {
    throw new AppError('format_mismatch', 422, 'Use an 8-digit code with a valid YYMM prefix.', { field: 'code' });
  }
  const existing = await repo.findBatteryByCode(db, derived.normalised);
  if (existing) {
    throw new AppError('duplicate_serial', 409, 'This battery code is already registered.', { field: 'code' });
  }
  const model = await repo.findModelById(db, input.modelId);
  if (!model) {
    throw new AppError('model_inactive', 422, 'Choose a valid model.', { field: 'modelId' });
  }

  const saleDate = input.saleDate ?? todayIso(ctx);
  const warrantyExpiry = expiryFrom(saleDate, model.warrantyMonths);

  return withTransaction(async (tx) => {
    const battery = await repo.insertBattery(tx, {
      batteryCode: derived.normalised,
      batteryCodeEntered: input.code,
      serialNo: derived.serialNo,
      modelId: model.id,
      mfgMonth: derived.mfgMonth,
      state: 'sold',
      custodian: 'customer',
      dealerId: ctx.user!.scope === 'dealer' ? (ctx.user!.dealerId ?? null) : null,
      origin: 'entry',
    });
    const chain = await repo.insertChain(tx, { rootBatteryId: battery.id, warrantyStart: saleDate, warrantyExpiry, termMonths: model.warrantyMonths });
    const updated = await repo.updateBatteryChainId(tx, battery.id, chain.id);
    await audit(tx, { ctx, action: 'battery.sold', entityType: 'battery', entityId: battery.id, entityRef: battery.batteryCode, outcome: 'ok' });
    return { battery: updated, chain };
  });
}

export async function recordReplacement(ctx: Ctx, input: BatteryReplaceBody) {
  if (!ctx.user) {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }

  const old = await repo.findBatteryByCode(db, deriveCode(input.oldCode).normalised);
  if (!old || !old.chainId) {
    throw new AppError('old_not_on_record', 422, 'This old battery is not on record — its warranty cannot be verified.', { field: 'oldCode' });
  }
  if (old.custodian === 'dealer' && ctx.user.scope === 'dealer' && old.dealerId !== ctx.user.dealerId) {
    throw new AppError('custody_conflict', 409, 'This old battery belongs to another dealer.', { field: 'oldCode' });
  }
  if (old.replacedById) {
    throw new AppError('already_replaced', 409, 'This battery has already been replaced. Use the current battery in the chain.', { field: 'oldCode' });
  }

  const chain = await repo.findChainById(db, old.chainId);
  if (!chain) {
    throw new AppError('chain_missing', 500, 'This battery is missing its warranty record.');
  }
  const replacementDate = input.replacementDate ?? todayIso(ctx);
  if (Date.parse(chain.warrantyExpiry) < Date.parse(replacementDate)) {
    throw new AppError('warranty_expired', 422, `Warranty expired on ${chain.warrantyExpiry}. Request an admin override before submitting.`, {
      field: 'oldCode',
      details: { warrantyStart: chain.warrantyStart, warrantyExpiry: chain.warrantyExpiry },
    });
  }

  const derivedNew = deriveCode(input.newCode);
  if (!derivedNew.valid) {
    throw new AppError('format_mismatch', 422, 'Use an 8-digit code with a valid YYMM prefix.', { field: 'newCode' });
  }
  if (derivedNew.normalised === old.batteryCode) {
    throw new AppError('old_equals_new', 422, 'Old and new batteries must be different.', { field: 'newCode' });
  }
  const existingNew = await repo.findBatteryByCode(db, derivedNew.normalised);
  if (existingNew) {
    throw new AppError('duplicate_serial', 409, 'This new battery code is already registered.', { field: 'newCode' });
  }
  const newModel = await repo.findModelById(db, input.newModelId);
  if (!newModel) {
    throw new AppError('model_inactive', 422, 'Choose a valid model.', { field: 'newModelId' });
  }

  return withTransaction(async (tx) => {
    const newBattery = await repo.insertBattery(tx, {
      batteryCode: derivedNew.normalised,
      batteryCodeEntered: input.newCode,
      serialNo: derivedNew.serialNo,
      modelId: newModel.id,
      mfgMonth: derivedNew.mfgMonth,
      state: 'replacement',
      custodian: 'customer',
      dealerId: ctx.user!.scope === 'dealer' ? (ctx.user!.dealerId ?? null) : old.dealerId,
      origin: 'entry',
      chainId: chain.id, // inherits the SAME chain — warranty never restarts (I-1)
      replacedFromId: old.id,
    });
    await repo.updateBatteryAfterReplacement(tx, old.id, newBattery.id);
    await repo.insertReplacementLink(tx, { oldBatteryId: old.id, newBatteryId: newBattery.id, chainId: chain.id, replacedAt: replacementDate });
    const updatedChain = await repo.incrementChainReplacementCount(tx, chain.id, chain.replacementCount + 1);
    await audit(tx, {
      ctx,
      action: 'battery.replaced',
      entityType: 'battery',
      entityId: newBattery.id,
      entityRef: newBattery.batteryCode,
      before: { oldBatteryCode: old.batteryCode },
      after: { newBatteryCode: newBattery.batteryCode, chainId: chain.id },
      outcome: 'ok',
    });
    return { battery: newBattery, chain: updatedChain };
  });
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
