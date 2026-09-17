import { db, withTransaction } from '../../database/client';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { monthKey, nextFormattedRef } from '../../utils/ids';
import { findBatteryById } from '../batteries/batteries.repository';
import type { claimStatus } from '../../models/claims.model';
import * as repo from './claims.repository';
import type { ClaimCheckBody, ClaimDecideBody, ClaimListQuery } from './claims.validation';

type ClaimStatus = (typeof claimStatus.enumValues)[number];

// memory.md D-08 — still open (client hasn't supplied real rates). These match the demo
// values already in the app; swap for a real credit_rates table lookup once D-08 closes.
const DEMO_CREDIT_RATES: Record<string, number> = { M3: 3800, M5: 4250, M7: 4900, B5: 3600, S5: 1400, I700: 5200 };
const DEFAULT_CREDIT_RATE = 3000;

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

export async function dispatch(ctx: Ctx, id: string) {
  requireUser(ctx);
  const claim = await loadClaimForTransition(id, 'raised');
  return withTransaction(async (tx) => {
    const updated = await repo.updateClaimStatus(tx, claim.id, 'awaiting_return');
    await audit(tx, { ctx, action: 'claim.dispatched', entityType: 'claim', entityId: claim.id, entityRef: claim.ref, before: { status: 'raised' }, after: { status: 'awaiting_return' }, outcome: 'ok' });
    return updated;
  });
}

export async function receive(ctx: Ctx, id: string) {
  requireUser(ctx);
  const claim = await loadClaimForTransition(id, 'awaiting_return');
  return withTransaction(async (tx) => {
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

    const newBattery = await findBatteryById(db, claim.newBatteryId);
    const amount = (newBattery && DEMO_CREDIT_RATES[newBattery.modelId]) ?? DEFAULT_CREDIT_RATE;
    const no = await nextFormattedRef(tx, 'CN', 'credit_note', monthKey(ctx.now()));
    const creditNote = await repo.insertCreditNote(tx, { no, dealerId: claim.dealerId, claimId: claim.id, amount, issuedBy: user.id });
    const updated = await repo.updateClaimDecision(tx, claim.id, { status: 'approved', decidedBy: user.id, decisionReason: input.reason, creditNoteId: creditNote.id });
    await audit(tx, { ctx, action: 'claim.approved', entityType: 'claim', entityId: claim.id, entityRef: claim.ref, before: { status: 'checked' }, after: { status: 'approved', creditNoteRef: creditNote.no, amount }, reason: input.reason, outcome: 'ok' });
    await audit(tx, { ctx, action: 'credit_note.issued', entityType: 'credit_note', entityId: creditNote.id, entityRef: creditNote.no, outcome: 'ok' });
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
