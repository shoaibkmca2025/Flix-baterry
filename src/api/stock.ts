import { apiGet, apiPost } from './client';

export type BatteryState = 'available' | 'allocated' | 'sold' | 'returned' | 'replacement' | 'repair' | 'damaged' | 'scrap';
export type Custodian = 'company' | 'dealer' | 'customer' | 'transit';

export type ApiMovement = {
  id: string;
  batteryId: string;
  batteryCode: string;
  modelId: string;
  fromState: BatteryState | null;
  toState: BatteryState;
  fromCustodian: Custodian | null;
  toCustodian: Custodian;
  fromDealerId: string | null;
  toDealerId: string | null;
  entryId: string | null;
  claimId: string | null;
  reasonCode: string;
  reasonText: string | null;
  postedBy: string | null;
  postedAt: string;
};

export function listMovements(accessToken: string) {
  return apiGet<{ items: ApiMovement[]; nextCursor: string | null }>('/stock/movements?limit=200', { accessToken });
}
/** Head office posts a movement by hand (stock.post). The server validates the §9.6 transition. */
export function postMovement(input: { batteryCode: string; toState: BatteryState; toCustodian?: Custodian; toDealerId?: string | null; reasonText: string }, accessToken: string) {
  return apiPost<{ movement: ApiMovement }>('/stock/movements', input, { accessToken });
}
