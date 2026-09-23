import { apiGet } from './client';

export type City = { id: string; name: string; state: string; active: boolean };
export type ApiModel = { id: string; family: string; plate: string | null; modelNo: string | null; type: string; capacity: string | null; warrantyMonths: number; active: boolean };
export type ApiPlateType = { code: string; label: string; sortOrder: number; active: boolean };

export function getMastersBundle() {
  return apiGet<{ cities: City[]; models: ApiModel[]; plateTypes: ApiPlateType[]; warrantyGraceMonths: number }>('/masters');
}
