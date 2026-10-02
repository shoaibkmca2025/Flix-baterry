import { apiGet, apiPatch, apiPost } from './client';

export type ReturnStage = 'in_transit' | 'received' | 'testing' | 'repaired' | 'scrapped' | 'closed';

export type ChallanLineResult = {
  id: string;
  challanId: string;
  entryId: string;
  entryItemId: string;
  batteryCode: string; // the old battery
  modelId: string;
  faultCode: string | null;
  stage: ReturnStage;
  stageNote: string | null;
  stagedBy: string | null;
  stagedAt: string | null;
  shortage: boolean;
  plantId: string | null; // the plant that made it, tagged on arrival (D-19)
  // what head office decided about THIS battery, so a challan can be grouped by outcome on both
  // sides (client, 2 Oct 2026). 'passed' = checked and good, waiting for the Claim button.
  claimId: string | null;
  outcome: 'travelling' | 'arrived' | 'passed' | 'claimed' | 'rejected';
  outcomeReason: string | null;
};

export type ChallanResult = {
  id: string;
  no: string; // CHL-26-09-0003
  dealerId: string;
  vehicleNo: string | null;
  driverName: string | null;
  lineCount: number;
  status: 'dispatched' | 'received';
  dispatchedBy: string;
  dispatchedAt: string;
  receivedBy: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: ChallanLineResult[];
};

/** Dealer: hand the old batteries of these entries (server ids) to the van. */
export function createChallan(input: { entryIds: string[]; vehicleNo?: string; driverName?: string }, accessToken: string) {
  return apiPost<ChallanResult>('/challans', input, { accessToken });
}

/** Newest first. A dealer token sees only that dealer's challans. */
export function listChallans(query: { status?: ChallanResult['status']; limit?: number; cursor?: string }, accessToken: string) {
  const qs = new URLSearchParams();
  if (query.status) qs.set('status', query.status);
  if (query.limit) qs.set('limit', String(query.limit));
  if (query.cursor) qs.set('cursor', query.cursor);
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiGet<{ items: ChallanResult[]; nextCursor: string | null }>(`/challans${suffix}`, { accessToken });
}

/**
 * Head office: the whole van arrived, every battery made at `plantId`. Codes on the challan but not
 * in the van are flagged as shortages; batteries already confirmed one by one are left as they are.
 */
export function receiveChallan(id: string, input: { plantId: string; reason?: string; missingBatteryCodes?: string[] }, accessToken: string) {
  return apiPost<ChallanResult>(`/challans/${id}/receive`, { missingBatteryCodes: [], ...input }, { accessToken });
}

/** Head office: ONE battery arrived, and this is the plant that made it (read off its label). */
export function receiveLine(lineId: string, input: { plantId: string; reason?: string }, accessToken: string) {
  return apiPost<ChallanLineResult & { challanNo: string; stillOnTheWay: number }>(`/challans/lines/${lineId}/receive`, input, { accessToken });
}

/** Head office: correct the plant of a battery that has arrived (a misread label). */
export function setLinePlant(lineId: string, input: { plantId: string; reason: string }, accessToken: string) {
  return apiPatch<ChallanLineResult>(`/challans/lines/${lineId}/plant`, input, { accessToken });
}

/** Head office: move one old battery along received → testing → repaired/scrapped → closed. */
export function stageLine(lineId: string, input: { stage: Exclude<ReturnStage, 'in_transit' | 'received'>; reason: string }, accessToken: string) {
  return apiPost<ChallanLineResult>(`/challans/lines/${lineId}/stage`, input, { accessToken });
}

/**
 * The Claim button: approve for refund every battery on this challan that passed its check.
 * Batteries still travelling, not yet checked, already refused or already claimed are left
 * alone and reported in `skipped`, so pressing it twice cannot pay a dealer twice.
 */
export function claimChallan(id: string, reason: string, accessToken: string) {
  return apiPost<{ challanNo: string; claimed: number; skipped: number; creditNotes: { no: string }[]; lines: ChallanLineResult[] }>(
    `/challans/${id}/claim`, { reason }, { accessToken },
  );
}
