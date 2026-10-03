import { db, withTransaction } from '../../database/client';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { hashPassword } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { revokeAllSessionsForUser } from '../auth/auth.repository';
import { invalidateAccountStatus } from '../users/users.service';
import { verifyVerifiedToken } from '../auth/auth.tokens';
import { findCityByName } from '../masters/masters.repository';
import * as repo from './dealers.repository';
import type { AdminDealerCreateBody, DealerAdminUpdateBody, DealerApproveBody, DealerCreateBody, DealerListQuery, DealerProfileUpdateBody, DealerReasonBody, DealerRegisterBody } from './dealers.validation';
import { findUserByMobile } from '../users/users.repository';

function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  try {
    const { createdAt, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return { createdAt: new Date(createdAt), id };
  } catch {
    throw new AppError('filter_invalid', 422, 'That page link is not valid — start from the first page again.');
  }
}

/**
 * Where a shop is, as the forms now ask for it: State, District, then the town typed by hand
 * (client, 4 Oct 2026). The town is stored exactly as typed — a shop may be anywhere in India,
 * and no list of Indian towns is small enough to keep here. If the typed name happens to be one
 * of the company's own listed cities it is linked to it as well, so the older screens that read
 * `city_id` keep working.
 */
async function placeOf(input: { city: string; district?: string }) {
  const city = await findCityByName(db, input.city);
  return { cityId: city?.id ?? null, cityName: input.city.trim(), district: input.district?.trim() || null };
}

export async function register(ctx: Ctx, input: DealerRegisterBody) {
  const claims = await verifyVerifiedToken(input.verifiedToken, 'register').catch(() => {
    throw new AppError('verified_token_invalid', 401, 'Please verify your mobile number again.');
  });
  if (claims.target !== input.mobile) {
    throw new AppError('verified_token_invalid', 401, 'The verified number does not match this form.');
  }

  const existing = await repo.findDealerByMobile(db, input.mobile);
  if (existing) {
    throw new AppError('mobile_taken', 409, 'A shop with this mobile number is already registered.', { field: 'mobile' });
  }

  const place = await placeOf(input);

  const passwordHash = await hashPassword(input.password);

  const dealer = await withTransaction(async (tx) => {
    const d = await repo.insertDealer(tx, {
      name: input.name,
      contactPerson: input.contactPerson,
      mobile: input.mobile,
      email: input.email || null,
      cityId: place.cityId, cityName: place.cityName, district: place.district,
      state: input.state,
      pin: input.pin ?? null,
      place: input.place || null,
      address: input.address,
      registeredVia: 'self',
    });
    await repo.insertDealerUser(tx, {
      dealerId: d.id,
      name: input.contactPerson,
      mobile: input.mobile,
      email: input.email || null,
      passwordHash,
    });
    await audit(tx, { ctx, action: 'dealer.registered', entityType: 'dealer', entityId: d.id, entityRef: d.name, outcome: 'ok' });
    return d;
  });

  return { id: dealer.id, name: dealer.name, status: dealer.status };
}

// No session → 401 (the client signs out on it); a signed-in admin → 403, so hitting a
// dealer-only route never logs a head-office user out.
function requireDealerUser(ctx: Ctx): asserts ctx is Ctx & { user: { dealerId: string } } {
  if (!ctx.user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  if (ctx.user.scope !== 'dealer' || !ctx.user.dealerId) {
    throw new AppError('dealer_only', 403, 'Only a dealer account can do this.');
  }
}

export async function getMe(ctx: Ctx) {
  requireDealerUser(ctx);
  const dealer = await repo.findDealerById(db, ctx.user.dealerId);
  if (!dealer) {
    throw new AppError('dealer_not_found', 404, 'Shop not found.');
  }
  return dealer;
}

export async function updateMe(ctx: Ctx, input: DealerProfileUpdateBody) {
  requireDealerUser(ctx);
  const dealerId = ctx.user.dealerId;
  const before = await repo.findDealerById(db, dealerId);
  if (!before) throw new AppError('dealer_not_found', 404, 'Shop not found.');

  return withTransaction(async (tx) => {
    const after = await repo.updateDealerProfile(tx, dealerId, {
      contactPerson: input.contactPerson,
      email: input.email === '' ? null : input.email,
      address: input.address,
      place: input.place,
    });
    await audit(tx, { ctx, action: 'dealer.updated', entityType: 'dealer', entityId: dealerId, entityRef: before.name, before, after, outcome: 'ok' });
    return after;
  });
}

// --- admin lifecycle (architecture.md §9.9) ---------------------------------

async function requireAdminActor(ctx: Ctx) {
  if (!ctx.user || ctx.user.scope !== 'admin') {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
  return ctx.user;
}

export async function approve(ctx: Ctx, dealerId: string, input: DealerApproveBody) {
  const actor = await requireAdminActor(ctx);
  const dealer = await repo.findDealerById(db, dealerId);
  if (!dealer) throw new AppError('dealer_not_found', 404, 'Dealer not found.');
  // architecture.md §9.9 — pending_approval -> active | rejected; rejected -> active (reconsidered).
  if (dealer.status !== 'pending_approval' && dealer.status !== 'rejected') {
    throw new AppError('invalid_transition', 409, `Cannot approve a dealer that is already ${dealer.status}.`);
  }
  if (dealer.dealerCode) {
    throw new AppError('dealer_code_immutable', 409, 'This dealer already has a code.');
  }
  const codeOwner = await repo.findDealerByCode(db, input.dealerCode);
  if (codeOwner && codeOwner.id !== dealerId) {
    throw new AppError('dealer_code_taken', 409, 'This dealer code is already in use.', { field: 'dealerCode' });
  }

  return withTransaction(async (tx) => {
    const before = { status: dealer.status, dealerCode: dealer.dealerCode };
    const after = await repo.updateDealerStatus(tx, dealerId, { status: 'active', dealerCode: input.dealerCode, statusReason: input.reason, statusChangedBy: actor.id });
    invalidateAccountStatus(); // dealer status is part of every request's account check (users.service)
    await audit(tx, { ctx, action: 'dealer.approved', entityType: 'dealer', entityId: dealerId, entityRef: input.dealerCode, before, after: { status: 'active', dealerCode: input.dealerCode }, reason: input.reason, outcome: 'ok' });
    return after;
  });
}

export async function reject(ctx: Ctx, dealerId: string, input: DealerReasonBody) {
  const actor = await requireAdminActor(ctx);
  const dealer = await repo.findDealerById(db, dealerId);
  if (!dealer) throw new AppError('dealer_not_found', 404, 'Dealer not found.');
  if (dealer.status !== 'pending_approval') {
    throw new AppError('invalid_transition', 409, `Cannot reject a dealer that is ${dealer.status}.`);
  }

  return withTransaction(async (tx) => {
    const before = { status: dealer.status };
    const after = await repo.updateDealerStatus(tx, dealerId, { status: 'rejected', statusReason: input.reason, statusChangedBy: actor.id });
    invalidateAccountStatus(); // dealer status is part of every request's account check (users.service)
    await audit(tx, { ctx, action: 'dealer.rejected', entityType: 'dealer', entityId: dealerId, entityRef: dealer.name, before, after: { status: 'rejected' }, reason: input.reason, outcome: 'ok' });
    return after;
  });
}

export async function suspend(ctx: Ctx, dealerId: string, input: DealerReasonBody) {
  const actor = await requireAdminActor(ctx);
  const dealer = await repo.findDealerById(db, dealerId);
  if (!dealer) throw new AppError('dealer_not_found', 404, 'Dealer not found.');
  if (dealer.status !== 'active') {
    throw new AppError('invalid_transition', 409, `Cannot suspend a dealer that is ${dealer.status}.`);
  }

  return withTransaction(async (tx) => {
    const before = { status: dealer.status };
    const after = await repo.updateDealerStatus(tx, dealerId, { status: 'suspended', statusReason: input.reason, statusChangedBy: actor.id });
    invalidateAccountStatus(); // dealer status is part of every request's account check (users.service)
    // I-8 wants status checked on every request; until the accountStatus plugin exists,
    // revoking sessions now gives suspension immediate effect instead of waiting for token expiry.
    const dealerUsers = await repo.findUsersByDealerId(tx, dealerId);
    for (const u of dealerUsers) await revokeAllSessionsForUser(tx, u.id, 'dealer_suspended');
    await audit(tx, { ctx, action: 'dealer.suspended', entityType: 'dealer', entityId: dealerId, entityRef: dealer.name, before, after: { status: 'suspended' }, reason: input.reason, outcome: 'ok' });
    return after;
  });
}

export async function activate(ctx: Ctx, dealerId: string, input: DealerReasonBody) {
  const actor = await requireAdminActor(ctx);
  const dealer = await repo.findDealerById(db, dealerId);
  if (!dealer) throw new AppError('dealer_not_found', 404, 'Dealer not found.');
  if (dealer.status !== 'suspended') {
    throw new AppError('invalid_transition', 409, `Cannot activate a dealer that is ${dealer.status}.`);
  }

  return withTransaction(async (tx) => {
    const before = { status: dealer.status };
    const after = await repo.updateDealerStatus(tx, dealerId, { status: 'active', statusReason: input.reason, statusChangedBy: actor.id });
    invalidateAccountStatus(); // dealer status is part of every request's account check (users.service)
    await audit(tx, { ctx, action: 'dealer.activated', entityType: 'dealer', entityId: dealerId, entityRef: dealer.name, before, after: { status: 'active' }, reason: input.reason, outcome: 'ok' });
    return after;
  });
}

export async function list(ctx: Ctx, query: DealerListQuery) {
  await requireAdminActor(ctx);
  const { items, nextCursor } = await repo.listDealers(db, { status: query.status, limit: query.limit, cursor: decodeCursor(query.cursor) });
  return { items, nextCursor };
}

export async function getById(ctx: Ctx, dealerId: string) {
  await requireAdminActor(ctx);
  const dealer = await repo.findDealerById(db, dealerId);
  if (!dealer) throw new AppError('dealer_not_found', 404, 'Dealer not found.');
  return dealer;
}

// --- a distributor's own dealers (client, 2 Oct 2026) ------------------------
// Head office → distributor → dealer. A distributor adds the dealers under him from the app;
// they are active at once and sign in with their mobile number and the SMS code.

/** The signed-in user's shop, which must be an active distributor. */
export async function requireDistributor(ctx: Ctx) {
  requireDealerUser(ctx);
  const shop = await repo.findDealerById(db, ctx.user.dealerId);
  if (!shop || shop.kind !== 'distributor') throw new AppError('distributor_only', 403, 'Only a distributor can do this.');
  return shop;
}

export async function listMyDealers(ctx: Ctx) {
  const me = await requireDistributor(ctx);
  return { items: await repo.findDealersByDistributor(db, me.id) };
}

export async function createMyDealer(ctx: Ctx, input: DealerCreateBody) {
  const me = await requireDistributor(ctx);
  if (await repo.findDealerByMobile(db, input.mobile) || await findUserByMobile(db, input.mobile)) {
    throw new AppError('mobile_taken', 409, 'This mobile number already has an account.', { field: 'mobile' });
  }
  const place = await placeOf(input);
  return withTransaction(async (tx) => {
    const d = await repo.insertDealer(tx, {
      name: input.name, contactPerson: input.contactPerson, mobile: input.mobile, email: input.email || null,
      cityId: place.cityId, cityName: place.cityName, district: place.district, state: input.state, pin: input.pin ?? null, place: input.place || null, address: input.address,
      registeredVia: 'distributor', kind: 'dealer', distributorId: me.id, status: 'active',
    });
    await repo.insertDealerUser(tx, { dealerId: d.id, name: input.contactPerson, mobile: input.mobile, email: input.email || null, passwordHash: null });
    await audit(tx, { ctx, action: 'dealer.created_by_distributor', entityType: 'dealer', entityId: d.id, entityRef: d.name, after: { kind: 'dealer', distributorId: me.id, distributor: me.name }, outcome: 'ok' });
    return d;
  });
}

/** Suspend or re-activate one of MY dealers. Suspending signs them out at once. */
export async function setMyDealerStatus(ctx: Ctx, dealerId: string, to: 'suspended' | 'active', input: DealerReasonBody) {
  const me = await requireDistributor(ctx);
  const dealer = await repo.findDealerById(db, dealerId);
  if (!dealer || dealer.distributorId !== me.id) throw new AppError('dealer_not_found', 404, 'Dealer not found.'); // I-3: no existence leak
  const from = to === 'suspended' ? 'active' : 'suspended';
  if (dealer.status !== from) throw new AppError('invalid_transition', 409, `This dealer is already ${dealer.status}.`);

  return withTransaction(async (tx) => {
    const after = await repo.updateDealerStatus(tx, dealerId, { status: to, statusReason: input.reason, statusChangedBy: ctx.user!.id });
    invalidateAccountStatus();
    if (to === 'suspended') for (const u of await repo.findUsersByDealerId(tx, dealerId)) await revokeAllSessionsForUser(tx, u.id, 'dealer_suspended');
    await audit(tx, { ctx, action: to === 'suspended' ? 'dealer.suspended' : 'dealer.activated', entityType: 'dealer', entityId: dealerId, entityRef: dealer.name, before: { status: dealer.status }, after: { status: to }, reason: input.reason, outcome: 'ok' });
    return after;
  });
}

// --- head office adds and moves dealers (client, 3 Oct 2026) -----------------
// The same two powers a distributor has over his own dealers, except head office says which
// distributor the dealer belongs under instead of it being himself.

/** The shop must exist and be an active distributor for a dealer to be put under it. */
async function requireDistributorShop(id: string) {
  const shop = await repo.findDealerById(db, id);
  if (!shop || shop.kind !== 'distributor') {
    throw new AppError('distributor_not_found', 422, 'Choose a distributor from the list.', { field: 'distributorId' });
  }
  if (shop.status !== 'active') {
    throw new AppError('distributor_inactive', 422, `${shop.name} is ${shop.status.replace('_', ' ')} — a dealer cannot be put under it.`, { field: 'distributorId' });
  }
  return shop;
}

/** Head office adds a dealer under the distributor it names. Active at once, like a distributor's. */
export async function createDealerForDistributor(ctx: Ctx, input: AdminDealerCreateBody) {
  await requireAdminActor(ctx);
  const distributor = await requireDistributorShop(input.distributorId);
  if (await repo.findDealerByMobile(db, input.mobile) || await findUserByMobile(db, input.mobile)) {
    throw new AppError('mobile_taken', 409, 'This mobile number already has an account.', { field: 'mobile' });
  }
  const place = await placeOf(input);
  return withTransaction(async (tx) => {
    const d = await repo.insertDealer(tx, {
      name: input.name, contactPerson: input.contactPerson, mobile: input.mobile, email: input.email || null,
      cityId: place.cityId, cityName: place.cityName, district: place.district, state: input.state, pin: null, place: input.place || null, address: input.address,
      registeredVia: 'admin', kind: 'dealer', distributorId: distributor.id, status: 'active',
    });
    await repo.insertDealerUser(tx, { dealerId: d.id, name: input.contactPerson, mobile: input.mobile, email: input.email || null, passwordHash: null });
    await audit(tx, { ctx, action: 'dealer.created_by_admin', entityType: 'dealer', entityId: d.id, entityRef: d.name, after: { kind: 'dealer', distributorId: distributor.id, distributor: distributor.name }, outcome: 'ok' });
    return d;
  });
}

/**
 * Head office correcting a shop's record (client, 4 Oct 2026).
 *
 * One call for the whole edit, including which distributor a dealer sits under — a shop changes
 * its number, moves road, or an area passes to another distributor, and all of it is the same
 * act of putting the record right. Only the fields that actually changed are written, and the
 * before and after of each go into the audit log with the reason.
 *
 * Nothing the shop has already recorded moves or is rewritten: its requests, batteries and
 * history stay exactly where they are.
 */
export async function updateDealer(ctx: Ctx, dealerId: string, input: DealerAdminUpdateBody) {
  await requireAdminActor(ctx);
  const dealer = await repo.findDealerById(db, dealerId);
  if (!dealer) throw new AppError('dealer_not_found', 404, 'Dealer not found.');

  const set: repo.DealerProfileUpdate = {};
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  const change = <K extends keyof repo.DealerProfileUpdate>(key: K, was: unknown, now: repo.DealerProfileUpdate[K]) => {
    if (now === undefined || now === was) return;
    set[key] = now; before[key] = was; after[key] = now;
  };

  change('name', dealer.name, input.name);
  change('contactPerson', dealer.contactPerson, input.contactPerson);
  change('state', dealer.state, input.state);
  change('address', dealer.address, input.address);
  change('place', dealer.place, input.place === undefined ? undefined : input.place || null);
  change('email', dealer.email, input.email === undefined ? undefined : input.email || null);

  // the mobile number is how the shop signs in, so it may not land on another account
  if (input.mobile !== undefined && input.mobile !== dealer.mobile) {
    if (await repo.findDealerByMobile(db, input.mobile) || await findUserByMobile(db, input.mobile)) {
      throw new AppError('mobile_taken', 409, 'This mobile number already has an account.', { field: 'mobile' });
    }
    change('mobile', dealer.mobile, input.mobile);
  }

  if (input.city !== undefined) {
    const place = await placeOf({ city: input.city, district: input.district });
    change('cityId', dealer.cityId, place.cityId);
    change('cityName', dealer.cityName, place.cityName);
  }
  if (input.district !== undefined) {
    change('district', dealer.district, input.district.trim() || null);
  }

  // moving a dealer under another distributor: only a dealer sits under one, and only an active
  // distributor may take it
  let moved: { from: string | null; to: string } | null = null;
  if (input.distributorId !== undefined && input.distributorId !== dealer.distributorId) {
    if (dealer.kind !== 'dealer') throw new AppError('not_a_dealer', 409, 'Only a dealer sits under a distributor.');
    const to = await requireDistributorShop(input.distributorId);
    const from = dealer.distributorId ? await repo.findDealerById(db, dealer.distributorId) : null;
    change('distributorId', dealer.distributorId, to.id);
    moved = { from: from?.name ?? null, to: to.name };
  }

  if (!Object.keys(set).length) throw new AppError('nothing_to_change', 409, 'Nothing was changed.');

  return withTransaction(async (tx) => {
    const row = await repo.updateDealerProfile(tx, dealerId, set);
    // a changed mobile number signs the shop out: the next sign-in uses the new one
    if (set.mobile) {
      invalidateAccountStatus();
      for (const u of await repo.findUsersByDealerId(tx, dealerId)) await revokeAllSessionsForUser(tx, u.id, 'dealer_updated');
    }
    await audit(tx, {
      ctx, action: 'dealer.updated', entityType: 'dealer', entityId: dealerId, entityRef: dealer.name,
      before: moved ? { ...before, distributor: moved.from } : before,
      after: moved ? { ...after, distributor: moved.to } : after,
      reason: input.reason, outcome: 'ok',
    });
    return row;
  });
}

/**
 * The shops whose requests this signed-in shop may read: a distributor his own and his
 * dealers', a dealer only its own. Never throws for a dealer, unlike distributorShopIds.
 */
export async function visibleShopIds(ctx: Ctx) {
  requireDealerUser(ctx);
  const shop = await repo.findDealerById(db, ctx.user.dealerId);
  if (!shop || shop.kind !== 'distributor') return new Set([ctx.user.dealerId]);
  const mine = await repo.findDealersByDistributor(db, shop.id);
  return new Set([shop.id, ...mine.map((d) => d.id)]);
}

/**
 * The shops a distributor acts for: his own and every dealer under him. Old batteries from
 * any of them leave on his challan (dealers hand theirs over by hand and cannot dispatch).
 */
export async function distributorShopIds(ctx: Ctx) {
  const me = await requireDistributor(ctx);
  const mine = await repo.findDealersByDistributor(db, me.id);
  return new Set([me.id, ...mine.map((d) => d.id)]);
}
