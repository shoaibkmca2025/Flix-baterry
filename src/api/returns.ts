import { apiGet, apiPost } from './client';

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

/** Head office: the van arrived. Codes on the challan but not in the van are flagged as shortages. */
export function receiveChallan(id: string, input: { reason?: string; missingBatteryCodes?: string[] }, accessToken: string) {
  return apiPost<ChallanResult>(`/challans/${id}/receive`, { missingBatteryCodes: [], ...input }, { accessToken });
}

/** Head office: move one old battery along received → testing → repaired/scrapped → closed. */
export function stageLine(lineId: string, input: { stage: Exclude<ReturnStage, 'in_transit' | 'received'>; reason: string }, accessToken: string) {
  return apiPost<ChallanLineResult>(`/challans/lines/${lineId}/stage`, input, { accessToken });
}
