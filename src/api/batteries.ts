import { apiGet } from './client';

export type BatteryCover = {
  mfgMonth: string | null;
  expiryDate: string;
  inWarranty: boolean;
  daysRemaining: number;
  warrantyStart?: string; // present once the battery is part of a chain (memory.md D-03)
};

export type BatteryCustody = 'yours' | 'other' | 'customer' | 'company' | 'transit';

export type BatteryLookupResult =
  | { found: false; mfgMonth: string | null; serialNo: string; model: null; custody: null; cover: BatteryCover }
  | {
      found: true;
      battery: { id: string; batteryCode: string; serialNo: string; state: string; dealerId: string | null };
      model: { id: string; type: string; capacity: string; warrantyMonths: number } | null;
      custody: BatteryCustody;
      cover: BatteryCover;
    };

// architecture.md §9.9 — never reveals which OTHER dealer holds a battery to a dealer caller.
export function lookupBattery(code: string, accessToken: string) {
  return apiGet<BatteryLookupResult>(`/batteries/lookup?code=${encodeURIComponent(code)}`, { accessToken });
}
