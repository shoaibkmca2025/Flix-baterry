import { db, withTransaction, type Tx } from '../../database/client';
import { findDealerById } from '../dealers/dealers.repository';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { monthKey, nextFormattedRef } from '../../utils/ids';
import type { warrantyClaims } from '../../models/claims.model';
import { countClaimsByStatus } from '../claims/claims.repository';
import * as repo from './credits.repository';
import type { CreditNoteListQuery, CreditNoteReverseBody, CreditNoteSettleBody, CreditNoteSummaryQuery } from './credits.validation';

// M-18 credits — modules.md. Owns credit_notes: claims.decide issues through issueInTx (same
// transaction), dealers read their own notes (d37 / d32 card), admins settle or reverse.
//
// A note is the record that a claim was APPROVED FOR REFUND — it carries no amount. Felix's
// accounts team works out and pays the refund outside this system, and the dealer is shown
// only "approved for refund" (client, 28 Sep 2026 — memory.md D-20, superseding the typed
// amount of D-08). Notes from before then keep the amount they were issued with.

const BUSINESS_TZ_OFFSET_MS = 5.5 * 60 * 60 * 1000; // Asia/Kolkata, no DST (memory.md §12)

function requireUser(ctx: Ctx) {
  if (!ctx.user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  return ctx.user;
}

// First instant of the current calendar month in the business timezone, as a UTC Date.
export function startOfBusinessMonth(now: Date): Date {
  const local = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - BUSINESS_TZ_OFFSET_MS);
}

type Claim = typeof warrantyClaims.$inferSelect;

// Called by claims.decide inside its own transaction — the caller stores the returned note's
// id on the claim row. The audit row for the claim's approval belongs to claims; the one for
// the note's issue belongs here.
export async function issueInTx(tx: Tx, ctx: Ctx, input: { claim: Pick<Claim, 'id' | 'ref' | 'dealerId' | 'newBatteryId'> }) {
  const user = requireUser(ctx);
  const issuedAt = ctx.now();
  const no = await nextFormattedRef(tx, 'CN', 'credit_note', monthKey(issuedAt));
  // Head office refunds the distributor; he settles with his dealer (client, 2 Oct 2026). A
  // claim from a dealer's request is credited to that dealer's distributor.
  const shop = await findDealerById(tx, input.claim.dealerId);
  const payee = shop?.kind === 'dealer' && shop.distributorId ? shop.distributorId : input.claim.dealerId;
  const note = await repo.insertCreditNote(tx, { no, dealerId: payee, claimId: input.claim.id, amount: null, issuedBy: user.id, issuedAt });
  await audit(tx, {
    ctx,
    action: 'credit_note.issued',
    entityType: 'credit_note',
    entityId: note.id,
    entityRef: note.no,
    after: { status: 'issued', claimRef: input.claim.ref, dealerId: payee, ...(payee !== input.claim.dealerId ? { forDealerId: input.claim.dealerId } : {}) },
    outcome: 'ok',
  });
  return note;
}

export async function list(ctx: Ctx, query: CreditNoteListQuery) {
  const user = requireUser(ctx);
  const dealerId = user.scope === 'dealer' ? user.dealerId : query.dealerId;
  return repo.listCreditNotes(db, { status: query.status, dealerId, limit: query.limit, cursor: decodeCursor(query.cursor) });
}

function findByNoOrId(noOrId: string) {
  return /^CN-/i.test(noOrId) ? repo.findCreditNoteByNo(db, noOrId.toUpperCase()) : repo.findCreditNoteById(db, noOrId);
}

// Accepts the note number ('CN-26-09-0001') or its uuid.
export async function getByNo(ctx: Ctx, noOrId: string) {
  const user = requireUser(ctx);
  const note = await findByNoOrId(noOrId);
  if (!note || (user.scope === 'dealer' && note.dealerId !== user.dealerId)) {
    throw new AppError('credit_note_not_found', 404, 'Credit note not found.'); // 404, not 403 — no existence leak (I-3)
  }
  return note;
}

// The four KPIs on the dealer's credit-notes screen (d37) plus the admin dealer-profile KPI.
export async function summary(ctx: Ctx, query: CreditNoteSummaryQuery) {
  const user = requireUser(ctx);
  const dealerId = user.scope === 'dealer' ? user.dealerId : query.dealerId;
  if (!dealerId) throw new AppError('dealer_required', 422, 'Choose a dealer to summarise.');

  const [month, allTime, claimCounts] = await Promise.all([
    repo.sumCreditedForDealer(db, dealerId, startOfBusinessMonth(ctx.now())),
    repo.sumCreditedForDealer(db, dealerId),
    countClaimsByStatus(db, dealerId),
  ]);
  const checkingCount = (['raised', 'awaiting_return', 'received', 'checked'] as const).reduce((t, s) => t + (claimCounts[s] ?? 0), 0);
  return {
    dealerId,
    monthTotal: month.total,
    totalCredited: allTime.total,
    creditedCount: allTime.count,
    checkingCount,
    refusedCount: claimCounts.refused ?? 0,
  };
}

async function loadForAdjust(noOrId: string) {
  const note = await findByNoOrId(noOrId);
  if (!note) throw new AppError('credit_note_not_found', 404, 'Credit note not found.');
  if (note.status === 'settled') throw new AppError('already_settled', 409, `${note.no} is already settled against ${note.settledRef}.`);
  if (note.status === 'reversed') throw new AppError('invalid_transition', 409, `${note.no} was reversed and cannot be changed.`);
  return note;
}

export async function settle(ctx: Ctx, noOrId: string, input: CreditNoteSettleBody) {
  const user = requireUser(ctx);
  const note = await loadForAdjust(noOrId);
  return withTransaction(async (tx) => {
    const updated = await repo.updateCreditNoteSettled(tx, note.id, { settledRef: input.ref, adjustedBy: user.id, at: ctx.now() });
    await audit(tx, { ctx, action: 'credit_note.settled', entityType: 'credit_note', entityId: note.id, entityRef: note.no, before: { status: 'issued' }, after: { status: 'settled', settledRef: input.ref }, outcome: 'ok' });
    return updated;
  });
}

export async function reverse(ctx: Ctx, noOrId: string, input: CreditNoteReverseBody) {
  const user = requireUser(ctx);
  const note = await loadForAdjust(noOrId);
  return withTransaction(async (tx) => {
    const updated = await repo.updateCreditNoteReversed(tx, note.id, { reason: input.reason, adjustedBy: user.id, at: ctx.now() });
    await audit(tx, { ctx, action: 'credit_note.reversed', entityType: 'credit_note', entityId: note.id, entityRef: note.no, before: { status: 'issued', amount: note.amount }, after: { status: 'reversed' }, reason: input.reason, outcome: 'ok' });
    return updated;
  });
}

function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  try {
    const { issuedAt, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return { issuedAt: new Date(issuedAt), id };
  } catch {
    throw new AppError('filter_invalid', 422, 'That page link is not valid — start from the first page again.');
  }
}
