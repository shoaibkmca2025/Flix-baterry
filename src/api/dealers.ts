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
