import { Battery, Challan, Dealer, Entry, State, anyDigitLengths, chainFor, deriveCode, expiryFrom, normalize, sameBattery, today, warranty, validateEntry } from './domain';
import { escapeHtml } from './html';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parse = (s: string) => new Date(s.length <= 10 ? s + 'T12:00:00' : s);
const pad = (n: number) => String(n).padStart(2, '0');

/** 09 Jan 2028 */
export const dLong = (s?: string) => { if (!s) return '—'; const d = parse(s); return `${pad(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
/** 30 Aug */
export const dShort = (s?: string) => { if (!s) return '—'; const d = parse(s); return `${pad(d.getDate())} ${MON[d.getMonth()]}`; };
/** 9:43 am */
export const tShort = (s?: string) => { if (!s || s.length <= 10) return ''; const d = new Date(s); const h = d.getHours(); return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`; };
/** April 2021 (from 2021-04) */
export const monthLong = (ym?: string) => { if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return '—'; return `${MONTH[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`; };
/** Apr 2021 */
export const monthShort = (ym?: string) => { if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return '—'; return `${MON[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`; };
/** Sep 2028 */
export const monYear = (s: string) => { const d = parse(s); return `${MON[d.getMonth()]} ${d.getFullYear()}`; };

/** Whole years, months and days between two ISO dates (a ≤ b). */
export function span(a: string, b: string) {
  const x = parse(a), y = parse(b);
  if (y < x) return { y: 0, m: 0, d: 0 };
  let months = (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth();
  let days = y.getDate() - x.getDate();
  if (days < 0) { months -= 1; days += new Date(y.getFullYear(), y.getMonth(), 0).getDate(); }
  return { y: Math.floor(months / 12), m: months % 12, d: days };
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const spanShort = (s: { y: number; m: number; d: number }) => s.y ? `${s.y} yr ${s.m} mo` : s.m ? `${s.m} mo ${s.d} d` : plural(s.d, 'day');
export const spanLong = (s: { y: number; m: number; d: number }) => s.y ? `${plural(s.y, 'year')}, ${plural(s.m, 'month')}` : s.m ? `${plural(s.m, 'month')}, ${plural(s.d, 'day')}` : plural(s.d, 'day');

/** Cover a battery carries — always the dates of the first sale in its chain. */
export function coverOf(b: Battery | undefined, state: State) {
  if (!b || !b.start || !b.expiry) return null;
  const now = today();
  const total = Date.parse(b.expiry) - Date.parse(b.start);
  const used = Math.max(0, Math.min(1, (Date.parse(now) - Date.parse(b.start)) / Math.max(1, total)));
  const w = warranty(b, now, state.policies[0]?.alertDays ?? 30);
  const policy = state.policies.find(p => p.id === b.policy) || state.policies[0];
  const chain = chainFor(b.code, state.batteries);
  return { start: b.start, expiry: b.expiry, used, status: w.status, policy, months: policy?.months ?? 24, usedSpan: span(b.start, now), leftSpan: span(now, b.expiry), replacements: Math.max(0, chain.length - 1) };
}
export const coverChip = (status: string): [string, 'live' | 'warn' | 'mute' | 'bad'] =>
  status === 'Active' ? ['Cover active', 'live'] : status === 'Expiring soon' ? ['Cover ending soon', 'warn'] : status === 'Expired' ? ['Cover ended', 'bad'] : ['Not on record', 'mute'];

export const findBattery = (state: State, code: string) => state.batteries.find(b => normalize(b.code) === normalize(code));
export const dealerEntries = (state: State, dealerId: string) => state.entries.filter(e => e.dealerId === dealerId).sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));
export const avatarTone = (status: string) => status === 'Approved' ? 'green' : status === 'Conflict' || status === 'Rejected' ? 'red' : status === 'Pending sync' ? 'amber' : status === 'Draft' ? 'mute' : 'blue';

export function nextEntryId(state: State) {
  const d = new Date(), stem = `ENT-${String(d.getFullYear()).slice(2)}-${pad(d.getMonth() + 1)}-`;
  const max = state.entries.reduce((m, e) => { const r = /^ENT-\d\d-\d\d-(\d{4})$/.exec(e.id); return r ? Math.max(m, Number(r[1])) : m; }, 0);
  return stem + String(max + 1).padStart(4, '0');
}
export function nextChallanNo(state: State) {
  const d = new Date(), stem = `FBI-RT-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}-`;
  const n = state.challans.filter(c => c.no.startsWith(stem)).length + 1;
  return stem + pad(n);
}

export const decisionOf = (state: State, id: string) => state.audits.find(a => a.ref === id && ['Entry approved', 'Reject entry'].includes(a.action));
export const personOf = (actor?: string) => (actor || 'Head office').split(' · ')[0];

/**
 * A replacement head office has approved for refund. That is all anyone is shown — no amount:
 * Felix's accounts team works out and pays the refund (client, 28 Sep 2026 — memory.md D-20).
 * On the server a replacement is approved in two steps (entry, then its claim), so until the
 * claim is decided it is still being checked.
 */
export const approvedForRefund = (e: Entry) =>
  e.type === 'Replacement' && e.status === 'Approved' && (!e.claimStatus || e.claimStatus === 'approved');
const refusedClaim = (e: Entry) => e.status === 'Rejected' || e.claimStatus === 'refused';

// the business month is Asia/Kolkata, same as the server's summary
const IST = 5.5 * 60 * 60 * 1000;
const istMonth = (iso: string) => new Date(Date.parse(iso) + IST).toISOString().slice(0, 7);

/** A dealer's replacements by outcome: approved for refund, refused, still being checked. */
/**
 * A distributor's own requests and his dealers' (client, 2 Oct 2026). In his app the store only
 * ever holds those two, so every request that is not his own draft belongs to one of his dealers.
 */
export const networkEntries = (state: State, dealerId: string) => state.entries.filter(e => e.dealerId === dealerId || e.status !== 'Draft')
  .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));

export function refunds(state: State, dealerId: string, withDealers = false) {
  const reps = (withDealers ? networkEntries(state, dealerId) : dealerEntries(state, dealerId)).filter(e => e.type === 'Replacement');
  const month = istMonth(new Date().toISOString());
  const approved = reps.filter(approvedForRefund)
    .map(e => ({ entry: e, date: decisionOf(state, e.id)?.at || e.decidedAt || e.date }))
    .sort((x, y) => y.date.localeCompare(x.date));
  return {
    approved,
    refused: reps.filter(refusedClaim),
    checking: reps.filter(e => !approvedForRefund(e) && !refusedClaim(e) && ['Submitted', 'Under Review', 'Conflict', 'Approved'].includes(e.status)),
    monthCount: approved.filter(x => istMonth(x.date) === month).length,
  };
}

/** Replacement requests whose old battery is still sitting in the shop. */
// withDealers: a distributor sends back his dealers' old batteries too, once he has approved their requests
// ...and a dealer's request only once every one of its old batteries has reached him (client, 3 Oct 2026)
export const toSendBack = (state: State, dealerId: string, withDealers = false) => (withDealers ? networkEntries(state, dealerId) : dealerEntries(state, dealerId)).filter(e => e.type === 'Replacement' && ['Submitted', 'Under Review', 'Conflict', 'Approved'].includes(e.status) && (!e.returnState || e.returnState === 'At dealer') && e.items.some(i => i.oldSerial)
  && (e.dealerId === dealerId || e.items.every(i => !i.oldSerial || !!i.arrivedAtDistributor)));

/**
 * Where one battery of a dealer's request stands, as its distributor sees it (client, 3 Oct 2026):
 * requested → approved by him, waiting for the old battery → arrived at him → dispatched →
 * at the factory → head office's decision. A sales return has no old battery to hand over.
 */
export type DistributorStage = { key: 'requested' | 'awaiting' | 'arrived' | 'dispatched' | 'factory' | 'headoffice' | 'approved' | 'refused'; label: string; tone: 'warn' | 'info' | 'live' | 'vio' | 'bad' | 'mute'; hint: string };
export function distributorStage(e: Entry, it: Entry['items'][number]): DistributorStage {
  const st = it.status ?? e.status;
  if (e.status === 'With distributor') return { key: 'requested', label: 'Requested', tone: 'warn', hint: 'Check the photos and serial, then approve or refuse' };
  if (st === 'Rejected' || e.status === 'Rejected') return { key: 'refused', label: 'Refused', tone: 'bad', hint: e.decisionReason || '' };
  if (st === 'Approved') return { key: 'approved', label: 'Approved', tone: 'live', hint: 'Head office approved it for refund' };
  if (e.type !== 'Replacement' || !it.oldSerial) return { key: 'headoffice', label: 'With head office', tone: 'info', hint: 'You approved it — head office decides' };
  if (it.returnState && !['At dealer', 'In transit'].includes(it.returnState)) return { key: 'factory', label: 'At factory', tone: 'live', hint: 'Head office is checking it' };
  if (it.returnState === 'In transit') return { key: 'dispatched', label: 'Dispatched', tone: 'vio', hint: 'On your challan to head office' };
  if (it.arrivedAtDistributor) return { key: 'arrived', label: 'Arrived at you', tone: 'live', hint: 'Ready to send — use Send back' };
  return { key: 'awaiting', label: 'Waiting for the battery', tone: 'info', hint: 'You approved it — mark it arrived when the dealer hands it over' };
}
export const ageDays = (iso: string) => Math.max(0, Math.round((Date.parse(today()) - Date.parse(iso.slice(0, 10))) / 86400000));

export function challanStatus(c: Challan, state: State): { label: string; status: string; sub: string } {
  const entries = c.entryIds.map(id => state.entries.find(e => e.id === id)).filter(Boolean) as Entry[];
  if (entries.some(e => e.returnState === 'In transit')) return { label: 'In transit', status: 'In transit', sub: 'not yet arrived' };
  if (entries.length && entries.every(e => ['Approved', 'Rejected'].includes(e.status))) return { label: 'Closed', status: 'Closed', sub: 'all decided' };
  return { label: 'Being checked', status: 'Received', sub: 'arrived' };
}

export const attention = (entries: Entry[]) => entries.filter(e => ['Conflict', 'Rejected', 'Pending sync', 'Draft'].includes(e.status));
/**
 * What is wrong with this request, in one line. Local validation first; failing that, the
 * reason head office gave when it refused the send — otherwise a rejected entry would sit in
 * My requests with no explanation, since the app cannot re-derive the server's decision.
 */
/**
 * A replacement cannot go past the new battery until that battery has been photographed
 * (client, 29 Sep 2026). The photo is kept under the tag 'New label' — ' · item N' for the
 * second battery on a request onwards.
 */
export const newPhotoTag = (i: number) => i === 0 ? 'New label' : `New label · item ${i + 1}`;
export const needsNewBatteryPhoto = (e: Entry, i: number) => {
  if (e.type !== 'Replacement') return false;
  const k = (e.evidenceTags ?? []).indexOf(newPhotoTag(i));
  return k < 0 || !e.evidence[k];
};

/**
 * A replacement as head office handles it at the factory: one Entry per old battery, each with
 * its own claim, stage, plant and decision (client, 2 Oct 2026). A one-battery entry is itself.
 */
/**
 * A replacement as head office handles it: ONE unit per battery, always — even when the request
 * carries a single battery. A dealer may send two batteries as one request or as two, and before
 * this that choice silently changed the review screen: a one-battery request got a whole-request
 * Approve/Refuse, a two-battery one got per-battery cards. Same challan, two different forms
 * (client, 2 Oct 2026). Every battery is now reviewed and decided the same way.
 */
export const batteryUnits = (e: Entry): Entry[] => e.type !== 'Replacement' ? [e] : e.items.map((it, i) => ({
  ...e, items: [it], itemId: it.id, part: e.items.length > 1 ? `battery ${i + 1} of ${e.items.length}` : undefined,
  claimId: it.claimId, claimStatus: it.claimStatus, status: it.status ?? e.status,
  returnState: it.returnState ?? e.returnState, returnNote: it.returnNote ?? e.returnNote,
  decidedAt: it.decidedAt ?? e.decidedAt, decisionReason: it.decisionReason ?? e.decisionReason,
}));
/** The key that tells two batteries of one entry apart (an Entry's id is the request's). */
export const unitKey = (e: Entry) => e.itemId ? `${e.id}#${e.itemId}` : e.id;

/** A dealer works under a distributor and cannot dispatch old batteries (client, 2 Oct 2026). Every shop from before is a distributor. */
export const isDealerShop = (d?: Pick<Dealer, 'kind'>) => d?.kind === 'Dealer';
/** 'Distributor' or 'Dealer' — what a shop is called wherever it is named. */
export const roleOf = (d?: Pick<Dealer, 'kind'>) => isDealerShop(d) ? 'Dealer' : 'Distributor';
/** A shop as head office reads it: its name, its role, and a dealer's distributor (client, 2 Oct 2026). */
export function shopRole(state: Pick<State, 'dealers'>, id: string) {
  const d = state.dealers.find(x => x.id === id);
  const parent = d?.kind === 'Dealer' ? state.dealers.find(x => x.id === d.distributorId) : undefined;
  return { shop: d, name: d?.name || id, role: roleOf(d), parent, line: d?.kind === 'Dealer' ? `Dealer · under ${parent?.name || 'a distributor'}` : 'Distributor' };
}

export const firstProblem = (e: Entry, state: State) =>
  Object.values(validateEntry(e, state))[0] ?? e.items.find(i => i.exception)?.exception;

export function challanHtml(c: Challan, d: Dealer) {
  const date = dLong(c.at).replace(/^(\d\d) (\w+) (\d+)$/, (_, dd, m, y) => `${dd} ${MONTH[MON.indexOf(m)]} ${y}`);
  // The last four are left empty on purpose: the plant, voltage, gravity and a remark are filled
  // in by hand at the factory as each battery is opened and tested, then typed in later. Request
  // Ref. came out to make room — the serial already identifies the battery (client, 3 Oct 2026).
  const rows = c.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.serial)}</td><td>${escapeHtml(r.model)}</td><td>${escapeHtml(r.fault)}</td><td class="w"></td><td class="w"></td><td class="w"></td><td class="w"></td></tr>`).join('');
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Challan ' + escapeHtml(c.no) + '</title>' +
    '<style>body{font-family:Arial,Helvetica,sans-serif;color:#1B2430;max-width:760px;margin:30px auto;padding:0 24px;font-size:13px;line-height:1.5}' +
    'h1{font-size:21px;text-align:center;margin:0;letter-spacing:.02em}.sub{text-align:center;color:#5B6878;font-size:12px;margin:3px 0 14px}' +
    'hr{border:0;border-top:2px solid #141A23;margin:0 0 14px}h2{font-size:14px;letter-spacing:.12em;text-align:center;text-transform:uppercase;margin:0 0 16px}' +
    '.m{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;margin-bottom:16px}.m i{font-style:normal;color:#5B6878;font-size:11px}' +
    'table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px}th,td{border:1px solid #C4CDD8;padding:7px 8px;text-align:left}' +
    'th{background:#EDF0F4;font-size:10.5px;letter-spacing:.05em}' +
    'td{height:26px}.w{width:11%;background:#FCFCFD}'  /* the four written-in columns */ + '.tot{display:flex;justify-content:space-between;border-top:2px solid #141A23;padding-top:8px;font-weight:700;margin-bottom:16px}' +
    '.d{border-left:3px solid #E8A72C;padding-left:11px;color:#5B6878;font-size:11.5px;margin-bottom:34px}' +
    '.s{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;text-align:center;font-size:11px;color:#5B6878}.s div{border-top:1px solid #2B3746;padding-top:6px}' +
    '@media print{body{margin:0}}</style></head><body>' +
    '<h1>FELIX BATTERIES INDUSTRIES</h1><div class="sub">Battery Distribution &amp; Warranty Operations · Nashik, Maharashtra</div><hr>' +
    '<h2>Material Return Challan</h2>' +
    `<div class="m"><div><i>Challan No.</i><br><b>${escapeHtml(c.no)}</b></div><div><i>Date</i><br><b>${date}</b></div>` +
    `<div><i>From · Distributor</i><br><b>${escapeHtml(d.name)}</b><br>${[d.place, d.city].filter(Boolean).map(escapeHtml).join(', ')} · ${escapeHtml(d.code || d.id)}</div>` +
    '<div><i>To</i><br><b>Felix Batteries Industries</b><br>Warehouse, Nashik</div>' +
    `<div><i>Vehicle</i><br><b>${escapeHtml(c.vehicle || '—')}</b></div><div><i>Collected by</i><br><b>${escapeHtml(c.driver || '—')}</b></div></div>` +
    `<table><thead><tr><th>#</th><th>Serial No.</th><th>Model</th><th>Reported fault</th><th>Plant</th><th>Voltage</th><th>Gravity</th><th>Remark</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<div class="tot"><span>Total batteries returned</span><span>${c.rows.length}</span></div>` +
    '<div class="d">Returned for warranty inspection only. No sale value. Each battery remains the property of Felix Batteries Industries. Claims are decided after inspection at the company.</div>' +
    '<div class="s"><div>Distributor signature</div><div>Driver signature</div><div>Received at company</div></div></body></html>';
}


/** Requests that still hold a battery: a serial on one of these cannot be used on another. */
const OPEN_ELSEWHERE = ['Submitted', 'Under Review', 'Conflict', 'Pending sync'];

/**
 * Every check a replacement or return has to pass before it is sent, on top of the shared
 * field validation. Used by BOTH the dealer app and head office's "Record an entry" — the
 * console records on a dealer's behalf, so a request typed there must clear exactly the same
 * bar as one the dealer sent, or head office can create what it would refuse (client, 2 Oct 2026).
 *
 * Keyed `items.<i>.<field>` so a screen can show each message on the field it belongs to.
 */
export function entryErrors(e: Entry, state: State): Record<string, string> {
  const errs: Record<string, string> = { ...validateEntry(e, state) };
  const others = state.entries.filter(x => x.id !== e.id && OPEN_ELSEWHERE.includes(x.status));
  const modelIds = state.models.map(m => m.id);
  e.items.forEach((it, i) => {
    const key = `items.${i}.`;
    if (e.type === 'Replacement') {
      if (!it.fault) errs[key + 'fault'] = 'Choose what is wrong with the old battery.';
      const dupOld = it.oldSerial && others.find(x => x.type === 'Replacement' && x.items.some(y => sameBattery(y.oldSerial, y.oldModel, it.oldSerial, it.oldModel)));
      if (dupOld && !errs[key + 'oldSerial']) errs[key + 'oldSerial'] = `This old battery is already on request ${dupOld.id}.`;
      // Out of cover: the request must not be made at all. Worked out from the label — the same
      // sum the server does on approval — because almost no old battery is on record here.
      if (!errs[key + 'oldSerial'] && it.oldSerial) {
        const mfg = deriveCode(it.oldSerial, modelIds, anyDigitLengths(state.serialDigitLengths)).mfg;
        if (mfg) {
          const months = (state.models.find(m => m.id === (it.oldModel || it.model))?.months ?? 24) + (state.graceMonths ?? 2);
          const expiry = expiryFrom(`${mfg}-01`, months);
          if (Date.parse(expiry) < Date.parse(e.date)) {
            errs[key + 'oldSerial'] = `This battery's warranty ran out on ${dLong(expiry)} — ${months} months from ${monthLong(mfg)}. A replacement cannot be claimed for it.`;
          }
        }
      }
      if (i === 0 && !e.customer.trim()) errs['items.0.customer'] = 'Enter the customer name.';
    }
    const dupNew = it.code && others.find(x => x.items.some(y => sameBattery(y.code, y.model, it.code, it.model)));
    if (dupNew && !errs[key + 'code']) errs[key + 'code'] = `This battery is already on request ${dupNew.id}.`;
  });
  return errs;
}
