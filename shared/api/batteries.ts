import { apiGet } from './client';

export type BatteryCover = {
  mfgMonth: string | null;
  startDate: string; // where the cover is counted from — the first day of the manufacture month (memory.md D-11)
  expiryDate: string;
  inWarranty: boolean;
  daysRemaining: number;
  termMonths: number; // the (plate, model) term …
  graceMonths: number; // … plus the grace the company adds for shelf time
  warrantyStart?: string; // present once the battery is part of a chain
};
export type LookupModel = { id: string; plate: string | null; modelNo: string | null; family: string; type: string; capacity: string | null; warrantyMonths: number };

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
  | { found: false; mfgMonth: string | null; serialNo: string; labelModelId: string | null; model: LookupModel | null; custody: null; chain: null; cover: BatteryCover }
  | {
      found: true;
      mfgMonth: string | null;
      serialNo: string;
      labelModelId: string | null;
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
      model: LookupModel | null;
      chain: BatteryChainInfo | null;
      custody: BatteryCustody;
      cover: BatteryCover;
    };

// architecture.md §9.9 — never reveals which OTHER dealer holds a battery to a dealer caller.
export function lookupBattery(code: string, accessToken: string, modelId?: string) {
  return apiGet<BatteryLookupResult>(`/batteries/lookup?code=${encodeURIComponent(code)}${modelId ? `&modelId=${encodeURIComponent(modelId)}` : ''}`, { accessToken });
}

export type ApiBattery = {
  id: string;
  batteryCode: string;
  serialNo: string;
  modelId: string;
  mfgMonth: string | null;
  state: 'available' | 'allocated' | 'sold' | 'returned' | 'replacement' | 'repair' | 'damaged' | 'scrap';
  custodian: 'company' | 'dealer' | 'customer' | 'transit';
  dealerId: string | null;
  notOnRecord: boolean;
  chainId: string | null;
  replacedFromId: string | null;
  replacedById: string | null;
  warrantyStart: string | null;
  warrantyExpiry: string | null;
  replacementCount: number | null;
  replacedFromCode: string | null;
  createdAt: string;
};

export function listBatteries(accessToken: string) {
  return apiGet<{ items: ApiBattery[]; nextCursor: string | null }>('/batteries?limit=200', { accessToken });
}
