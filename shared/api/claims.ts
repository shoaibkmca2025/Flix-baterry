import { apiGet, apiPost } from './client';

export type ClaimStatus = 'raised' | 'awaiting_return' | 'received' | 'checked' | 'approved' | 'refused';
export type ClaimDisposition = 'repair' | 'scrap' | 'hold';

export type ApiClaim = {
  id: string;
  ref: string; // CLM-26-09-0002
  dealerId: string;
  chainId: string;
  oldBatteryId: string;
  newBatteryId: string;
  status: ClaimStatus;
  findingCode: string | null;
  conditionNote: string | null;
  disposition: ClaimDisposition | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  creditNoteId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function listClaims(accessToken: string) {
  return apiGet<{ items: ApiClaim[]; nextCursor: string | null }>('/claims?limit=200', { accessToken });
}
/** Dealer: the old battery has left the shop on the pickup vehicle. */
export function dispatchClaim(id: string, accessToken: string) {
  return apiPost<ApiClaim>(`/claims/${id}/dispatch`, {}, { accessToken });
}
/** Head office: the old battery arrived at the company. */
export function receiveClaim(id: string, accessToken: string) {
  return apiPost<ApiClaim>(`/claims/${id}/receive`, {}, { accessToken });
}
/** Engineer inspection. `disqualify` refuses the claim on the spot (reason required). */
export function checkClaim(id: string, input: { findingCode: string; conditionNote?: string; disposition: ClaimDisposition; disqualify?: boolean; reason?: string }, accessToken: string) {
  return apiPost<ApiClaim>(`/claims/${id}/check`, input, { accessToken });
}
/** Second person's decision; 'approved' issues the credit note. */
export function decideClaim(id: string, outcome: 'approved' | 'refused', reason: string, accessToken: string) {
  return apiPost<{ claim: ApiClaim; creditNote: { id: string; no: string; amount: number } | null }>(`/claims/${id}/decide`, { outcome, reason }, { accessToken });
}
