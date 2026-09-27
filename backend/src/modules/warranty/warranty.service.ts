import { db, withTransaction } from '../../database/client';
import { deriveCode, fullCode } from '../../domain/serials';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { monthKey, nextFormattedRef } from '../../utils/ids';
import { readSetting } from '../../utils/settings';
import * as batteriesRepo from '../batteries/batteries.repository';
import * as repo from './warranty.repository';
import type { OverrideDecisionBody, OverrideListQuery, OverrideRequestBody } from './warranty.validation';

// M-10 warranty — the V1 slice: overrides. Chains themselves are written by entries.approve
// (they are the record of a sale), and this module is the one place allowed to move a chain's
// expiry afterwards, because doing so is a goodwill decision that has to be asked for, decided
// by head office, bounded, and auditable.

const DEFAULT_MAX_DAYS = 90;

function requireUser(ctx: Ctx) {
  if (!ctx.user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  return ctx.user;
}

async function maxOverrideDays(): Promise<number> {
  const v = await readSetting<number>(db, 'warranty.override_max_days', DEFAULT_MAX_DAYS);
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_MAX_DAYS;
}

const addDays = (isoDate: string, days: number) => new Date(Date.parse(isoDate) + days * 86_400_000).toISOString().slice(0, 10);

/** The battery the dealer scanned, found by its full printed identity (D-13). */
async function findBattery(code: string, modelId?: string) {
  const modelIds = (await batteriesRepo.listModels(db)).map((m) => m.id);
  const derived = deriveCode(code, modelIds);
  if (!derived.valid) throw new AppError('format_mismatch', 422, 'Use an 8-digit code with a valid YYMM prefix.', { field: 'batteryCode' });
  const productId = derived.modelId ?? modelId;
  if (!productId) throw new AppError('model_required', 422, 'Say which model this battery is — the serial alone does not identify it.', { field: 'modelId' });
  return batteriesRepo.findBatteryByCode(db, fullCode(productId, derived.normalised));
}

/**
 * A dealer (or an admin on their behalf) asks for a battery's cover to be extended. Only a
 * battery already on record can be extended — one that was never sold through the system has
 * no chain to extend, and the entry flow puts it on record at approval instead.
 */
export async function requestOverride(ctx: Ctx, input: OverrideRequestBody) {
  const user = requireUser(ctx);
  const max = await maxOverrideDays();
  if (input.days > max) {
    throw new AppError('override_too_long', 422, `Head office can extend cover by at most ${max} days.`, { field: 'days', details: { maxDays: max } });
  }

  const battery = await findBattery(input.batteryCode, input.modelId);
  if (!battery || !battery.chainId) {
    throw new AppError('battery_not_on_record', 404, 'This battery is not on record, so its cover cannot be extended.', { field: 'batteryCode' });
  }
  if (user.scope === 'dealer' && battery.dealerId && battery.dealerId !== user.dealerId) {
    throw new AppError('custody_conflict', 409, 'This battery belongs to another dealer.', { field: 'batteryCode' });
  }
  const existing = await repo.findPendingForChain(db, battery.chainId);
  if (existing) throw new AppError('override_already_requested', 409, `${existing.ref} is already waiting for a decision on this battery.`);

  return withTransaction(async (tx) => {
    const ref = await nextFormattedRef(tx, 'OVR', 'override', monthKey(ctx.now()));
    const override = await repo.insertOverride(tx, {
      ref,
      chainId: battery.chainId!,
      batteryId: battery.id,
      dealerId: user.scope === 'dealer' ? user.dealerId! : battery.dealerId,
      days: input.days,
      reason: input.reason,
      requestedBy: user.id,
      requestedAt: ctx.now(),
    });
    await audit(tx, {
      ctx,
      action: 'warranty.override_requested',
      entityType: 'warranty_override',
      entityId: override.id,
      entityRef: override.ref,
      after: { batteryCode: battery.batteryCode, days: input.days },
      reason: input.reason,
      outcome: 'ok',
    });
    return override;
  });
}

async function loadPending(id: string) {
  const override = await repo.findOverrideById(db, id);
  if (!override) throw new AppError('override_not_found', 404, 'Override request not found.');
  if (override.status !== 'pending') {
    throw new AppError('invalid_transition', 409, `This request was already ${override.status}.`);
  }
  return override;
}

/** Approving moves the chain's expiry — the only place that happens after a sale. */
export async function approveOverride(ctx: Ctx, id: string, input: OverrideDecisionBody) {
  const user = requireUser(ctx);
  if (user.scope !== 'admin') throw new AppError('permission_denied', 403, 'You do not have permission to do this.');
  const override = await loadPending(id);
  const chain = await batteriesRepo.findChainById(db, override.chainId);
  if (!chain) throw new AppError('chain_missing', 500, 'This battery is missing its warranty record.');

  const expiryBefore = chain.warrantyExpiry;
  const expiryAfter = addDays(expiryBefore, override.days);

  return withTransaction(async (tx) => {
    await repo.extendChainExpiry(tx, chain.id, { expiryBefore, expiryAfter });
    const updated = await repo.updateOverrideDecision(tx, override.id, {
      status: 'approved',
      decidedBy: user.id,
      decisionReason: input.reason,
      decidedAt: ctx.now(),
      expiryBefore,
      expiryAfter,
    });
    await audit(tx, {
      ctx,
      action: 'warranty.override_approved',
      entityType: 'warranty_override',
      entityId: override.id,
      entityRef: override.ref,
      before: { warrantyExpiry: expiryBefore },
      after: { warrantyExpiry: expiryAfter, days: override.days },
      reason: input.reason,
      outcome: 'ok',
    });
    return updated;
  });
}

export async function rejectOverride(ctx: Ctx, id: string, input: OverrideDecisionBody) {
  const user = requireUser(ctx);
  if (user.scope !== 'admin') throw new AppError('permission_denied', 403, 'You do not have permission to do this.');
  const override = await loadPending(id);

  return withTransaction(async (tx) => {
    const updated = await repo.updateOverrideDecision(tx, override.id, {
      status: 'rejected',
      decidedBy: user.id,
      decisionReason: input.reason,
      decidedAt: ctx.now(),
    });
    await audit(tx, {
      ctx,
      action: 'warranty.override_rejected',
      entityType: 'warranty_override',
      entityId: override.id,
      entityRef: override.ref,
      reason: input.reason,
      outcome: 'ok',
    });
    return updated;
  });
}

export async function listOverrides(ctx: Ctx, query: OverrideListQuery) {
  const user = requireUser(ctx);
  const dealerId = user.scope === 'dealer' ? user.dealerId : undefined;
  return repo.listOverrides(db, { status: query.status, dealerId, limit: query.limit });
}
