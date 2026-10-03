import { ENTRY_TYPES, faultCode, isEntryType } from '../domain';
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
  // Two types exist, and nothing else may reach here. This used to read "anything that is not a
  // replacement is a sales return", so the console's thirteen-item list quietly recorded Goods
  // Return, For Charging and the rest as sales returns (client, 3 Oct 2026).
  if (!isEntryType(e.type)) throw new Error(`${e.type} is not an entry type — use one of ${ENTRY_TYPES.join(' or ')}.`);
  const entryType: EntryType = e.type === 'Replacement' ? 'replacement' : 'sales_return';
  const items: EntryItemInput[] = e.items.map(it => ({
    modelId: it.model,
    code: it.code,
    // the old battery belongs to a replacement alone; the fault belongs to either — a dealer may
    // name one on a sales return too, and it is how the battery is checked (client, 3 Oct 2026)
    ...(entryType === 'replacement' ? { oldCode: it.oldSerial, oldModelId: it.oldModel || undefined } : {}),
    ...(it.fault ? { faultCode: faultCode(it.fault) } : {}),
    remarks: it.remarks || undefined,
  }));
  return {
    entryType, place: e.place, customerName: e.customer || undefined, items,
    gps: e.gps, signature: e.signature, coverTold: !!e.coverTold,
    // a sales return must say which kind it is; a replacement never carries one
    ...(entryType === 'sales_return' && e.returnKind ? { returnKind: e.returnKind.toLowerCase() as 'unsold' | 'defective' } : {}),
  };
}
