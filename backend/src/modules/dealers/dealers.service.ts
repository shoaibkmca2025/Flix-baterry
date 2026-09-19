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
import type { DealerApproveBody, DealerListQuery, DealerProfileUpdateBody, DealerReasonBody, DealerRegisterBody } from './dealers.validation';

function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  try {
    const { createdAt, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return { createdAt: new Date(createdAt), id };
  } catch {
    throw new AppError('filter_invalid', 422, 'That page link is not valid — start from the first page again.');
  }
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

  const city = await findCityByName(db, input.city);
  if (!city) {
    throw new AppError('city_invalid', 422, 'Choose a city from the list.', { field: 'city' });
  }

  const passwordHash = await hashPassword(input.password);

  const dealer = await withTransaction(async (tx) => {
    const d = await repo.insertDealer(tx, {
      name: input.name,
      contactPerson: input.contactPerson,
      mobile: input.mobile,
      email: input.email || null,
      cityId: city.id,
      state: input.state,
      pin: input.pin,
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

export async function getMe(ctx: Ctx) {
  if (!ctx.user || ctx.user.scope !== 'dealer' || !ctx.user.dealerId) {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
  const dealer = await repo.findDealerById(db, ctx.user.dealerId);
  if (!dealer) {
    throw new AppError('dealer_not_found', 404, 'Shop not found.');
  }
  return dealer;
}

export async function updateMe(ctx: Ctx, input: DealerProfileUpdateBody) {
  if (!ctx.user || ctx.user.scope !== 'dealer' || !ctx.user.dealerId) {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
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
