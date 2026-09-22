import type { Audit, Battery, Challan, Dealer, Entry, Item, Model, Movement, Staff, State } from '../domain';
import { listAudit } from './audit';
import { listBatteries, type ApiBattery } from './batteries';
import { listClaims, type ApiClaim } from './claims';
import { listDealers, type ApiDealer } from './dealers';
import { listEntries, type EntryWithItems } from './entries';
import { getMastersBundle } from './masters';
import type { Session } from './session';
import { listMovements } from './stock';
import { listChallans, type ChallanResult } from './returns';
import { listAdmins } from './users';

/**
 * The bridge between the backend and the screens. Every screen still reads the local store
 * (`useStore().state`), so instead of rewriting each one to fetch, the store is HYDRATED from
 * the API: on sign-in, on foreground, after every write, and on "sync now". Backend enums are
 * snake_case; the store uses the Title Case labels the client-approved design shows
 * (memory.md §7) — the mapping lives here and nowhere else.
 *
 * Ids: the store's `Entry.id` is the human ref (ENT-26-09-0018) because that is what the
 * screens print and link on; the server uuid rides along as `apiId` for write calls. Dealers
 * and batteries use the server uuid / battery code directly, as the screens already did.
 */

const STATE_LABEL: Record<ApiBattery['state'], string> = { available: 'Available', allocated: 'Allocated', sold: 'Sold', returned: 'Returned', replacement: 'Replacement', repair: 'Repair', damaged: 'Damaged', scrap: 'Scrap' };
const DEALER_STATUS: Record<ApiDealer['status'], string> = { pending_approval: 'Pending Approval', active: 'Active', rejected: 'Rejected', suspended: 'Suspended' };
const ENTRY_TYPE: Record<EntryWithItems['entryType'], string> = { replacement: 'Replacement', sales_return: 'Sales Return', regular_sales: 'Regular Sales' };
const ROLE_LABEL: Record<string, string> = { main_admin: 'Main Admin', co_admin: 'Co-Admin', operations: 'Operations', inventory_manager: 'Inventory manager', read_only: 'Read-only', dealer_manager: 'Dealer manager', dealer_user: 'Dealer user' };
const USER_STATUS: Record<string, string> = { active: 'Active', temporarily_blocked: 'Blocked', inactive: 'Inactive', soft_deleted: 'Deleted' };
const FAULT_LABEL: Record<string, string> = { not_holding_charge: 'Not holding charge', low_backup: 'Low backup', swollen_case: 'Swollen case', leaking: 'Leaking', other: 'Other' };

/** Where the old battery is, in the words the returns screens use (memory.md §1a flow). */
export function returnStageOf(claim: ApiClaim | undefined): Entry['returnState'] {
  if (!claim) return undefined;
  switch (claim.status) {
    case 'raised': return 'At dealer';
    case 'awaiting_return': return 'In transit';
    case 'received': return 'Received';
    case 'checked': return claim.disposition === 'repair' ? 'Repaired' : claim.disposition === 'scrap' ? 'Scrapped' : 'Testing';
    default: return 'Closed';
  }
}

/**
 * The status a person sees. A replacement entry is only "Approved" once head office has
 * decided the CLAIM (that is when the credit exists) — between the entry approval and the
 * claim decision it reads "Under Review", which is what the two-step flow (memory.md D-05) is.
 */
export function entryStatusOf(e: EntryWithItems, claim: ApiClaim | undefined): Entry['status'] {
  if (e.status === 'submitted') return 'Submitted';
  if (e.status === 'rejected') return 'Rejected';
  if (e.entryType !== 'replacement' || !claim) return 'Approved';
  if (claim.status === 'approved') return 'Approved';
  if (claim.status === 'refused') return 'Rejected';
  return 'Under Review';
}

function toItem(it: EntryWithItems['items'][number], e: EntryWithItems, batteries: Map<string, ApiBattery>): Item {
  const b = batteries.get(it.batteryCode);
  return {
    id: it.id,
    model: it.modelId,
    code: it.batteryCode,
    serial: it.batteryCode.slice(-4),
    oldSerial: it.oldBatteryCode ?? '',
    mfg: b?.mfgMonth ?? (/^\d{8}$/.test(it.batteryCode) ? `20${it.batteryCode.slice(0, 2)}-${it.batteryCode.slice(2, 4)}` : ''),
    rpl: e.entryDate.slice(0, 7),
    rtn: '',
    wr: it.oldBatteryCode ?? '',
    remarks: it.remarks ?? '',
    fault: it.faultCode ? (FAULT_LABEL[it.faultCode] ?? it.faultCode) : undefined,
  };
}

export function toEntry(e: EntryWithItems, claims: Map<string, ApiClaim>, batteries: Map<string, ApiBattery>): Entry {
  const claim = e.items.map((it) => (it.claimId ? claims.get(it.claimId) : undefined)).find(Boolean);
  return {
    id: e.ref,
    apiId: e.id,
    dealerId: e.dealerId,
    type: ENTRY_TYPE[e.entryType],
    date: e.entryDate,
    customer: e.customerName ?? '',
    place: e.place,
    order: '',
    remarks: e.remarks ?? '',
    items: e.items.map((it) => toItem(it, e, batteries)),
    status: entryStatusOf(e, claim),
    evidence: [],
    gps: e.gps ?? undefined,
    signature: e.signature ?? undefined,
    createdAt: e.createdAt,
    retries: 0,
    returnState: e.entryType === 'replacement' && e.status === 'approved' ? returnStageOf(claim) : undefined,
    returnNote: claim?.findingCode ? `Finding: ${claim.findingCode}${claim.conditionNote ? ` · ${claim.conditionNote}` : ''}` : undefined,
    coverTold: e.coverToldAt ? 'yes' : undefined,
    claimId: claim?.id,
    claimStatus: claim?.status,
    decidedAt: claim?.decidedAt ?? e.decidedAt ?? undefined,
    decisionReason: claim?.decisionReason ?? e.decisionReason ?? undefined,
  };
}

export function toBattery(b: ApiBattery, customerByCode: Map<string, string>): Battery {
  return {
    code: b.batteryCode,
    serial: b.serialNo,
    model: b.modelId,
    dealerId: b.dealerId ?? '',
    customer: customerByCode.get(b.batteryCode) ?? '',
    mfg: b.mfgMonth ?? '',
    oldSerial: b.replacedFromCode ?? undefined,
    start: b.warrantyStart ?? undefined,
    expiry: b.warrantyExpiry ?? undefined,
    policy: b.chainId ? 'POL-01' : undefined,
    state: STATE_LABEL[b.state],
  };
}

export function toDealer(d: ApiDealer, cityName: (id: string) => string): Dealer {
  return {
    id: d.id,
    code: d.dealerCode ?? undefined,
    name: d.name,
    contact: d.contactPerson,
    mobile: d.mobile,
    email: d.email ?? '',
    city: cityName(d.cityId),
    place: d.place ?? '',
    address: d.address,
    pin: d.pin,
    state: d.state,
    status: DEALER_STATUS[d.status],
    reason: d.statusReason ?? undefined,
  };
}

/**
 * The decisions the dealer's claims screens look up (`decisionOf` reads audits with the
 * entry ref). Built from the claims themselves, so a dealer — who cannot read the audit log —
 * still sees head office's decision and reason.
 */
function decisionAudits(entries: Entry[]): Audit[] {
  return entries
    .filter((e) => e.type === 'Replacement' && (e.status === 'Approved' || e.status === 'Rejected') && e.decidedAt)
    .map((e) => ({ id: `DEC-${e.id}`, actor: 'Head office', action: e.status === 'Approved' ? 'Entry approved' : 'Reject entry', ref: e.id, reason: e.decisionReason ?? '', at: e.decidedAt! }));
}

const RETURN_STAGE: Record<ChallanResult['lines'][number]['stage'], string> = { in_transit: 'In transit', received: 'Received', testing: 'Testing', repaired: 'Repaired', scrapped: 'Scrapped', closed: 'Closed' };
const STAGE_ORDER = ['At dealer', 'In transit', 'Received', 'Testing', 'Repaired', 'Scrapped', 'Closed'];

/** `refOf` turns the server's entry uuid into the store's entry id (the ENT- ref). */
export function toChallan(c: ChallanResult, refOf: (entryId: string) => string): Challan {
  return {
    no: c.no, serverId: c.id, dealerId: c.dealerId, at: c.dispatchedAt, vehicle: c.vehicleNo ?? '', driver: c.driverName ?? '',
    receivedAt: c.receivedAt ?? undefined,
    entryIds: [...new Set(c.lines.map((l) => refOf(l.entryId)))],
    rows: c.lines.map((l) => ({ serial: l.batteryCode, model: l.modelId, ref: refOf(l.entryId), fault: l.faultCode ? (FAULT_LABEL[l.faultCode] ?? l.faultCode) : '—', lineId: l.id, stage: RETURN_STAGE[l.stage] })),
  };
}

/**
 * A challan tracks the physical old battery from the moment the dealer hands it over — which
 * can be before head office approves the entry (no claim yet). Where both a challan line and a
 * claim describe the same battery, the further-along stage wins.
 */
export function withChallanStages(entries: Entry[], challans: Challan[]): Entry[] {
  const best = new Map<string, { state: string; note: string }>();
  for (const c of challans) for (const r of c.rows) {
    if (!r.stage) continue;
    const cur = best.get(r.ref);
    if (!cur || STAGE_ORDER.indexOf(r.stage) > STAGE_ORDER.indexOf(cur.state)) best.set(r.ref, { state: r.stage, note: `Challan ${c.no}${c.vehicle ? ` · ${c.vehicle}` : ''}` });
  }
  return entries.map((e) => {
    const line = best.get(e.id);
    if (!line) return e;
    const further = !e.returnState || STAGE_ORDER.indexOf(line.state) >= STAGE_ORDER.indexOf(e.returnState);
    return further ? { ...e, returnState: line.state, returnNote: e.returnNote ? `${line.note} · ${e.returnNote}` : line.note } : e;
  });
}

export type Hydrated = Partial<State> & { syncedAt: string };

export async function fetchHydrated(session: Session, token: string): Promise<Hydrated> {
  const isAdmin = session.user.scope === 'admin';
  const [masters, entriesPage, batteriesPage, claimsPage, movementsPage, dealersPage, auditPage, adminsPage, challanPage] = await Promise.all([
    getMastersBundle(),
    listEntries(token),
    listBatteries(token),
    listClaims(token),
    listMovements(token),
    isAdmin ? listDealers(token) : Promise.resolve(null),
    isAdmin ? listAudit(token).catch(() => null) : Promise.resolve(null), // co-admins without audit.read still sync everything else
    isAdmin && session.user.role === 'main_admin' ? listAdmins(token).catch(() => null) : Promise.resolve(null),
    listChallans({ limit: 200 }, token),
  ]);

  const cityName = (id: string) => masters.cities.find((c) => c.id === id)?.name ?? id;
  const batteriesByCode = new Map(batteriesPage.items.map((b) => [b.batteryCode, b]));
  const claimsById = new Map(claimsPage.items.map((c) => [c.id, c]));
  const refOf = new Map(entriesPage.items.map((e) => [e.id, e.ref]));
  const challans = challanPage.items.map((c) => toChallan(c, (id) => refOf.get(id) ?? id));
  const entries = withChallanStages(entriesPage.items.map((e) => toEntry(e, claimsById, batteriesByCode)), challans);

  // a battery's "customer" is whoever the entry that sold/replaced it named
  const customerByCode = new Map<string, string>();
  for (const e of entries) for (const it of e.items) if (e.customer && it.code) customerByCode.set(it.code, e.customer);

  const models: Model[] = masters.models.map((m) => ({ id: m.id, plate: m.plate ?? undefined, modelNo: m.modelNo ?? undefined, type: m.type, capacity: m.capacity ?? '', months: m.warrantyMonths, threshold: 0, active: m.active }));
  const dealers: Dealer[] = dealersPage ? dealersPage.items.map((d) => toDealer(d, cityName)) : session.dealer ? [session.dealer] : [];
  const dealerLabel = (id: string | null) => (id ? (dealers.find((d) => d.id === id)?.name ?? id) : 'Company');

  const movements: Movement[] = movementsPage.items.map((m) => ({
    id: m.id,
    code: m.batteryCode,
    model: m.modelId,
    dealerId: m.toDealerId ?? '',
    from: m.fromState ? `${STATE_LABEL[m.fromState]}${m.fromCustodian ? ` · ${m.fromCustodian}` : ''}` : 'Created',
    to: `${STATE_LABEL[m.toState]} · ${m.toCustodian === 'dealer' ? dealerLabel(m.toDealerId) : m.toCustodian}`,
    reason: m.reasonText ?? m.reasonCode.replace(/_/g, ' '),
    date: m.postedAt.slice(0, 10),
  }));

  const audits: Audit[] = auditPage
    ? auditPage.items.map((a) => ({
        id: String(a.id),
        actor: `${a.actor.name ?? a.actor.role} · ${ROLE_LABEL[a.actor.role] ?? a.actor.role}`,
        action: a.action,
        ref: a.entityRef ?? a.entityId,
        reason: a.reason ?? '',
        at: a.at,
        before: a.before == null ? undefined : JSON.stringify(a.before),
        after: a.after == null ? undefined : JSON.stringify(a.after),
      }))
    : decisionAudits(entries);

  const staff: Staff[] | undefined = adminsPage
    ? adminsPage.items.map((u) => ({ id: u.id, name: u.name, email: u.email ?? u.mobile ?? '', role: ROLE_LABEL[u.role] ?? u.role, roleKey: u.role, status: USER_STATUS[u.status] ?? u.status, permissions: u.role === 'main_admin' ? ['All'] : [] }))
    : undefined;

  return {
    syncedAt: new Date().toISOString(),
    models,
    cities: masters.cities.map((c) => c.name),
    plateTypes: masters.plateTypes.map((p) => ({ code: p.code, label: p.label })),
    graceMonths: masters.warrantyGraceMonths,
    dealers,
    entries,
    challans,
    batteries: batteriesPage.items.map((b) => toBattery(b, customerByCode)),
    movements,
    audits,
    ...(staff ? { staff } : {}),
    lastSync: new Date().toISOString(),
    offline: false,
  };
}
