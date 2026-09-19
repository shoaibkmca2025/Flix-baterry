import { apiGet } from './client';

export type BatteryCover = {
  mfgMonth: string | null;
  expiryDate: string;
  inWarranty: boolean;
  daysRemaining: number;
  warrantyStart?: string; // present once the battery is part of a chain (memory.md D-03)
};

export type BatteryCustody = 'yours' | 'other' | 'customer' | 'company' | 'transit';

export type BatteryChainInfo = {
  id: string;
  purchaseDate: string; // the original sale — every battery in the chain shares it (memory.md D-03)
  warrantyExpiry: string;
  termMonths: number;
  replacementCount: number;
  isOriginal: boolean; // this battery is the one first sold, not a replacement
  installedOn: string | null; // when THIS battery was handed over as a replacement
};

export type BatteryLookupResult =
  | { found: false; mfgMonth: string | null; serialNo: string; model: null; custody: null; chain: null; cover: BatteryCover }
  | {
      found: true;
      mfgMonth: string | null;
      serialNo: string;
      battery: {
        id: string;
        batteryCode: string;
        serialNo: string;
        mfgMonth: string | null;
        state: string;
        notOnRecord: boolean;
        alreadyReplaced: boolean; // entries.approve has already replaced it — cannot be replaced again
        isReplacement: boolean; // it was itself handed over as a replacement
        dealerId: string | null;
      };
      model: { id: string; family: string; type: string; capacity: string | null; warrantyMonths: number } | null;
      chain: BatteryChainInfo | null;
      custody: BatteryCustody;
      cover: BatteryCover;
    };

// architecture.md §9.9 — never reveals which OTHER dealer holds a battery to a dealer caller.
export function lookupBattery(code: string, accessToken: string) {
  return apiGet<BatteryLookupResult>(`/batteries/lookup?code=${encodeURIComponent(code)}`, { accessToken });
}
