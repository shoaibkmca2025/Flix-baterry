import { apiGet } from './client';

export type City = { id: string; name: string; state: string; active: boolean };

export function getMastersBundle() {
  return apiGet<{ cities: City[] }>('/masters');
}
