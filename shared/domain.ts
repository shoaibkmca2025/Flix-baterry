export type Role = 'Dealer' | 'Main Admin' | 'Co-Admin' | 'Read-only';
// 'With distributor': a dealer's request waiting for its distributor's approval (client, 2 Oct 2026)
export type Status = 'Draft' | 'Pending sync' | 'With distributor' | 'Submitted' | 'Under Review' | 'Approved' | 'Rejected' | 'Corrected' | 'Cancelled' | 'Conflict';
export type Item = { id: string; model: string; oldModel?: string; code: string; serial: string; oldSerial: string; mfg: string; rpl: string; rtn: string; wr: string; remarks: string; exception?: string; fault?: string;
  /** a replacement's old battery travels and is decided on its own (client, 2 Oct 2026): its claim, where it is, and head office's decision */
  /** a dealer's old battery handed over and marked arrived by the distributor (client, 3 Oct 2026) */
  arrivedAtDistributor?: string;
  claimId?: string; claimStatus?: string; claimUpdatedAt?: string; status?: Status; returnState?: string; returnNote?: string; decidedAt?: string; decisionReason?: string;
  /** head office looked at THIS battery, and/or rewrote its serials (client, 2 Oct 2026) */
  reviewStartedAt?: string; reviewNote?: string; correctedAt?: string; correctionReason?: string };
export type Entry = { id: string; dealerId: string; type: string; date: string; customer: string; place: string; order: string; remarks: string; items: Item[]; status: Status; evidence: string[]; gps?: string; signature?: string; createdAt: string; retries: number; correction?: { reason: string; value: string; status: string }; handover?: string; returnState?: string; returnNote?: string; linkedTo?: string; evidenceTags?: string[]; coverTold?: string; apiId?: string; claimId?: string; claimStatus?: string; decidedAt?: string; decisionReason?: string;
  /** the distributor's decision on a dealer's request, before head office (client, 2 Oct 2026) */
  distributorDecidedAt?: string; distributorReason?: string;
  /** set when this Entry stands for ONE battery of a multi-battery replacement (see batteryUnits) */
  itemId?: string; part?: string };
export type Battery = { code: string; serial: string; model: string; dealerId: string; customer: string; mfg: string; oldSerial?: string; start?: string; expiry?: string; policy?: string; state: string };
export type Dealer = { id: string; code?: string; name: string; contact: string; mobile: string; email: string; city: string; place: string; address: string; pin: string; state: string; status: string; reason?: string; documents?: string[];
  /** head office → distributor → dealer (client, 2 Oct 2026). Absent = 'Distributor' (every shop from before). */
  kind?: 'Distributor' | 'Dealer'; distributorId?: string;
  /** a dealer's distributor, as its own session knows it (who to hand old batteries to) */
  distributor?: { id: string; name: string; mobile: string; contact: string } };
/**
 * Who a shop answers to, in its own words.
 *
 * A dealer never deals with head office: he hands his request and his old battery to his
 * distributor, and the distributor carries both on (client, 3 Oct 2026). A distributor does deal
 * with head office. Naming the wrong one on a screen sends a dealer chasing an office whose
 * number he does not have.
 *
 * A shop from before the two tiers existed has no `kind` and is a distributor (see Dealer.kind),
 * so it keeps reading "head office" — the wording it has always had.
 */
export function above(shop?: Pick<Dealer, 'kind' | 'distributor'>) {
  const isDealer = shop?.kind === 'Dealer';
  return {
    isDealer,
    /** mid-sentence: `waiting for ${above}` */
    above: isDealer ? 'your distributor' : 'head office',
    /** starting a sentence, or a button: `${Above} decision` */
    Above: isDealer ? 'Your distributor' : 'Head office',
    /** the distributor's real name once his session knows it, else the plain term */
    aboveName: isDealer ? shop?.distributor?.name || 'your distributor' : 'head office',
  };
}

export type Model = { id: string; plate?: string; modelNo?: string; brand?: string; plateCount?: number | null; type: string; capacity: string; months: number; threshold: number; active: boolean };
export type Movement = { id: string; code: string; model: string; dealerId: string; from: string; to: string; reason: string; date: string };
export type Audit = { id: string; actor: string; action: string; ref: string; reason: string; at: string; before?: string; after?: string };
export type Customer = { id: string; dealerId: string; name: string; mobile: string; address: string; equipment: string; consent: boolean; mergedInto?: string };
export type Policy = { id: string; months: number; effective: string; anchor: string; overrides: boolean; maxDays: number; alertDays: number };
export type Notice = { id: string; title: string; body: string; route: string; read: boolean; dealerId?: string };
/** A plant that makes Felix batteries (memory.md D-19). Switched-off plants stay listed so old tags keep a name. */
export type Plant = { id: string; name: string; active: boolean };
export type Challan = { no: string; dealerId: string; at: string; vehicle: string; driver: string; entryIds: string[]; rows: { serial: string; model: string; ref: string; fault: string; lineId?: string; itemId?: string; stage?: string; plantId?: string; stagedAt?: string;
    /** what head office decided about this battery — the challan screens group by it (client, 2 Oct 2026) */
    outcome?: 'travelling' | 'arrived' | 'passed' | 'claimed' | 'rejected'; outcomeReason?: string }[]; serverId?: string; receivedAt?: string };
export type Staff = { id: string; name: string; email: string; role: string; roleKey?: string; status: string; dealerId?: string; permissions: string[] };
export type State = { entries: Entry[]; batteries: Battery[]; dealers: Dealer[]; models: Model[]; movements: Movement[]; audits: Audit[]; customers: Customer[]; policies: Policy[]; notices: Notice[]; staff: Staff[]; reports: {id:string;name:string;type:string;model:string;status:string;schedule:string}[]; exports: {id:string;name:string;rows:number;date:string}[]; overrides: {id:string;code:string;days:number;reason:string;status:string}[]; cities: string[]; plateTypes?: { code: string; label: string; plateCount?: number | null }[]; serialDigitLengths?: number[]; plants?: Plant[]; graceMonths?: number; entryTypes: string[]; lastSync: string; offline: boolean; language: 'English'|'मराठी'; challans: Challan[]; smsAlerts?: boolean; };
export const uid = (prefix = 'ID') => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const normalize = (s: string) => s.trim().toUpperCase().replace(/\s/g, '');
export const dateLabel = (s?: string) => s ? new Date(s.slice(0,10)+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : 'Not on record';
export function expiryFrom(start: string, months: number) {
  const [y,m,d] = start.split('-').map(Number);
  const last = new Date(Date.UTC(y, m-1+months+1, 0)).getUTCDate();
  const end = new Date(Date.UTC(y,m-1+months,Math.min(d,last)));
  end.setUTCDate(end.getUTCDate()-1);
  return end.toISOString().slice(0,10);
}
export function warranty(b: Battery, now = today(), alertDays = 30) {
  if (!b.expiry) return {status:'Not on record',days:0,progress:0};
  const days = Math.ceil((Date.parse(b.expiry)-Date.parse(now))/86400000);
  const total = Math.max(1,(Date.parse(b.expiry)-Date.parse(b.start || now))/86400000);
  return {status: days < 0 ? 'Expired' : days <= alertDays ? 'Expiring soon' : 'Active',days:Math.max(0,days),progress:Math.max(0,Math.min(1,days/total))};
}
/**
 * How many digits the number after the model may have. Felix's plants do not agree — the main
 * one prints 8 ("M1300 2608 0001") and 7 ("S2000 2607 001") — so the app takes the list from
 * the server (`/masters`) rather than hard-coding it (memory.md D-18). Every known form is the
 * same underneath: YYMM, then the serial.
 */
export const DEFAULT_DIGIT_LENGTHS = [7, 8];
/** A new battery may be 7, 8 or 9 digits — all three plants are in use on new stock (client,
 * 2 Oct 2026). Must stay in step with backend domain/serials.ts, which is what actually decides. */
export const NEW_BATTERY_DIGIT_LENGTHS = [7, 8, 9];
/** Every length a battery in the system can carry — see anyDigitLengths in backend domain/serials.ts.
 * Used wherever a code is read back rather than issued: an old battery returning, a stock move. */
export const anyDigitLengths = (settingLengths: readonly number[] = DEFAULT_DIGIT_LENGTHS) =>
  [...new Set([...settingLengths, ...NEW_BATTERY_DIGIT_LENGTHS])].sort((a, b) => a - b);

/**
 * What can be wrong with the battery that came back, in the client's own words and order
 * (client, 2 Oct 2026). The dealer picks one of these on the old-battery screen.
 *
 * This list lives here, not in the app, because the label is only half of it: what is stored is
 * `faultCode(label)`, and the console and the challan print-out turn that code back into words
 * (FAULT_LABEL in api/mapping.ts, built from this list). Keeping the list and the reverse map in
 * two different files is how they drift, and a drifted code prints as a raw slug.
 */
export const FAULTS = ['Low voltage', 'Low backup', 'Leakage', 'Low gravity', 'Pole damage', 'Cell disconnect', 'Cell boil', 'Temp battery', 'Bulgy battery'];
/** The label as it is stored: 'Pole damage' → 'pole_damage'. Stable, so old rows keep reading. */
export const faultCode = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
/**
 * Codes the dealer app no longer offers, but which are on entries already sent. They have to stay
 * readable for good: without them the console and the challan print-out would show a raw slug
 * ('not_holding_charge') on every request taken before 2 Oct 2026. Never delete a line from here.
 */
const RETIRED_FAULT_LABEL: Record<string, string> = { not_holding_charge: 'Not holding charge', swollen_case: 'Swollen case', leaking: 'Leaking', other: 'Other' };
const FAULT_LABEL: Record<string, string> = { ...RETIRED_FAULT_LABEL, ...Object.fromEntries(FAULTS.map(f => [faultCode(f), f])) };
/** What the console, the entry list and the challan print-out show for a stored fault code.
 * An unknown code falls back to itself rather than going blank — better a slug than nothing. */
export const faultLabel = (code: string | null | undefined) => (code ? FAULT_LABEL[code] ?? code : undefined);

const isDigits = (v: string) => /^\d+$/.test(v);
const monthOf = (d: string) => { if (d.length <= 4 || !isDigits(d)) return ''; const m = Number(d.slice(2, 4)); return m >= 1 && m <= 12 ? `20${d.slice(0, 2)}-${d.slice(2, 4)}` : ''; };
const lengthsDesc = (ls: readonly number[]) => [...new Set(ls)].sort((a, b) => b - a);

/**
 * Splits a scanned or typed label into the product it names and its digits. "K60L" cannot be
 * cut into K + 60L by shape alone, so this matches against the ids the catalogue holds —
 * longest first — and a length only wins if what is left is a model we know.
 */
export function splitLabel(input: string, knownModelIds: readonly string[] = [], lengths: readonly number[] = DEFAULT_DIGIT_LENGTHS) {
  const whole = (input||'').trim().toUpperCase().replace(/[\s\-._/]+/g,'');
  const tryLengths = lengthsDesc(lengths);
  if (isDigits(whole) && tryLengths.includes(whole.length)) return { modelId: '', code: whole };
  const ids = [...knownModelIds].sort((a,b) => b.length - a.length);
  for (const len of tryLengths) {
    const tail = whole.slice(-len), head = whole.slice(0, -len);
    if (!head || !isDigits(tail) || !monthOf(tail)) continue;
    if (ids.includes(head)) return { modelId: head, code: tail };
    const swapped = /^(?:IT|FT)?(\d{3,4})([A-Z][A-Z0-9]?)$/.exec(head);       // "IT2200SG"
    if (swapped) { const rebuilt = `${swapped[2]}${swapped[1]}`; if (ids.includes(rebuilt)) return { modelId: rebuilt, code: tail }; }
    const endsWith = ids.find(id => head.endsWith(id));
    if (endsWith) return { modelId: endsWith, code: tail };
  }
  // all digits and not an accepted length: hand the whole thing back so the length check refuses it,
  // rather than trimming '2609123456' to '09123456' and registering a different battery
  if (isDigits(whole)) return { modelId: '', code: whole };
  // the label named a model the catalogue does not have — prefer a tail that looks like YYMM
  const fallback = tryLengths.find(len => monthOf(whole.slice(-len))) ?? tryLengths.find(len => isDigits(whole.slice(-len)));
  return { modelId: '', code: fallback ? whole.slice(-fallback) : whole };
}
/**
 * The battery's identity as printed on it. The digits are NOT unique on their own: the factory
 * restarts the serial and counts separately per product, so "M1000 26090001" and
 * "S1000 26090001" are two different batteries (D-13).
 */
export const fullCode = (modelId: string, code: string) =>
  `${(modelId||'').toUpperCase().replace(/[\s\-._/]+/g,'')}${normalize(code)}`;
/** The digits half of a stored identity — exact, because the product prefix is known. */
export const digitsOf = (batteryCode: string, modelId = '') => {
  const prefix = (modelId||'').toUpperCase().replace(/[\s\-._/]+/g,'');
  const v = batteryCode||'';
  if (prefix && v.startsWith(prefix)) return v.slice(prefix.length);
  const m = /(\d{5,})$/.exec(v);          // no product given: take the trailing digits
  return m ? m[1] : v;
};
/**
 * Whether two codes name the same battery: code + model + YY + MM + serial must ALL match
 * (client, 29 Sep 2026). A code is either typed digits with its model chosen apart (a phone
 * draft) or the whole label (the server's copy); both are brought to the whole label first.
 * Only when a side has no model at all can the digits alone be compared.
 */
export const batteryId = (code: string, modelId = '') => { const c = normalize(code||''); return modelId && c ? fullCode(modelId, digitsOf(c, modelId)) : c; };
export const sameBattery = (a: string, aModel: string | undefined, b: string, bModel: string | undefined) => {
  const x = batteryId(a, aModel), y = batteryId(b, bModel);
  if (!x || !y) return false;
  const bareX = /^\d+$/.test(x), bareY = /^\d+$/.test(y);
  if (bareX && bareY) return x === y;
  // one side's model is unknown: its digits can only be matched against the end of the other
  // (a model may itself end in a digit, e.g. M5, so the other's digits cannot be cut out)
  if (bareX) return y.endsWith(x);
  if (bareY) return x.endsWith(y);
  return x === y;
};
export const isValidDigits = (code: string, lengths: readonly number[] = DEFAULT_DIGIT_LENGTHS) =>
  lengthsDesc(lengths).includes(code.length) && !!monthOf(code);
/** "7, 8 or 9 digits" — so a message names what is actually accepted. */
export const lengthsLabel = (lengths: readonly number[] = DEFAULT_DIGIT_LENGTHS) => {
  const ls = [...new Set(lengths)].sort((a,b) => a-b);
  return ls.length === 1 ? `${ls[0]} digits` : `${ls.slice(0,-1).join(', ')} or ${ls[ls.length-1]} digits`;
};
export function deriveCode(code: string, knownModelIds: readonly string[] = [], lengths: readonly number[] = DEFAULT_DIGIT_LENGTHS) {
  const { code: c, modelId }=splitLabel(code, knownModelIds, lengths);
  const mfg = lengthsDesc(lengths).includes(c.length) ? monthOf(c) : '';
  return {serial:c.slice(4),mfg,labelModelId:modelId};
}
/**
 * The same request, whatever number it carries: its type, the dealer, and the batteries on it.
 * A phone draft keeps the typed digits (26052369, model J700) while the server's copy stores the
 * whole label (J70026052369), so the model prefix is stripped before comparing. Used to drop a
 * local draft once that request is already on the server.
 */
export function entryKey(e: Pick<Entry, 'type' | 'dealerId' | 'items'>): string {
  const digits = (code: string, model: string) => {
    const c = normalize(code), m = (model || '').toUpperCase().replace(/[\s\-._/]+/g, '');
    return m && c.startsWith(m) ? c.slice(m.length) : c;
  };
  const items = e.items.map(i => `${i.model}:${digits(i.code, i.model)}:${digits(i.oldSerial || '', i.oldModel || i.model)}`).sort();
  return `${e.dealerId}|${e.type}|${items.join(',')}`;
}
export const newItem = (): Item => ({id:uid('ITEM'),model:'',code:'',serial:'',oldSerial:'',mfg:'',rpl:today().slice(0,7),rtn:'',wr:'',remarks:''});
export const newEntry = (dealerId: string, type = 'Replacement'): Entry => ({id:uid('ENT'),dealerId,type,date:today(),customer:'',place:'Sakri Road',order:'',remarks:'',items:[newItem()],status:'Draft',evidence:[],createdAt:new Date().toISOString(),retries:0});
export function validateEntry(e: Entry, state: State): Record<string,string> {
  const errors: Record<string,string>={};
  const age=(Date.parse(today())-Date.parse(e.date))/86400000;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!Number.isFinite(age)||age<0||age>30) errors.date='Choose a valid date within the last 30 days.';
  // Place is not asked for any more (client, 3 Oct 2026): it is the dealer's own shop on almost
  // every entry, so it is filled from their record when left blank rather than typed each time.
  // The column is still NOT NULL on the server, so the apps must always send something.
  if(e.type==='Other'&&!e.remarks.trim()) errors.remarks='Explain the purpose of this entry.';
  if(!e.items.length) errors.items='Add at least one battery.';
  e.items.forEach((item,i)=>{
    const key=`items.${i}.`; const code=normalize(item.code);
    if(!state.models.some(m=>m.id===item.model&&m.active)) errors[key+'model']='Choose an active model.';
    // a replacement's or sale's battery is NEW (7, 8 or 9 digits); a sales return's is already in the field
    const codeLengths=e.type==='Sales Return'?state.serialDigitLengths:NEW_BATTERY_DIGIT_LENGTHS;
    const digits=digitsOf(code, item.model), codeOk=isValidDigits(digits, codeLengths);
    if(!codeOk) errors[key+'code']=`Use ${lengthsLabel(codeLengths)} starting with the YYMM it was made.`;
    // the serial is whatever follows the YYMM, so its length follows the code's (3 digits on a
    // 7-digit code, 4 on an 8-digit one). It is derived, never typed — a mismatch means the two
    // fields have drifted apart, not that the dealer typed it wrong.
    else if(item.serial!==digits.slice(4)) errors[key+'serial']='The serial does not match the number entered above.';
    // the same battery means code + model + YY + MM + serial all match — never the digits alone
    if(e.items.some((x,j)=>j!==i&&sameBattery(x.code,x.model,item.code,item.model))) errors[key+'code']='This battery is already in this entry.';
    const existing=state.batteries.find(b=>sameBattery(b.code,b.model,item.code,item.model));
    if(existing&&['Replacement','Regular Sales'].includes(e.type)&&existing.state!=='Available') errors[key+'code']='This serial is already active. Choose an available battery.';
    if(existing&&existing.dealerId!==e.dealerId) errors[key+'code']='This battery belongs to another dealer.';
    if(e.type==='Replacement') {
      if(!item.oldSerial.trim()) errors[key+'oldSerial']='An old battery code is required for replacement.';
      if(sameBattery(item.oldSerial,item.oldModel,item.code,item.model)) errors[key+'oldSerial']='Old and new batteries must be different.';
      if(e.items.some((x,j)=>j!==i&&sameBattery(x.oldSerial,x.oldModel,item.oldSerial,item.oldModel))) errors[key+'oldSerial']='This old battery is already used in another item.';
      const old=state.batteries.find(b=>sameBattery(b.code,b.model,item.oldSerial,item.oldModel));
      if(old&&old.dealerId!==e.dealerId) errors[key+'oldSerial']='Old battery custody belongs to another dealer.';
      if(state.batteries.some(b=>!!b.oldSerial&&sameBattery(b.oldSerial,undefined,item.oldSerial,item.oldModel))) errors[key+'oldSerial']='This battery has already been replaced. Use the current battery in the chain.';
      const override=state.overrides.some(o=>o.code===item.oldSerial&&o.status==='Approved');
      if(old&&warranty(old).status==='Expired'&&!override) errors[key+'oldSerial']='Warranty expired. Request an admin override before submitting.';
    }
    for(const f of ['mfg','rpl','rtn'] as const) if(item[f]&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(item[f])) errors[key+f]='Use YYYY-MM with a valid month.';
  });
  return errors;
}
export function filterEntries(entries: Entry[], query='',type='All',status='All',model='All',from='',to='') {
  const q=query.toLowerCase().trim();
  return entries.filter(e=>(!q||[e.id,e.customer,e.place,...e.items.flatMap(i=>[i.code,i.serial,i.oldSerial,i.model])].some(v=>v.toLowerCase().includes(q)))&&(type==='All'||e.type===type)&&(status==='All'||e.status===status)&&(model==='All'||e.items.some(i=>i.model===model))&&(!from||e.date>=from)&&(!to||e.date<=to));
}
export function chainFor(code: string,batteries:Battery[]) {
  let root=batteries.find(b=>b.code===code); const seen=new Set<string>();
  while(root?.oldSerial&&!seen.has(root.code)) { seen.add(root.code); const old=batteries.find(b=>b.code===root!.oldSerial); if(!old)break; root=old; }
  const chain:Battery[]=[]; seen.clear();
  while(root&&!seen.has(root.code)) {chain.push(root);seen.add(root.code);root=batteries.find(b=>b.oldSerial===root!.code);}
  return chain;
}
export function approveEntry(state:State,entry:Entry):State {
  const current=state.entries.find(e=>e.id===entry.id);
  if(!current||current.status==='Approved'||current.status==='Cancelled') return state;
  let batteries=[...state.batteries]; let movements=[...state.movements];
  const policy=[...state.policies].filter(p=>p.effective<=entry.date).sort((a,b)=>b.effective.localeCompare(a.effective))[0]||state.policies[0];
  for(const i of entry.items) {
    const old=batteries.find(b=>b.code===i.oldSerial);
    const prior=batteries.find(b=>b.code===i.code);
    const isReplacement=entry.type==='Replacement'; const isSale=entry.type==='Regular Sales';
    const dest=isReplacement?'Replacement':isSale?'Sold':entry.type.includes('Repair')?'Repair':['Goods Return','Sales Return'].includes(entry.type)?'Returned':entry.type==='For Charging'?(prior?.state||'Available'):'Allocated';
    const battery:Battery={...prior,code:i.code,serial:i.serial,model:i.model,dealerId:entry.dealerId,customer:entry.customer,mfg:i.mfg,state:dest,...(isReplacement?{oldSerial:i.oldSerial,start:old?.start,expiry:old?.expiry,policy:old?.policy}:isSale?{start:entry.date,expiry:expiryFrom(entry.date,policy.months),policy:policy.id}:{})};
    batteries=batteries.filter(b=>b.code!==i.code).concat(battery);
    movements.push({id:uid('MOV'),code:i.code,model:i.model,dealerId:entry.dealerId,from:prior?.state||'Company',to:dest,reason:entry.id,date:entry.date});
    if(old&&isReplacement) {batteries=batteries.map(b=>b.code===old.code?{...b,state:'Returned'}:b);movements.push({id:uid('MOV'),code:old.code,model:old.model,dealerId:entry.dealerId,from:old.state,to:'Returned',reason:entry.id,date:entry.date});}
  }
  return {...state,batteries,movements,entries:state.entries.map(e=>e.id===entry.id?{...e,status:'Approved',returnState:e.type==='Replacement'?(e.returnState||'At dealer'):undefined}:e)};
}
