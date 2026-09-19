import { db, withTransaction } from '../../database/client';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { issueInTx as issueCreditNoteInTx } from '../credits/credits.service';
import { findBatteryById } from '../batteries/batteries.repository';
import { postMovementInTx } from '../stock/stock.service';
import type { claimStatus } from '../../models/claims.model';
import * as repo from './claims.repository';
import type { ClaimCheckBody, ClaimDecideBody, ClaimListQuery } from './claims.validation';

type ClaimStatus = (typeof claimStatus.enumValues)[number];

function requireUser(ctx: Ctx) {
  if (!ctx.user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  return ctx.user;
}

async function loadClaimForTransition(id: string, expected: ClaimStatus) {
  const claim = await repo.findClaimById(db, id);
  if (!claim) throw new AppError('claim_not_found', 404, 'Claim not found.');
  if (claim.status !== expected) {
    throw new AppError('invalid_transition', 409, `Cannot do this while the claim is ${claim.status}.`);
  }
  return claim;
}

async function moveOldBattery(
  tx: Parameters<typeof postMovementInTx>[0],
  ctx: Ctx,
  claim: { id: string; oldBatteryId: string },
  move: { toState: 'returned' | 'repair' | 'scrap'; toCustodian: 'transit' | 'company'; toDealerId?: null; reasonCode: 'claim_dispatched' | 'claim_received' | 'inspection'; reasonText?: string },
) {
  const battery = await findBatteryById(tx, claim.oldBatteryId);
  if (!battery) throw new AppError('battery_not_found', 500, 'The claim is missing its old battery.');
  return postMovementInTx(tx, ctx, { battery, claimId: claim.id, ...move });
}

export async function dispatch(ctx: Ctx, id: string) {
  requireUser(ctx);
  const claim = await loadClaimForTransition(id, 'raised');
  return withTransaction(async (tx) => {
    // the old battery leaves the dealer's counter — custody transit, state unchanged (stock ledger)
    await moveOldBattery(tx, ctx, claim, { toState: 'returned', toCustodian: 'transit', reasonCode: 'claim_dispatched' });
    const updated = await repo.updateClaimStatus(tx, claim.id, 'awaiting_return');
    await audit(tx, { ctx, action: 'claim.dispatched', entityType: 'claim', entityId: claim.id, entityRef: claim.ref, before: { status: 'raised' }, after: { status: 'awaiting_return' }, outcome: 'ok' });
    return updated;
  });
}

export async function receive(ctx: Ctx, id: string) {
  requireUser(ctx);
  const claim = await loadClaimForTransition(id, 'awaiting_return');
  return withTransaction(async (tx) => {
    // arrived at the company — custody company, dealer link dropped (V1 flow step 4, memory.md §1a)
    await moveOldBattery(tx, ctx, claim, { toState: 'returned', toCustodian: 'company', toDealerId: null, reasonCode: 'claim_received' });
    const updated = await repo.updateClaimStatus(tx, claim.id, 'received');
    await audit(tx, { ctx, action: 'claim.received', entityType: 'claim', entityId: claim.id, entityRef: claim.ref, before: { status: 'awaiting_return' }, after: { status: 'received' }, outcome: 'ok' });
    return updated;
  });
}

// architecture.md §9.7 "inspection" step. The team's own words: if the engineer finds a
// disqualifying fault they mark it rejected themselves; otherwise it moves to 'checked',
// awaiting a second person's decision — both paths happen inside this one call.
export async function check(ctx: Ctx, id: string, input: ClaimCheckBody) {
  const user = requireUser(ctx);
  const claim = await loadClaimForTransition(id, 'received');

  return withTransaction(async (tx) => {
    // inspection disposition is a stock movement too: repair → 'repair', scrap → 'scrap', hold stays 'returned'
    if (input.disposition !== 'hold') {
      await moveOldBattery(tx, ctx, claim, { toState: input.disposition, toCustodian: 'company', reasonCode: 'inspection', reasonText: input.findingCode });
    }
    const updated = await repo.updateClaimCheck(tx, claim.id, {
      status: input.disqualify ? 'refused' : 'checked',
      findingCode: input.findingCode,
      conditionNote: input.conditionNote ?? null,
      disposition: input.disposition,
      ...(input.disqualify ? { decidedBy: user.id, decisionReason: input.reason, decidedAt: new Date() } : {}),
    });
    await audit(tx, {
      ctx,
      action: input.disqualify ? 'claim.refused' : 'claim.checked',
      entityType: 'claim',
      entityId: claim.id,
      entityRef: claim.ref,
      before: { status: 'received' },
      after: { status: updated.status, findingCode: input.findingCode, disposition: input.disposition },
      reason: input.disqualify ? input.reason : undefined,
      outcome: 'ok',
    });
    return updated;
  });
}

export async function decide(ctx: Ctx, id: string, input: ClaimDecideBody) {
  const user = requireUser(ctx);
  const claim = await loadClaimForTransition(id, 'checked');

  return withTransaction(async (tx) => {
    if (input.outcome === 'refused') {
      const updated = await repo.updateClaimDecision(tx, claim.id, { status: 'refused', decidedBy: user.id, decisionReason: input.reason });
      await audit(tx, { ctx, action: 'claim.refused', entityType: 'claim', entityId: claim.id, entityRef: claim.ref, before: { status: 'checked' }, after: { status: 'refused' }, reason: input.reason, outcome: 'ok' });
      return { claim: updated, creditNote: null };
    }

    // credits owns credit_notes (modules.md §4) — it picks the amount, numbers the note and
    // writes its own audit row, all inside this transaction.
    const creditNote = await issueCreditNoteInTx(tx, ctx, { claim });
    const updated = await repo.updateClaimDecision(tx, claim.id, { status: 'approved', decidedBy: user.id, decisionReason: input.reason, creditNoteId: creditNote.id });
    await audit(tx, { ctx, action: 'claim.approved', entityType: 'claim', entityId: claim.id, entityRef: claim.ref, before: { status: 'checked' }, after: { status: 'approved', creditNoteRef: creditNote.no, amount: creditNote.amount }, reason: input.reason, outcome: 'ok' });
    return { claim: updated, creditNote };
  });
}

export async function list(ctx: Ctx, query: ClaimListQuery) {
  const user = requireUser(ctx);
  const dealerId = user.scope === 'dealer' ? user.dealerId : undefined;
  return repo.listClaims(db, { status: query.status, dealerId, limit: query.limit, cursor: decodeCursor(query.cursor) });
}

export async function getById(ctx: Ctx, id: string) {
  const user = requireUser(ctx);
  const claim = await repo.findClaimById(db, id);
  if (!claim) throw new AppError('claim_not_found', 404, 'Claim not found.');
  if (user.scope === 'dealer' && claim.dealerId !== user.dealerId) {
    throw new AppError('claim_not_found', 404, 'Claim not found.'); // 404, not 403 — no existence leak (I-3)
  }
  return claim;
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
