import { apiGet, apiPost } from './client';

export type EntryType = 'replacement' | 'sales_return' | 'regular_sales';

export type EntryItemInput = {
  modelId: string;
  code: string;
  oldCode?: string;
  oldModelId?: string; // the old battery's plate + model when it is not on record (its warranty term)
  faultCode?: string;
  remarks?: string;
};

export type EntryCreateInput = {
  entryType: EntryType;
  dealerId?: string; // head office only: the dealer the entry is recorded for
  entryDate?: string; // omit to let the server default to today (Asia/Kolkata)
  place: string;
  customerName?: string;
  remarks?: string;
  items: EntryItemInput[];
  gps?: string;
  signature?: string;
  coverTold?: boolean;
  /** sales returns only: unsold stock, or a faulty battery (client, 3 Oct 2026) */
  returnKind?: ReturnKindApi;
};

export type EntryResult = {
  id: string;
  ref: string; // ENT-26-09-0414
  dealerId: string;
  entryType: EntryType;
  entryDate: string;
  place: string;
  customerName: string | null;
  remarks: string | null;
  totalQty: number;
  status: 'submitted' | 'approved' | 'rejected' | 'with_distributor' | 'void';
  // head office voided it: out of every live queue, still readable (client, 6 Oct 2026)
  voidedAt?: string | null;
  voidReason?: string | null;
  gps: string | null;
  signature: string | null;
  coverToldAt: string | null;
  submittedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  distributorDecidedAt?: string | null;
  distributorReason?: string | null;
  // a special request (a battery past its term): head office decides it in Correction requests
  specialStatus?: 'pending' | 'approved' | 'rejected' | null;
  specialDecidedAt?: string | null;
  specialReason?: string | null;
  createdAt: string;
  updatedAt: string;
  returnKind?: ReturnKindApi | null; // sales returns only
  byAdmin?: boolean; // recorded by head office, not sent in by a shop (client, 3 Oct 2026)
};

export function createEntry(input: EntryCreateInput, accessToken: string) {
  return apiPost<EntryResult>('/entries', input, { accessToken });
}

export function getEntry(id: string, accessToken: string) {
  return apiGet<EntryResult & { items: unknown[] }>(`/entries/${id}`, { accessToken });
}

export type ReturnKindApi = 'unsold' | 'defective';

export type EntryItemResult = {
  id: string;
  seq: number;
  modelId: string;
  batteryCode: string;
  batteryCodeEntered: string;
  oldBatteryCode: string | null;
  // the old battery's own plate + model when it differs from the new one. Without it a stored
  // code cannot be split back into its digits, which is what a correction edits.
  oldModelId: string | null;
  faultCode: string | null;
  remarks: string | null;
  batteryId: string | null;
  oldBatteryId: string | null;
  claimId: string | null;
  // head office works a request battery by battery (client, 2 Oct 2026)
  reviewStartedAt: string | null;
  reviewNote: string | null;
  correctedAt: string | null;
  correctionReason: string | null;
  distributorReceivedAt?: string | null; // the distributor marked the dealer's old battery arrived
  coverCase?: 'extension' | 'expired' | null; // the old battery was past its term when the request was made
  coverTermEnd?: string | null;
  coverEnd?: string | null;
};
export type EntryWithItems = EntryResult & { items: EntryItemResult[] };

export function listEntries(accessToken: string, opts: { status?: EntryResult['status']; dealerId?: string; cursor?: string } = {}) {
  const q = new URLSearchParams({ limit: '200' });
  if (opts.status) q.set('status', opts.status);
  if (opts.dealerId) q.set('dealerId', opts.dealerId);
  if (opts.cursor) q.set('cursor', opts.cursor);
  return apiGet<{ items: EntryWithItems[]; nextCursor: string | null }>(`/entries?${q}`, { accessToken });
}
export function approveEntry(id: string, reason: string, accessToken: string) {
  return apiPost<{ entry: EntryResult }>(`/entries/${id}/approve`, { reason }, { accessToken });
}
export function rejectEntry(id: string, reason: string, accessToken: string) {
  return apiPost<EntryResult>(`/entries/${id}/reject`, { reason }, { accessToken });
}

/** Mark ONE battery as being looked at. A note about work in progress, not a decision — the
 * request's own status does not move, and the other batteries on it are untouched. */
export function reviewEntryItem(id: string, itemId: string, note: string | undefined, accessToken: string) {
  return apiPost<EntryItemResult>(`/entries/${id}/items/${itemId}/review`, note ? { note } : {}, { accessToken });
}

/** Rewrite ONE battery's serials. Only while the request is still open; the server re-checks the
 * corrected values against exactly the rules the dealer's entry had to pass. */
export function correctEntryItem(
  id: string, itemId: string,
  change: { code?: string; modelId?: string; oldCode?: string; oldModelId?: string; reason: string },
  accessToken: string,
) {
  return apiPost<EntryItemResult>(`/entries/${id}/items/${itemId}/correct`, change, { accessToken });
}

/** Head office's one decision on a replacement once its old battery is at the factory (entries.settle). */
/** Approving means "approved for refund" — there is no amount (memory.md D-20). */
export function settleEntry(id: string, decision: 'approved' | 'passed' | 'refused', reason: string, accessToken: string, itemId?: string) {
  // `itemId`: decide one battery of a multi-battery replacement on its own
  return apiPost<{ entry: EntryResult; creditNotes: { no: string }[] }>(`/entries/${id}/settle`, { decision, reason, ...(itemId ? { itemId } : {}) }, { accessToken });
}

/** A distributor approves a dealer's request on to head office, or refuses it (client, 2 Oct 2026). */
export function distributorDecide(id: string, decision: 'approve' | 'refuse', reason: string, accessToken: string) {
  return apiPost<EntryResult>(`/entries/${id}/distributor/${decision}`, { reason }, { accessToken });
}

/** The dealer handed the old battery over: the distributor marks it arrived — one battery, or all still to come. */
export function markArrived(id: string, accessToken: string, itemId?: string) {
  return apiPost<{ entryId: string; ref: string; items: EntryItemResult[] }>(`/entries/${id}/arrived`, itemId ? { itemId } : {}, { accessToken });
}

/** Head office approves or rejects a special replacement request, from Correction requests (client, 3 Oct 2026). */
export function decideSpecial(id: string, decision: 'approve' | 'reject', reason: string, accessToken: string) {
  return apiPost<EntryResult>(`/entries/${id}/special/${decision}`, { reason }, { accessToken });
}

/** Head office takes a request out of every live queue and total. Nothing is deleted (client, 6 Oct 2026). */
export function voidEntry(id: string, reason: string, accessToken: string) {
  return apiPost<EntryResult>(`/entries/${id}/void`, { reason }, { accessToken });
}
