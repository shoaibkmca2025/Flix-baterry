export type Role = 'Dealer' | 'Main Admin' | 'Co-Admin' | 'Read-only';
export type Status = 'Draft' | 'Pending sync' | 'Submitted' | 'Under Review' | 'Approved' | 'Rejected' | 'Corrected' | 'Cancelled' | 'Conflict';
export type Item = { id: string; model: string; code: string; serial: string; oldSerial: string; mfg: string; rpl: string; rtn: string; wr: string; remarks: string; exception?: string; fault?: string };
export type Entry = { id: string; dealerId: string; type: string; date: string; customer: string; place: string; order: string; remarks: string; items: Item[]; status: Status; evidence: string[]; gps?: string; signature?: string; createdAt: string; retries: number; correction?: { reason: string; value: string; status: string }; handover?: string; returnState?: string; returnNote?: string; linkedTo?: string; evidenceTags?: string[]; coverTold?: string; serverId?: string; decision?: { reason: string; at: string } };
export type Battery = { code: string; serial: string; model: string; dealerId: string; customer: string; mfg: string; oldSerial?: string; start?: string; expiry?: string; policy?: string; state: string };
export type Dealer = { id: string; name: string; contact: string; mobile: string; email: string; city: string; place: string; address: string; pin: string; state: string; status: string; reason?: string; documents?: string[] };
export type Model = { id: string; type: string; capacity: string; months: number; threshold: number; active: boolean };
export type Movement = { id: string; code: string; model: string; dealerId: string; from: string; to: string; reason: string; date: string };
export type Audit = { id: string; actor: string; action: string; ref: string; reason: string; at: string; before?: string; after?: string };
export type Customer = { id: string; dealerId: string; name: string; mobile: string; address: string; equipment: string; consent: boolean; mergedInto?: string };
export type Policy = { id: string; months: number; effective: string; anchor: string; overrides: boolean; maxDays: number; alertDays: number };
export type Notice = { id: string; title: string; body: string; route: string; read: boolean; dealerId?: string };
export type Challan = { no: string; dealerId: string; at: string; vehicle: string; driver: string; entryIds: string[]; rows: { serial: string; model: string; ref: string; fault: string; lineId?: string; stage?: string }[]; serverId?: string; receivedAt?: string };
export type Staff = { id: string; name: string; email: string; role: string; status: string; dealerId?: string; permissions: string[] };
export type State = { entries: Entry[]; batteries: Battery[]; dealers: Dealer[]; models: Model[]; movements: Movement[]; audits: Audit[]; customers: Customer[]; policies: Policy[]; notices: Notice[]; staff: Staff[]; reports: {id:string;name:string;type:string;model:string;status:string;schedule:string}[]; exports: {id:string;name:string;rows:number;date:string}[]; overrides: {id:string;code:string;days:number;reason:string;status:string}[]; cities: string[]; entryTypes: string[]; lastSync: string; offline: boolean; language: 'English'|'मराठी'; challans: Challan[]; smsAlerts?: boolean; };
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
export function deriveCode(code: string) {
  const c=normalize(code); const month=Number(c.slice(2,4));
  return {serial:c.slice(-4),mfg:/^\d{8}$/.test(c)&&month>=1&&month<=12?`20${c.slice(0,2)}-${c.slice(2,4)}`:''};
}
export const newItem = (): Item => ({id:uid('ITEM'),model:'M5',code:'',serial:'',oldSerial:'',mfg:'',rpl:today().slice(0,7),rtn:'',wr:'',remarks:''});
export const newEntry = (dealerId: string, type = 'Replacement'): Entry => ({id:uid('ENT'),dealerId,type,date:today(),customer:'',place:'Sakri Road',order:'',remarks:'',items:[newItem()],status:'Draft',evidence:[],createdAt:new Date().toISOString(),retries:0});
export function validateEntry(e: Entry, state: State): Record<string,string> {
  const errors: Record<string,string>={};
  const age=(Date.parse(today())-Date.parse(e.date))/86400000;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!Number.isFinite(age)||age<0||age>30) errors.date='Choose a valid date within the last 30 days.';
  if(!e.place.trim()) errors.place='Enter the transaction location.';
  if(e.type==='Other'&&!e.remarks.trim()) errors.remarks='Explain the purpose of this entry.';
  if(!e.items.length) errors.items='Add at least one battery.';
  e.items.forEach((item,i)=>{
    const key=`items.${i}.`; const code=normalize(item.code);
    if(!state.models.some(m=>m.id===item.model&&m.active)) errors[key+'model']='Choose an active model.';
    if(!/^\d{8}$/.test(code)||!deriveCode(code).mfg) errors[key+'code']='Use an 8-digit code with a valid YYMM prefix.';
    if(!/^\d{4}$/.test(item.serial)) errors[key+'serial']='Enter the 4-digit serial, keeping leading zeroes.';
    if(e.items.some((x,j)=>j!==i&&normalize(x.code)===code)) errors[key+'code']='This battery is already in this entry.';
    const existing=state.batteries.find(b=>normalize(b.code)===code);
    if(existing&&['Replacement','Regular Sales'].includes(e.type)&&existing.state!=='Available') errors[key+'code']='This serial is already active. Choose an available battery.';
    if(existing&&existing.dealerId!==e.dealerId) errors[key+'code']='This battery belongs to another dealer.';
    if(e.type==='Replacement') {
      if(!item.oldSerial.trim()) errors[key+'oldSerial']='An old battery code is required for replacement.';
      if(normalize(item.oldSerial)===code) errors[key+'oldSerial']='Old and new batteries must be different.';
      if(e.items.some((x,j)=>j!==i&&normalize(x.oldSerial)===normalize(item.oldSerial))) errors[key+'oldSerial']='This old battery is already used in another item.';
      const old=state.batteries.find(b=>normalize(b.code)===normalize(item.oldSerial));
      if(old&&old.dealerId!==e.dealerId) errors[key+'oldSerial']='Old battery custody belongs to another dealer.';
      if(state.batteries.some(b=>b.oldSerial===item.oldSerial)) errors[key+'oldSerial']='This battery has already been replaced. Use the current battery in the chain.';
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
