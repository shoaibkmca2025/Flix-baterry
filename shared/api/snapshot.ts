import { apiGet } from './client';
import type { ApiAuditEvent } from './audit';
import type { ApiBattery } from './batteries';
import type { ApiClaim } from './claims';
import type { ApiCreditNote } from './credits';
import type { ApiDealer } from './dealers';
import type { EntryWithItems } from './entries';
import type { getMastersBundle } from './masters';
import type { ChallanResult } from './returns';
import type { ApiMovement } from './stock';
import type { ApiUser } from './users';

type Page<T> = { items: T[]; nextCursor?: string | null };
/** GET /sync — every list the app loads, in one round trip. A section the user may not read is null. */
export type Snapshot = {
  masters: Awaited<ReturnType<typeof getMastersBundle>>;
  entries: Page<EntryWithItems> | null;
  batteries: Page<ApiBattery> | null;
  claims: Page<ApiClaim> | null;
  movements: Page<ApiMovement> | null;
  dealers: Page<ApiDealer> | null;
  audit: Page<ApiAuditEvent> | null;
  admins: { items: ApiUser[] } | null;
  challans: Page<ChallanResult> | null;
  creditNotes: Page<ApiCreditNote> | null;
  syncedAt: string;
};

export function getSnapshot(accessToken: string) {
  return apiGet<Snapshot>('/sync', { accessToken });
}
