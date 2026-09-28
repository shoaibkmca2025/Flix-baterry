import { apiDelete, apiGet, apiPatch, apiPost } from './client';

export type City = { id: string; name: string; state: string; active: boolean };
export type ApiModel = { id: string; family: string; plate: string | null; modelNo: string | null; brand: string; type: string; capacity: string | null; warrantyMonths: number; active: boolean };
export type ApiPlateType = { code: string; label: string; plateCount: number | null; sortOrder: number; active: boolean };
export type ApiPlant = { id: string; name: string; active: boolean };
/** A plant with its details — admin-only (GET /masters/plants); the public bundle carries names only. */
export type PlantInfo = ApiPlant & { location: string | null; contactName: string | null; contactPhone: string | null; notes: string | null };
/** An empty string clears a detail. */
export type PlantDetails = { location?: string; contactName?: string; contactPhone?: string; notes?: string };

export function getMastersBundle() {
  return apiGet<{ cities: City[]; models: ApiModel[]; plateTypes: ApiPlateType[]; plants?: ApiPlant[]; warrantyGraceMonths: number; serialDigitLengths: number[] }>('/masters');
}

/** Main admin: every plant with its details. */
export function listPlants(accessToken: string) {
  return apiGet<PlantInfo[]>('/masters/plants', { accessToken });
}

/** Main admin: add a plant (D-19). */
export function createPlant(input: { name: string } & PlantDetails, accessToken: string) {
  return apiPost<PlantInfo>('/masters/plants', input, { accessToken });
}

/** Main admin: rename a plant, change its details, or switch it off / back on. */
export function updatePlant(id: string, input: { name?: string; active?: boolean } & PlantDetails, accessToken: string) {
  return apiPatch<PlantInfo>(`/masters/plants/${id}`, input, { accessToken });
}

/** Main admin: delete a plant no battery is counted under (the server refuses one in use). */
export function deletePlant(id: string, accessToken: string) {
  return apiDelete<{ id: string; deleted: true }>(`/masters/plants/${id}`, { accessToken });
}
