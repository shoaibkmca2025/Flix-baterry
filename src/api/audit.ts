import { apiGet } from './client';

export type ApiAuditEvent = {
  id: number;
  at: string;
  actor: { id: string | null; name: string | null; role: string; scope: string };
  action: string;
  entityType: string;
  entityId: string;
  entityRef: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  outcome: 'ok' | 'denied' | 'failed';
};

export function listAudit(accessToken: string) {
  return apiGet<{ items: ApiAuditEvent[]; nextCursor: string | null }>('/audit?limit=200', { accessToken });
}

/** One entry's history. Dealers see their own entries; head-office actors are reduced to "Head office". */
export function entryTrail(entryId: string, accessToken: string) {
  return apiGet<{ items: ApiAuditEvent[] }>(`/entries/${entryId}/audit`, { accessToken });
}
