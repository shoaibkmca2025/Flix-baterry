import { Battery, Challan, Dealer, Entry, State, chainFor, normalize, today, warranty, validateEntry } from './domain';
import { escapeHtml } from './reports';

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

/** Demo credit value per model for an approved warranty claim (set by head office in production). */
export const CREDIT_VALUE: Record<string, number> = { M3: 3800, M5: 4250, M7: 4900, B5: 3600, S5: 1400, I700: 5200 };
export const rupees = (n: number) => '₹ ' + n.toLocaleString('en-IN');
export const decisionOf = (state: State, id: string) => state.audits.find(a => a.ref === id && ['Entry approved', 'Reject entry'].includes(a.action));
export const personOf = (actor?: string) => (actor || 'Head office').split(' · ')[0];

export function creditNotes(state: State, dealerId: string) {
  const reps = dealerEntries(state, dealerId).filter(e => e.type === 'Replacement');
  const credited = reps.filter(e => e.status === 'Approved').map(e => {
    const audit = decisionOf(state, e.id);
    return { no: e.id.replace(/^ENT/, 'CN'), entry: e, amount: e.items.reduce((t, i) => t + (CREDIT_VALUE[i.model] || 0), 0), date: audit?.at || e.date };
  });
  const month = today().slice(0, 7);
  return {
    credited, refused: reps.filter(e => e.status === 'Rejected'),
    checking: reps.filter(e => ['Submitted', 'Under Review', 'Conflict'].includes(e.status)),
    monthTotal: credited.filter(c => c.date.slice(0, 7) === month).reduce((t, c) => t + c.amount, 0),
    monthCount: credited.filter(c => c.date.slice(0, 7) === month).length,
  };
}

/** Replacement requests whose old battery is still sitting in the shop. */
export const toSendBack = (state: State, dealerId: string) => dealerEntries(state, dealerId).filter(e => e.type === 'Replacement' && ['Submitted', 'Under Review', 'Conflict', 'Approved'].includes(e.status) && (!e.returnState || e.returnState === 'At dealer') && e.items.some(i => i.oldSerial));
export const ageDays = (iso: string) => Math.max(0, Math.round((Date.parse(today()) - Date.parse(iso.slice(0, 10))) / 86400000));

export function challanStatus(c: Challan, state: State): { label: string; status: string; sub: string } {
  const entries = c.entryIds.map(id => state.entries.find(e => e.id === id)).filter(Boolean) as Entry[];
  if (entries.some(e => e.returnState === 'In transit')) return { label: 'In transit', status: 'In transit', sub: 'not yet arrived' };
  if (entries.length && entries.every(e => ['Approved', 'Rejected'].includes(e.status))) return { label: 'Closed', status: 'Closed', sub: 'all decided' };
  return { label: 'Being checked', status: 'Received', sub: 'arrived' };
}

export const attention = (entries: Entry[]) => entries.filter(e => ['Conflict', 'Rejected', 'Pending sync', 'Draft'].includes(e.status));
export const firstProblem = (e: Entry, state: State) => Object.values(validateEntry(e, state))[0];

export function challanHtml(c: Challan, d: Dealer) {
  const date = dLong(c.at).replace(/^(\d\d) (\w+) (\d+)$/, (_, dd, m, y) => `${dd} ${MONTH[MON.indexOf(m)]} ${y}`);
  const rows = c.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.serial)}</td><td>${escapeHtml(r.model)}</td><td>${escapeHtml(r.ref)}</td><td>${escapeHtml(r.fault)}</td></tr>`).join('');
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Challan ' + escapeHtml(c.no) + '</title>' +
    '<style>body{font-family:Arial,Helvetica,sans-serif;color:#1B2430;max-width:760px;margin:30px auto;padding:0 24px;font-size:13px;line-height:1.5}' +
    'h1{font-size:21px;text-align:center;margin:0;letter-spacing:.02em}.sub{text-align:center;color:#5B6878;font-size:12px;margin:3px 0 14px}' +
    'hr{border:0;border-top:2px solid #141A23;margin:0 0 14px}h2{font-size:14px;letter-spacing:.12em;text-align:center;text-transform:uppercase;margin:0 0 16px}' +
    '.m{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;margin-bottom:16px}.m i{font-style:normal;color:#5B6878;font-size:11px}' +
    'table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px}th,td{border:1px solid #C4CDD8;padding:7px 8px;text-align:left}' +
    'th{background:#EDF0F4;font-size:10.5px;letter-spacing:.05em}.tot{display:flex;justify-content:space-between;border-top:2px solid #141A23;padding-top:8px;font-weight:700;margin-bottom:16px}' +
    '.d{border-left:3px solid #E8A72C;padding-left:11px;color:#5B6878;font-size:11.5px;margin-bottom:34px}' +
    '.s{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;text-align:center;font-size:11px;color:#5B6878}.s div{border-top:1px solid #2B3746;padding-top:6px}' +
    '@media print{body{margin:0}}</style></head><body>' +
    '<h1>FELIX BATTERIES INDUSTRIES</h1><div class="sub">Battery Distribution &amp; Warranty Operations · Nashik, Maharashtra</div><hr>' +
    '<h2>Material Return Challan</h2>' +
    `<div class="m"><div><i>Challan No.</i><br><b>${escapeHtml(c.no)}</b></div><div><i>Date</i><br><b>${date}</b></div>` +
    `<div><i>From · Dealer</i><br><b>${escapeHtml(d.name)}</b><br>${[d.place, d.city].filter(Boolean).map(escapeHtml).join(', ')} · ${escapeHtml(d.code || d.id)}</div>` +
    '<div><i>To</i><br><b>Felix Batteries Industries</b><br>Warehouse, Nashik</div>' +
    `<div><i>Vehicle</i><br><b>${escapeHtml(c.vehicle || '—')}</b></div><div><i>Collected by</i><br><b>${escapeHtml(c.driver || '—')}</b></div></div>` +
    `<table><thead><tr><th>#</th><th>Serial No.</th><th>Model</th><th>Request Ref.</th><th>Reported fault</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<div class="tot"><span>Total batteries returned</span><span>${c.rows.length}</span></div>` +
    '<div class="d">Returned for warranty inspection only. No sale value. Each battery remains the property of Felix Batteries Industries. Claims are decided after inspection at the company.</div>' +
    '<div class="s"><div>Dealer signature</div><div>Driver signature</div><div>Received at company</div></div></body></html>';
}
