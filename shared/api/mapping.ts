import { deriveCode, digitsOf, faultLabel } from '../domain';
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
import { getSnapshot } from './snapshot';
import { allPages, type Page } from './pages';
import { ApiError } from './client';

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

const findingOf = (claim: ApiClaim | undefined) => claim?.findingCode ? `Finding: ${claim.findingCode}${claim.conditionNote ? ` · ${claim.conditionNote}` : ''}` : undefined;

function toItem(it: EntryWithItems['items'][number], e: EntryWithItems, batteries: Map<string, ApiBattery>, claims: Map<string, ApiClaim>): Item {
  const b = batteries.get(it.batteryCode);
  // each old battery has its own claim, so its own stage and decision (client, 2 Oct 2026)
  const claim = it.claimId ? claims.get(it.claimId) : undefined;
  const rep = e.entryType === 'replacement';
  return {
    id: it.id,
    model: it.modelId,
    code: it.batteryCode,
    serial: it.batteryCode.slice(-4),
    oldSerial: it.oldBatteryCode ?? '',
    mfg: b?.mfgMonth ?? deriveCode(digitsOf(it.batteryCode, it.modelId)).mfg,
    rpl: e.entryDate.slice(0, 7),
    rtn: '',
    wr: it.oldBatteryCode ?? '',
    remarks: it.remarks ?? '',
    fault: faultLabel(it.faultCode),
    ...(rep ? {
      claimId: claim?.id,
      claimStatus: claim?.status,
      status: entryStatusOf(e, claim),
      returnState: e.status === 'approved' ? returnStageOf(claim) : undefined,
      returnNote: findingOf(claim),
      decidedAt: claim?.decidedAt ?? e.decidedAt ?? undefined,
      decisionReason: claim?.decisionReason ?? e.decisionReason ?? undefined,
    } : {}),
    // per-battery working state, on every entry type
    reviewStartedAt: it.reviewStartedAt ?? undefined,
    reviewNote: it.reviewNote ?? undefined,
    correctedAt: it.correctedAt ?? undefined,
    correctionReason: it.correctionReason ?? undefined,
  };
}

/**
 * A replacement with several batteries is decided battery by battery, so the request as a
 * whole is "Under Review" while any of them is undecided, "Rejected" only when every one was
 * refused, and "Approved" once each is decided and at least one approved.
 */
function wholeStatus(e: EntryWithItems, claims: (ApiClaim | undefined)[]): Entry['status'] {
  const each = (claims.length ? claims : [undefined]).map((c) => entryStatusOf(e, c));
  if (each.some((s) => s !== 'Approved' && s !== 'Rejected')) return each.find((s) => s !== 'Approved' && s !== 'Rejected')!;
  return each.every((s) => s === 'Rejected') ? 'Rejected' : 'Approved';
}

export function toEntry(e: EntryWithItems, claims: Map<string, ApiClaim>, batteries: Map<string, ApiBattery>): Entry {
  const itemClaims = e.items.map((it) => (it.claimId ? claims.get(it.claimId) : undefined));
  const claim = itemClaims.find(Boolean);
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
    items: e.items.map((it) => toItem(it, e, batteries, claims)),
    status: e.entryType === 'replacement' ? wholeStatus(e, itemClaims.filter(Boolean)) : entryStatusOf(e, claim),
    evidence: [],
    gps: e.gps ?? undefined,
    signature: e.signature ?? undefined,
    createdAt: e.createdAt,
    retries: 0,
    returnState: e.entryType === 'replacement' && e.status === 'approved' ? returnStageOf(claim) : undefined,
    returnNote: findingOf(claim),
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
    rows: c.lines.map((l) => ({ serial: l.batteryCode, model: l.modelId, ref: refOf(l.entryId), fault: faultLabel(l.faultCode) ?? '—', lineId: l.id, itemId: l.entryItemId, stage: RETURN_STAGE[l.stage], plantId: l.plantId ?? undefined, stagedAt: l.stagedAt ?? undefined })),
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
  // and the same, battery by battery, from that battery's own challan line
  const byItem = new Map<string, { state: string; note: string }>();
  for (const c of challans) for (const r of c.rows) if (r.stage && r.itemId) byItem.set(r.itemId, { state: r.stage, note: `Challan ${c.no}${c.vehicle ? ` · ${c.vehicle}` : ''}` });
  const furthest = <T extends { returnState?: string; returnNote?: string }>(x: T, line?: { state: string; note: string }): T => {
    if (!line) return x;
    const further = !x.returnState || STAGE_ORDER.indexOf(line.state) >= STAGE_ORDER.indexOf(x.returnState);
    return further ? { ...x, returnState: line.state, returnNote: x.returnNote ? `${line.note} · ${x.returnNote}` : line.note } : x;
  };
  return entries.map((e) => {
    const items = e.type === 'Replacement' ? e.items.map((it) => furthest(it, byItem.get(it.id))) : e.items;
    return furthest({ ...e, items }, best.get(e.id));
  });
}

export type Hydrated = Partial<State> & { syncedAt: string };

export async function fetchHydrated(session: Session, token: string): Promise<Hydrated> {
  const isAdmin = session.user.scope === 'admin';
  // One request (GET /sync) instead of nine: the server is ~250 ms away and speaks HTTP/1.1, so
  // nine calls meant several new TLS connections per refresh. A server without /sync (an older
  // deployment) answers 404, and the app falls back to the individual lists.
  const snap = await getSnapshot(token).catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; });
  const none = { items: [] as never[], nextCursor: null };
  const [masters, entriesFirst, batteriesFirst, claimsFirst, movementsFirst, dealersFirst, auditFirst, adminsPage, challanFirst] = snap
    ? [snap.masters, snap.entries ?? none, snap.batteries ?? none, snap.claims ?? none, snap.movements ?? none,
       isAdmin ? snap.dealers : null, isAdmin ? snap.audit : null, isAdmin ? snap.admins : null, snap.challans ?? none] as const
    : await Promise.all([
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

  // 200 rows is the FIRST page, not the list — /sync and the list routes both answer one page
  // and a cursor. The screens count and classify off the whole store (queues, "still at
  // dealers", whether a challan is finished), so stopping at 200 is silently wrong, and the
  // audit log already passes 200 in production. Follow each cursor to the end (logs.md,
  // 29 Sep 2026). Lists that came back complete cost nothing here.
  const page = <T>(first: { items: T[]; nextCursor?: string | null } | null | undefined, more: (cursor: string) => Promise<Page<T>>) =>
    first ? allPages({ items: first.items, nextCursor: first.nextCursor ?? null }, more) : Promise.resolve(null);

  const [entriesAll, batteriesAll, claimsAll, movementsAll, dealersPage, auditPage, challansAll] = await Promise.all([
    page(entriesFirst, (cursor) => listEntries(token, { cursor })),
    page(batteriesFirst, (cursor) => listBatteries(token, cursor)),
    page(claimsFirst, (cursor) => listClaims(token, cursor)),
    page(movementsFirst, (cursor) => listMovements(token, cursor)),
    page(dealersFirst, (cursor) => listDealers(token, undefined, cursor)),
    page(auditFirst, (cursor) => listAudit(token, cursor)),
    page(challanFirst, (cursor) => listChallans({ limit: 200, cursor }, token)),
  ]);
  // these four are readable by every signed-in caller, so they are never null here
  const entriesPage = entriesAll ?? none, batteriesPage = batteriesAll ?? none, claimsPage = claimsAll ?? none;
  const movementsPage = movementsAll ?? none, challanPage = challansAll ?? none;

  // A server a release behind may omit newer masters fields (plateTypes/grace arrived with D-11).
  // Default them rather than let one missing list abort the whole sync — that silently froze the
  // console on stale data (no new dealer registrations, no new requests).
  const plateTypes = masters.plateTypes ?? [];
  const cityName = (id: string) => masters.cities.find((c) => c.id === id)?.name ?? id;
  const batteriesByCode = new Map(batteriesPage.items.map((b) => [b.batteryCode, b]));
  const claimsById = new Map(claimsPage.items.map((c) => [c.id, c]));
  const refOf = new Map(entriesPage.items.map((e) => [e.id, e.ref]));
  const challans = challanPage.items.map((c) => toChallan(c, (id) => refOf.get(id) ?? id));
  const entries = withChallanStages(entriesPage.items.map((e) => toEntry(e, claimsById, batteriesByCode)), challans);

  // a battery's "customer" is whoever the entry that sold/replaced it named
  const customerByCode = new Map<string, string>();
  for (const e of entries) for (const it of e.items) if (e.customer && it.code) customerByCode.set(it.code, e.customer);

  const plateCountOf = new Map(plateTypes.map((p) => [p.code, p.plateCount]));
  const models: Model[] = masters.models.map((m) => ({ id: m.id, plate: m.plate ?? undefined, modelNo: m.modelNo ?? undefined, brand: m.brand, plateCount: m.plate ? plateCountOf.get(m.plate) ?? null : null, type: m.type, capacity: m.capacity ?? '', months: m.warrantyMonths, threshold: 0, active: m.active }));
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
    plateTypes: plateTypes.map((p) => ({ code: p.code, label: p.label, plateCount: p.plateCount })),
    graceMonths: masters.warrantyGraceMonths,
    serialDigitLengths: masters.serialDigitLengths,
    plants: (masters.plants ?? []).map(({ id, name, active }) => ({ id, name, active })),
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
