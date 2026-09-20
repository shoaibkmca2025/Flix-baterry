import { apiGet, apiPost } from './client';

export type DealerRegisterInput = {
  verifiedToken: string;
  name: string;
  contactPerson: string;
  mobile: string;
  email?: string;
  city: string;
  state: string;
  pin: string;
  place?: string;
  address: string;
  password: string;
};

export function registerDealer(input: DealerRegisterInput) {
  return apiPost<{ id: string; name: string; status: string }>('/dealers/register', input);
}

export function getMe(accessToken: string) {
  return apiGet('/dealers/me', { accessToken });
}

export type DealerResult = {
  id: string;
  dealerCode: string | null;
  name: string;
  contactPerson: string;
  mobile: string;
  email: string | null;
  cityId: string;
  state: string;
  pin: string;
  place: string | null;
  address: string;
  status: 'pending_approval' | 'active' | 'rejected' | 'suspended';
};

/** Head office only (dealers.read). Newest first. */
export function listDealers(query: { status?: DealerResult['status']; limit?: number; cursor?: string }, accessToken: string) {
  const qs = new URLSearchParams();
  if (query.status) qs.set('status', query.status);
  if (query.limit) qs.set('limit', String(query.limit));
  if (query.cursor) qs.set('cursor', query.cursor);
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiGet<{ items: DealerResult[]; nextCursor: string | null }>(`/dealers${suffix}`, { accessToken });
}
