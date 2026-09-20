import { db, withTransaction, type Tx } from '../../database/client';
import { canTransition, type BatteryState, type Custodian } from '../../domain/stock';
import { deriveCode } from '../../domain/serials';
import type { batteries } from '../../models/batteries.model';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import * as batteriesRepo from '../batteries/batteries.repository';
import * as repo from './stock.repository';
import type { StockMovementListQuery, StockMovementPostBody, StockPositionsQuery } from './stock.validation';

// M-11 stock — the movement ledger (modules.md). Every change to a battery's state or custody
// is a movement posted here: entries.approve, claims (dispatch/receive/inspection) and the
// admin "post a movement" screen all call postMovementInTx, which validates the transition
// against the battery's CURRENT row, appends the ledger row and applies it to batteries in
// the same transaction. Thresholds/low-stock alerts are deferred (not in the V1 flow).

type Battery = typeof batteries.$inferSelect;

export type MovementInput = {
  battery: Pick<Battery, 'id' | 'state' | 'custodian' | 'dealerId'> | null; // null = created by this movement
  batteryId?: string; // required when battery is null
  toState: BatteryState;
  toCustodian: Custodian;
  toDealerId?: string | null; // undefined = keep the battery's current dealer
  entryId?: string;
  claimId?: string;
  reasonCode: 'entry_approved' | 'claim_dispatched' | 'claim_received' | 'inspection' | 'manual' | 'correction';
  reasonText?: string;
  correctionOfId?: string;
};

function requireUser(ctx: Ctx) {
  if (!ctx.user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  return ctx.user;
}

// The one place a battery's state changes. Callers already hold the transaction.
export async function postMovementInTx(tx: Tx, ctx: Ctx, input: MovementInput) {
  const fromState = input.battery?.state ?? null;
  const fromCustodian = input.battery?.custodian ?? null;
  const fromDealerId = input.battery?.dealerId ?? null;
  const batteryId = input.battery?.id ?? input.batteryId;
  if (!batteryId) throw new AppError('battery_not_found', 404, 'Battery not found.');

  if (!canTransition(fromState, input.toState)) {
    if (fromState === 'scrap') throw new AppError('scrap_is_terminal', 409, 'A scrapped battery cannot move again. Post a correction with a reason instead.');
    throw new AppError('invalid_transition', 409, `A battery cannot go from ${fromState} to ${input.toState}.`);
  }
  const toDealerId = input.toDealerId === undefined ? fromDealerId : input.toDealerId;

  const movement = await repo.insertMovement(tx, {
    batteryId,
    fromState,
    toState: input.toState,
    fromCustodian,
    toCustodian: input.toCustodian,
    fromDealerId,
    toDealerId,
    entryId: input.entryId,
    claimId: input.claimId,
    reasonCode: input.reasonCode,
    reasonText: input.reasonText,
    correctionOfId: input.correctionOfId,
    postedBy: ctx.user?.id ?? null,
    postedAt: ctx.now(),
  });
  // A creation movement's battery row was inserted by the caller already in the target state;
  // for every other movement, apply it.
  const battery = input.battery ? await batteriesRepo.applyMovement(tx, batteryId, { state: input.toState, custodian: input.toCustodian, dealerId: toDealerId }) : null;
  return { movement, battery };
}

// POST /stock/movements — an admin corrects or records a movement by hand (stock.post).
export async function postMovement(ctx: Ctx, input: StockMovementPostBody) {
  const user = requireUser(ctx);
  if (user.scope !== 'admin') throw new AppError('permission_denied', 403, 'You do not have permission to do this.');

  const derived = deriveCode(input.batteryCode);
  const battery = await batteriesRepo.findBatteryByCode(db, derived.normalised);
  if (!battery) throw new AppError('battery_not_found', 404, 'Battery not found.', { field: 'batteryCode' });
  if (input.correctionOfId) {
    const original = await repo.findMovementById(db, input.correctionOfId);
    if (!original || original.batteryId !== battery.id) throw new AppError('movement_not_found', 404, 'That movement is not on this battery.', { field: 'correctionOfId' });
  }

  return withTransaction(async (tx) => {
    const result = await postMovementInTx(tx, ctx, {
      battery,
      toState: input.toState,
      toCustodian: input.toCustodian ?? battery.custodian,
      toDealerId: input.toDealerId,
      reasonCode: input.correctionOfId ? 'correction' : 'manual',
      reasonText: input.reasonText,
      correctionOfId: input.correctionOfId,
    });
    await audit(tx, {
      ctx,
      action: 'stock.movement_posted',
      entityType: 'battery',
      entityId: battery.id,
      entityRef: battery.batteryCode,
      before: { state: battery.state, custodian: battery.custodian, dealerId: battery.dealerId },
      after: { state: result.battery!.state, custodian: result.battery!.custodian, dealerId: result.battery!.dealerId, movementId: result.movement.id },
      reason: input.reasonText,
      outcome: 'ok',
    });
    return result;
  });
}

export async function ledger(ctx: Ctx, query: StockMovementListQuery) {
  const user = requireUser(ctx);
  const dealerId = user.scope === 'dealer' ? user.dealerId : query.dealerId;
  let batteryId: string | undefined;
  if (query.batteryCode) {
    const battery = await batteriesRepo.findBatteryByCode(db, deriveCode(query.batteryCode).normalised);
    if (!battery) return { items: [], nextCursor: null };
    batteryId = battery.id;
  }
  return repo.listMovements(db, { batteryId, dealerId, reasonCode: query.reasonCode, limit: query.limit, cursor: decodeCursor(query.cursor) });
}

// GET /stock/positions — counts of batteries by state, model or dealer, derived live.
export async function positions(ctx: Ctx, query: StockPositionsQuery) {
  const user = requireUser(ctx);
  const dealerId = user.scope === 'dealer' ? user.dealerId : query.dealerId;
  const rows = await repo.positionsBy(db, query.by, dealerId);
  const total = rows.reduce((t, r) => t + r.count, 0);
  return { by: query.by, dealerId: dealerId ?? null, total, rows };
}

function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  try {
    const { postedAt, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return { postedAt: new Date(postedAt), id };
  } catch {
    throw new AppError('filter_invalid', 422, 'That page link is not valid — start from the first page again.');
  }
}
