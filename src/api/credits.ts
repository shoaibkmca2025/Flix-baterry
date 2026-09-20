import { apiGet, apiPost } from './client';

export type ApiCreditNote = {
  id: string;
  no: string; // CN-26-09-0002
  dealerId: string;
  claimId: string;
  amount: number;
  issuedBy: string;
  issuedAt: string;
  status: 'issued' | 'settled' | 'reversed';
  settledRef: string | null;
  settledAt: string | null;
  reversedReason: string | null;
};

export function listCreditNotes(accessToken: string, dealerId?: string) {
  return apiGet<{ items: ApiCreditNote[]; nextCursor: string | null }>(`/credit-notes?limit=200${dealerId ? `&dealerId=${dealerId}` : ''}`, { accessToken });
}
export function creditSummary(accessToken: string, dealerId?: string) {
  return apiGet<{ monthTotal: number; totalCredited: number; creditedCount: number; checkingCount: number; refusedCount: number }>(`/credit-notes/summary${dealerId ? `?dealerId=${dealerId}` : ''}`, { accessToken });
}
export function settleCreditNote(no: string, ref: string, accessToken: string) {
  return apiPost<ApiCreditNote>(`/credit-notes/${no}/settle`, { ref }, { accessToken });
}
export function reverseCreditNote(no: string, reason: string, accessToken: string) {
  return apiPost<ApiCreditNote>(`/credit-notes/${no}/reverse`, { reason }, { accessToken });
}
