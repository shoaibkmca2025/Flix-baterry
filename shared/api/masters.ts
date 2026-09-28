import { apiGet, apiPatch, apiPost } from './client';

export type City = { id: string; name: string; state: string; active: boolean };
export type ApiModel = { id: string; family: string; plate: string | null; modelNo: string | null; brand: string; type: string; capacity: string | null; warrantyMonths: number; active: boolean };
export type ApiPlateType = { code: string; label: string; plateCount: number | null; sortOrder: number; active: boolean };
export type ApiPlant = { id: string; name: string; active: boolean };

export function getMastersBundle() {
  return apiGet<{ cities: City[]; models: ApiModel[]; plateTypes: ApiPlateType[]; plants?: ApiPlant[]; warrantyGraceMonths: number; serialDigitLengths: number[] }>('/masters');
}

/** Main admin: add a plant (D-19). */
export function createPlant(input: { name: string }, accessToken: string) {
  return apiPost<ApiPlant>('/masters/plants', input, { accessToken });
}

/** Main admin: rename a plant, or switch it off / back on. Plants are never deleted. */
export function updatePlant(id: string, input: { name?: string; active?: boolean }, accessToken: string) {
  return apiPatch<ApiPlant>(`/masters/plants/${id}`, input, { accessToken });
}
