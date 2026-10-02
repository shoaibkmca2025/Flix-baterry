import { faultCode } from '../domain';
import type { Entry } from '../domain';
import type { EntryCreateInput, EntryItemInput, EntryType } from './entries';

// faultCode lives in domain.ts beside the list of faults itself, so what is sent here and what
// mapping.ts turns back into words can only ever come from the same place.

/**
 * A store entry as POST /entries wants it. Used by the dealer app when a dealer sends a
 * request, and by the console when head office records one on a dealer's behalf.
 *
 * Note: `evidence`/`evidenceTags` (the photos) have no field on the backend yet — evidence
 * storage is Cloudinary, still open (memory.md D-10). Photos stay local-only for now.
 */
export function buildEntryBody(e: Entry): EntryCreateInput {
  const entryType: EntryType = e.type === 'Replacement' ? 'replacement' : 'sales_return';
  const items: EntryItemInput[] = e.items.map(it => ({
    modelId: it.model,
    code: it.code,
    ...(entryType === 'replacement' ? { oldCode: it.oldSerial, oldModelId: it.oldModel || undefined, faultCode: it.fault ? faultCode(it.fault) : undefined } : {}),
    remarks: it.remarks || undefined,
  }));
  return { entryType, place: e.place, customerName: e.customer || undefined, items, gps: e.gps, signature: e.signature, coverTold: !!e.coverTold };
}
