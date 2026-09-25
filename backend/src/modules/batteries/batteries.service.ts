import { db } from '../../database/client';
import { deriveCode, fullCode } from '../../domain/serials';
import { checkWarranty } from '../../domain/warranty';
import { graceMonths } from '../../utils/settings';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import * as repo from './batteries.repository';
import type { BatteryListQuery } from './batteries.validation';

const DEFAULT_WARRANTY_MONTHS = 24;

function todayIso(ctx: Ctx): string {
  return ctx.now().toISOString().slice(0, 10);
}

function coverFromChain(chain: { warrantyStart: string; warrantyExpiry: string; termMonths: number }, mfgMonth: string | null, today: string, grace: number) {
  const daysRemaining = Math.ceil((Date.parse(chain.warrantyExpiry) - Date.parse(today)) / 86_400_000);
  return { mfgMonth, startDate: chain.warrantyStart, expiryDate: chain.warrantyExpiry, inWarranty: daysRemaining >= 0, daysRemaining, warrantyStart: chain.warrantyStart, termMonths: Math.max(0, chain.termMonths - grace), graceMonths: grace };
}

// architecture.md §9.9 batteries.lookup — capture-time lookup. Never reveals which OTHER
// dealer holds a battery to a dealer caller (I-3); an admin caller sees the real custodian.
// memory.md D-03 (closed 2026-09-17): a battery that's part of a chain is covered by the
// CHAIN's original start date, never its own manufacture date — the mfg-month rule below
// only ever applies to a battery that has never been sold/replaced through the system.
//
// The dealer's old-battery screen (d11) shows everything this returns: manufacture month
// (from the code's YYMM), model/type/capacity, the date it was bought (the chain's start),
// when it was itself installed as a replacement, how many replacements the chain has had,
// its current state, and the cover dates.
export async function lookup(ctx: Ctx, code: string, modelIdHint?: string) {
  if (!ctx.user) {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }

  const modelIds = (await repo.listModels(db)).map((m) => m.id);
  const derived = deriveCode(code, modelIds);
  if (!derived.valid) {
    throw new AppError('format_mismatch', 422, 'Use an 8-digit code with a valid YYMM prefix.', { field: 'code' });
  }

  // The product is half of the battery's identity, so a lookup needs it: from the label's own
  // prefix, else from the plates + model the dealer chose.
  const productId = derived.modelId ?? modelIdHint ?? null;
  const [battery, grace] = await Promise.all([
    productId ? repo.findBatteryByCode(db, fullCode(productId, derived.normalised)) : undefined,
    graceMonths(db),
  ]);

  if (!battery) {
    // Not on record under this product. Since D-11 the cover is still knowable from the label
    // alone — manufacture month + the product's term + grace.
    const hinted = productId ? await repo.findModelById(db, productId) : undefined;
    const cover = checkWarranty(derived.mfgMonth!, todayIso(ctx), hinted?.warrantyMonths ?? DEFAULT_WARRANTY_MONTHS, grace);
    // These same digits may belong to a battery of a DIFFERENT product — the serial repeats
    // across products — so say so rather than silently treating this as a new battery.
    const sameDigits = await repo.findBatteriesByDigits(db, derived.normalised);
    return {
      found: false as const,
      mfgMonth: derived.mfgMonth,
      serialNo: derived.serialNo,
      labelModelId: derived.modelId, // what the printed label says, if it carried a prefix
      model: hinted ? { id: hinted.id, plate: hinted.plate, modelNo: hinted.modelNo, family: hinted.family, type: hinted.type, capacity: hinted.capacity, warrantyMonths: hinted.warrantyMonths, brand: hinted.brand } : null,
      otherProductsWithTheseDigits: sameDigits.filter((b) => b.modelId !== productId).map((b) => b.modelId),
      custody: null,
      chain: null,
      cover,
    };
  }

  const mfgMonth = battery.mfgMonth ?? derived.mfgMonth;
  const [model, chain, link] = await Promise.all([
    repo.findModelById(db, battery.modelId),
    battery.chainId ? repo.findChainById(db, battery.chainId) : undefined,
    battery.replacedFromId ? repo.findReplacementLinkByNewBatteryId(db, battery.id) : undefined,
  ]);
  const cover = chain ? coverFromChain(chain, mfgMonth, todayIso(ctx), grace) : checkWarranty(mfgMonth!, todayIso(ctx), model?.warrantyMonths ?? DEFAULT_WARRANTY_MONTHS, grace);

  // custody never names which OTHER dealer holds it — 'other' is as specific as a dealer
  // caller gets. An admin caller additionally gets the real dealerId via `battery.dealerId`
  // below, so admins aren't limited by this string, only dealers are.
  const isOwnDealer = ctx.user.scope === 'dealer' && battery.dealerId === ctx.user.dealerId;
  const custody: 'yours' | 'other' | 'customer' | 'company' | 'transit' =
    battery.custodian === 'dealer' ? (isOwnDealer ? 'yours' : 'other') : battery.custodian;

  return {
    found: true as const,
    mfgMonth,
    serialNo: battery.serialNo,
    battery: {
      id: battery.id,
      batteryCode: battery.batteryCode,
      serialNo: battery.serialNo,
      mfgMonth,
      state: battery.state,
      notOnRecord: battery.notOnRecord,
      // true once entries.approve has replaced this battery — it cannot be replaced again
      alreadyReplaced: battery.replacedById !== null,
      // true when this battery was itself handed over as a replacement (not the original sale)
      isReplacement: battery.replacedFromId !== null,
      dealerId: ctx.user.scope === 'admin' ? battery.dealerId : custody === 'yours' ? battery.dealerId : null,
    },
    labelModelId: derived.modelId,
    model: model ? { id: model.id, plate: model.plate, modelNo: model.modelNo, family: model.family, type: model.type, capacity: model.capacity, warrantyMonths: model.warrantyMonths, brand: model.brand } : null,
    otherProductsWithTheseDigits: [] as string[],
    chain: chain
      ? {
          id: chain.id,
          purchaseDate: chain.warrantyStart, // the original sale — every battery in the chain shares it (D-03)
          warrantyExpiry: chain.warrantyExpiry,
          termMonths: chain.termMonths,
          replacementCount: chain.replacementCount,
          isOriginal: chain.rootBatteryId === battery.id,
          installedOn: link?.replacedAt ?? null, // when THIS battery was handed over as a replacement
        }
      : null,
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
