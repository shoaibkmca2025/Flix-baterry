import { apiGet, apiPost } from './client';

export type EntryType = 'replacement' | 'sales_return' | 'regular_sales';

export type EntryItemInput = {
  modelId: string;
  code: string;
  oldCode?: string;
  faultCode?: string;
  remarks?: string;
};

export type EntryCreateInput = {
  entryType: EntryType;
  entryDate?: string; // omit to let the server default to today (Asia/Kolkata)
  place: string;
  customerName?: string;
  remarks?: string;
  items: EntryItemInput[];
  gps?: string;
  signature?: string;
  coverTold?: boolean;
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
  status: 'submitted' | 'approved' | 'rejected';
  gps: string | null;
  signature: string | null;
  coverToldAt: string | null;
  submittedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export function createEntry(input: EntryCreateInput, accessToken: string) {
  return apiPost<EntryResult>('/entries', input, { accessToken });
}

export function getEntry(id: string, accessToken: string) {
  return apiGet<EntryResult & { items: unknown[] }>(`/entries/${id}`, { accessToken });
}

export type EntryItemResult = {
  id: string;
  entryId: string;
  seq: number;
  modelId: string;
  batteryCode: string;
  batteryCodeEntered: string;
  oldBatteryCode: string | null;
  oldBatteryCodeEntered: string | null;
  faultCode: string | null;
  remarks: string | null;
  batteryId: string | null;
  oldBatteryId: string | null;
};
export type EntryWithItems = EntryResult & { items: EntryItemResult[] };

/** Newest first. A dealer token only ever sees that dealer's entries; an admin token sees all. */
export function listEntries(query: { status?: EntryResult['status']; limit?: number; cursor?: string }, accessToken: string) {
  const qs = new URLSearchParams();
  if (query.status) qs.set('status', query.status);
  if (query.limit) qs.set('limit', String(query.limit));
  if (query.cursor) qs.set('cursor', query.cursor);
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiGet<{ items: EntryWithItems[]; nextCursor: string | null }>(`/entries${suffix}`, { accessToken });
}

export function approveEntry(id: string, reason: string, accessToken: string) {
  return apiPost<{ entry: EntryResult; items: unknown[] }>(`/entries/${id}/approve`, { reason }, { accessToken });
}

export function rejectEntry(id: string, reason: string, accessToken: string) {
  return apiPost<EntryResult>(`/entries/${id}/reject`, { reason }, { accessToken });
}
