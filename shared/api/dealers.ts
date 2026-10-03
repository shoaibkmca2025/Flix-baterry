import { apiGet, apiPost } from './client';

export type DealerStatus = 'pending_approval' | 'active' | 'rejected' | 'suspended';
export type ApiDealer = {
  id: string;
  dealerCode: string | null;
  name: string;
  contactPerson: string;
  mobile: string;
  email: string | null;
  cityId: string;
  state: string;
  pin: string | null; // not asked for any more (client, 3 Oct 2026)
  place: string | null;
  address: string;
  status: DealerStatus;
  statusReason: string | null;
  createdAt: string;
  kind?: 'distributor' | 'dealer'; // absent on a server from before 2 Oct 2026 = distributor
  distributorId?: string | null;
};
export type Page<T> = { items: T[]; nextCursor: string | null };

export type DealerRegisterInput = {
  verifiedToken: string;
  name: string;
  contactPerson: string;
  mobile: string;
  email?: string;
  city: string;
  state: string;
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

// --- head office (dealers.read / dealers.approve etc.)
export function listDealers(accessToken: string, status?: DealerStatus, cursor?: string) {
  return apiGet<Page<ApiDealer>>(`/dealers?limit=200${status ? `&status=${status}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { accessToken });
}
export function approveDealer(id: string, dealerCode: string, reason: string, accessToken: string) {
  return apiPost<ApiDealer>(`/dealers/${id}/approve`, { dealerCode, reason }, { accessToken });
}
export function rejectDealer(id: string, reason: string, accessToken: string) {
  return apiPost<ApiDealer>(`/dealers/${id}/reject`, { reason }, { accessToken });
}
export function suspendDealer(id: string, reason: string, accessToken: string) {
  return apiPost<ApiDealer>(`/dealers/${id}/suspend`, { reason }, { accessToken });
}
export function activateDealer(id: string, reason: string, accessToken: string) {
  return apiPost<ApiDealer>(`/dealers/${id}/activate`, { reason }, { accessToken });
}

// --- a distributor's own dealers (client, 2 Oct 2026) --------------------------------------
export type MyDealerInput = { name: string; contactPerson: string; mobile: string; email?: string; city: string; state: string; place?: string; address: string };
export function listMyDealers(accessToken: string) {
  return apiGet<{ items: ApiDealer[] }>('/dealers/me/dealers', { accessToken });
}
export function createMyDealer(input: MyDealerInput, accessToken: string) {
  return apiPost<ApiDealer>('/dealers/me/dealers', input, { accessToken });
}
export function setMyDealerStatus(id: string, to: 'suspended' | 'active', reason: string, accessToken: string) {
  return apiPost<ApiDealer>(`/dealers/me/dealers/${id}/${to === 'suspended' ? 'suspend' : 'activate'}`, { reason }, { accessToken });
}

// --- head office adds and moves dealers (client, 3 Oct 2026) --------------------------------
/** Head office adds a dealer under the distributor it names — the same form, plus that choice. */
export function createDealerForDistributor(input: MyDealerInput & { distributorId: string }, accessToken: string) {
  return apiPost<ApiDealer>('/dealers', input, { accessToken });
}
/** Move a dealer to another distributor. Its requests and history follow it. */
export function assignDistributor(id: string, distributorId: string, reason: string, accessToken: string) {
  return apiPost<ApiDealer>(`/dealers/${id}/distributor`, { distributorId, reason }, { accessToken });
}
