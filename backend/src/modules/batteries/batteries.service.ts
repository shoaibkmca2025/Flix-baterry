import { db } from '../../database/client';
import { deriveCode } from '../../domain/serials';
import { checkWarranty } from '../../domain/warranty';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import * as repo from './batteries.repository';
import type { BatteryListQuery } from './batteries.validation';

const DEFAULT_WARRANTY_MONTHS = 24;

function todayIso(ctx: Ctx): string {
  return ctx.now().toISOString().slice(0, 10);
}

// architecture.md §9.9 batteries.lookup — capture-time lookup. Never reveals which OTHER
// dealer holds a battery to a dealer caller (I-3); an admin caller sees the real custodian.
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
    // Not on record yet — still useful: shows what warranty WOULD be if this code is used.
    const cover = checkWarranty(derived.mfgMonth!, todayIso(ctx), DEFAULT_WARRANTY_MONTHS);
    return { found: false as const, mfgMonth: derived.mfgMonth, serialNo: derived.serialNo, model: null, custody: null, cover };
  }

  const model = await repo.findModelById(db, battery.modelId);
  const cover = checkWarranty(battery.mfgMonth ?? derived.mfgMonth!, todayIso(ctx), model?.warrantyMonths ?? DEFAULT_WARRANTY_MONTHS);

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

function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  try {
    const { createdAt, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return { createdAt: new Date(createdAt), id };
  } catch {
    throw new AppError('filter_invalid', 422, 'That page link is not valid — start from the first page again.');
  }
}
