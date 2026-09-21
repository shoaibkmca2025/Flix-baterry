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
  pin: string;
  place: string | null;
  address: string;
  status: DealerStatus;
  statusReason: string | null;
  createdAt: string;
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

// --- head office (dealers.read / dealers.approve etc.)
export function listDealers(accessToken: string, status?: DealerStatus) {
  return apiGet<Page<ApiDealer>>(`/dealers?limit=200${status ? `&status=${status}` : ''}`, { accessToken });
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
