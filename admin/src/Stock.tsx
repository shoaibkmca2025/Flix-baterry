import React, { useState } from 'react';
import { View } from 'react-native';
import { useStore } from '@felix/shared/store';
import { getAccessToken } from '@felix/shared/api/session';
import { postMovement, type BatteryState } from '@felix/shared/api/stock';
import { checkClaim, receiveClaim } from '@felix/shared/api/claims';
import { receiveChallan, receiveLine, setLinePlant, stageLine } from '@felix/shared/api/returns';
import { errorMessage } from '@felix/shared/api/client';
import { useSync } from '@felix/shared/api/sync';
import { Challan, Entry, today, uid } from '@felix/shared/domain';
import { T } from '@felix/shared/ui/theme';
import { X, B, Mono, Btn, Card, CardH, Chip, StatusChip, Field, Hint, Banner, KV, Kpis, Line, Avatar, Plate, PlateLab, PlateVal, Tone, IconName } from '@felix/shared/ui/kit';
import { ageDays, challanHtml, dLong, dShort } from '@felix/shared/data';
import { saveHtmlDocument } from '@felix/shared/reports';
import { Page, Box, Cols, Stack, Table, Pills, SearchBox, FilterPick, Tabs, Dialog, ReasonDialog, Select, Empty, useA } from './ui';
import { useDecisions } from './Entries';

const STATES = ['Available', 'Allocated', 'Sold', 'Returned', 'Replacement', 'Repair', 'Damaged', 'Scrap'];
const TRANSITIONS: Record<string, string[]> = { Available: ['Allocated', 'Sold', 'Repair', 'Damaged', 'Scrap'], Allocated: ['Available', 'Sold', 'Returned'], Sold: ['Returned', 'Repair'], Returned: ['Repair', 'Available', 'Damaged', 'Scrap'], Replacement: ['Returned', 'Repair'], Repair: ['Available', 'Returned', 'Damaged', 'Scrap'], Damaged: ['Repair', 'Scrap'] };

/* ---------- stock ---------- */
export function Stock({ id }: { id?: string }) {
  const a = useA(); const { state, setState, audit, canEdit } = useStore(); const { sync } = useSync();
  const [tab, setTab] = useState('overview'), [model, setModel] = useState('All'), [st, setSt] = useState('All'), [dealer, setDealer] = useState('All'), [q, setQ] = useState('');
  const [move, setMove] = useState(!!id?.startsWith('move:')), [code, setCode] = useState(id?.startsWith('move:') ? id.slice(5) : ''), [to, setTo] = useState('Available'), [target, setTarget] = useState(''), [reason, setReason] = useState(''), [err, setErr] = useState('');
  const [thr, setThr] = useState<{ id: string; value: string } | null>(null);
  const dealerName = (d: string) => state.dealers.find(x => x.id === d)?.name || d;
  const dealerId = state.dealers.find(d => d.name === dealer)?.id;
  const batteries = state.batteries.filter(b => (model === 'All' || b.model === model) && (st === 'All' || b.state === st) && (!dealerId || b.dealerId === dealerId) && (!q || b.code.includes(q) || b.customer.toLowerCase().includes(q.toLowerCase())));
  const available = (m: string, d?: string) => state.batteries.filter(b => b.model === m && b.state === 'Available' && (!d || b.dealerId === d)).length;
  const low = state.models.filter(m => m.active && available(m.id) < m.threshold);
  const current = state.batteries.find(b => b.code === code.trim());
  const post = async () => {
    const b = current;
    if (!b) { setErr('That serial is not in the register.'); return; }
    if (reason.trim().length < 5) { setErr('Give a reason for the movement.'); return; }
    if (b.state === 'Scrap') { setErr('Scrap is final. Record an admin correction instead.'); return; }
    const dest = target || b.dealerId;
    if (b.state === to && b.dealerId === dest) { setErr('Choose a different state or dealer.'); return; }
    if (!TRANSITIONS[b.state]?.includes(to) && b.dealerId === dest) { setErr(`A ${b.state.toLowerCase()} battery cannot move straight to ${to.toLowerCase()}.`); return; }
    if (state.offline) { setErr('Stock movements need online mode.'); return; }
    const token = await getAccessToken();
    if (token) {
      // the server validates the same transition table (backend domain/stock.ts) and writes the ledger
      try {
        await postMovement({ batteryCode: b.code, toState: to.toLowerCase() as BatteryState, toDealerId: dest || null, toCustodian: dest ? 'dealer' : 'company', reasonText: reason.trim() }, token);
        setMove(false); setReason(''); setErr(''); a.toast('Movement posted. Both stock positions are updated.');
      } catch (err) { setErr(errorMessage(err)); }
      finally { sync(true); }
      return;
    }
    setState(s => audit({ ...s, batteries: s.batteries.map(x => x.code === b.code ? { ...x, state: to, dealerId: dest } : x), movements: [{ id: uid('MOV'), code: b.code, model: b.model, dealerId: dest, from: b.state, to, reason: reason.trim(), date: today() }, ...s.movements] }, 'Stock movement', b.code, reason.trim(), `${b.dealerId} / ${b.state}`, `${dest} / ${to}`));
    setMove(false); setReason(''); setErr(''); a.toast('Movement posted. Both stock positions are updated.');
  };
  const filters = <><SearchBox value={q} onChange={setQ} ph="Serial or customer" /><FilterPick label="Model" value={model} options={state.models.map(m => m.id)} onChange={setModel} /><FilterPick label="Where" value={st} options={STATES} onChange={setSt} /><FilterPick label="Dealer" value={dealer} options={state.dealers.map(d => d.name)} onChange={setDealer} /></>;
  return <Page title="Stock" sub="Worked out from recorded movements — nobody types a stock number"
    actions={canEdit ? <Btn kind="primary" sm icon="plus" label="Post a movement" onPress={() => { setErr(''); setMove(true); }} /> : undefined}
    tabs={<Tabs value={tab} onChange={setTab} items={[['overview', 'Overview'], ['batteries', `All batteries ${state.batteries.length}`], ['movements', 'Movements'], ['levels', `Reorder levels${low.length ? ` · ${low.length} low` : ''}`]]} />}>
    {tab === 'overview' && <Stack>
      <Kpis cols={a.wide ? 4 : 2} items={[{ v: String(state.batteries.filter(b => b.state === 'Available').length), l: 'Available', onPress: () => { setSt('Available'); setTab('batteries'); } }, { v: String(state.batteries.filter(b => ['Sold', 'Replacement'].includes(b.state)).length), l: 'With customers' }, { v: String(state.batteries.filter(b => ['Repair', 'Damaged'].includes(b.state)).length), l: 'In repair or damaged', tone: 'flag' }, { v: String(low.length), l: 'Models below reorder level', tone: low.length ? 'bad' : undefined, onPress: () => setTab('levels') }]} />
      <Box title="Available by dealer">
        <Table rows={state.dealers.filter(d => d.status === 'Active')} keyOf={d => d.id} onRow={d => { setDealer(d.name); setTab('batteries'); }}
          cols={[{ h: 'Dealer', w: 1.5, cell: d => <X s={13.5} w={7}>{d.name}</X> }, ...state.models.filter(m => m.active).map(m => ({ h: m.id, w: 0.6, cell: (d: typeof state.dealers[number]) => { const n = available(m.id, d.id); return <X s={13.5} w={n ? 6 : 4} c={n ? T.ink : T.zinc3}>{n || '—'}</X>; } })), { h: 'With customers', w: 0.9, cell: d => String(state.batteries.filter(b => b.dealerId === d.id && ['Sold', 'Replacement'].includes(b.state)).length) }]}
          mobile={{ title: d => d.name, sub: d => state.models.filter(m => available(m.id, d.id)).map(m => `${m.id} ${available(m.id, d.id)}`).join(' · ') || 'Nothing available' }} />
      </Box>
      {low.length > 0 && <Banner tone="warn" icon="alert"><B>Below reorder level:</B> {low.map(m => `${m.id} (${available(m.id)} left, level ${m.threshold})`).join(', ')}. Dealers are alerted in their app — nothing is ordered automatically.</Banner>}
    </Stack>}
    {tab === 'batteries' && <Box filters={filters}>
      <Table rows={batteries} keyOf={b => b.code} onRow={b => a.go('battery', b.code)} empty="No batteries match."
        cols={[{ h: 'Serial', w: 1, cell: b => <X s={13} f="m" w={6}>{b.code}</X> }, { h: 'Model', w: 0.5, cell: b => <X s={13.5} w={7}>{b.model}</X> }, { h: 'Dealer', w: 1.3, cell: b => dealerName(b.dealerId) }, { h: 'Customer', w: 1.2, cell: b => b.customer || '—' }, { h: 'Made', w: 0.7, cell: b => b.mfg || '—' }, { h: 'Where', w: 0.9, cell: b => <Chip tone={b.state === 'Available' ? 'live' : ['Repair', 'Damaged'].includes(b.state) ? 'vio' : b.state === 'Scrap' || b.state === 'Returned' ? 'mute' : 'info'} label={b.state} /> }]}
        mobile={{ title: b => <Mono>{b.code}</Mono>, sub: b => `${b.model} · ${dealerName(b.dealerId)}`, right: b => <Chip tone={b.state === 'Available' ? 'live' : 'info'} label={b.state} /> }} />
    </Box>}
    {tab === 'movements' && <Box filters={<><FilterPick label="Model" value={model} options={state.models.map(m => m.id)} onChange={setModel} /><FilterPick label="Moved to" value={st} options={STATES} onChange={setSt} /><FilterPick label="Dealer" value={dealer} options={state.dealers.map(d => d.name)} onChange={setDealer} /></>}>
      <Table rows={state.movements.filter(m => (model === 'All' || m.model === model) && (st === 'All' || m.to === st) && (!dealerId || m.dealerId === dealerId))} keyOf={m => m.id} onRow={m => a.go('battery', m.code)} empty="No movements match."
        cols={[{ h: 'Date', w: 0.7, cell: m => dShort(m.date) }, { h: 'Serial', w: 1, cell: m => <X s={13} f="m" w={6}>{m.code}</X> }, { h: 'Model', w: 0.5, cell: m => m.model }, { h: 'Movement', w: 1.3, cell: m => <X s={13.5}>{m.from} <X s={13.5} c={T.slate}>→</X> <X s={13.5} w={6}>{m.to}</X></X> }, { h: 'Dealer', w: 1.2, cell: m => dealerName(m.dealerId) }, { h: 'Reason', w: 1.5, cell: m => <X s={12.5} c={T.slate} numberOfLines={2}>{m.reason}</X> }]}
        mobile={{ title: m => <><Mono>{m.code}</Mono> · {m.from} → {m.to}</>, sub: m => `${dShort(m.date)} · ${m.reason}` }} />
      <Hint icon="lock" style={{ padding: 14, marginTop: 0 }}>A posted movement is never edited. A mistake is fixed with a new, correcting movement — both stay visible.</Hint>
    </Box>}
    {tab === 'levels' && <Box title="Reorder levels by model">
      <Table rows={state.models} keyOf={m => m.id} onRow={canEdit ? m => setThr({ id: m.id, value: String(m.threshold) }) : undefined}
        cols={[{ h: 'Model', w: 0.6, cell: m => <X s={14} w={7}>{m.id}</X> }, { h: 'Available', w: 0.7, cell: m => String(available(m.id)) }, { h: 'Reorder level', w: 0.8, cell: m => String(m.threshold) }, { h: 'Status', w: 1, cell: m => available(m.id) < m.threshold ? <Chip tone="bad" icon="alert" label="Below level" /> : <Chip tone="live" icon="check" label="OK" /> }, { h: '', w: 0.6, cell: m => canEdit ? <Btn kind="ghost" sm label="Change" onPress={() => setThr({ id: m.id, value: String(m.threshold) })} /> : null }]}
        mobile={{ title: m => m.id, sub: m => `${available(m.id)} available · level ${m.threshold}`, right: m => available(m.id) < m.threshold ? <Chip tone="bad" label="Low" /> : <Chip tone="live" label="OK" /> }} />
    </Box>}
    <Dialog open={move} title="Post a stock movement" sub="Moves one battery — the count follows by itself" onClose={() => setMove(false)}>
      <Field label="Battery serial" req mono numeric maxLength={8} value={code} onChange={v => { setCode(v.replace(/\D/g, '')); setErr(''); }} ph="8 digits" hint={current ? `${current.model} · ${current.state} · ${dealerName(current.dealerId)}` : code.length === 8 ? 'Not in the register' : undefined} hintTone={current ? 'ok' : undefined} hintIcon={current ? 'check' : 'alert'} />
      <Select label="Move to" req value={to} options={current ? (TRANSITIONS[current.state] || []).map(v => ({ v })) : STATES.filter(s => s !== 'Replacement').map(v => ({ v }))} onChange={setTo} hint={current ? `Allowed from ${current.state.toLowerCase()}: ${(TRANSITIONS[current.state] || ['nothing']).join(', ')}` : undefined} />
      <Select label="Dealer" value={dealerName(target || current?.dealerId || '')} options={state.dealers.filter(d => d.status === 'Active').map(d => ({ v: d.name, sub: d.id }))} onChange={v => setTarget(state.dealers.find(d => d.name === v)?.id || '')} hint="Change only for a transfer between dealers." />
      <Field label="Reason" req value={reason} onChange={v => { setReason(v); setErr(''); }} ph="e.g. Replenishment against reorder alert" multiline />
      {err ? <Banner tone="bad" icon="alert" style={{ marginBottom: 13 }}>{err}</Banner> : null}
      <Btn kind="blue" icon="check" label="Post movement" onPress={post} />
    </Dialog>
    <Dialog open={!!thr} title={`Reorder level for ${thr?.id}`} onClose={() => setThr(null)} width={420}>{thr && <>
      <Field label="Warn when available stock drops below" mono numeric value={thr.value} onChange={v => setThr({ ...thr, value: v.replace(/\D/g, '') })} />
      <Btn kind="blue" icon="check" label="Save level" onPress={() => { const m = state.models.find(x => x.id === thr.id)!; if (!thr.value) { a.toast('Enter a number.'); return; } setState(s => audit({ ...s, models: s.models.map(x => x.id === thr.id ? { ...x, threshold: Number(thr.value) } : x) }, 'Threshold changed', thr.id, 'Reorder threshold updated', String(m.threshold), thr.value)); setThr(null); a.toast('Reorder level saved.'); }} />
    </>}</Dialog>
  </Page>;
}

/* ---------- old battery returns ---------- */
const STAGE_NEXT: Record<string, [string, string, 'blue' | 'ghost' | 'danger'][]> = {
  'In transit': [['Received', 'Confirm it arrived', 'blue']],
  // Once a battery is at the factory head office checks it offline and just approves or rejects it
  // (the Approve / Reject buttons on each row) — no testing / repaired / scrapped steps.
};
const stageChip = (s?: string): [string, Tone, IconName] => s === 'In transit' ? ['On the way', 'vio', 'truck'] : s === 'Received' ? ['Arrived', 'live', 'box'] : s === 'Testing' ? ['Being tested', 'warn', 'eye'] : s === 'Repaired' ? ['Repaired', 'live', 'wrench'] : s === 'Scrapped' ? ['Scrapped', 'mute', 'x'] : s === 'Closed' ? ['Claimed', 'live', 'check'] : ['At dealer', 'warn', 'shop'];

export function Returns() {
  const a = useA(); const { state, setState, audit, canEdit } = useStore(); const { sync } = useSync();
  // `whole` is the challan's server id when the van is confirmed in one go ("Confirm all arrived")
  const [tab, setTab] = useState('challans'), [act, setAct] = useState<{ entries: Entry[]; to: string; label: string; whole?: string } | null>(null), [handover, setHandover] = useState<Entry | null>(null);
  // the plant that made the battery (memory.md D-19) — chosen in the arrival form, or corrected later
  const [plantName, setPlantName] = useState(''), [plantErr, setPlantErr] = useState(''), [retag, setRetag] = useState<Entry | null>(null), [plantF, setPlantF] = useState('All');
  const [dealerF, setDealerF] = useState('All'), [selChallan, setSelChallan] = useState<string | null>(null);
  const dec = useDecisions(); const [decide, setDecide] = useState<{ e: Entry; kind: 'approve' | 'reject' } | null>(null);
  // at the factory and not yet decided: this is where head office approves or refuses (verified offline)
  const undecided = (e: Entry) => ['Submitted', 'Under Review'].includes(e.status);
  const dealerName = (d: string) => state.dealers.find(x => x.id === d)?.name || d;
  const reps = state.entries.filter(e => e.type === 'Replacement' && !['Draft', 'Rejected', 'Cancelled', 'Pending sync'].includes(e.status));
  const atDealer = reps.filter(e => !e.returnState || e.returnState === 'At dealer');
  const onWay = reps.filter(e => e.returnState === 'In transit');
  // at the factory: still waiting for head office's decision; once approved it moves to "Claimed"
  const AT_FACTORY = ['Received', 'Testing', 'Repaired', 'Scrapped', 'Closed'];
  const atCompany = reps.filter(e => e.status !== 'Approved' && AT_FACTORY.includes(e.returnState || ''));
  const claimed = reps.filter(e => e.status === 'Approved' && AT_FACTORY.includes(e.returnState || ''));
  const rejected = state.entries.filter(e => e.type === 'Replacement' && e.status === 'Rejected');
  const challanOf = (e: Entry) => state.challans.find(c => c.entryIds.includes(e.id));
  // Plants come from the server; the preview that runs without one has none, and asks for none.
  const plants = state.plants ?? [], activePlants = plants.filter(p => p.active);
  const plantById = (id?: string) => plants.find(p => p.id === id);
  /** The entry's old batteries as challan lines — where the server keeps each one's stage and plant. */
  const linesOf = (e: Entry) => state.challans.flatMap(c => c.rows).filter(r => r.ref === e.id && r.lineId);
  const plantOf = (e: Entry) => plantById(linesOf(e).find(r => r.plantId)?.plantId);
  const codesOf = (e: Entry) => e.items.map(it => it.oldSerial).filter(Boolean).join(', ');
  const openAct = (x: NonNullable<typeof act>) => { setPlantName(''); setPlantErr(''); setAct(x); };
  const openRetag = (e: Entry) => { setPlantName(plantOf(e)?.name ?? ''); setPlantErr(''); setRetag(e); };
  const pickedPlant = () => activePlants.find(p => p.name === plantName);
  // the arrival form asks for the plant whenever a battery on a server challan is arriving
  const needsPlant = act?.to === 'Received' && plants.length > 0 && act.entries.some(e => e.apiId && linesOf(e).length > 0);
  const openChallans = state.challans.filter(c => c.entryIds.some(id => onWay.some(e => e.id === id)));
  const looseOnWay = onWay.filter(e => !challanOf(e));
  const month = today().slice(0, 7);
  const receivedThisMonth = state.audits.filter(x => x.action === 'Received' && x.at.startsWith(month)).length;
  /**
   * Live entries: each stage is a claim step on the server (stock ledger moves with it).
   *   Received  → claims.receive (custody → company)
   *   Testing   → claims.check, disposition hold      (battery stays 'returned')
   *   Repaired  → claims.check, disposition repair    (→ 'repair')   — or a manual movement if already checked
   *   Scrapped  → claims.check, disposition scrap     (→ 'scrap')    — or a manual movement if already checked
   *   Closed    → the claim decision itself, taken from "Requests to approve"
   */
  const applyLive = async (entries: Entry[], to: string, reason: string, plantId?: string, whole?: string) => {
    // never fail silently: without a session the change would simply not happen
    const token = await getAccessToken(); if (!token) { a.toast('Your sign-in has ended. Sign in again, then repeat this.'); return; }
    let done = 0;
    try {
      // A battery on a challan arrives through its own challan line, tagged with the plant that
      // made it (D-19): one line at a time, or — "Confirm all arrived" — the whole van with one
      // plant. The server moves any claim along. Batteries not on a challan fall through to the
      // claim steps below.
      const onChallan = new Set<string>();
      if (to === 'Received' && plantId) {
        if (whole) {
          await receiveChallan(whole, { plantId, reason }, token);
          entries.forEach(e => { onChallan.add(e.id); done++; });
        } else for (const e of entries) {
          const waiting = linesOf(e).filter(r => r.stage === 'In transit');
          if (!waiting.length) continue;
          for (const r of waiting) { await receiveLine(r.lineId!, { plantId, reason }, token); done++; }
          onChallan.add(e.id);
        }
      }
      for (const e of entries) {
        if (onChallan.has(e.id)) continue;
        if (!e.claimId) {
          // dispatched before approval: no claim yet, so the challan line itself carries the stage
          const line = state.challans.flatMap(c => c.rows).find(r => r.ref === e.id && r.lineId);
          if (line?.lineId && ['Testing', 'Repaired', 'Scrapped', 'Closed'].includes(to)) { await stageLine(line.lineId, { stage: to.toLowerCase() as 'testing' | 'repaired' | 'scrapped' | 'closed', reason }, token); done++; }
          continue;
        }
        if (to === 'Received') { if (e.claimStatus === 'awaiting_return') { await receiveClaim(e.claimId, token); done++; } }
        else if (to === 'Closed') { a.toast('Close the return by approving or refusing the claim from “Requests to approve”.'); return; }
        else if (e.claimStatus === 'received') { await checkClaim(e.claimId, { findingCode: reason.slice(0, 60), conditionNote: reason, disposition: to === 'Repaired' ? 'repair' : to === 'Scrapped' ? 'scrap' : 'hold' }, token); done++; }
        else if (e.claimStatus === 'checked' && (to === 'Repaired' || to === 'Scrapped')) {
          const code = e.items.find(i => i.oldSerial)?.oldSerial; if (!code) continue;
          await postMovement({ batteryCode: code, toState: to === 'Repaired' ? 'repair' : 'scrap', toCustodian: 'company', toDealerId: null, reasonText: reason }, token); done++;
        }
      }
      a.toast(done ? (done > 1 ? `${done} batteries marked “${stageChip(to)[0].toLowerCase()}”.` : `Marked “${stageChip(to)[0].toLowerCase()}”.`) : 'Nothing changed — that step is not possible from the current stage.');
    } catch (err) { a.toast(errorMessage(err)); }
    finally { sync(true); }
  };
  const apply = (entries: Entry[], to: string, reason: string, plantId?: string, whole?: string) => {
    if (!canEdit) { a.toast('Read-only access.'); return false; }
    if (entries.some(e => e.apiId)) { applyLive(entries.filter(e => e.apiId), to, reason, plantId, whole); return; }
    setState(s => entries.reduce((acc, e) => audit({ ...acc, entries: acc.entries.map(x => x.id === e.id ? { ...x, returnState: to, returnNote: reason } : x) }, to, e.id, reason, e.returnState || 'At dealer', to), s));
    a.toast(entries.length > 1 ? `${entries.length} batteries marked “${stageChip(to)[0].toLowerCase()}”.` : `Marked “${stageChip(to)[0].toLowerCase()}”.`);
  };
  const saveRetag = async (e: Entry, plantId: string, reason: string) => {
    if (!canEdit) { a.toast('Read-only access.'); return; }
    // never fail silently: without a session the change would simply not happen
    const token = await getAccessToken(); if (!token) { a.toast('Your sign-in has ended. Sign in again, then repeat this.'); return; }
    try {
      for (const r of linesOf(e).filter(l => l.stage !== 'In transit')) await setLinePlant(r.lineId!, { plantId, reason }, token);
      a.toast(`${codesOf(e)} is now counted under ${plantById(plantId)?.name}.`);
    } catch (err) { a.toast(errorMessage(err)); }
    finally { sync(true); }
  };
  const byDealer = state.dealers.map(d => ({ d, list: atDealer.filter(e => e.dealerId === d.id) })).filter(x => x.list.length).sort((x, y) => y.list.length - x.list.length);
  const row = (e: Entry, i: number, arr: Entry[], showActions = true) => {
    const [l, t, ic]: [string, Tone, IconName] = e.status === 'Rejected' ? ['Rejected', 'bad', 'x'] : stageChip(e.returnState);
    const arrived = !!e.returnState && !['At dealer', 'In transit'].includes(e.returnState) && linesOf(e).length > 0;
    return <Line key={e.id} last={i === arr.length - 1} onPress={() => a.go('entry', e.id)} av={<Avatar n={ic} tone={t === 'vio' ? 'vio' : t === 'live' ? 'green' : t === 'mute' ? 'mute' : t === 'bad' ? 'red' : 'amber'} />}
      title={<Mono>{e.items.map(it => it.oldSerial).filter(Boolean).join(', ') || '—'}</Mono>}
      sub={`${e.items[0]?.model} · ${e.id} · ${dealerName(e.dealerId)} · ${e.status === 'Approved' ? 'approved' : e.status === 'Rejected' ? 'refused' : e.status === 'Conflict' ? 'serial exception' : 'waiting for your decision'}${arrived && plants.length ? ` · ${plantOf(e) ? `made at ${plantOf(e)!.name}` : 'plant not set'}` : ''}`}
      right={<View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: a.wide ? 420 : 170 }}>
        <Chip tone={t} icon={ic} label={l} />
        {showActions && canEdit && (STAGE_NEXT[e.returnState || ''] || []).filter(([to]) => !(to === 'Closed' && undecided(e))).map(([to, label, kind]) => <Btn key={to} kind={kind === 'danger' ? 'ghost' : kind} sm label={label} color={kind === 'danger' ? T.terminal : undefined} borderColor={kind === 'danger' ? '#F0C7BC' : undefined} onPress={() => openAct({ entries: [e], to, label })} />)}
        {showActions && canEdit && arrived && e.apiId && plants.length > 0 && <Btn kind="ghost" sm label={plantOf(e) ? 'Change plant' : 'Set plant'} onPress={() => openRetag(e)} />}
        {canEdit && e.returnState && e.returnState !== 'In transit' && e.returnState !== 'At dealer' && undecided(e) && <>
          <Btn kind="ghost" sm icon="x" label="Reject" color={T.terminal} borderColor="#F0C7BC" onPress={() => setDecide({ e, kind: 'reject' })} />
          <Btn kind="blue" sm icon="check" label="Approve" onPress={() => setDecide({ e, kind: 'approve' })} /></>}
      </View>} />;
  };
  /**
   * Challans grouped under the dealer who sent them; opening one lists its batteries. `only` narrows
   * it to some entries (the claimed, or the rejected): only challans holding one of them are listed,
   * a challan shows only those batteries, and any that came without a challan are listed apart.
   */
  const challanView = (only?: Entry[], empty: { icon: IconName; title: string; text: string } = { icon: 'truck', title: 'No challans yet', text: "When a dealer dispatches old batteries, their challan appears here under the dealer's name." }) => {
    const inView = (ref: string) => !only || only.some(e => e.id === ref);
    const pool = only ? state.challans.filter(c => c.entryIds.some(inView)) : state.challans;
    const withChallans = state.dealers.filter(d => pool.some(c => c.dealerId === d.id) || only?.some(e => e.dealerId === d.id && !challanOf(e)));
    const groups = withChallans.filter(d => dealerF === 'All' || d.name === dealerF)
      .map(d => ({ d, list: pool.filter(c => c.dealerId === d.id).sort((x, y) => y.at.localeCompare(x.at)) })).filter(g => g.list.length)
      .sort((x, y) => y.list[0]!.at.localeCompare(x.list[0]!.at));
    const loose = (only ?? []).filter(e => !challanOf(e) && (dealerF === 'All' || dealerName(e.dealerId) === dealerF));
    const sel = pool.find(c => c.no === selChallan);
    const count = (n: number) => `${n} ${n === 1 ? 'battery' : 'batteries'}`;
    const shown = (c: Challan) => only ? `${c.rows.filter(r => inView(r.ref)).length} of ${count(c.rows.length)}` : count(c.rows.length);
    const chip = (c: Challan) => c.receivedAt ? <Chip tone="live" icon="box" label={`Arrived ${dShort(c.receivedAt)}`} /> : <Chip tone="vio" icon="truck" label="On the way" />;
    const total = groups.reduce((t, g) => t + g.list.length, 0);
    const list = <Stack>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <FilterPick label="Dealer" value={dealerF} options={withChallans.map(d => d.name)} onChange={v => { setDealerF(v); setSelChallan(null); }} />
        <X s={12.5} c={T.slate}>{only ? `${count(only.length)} · ` : ''}{total} {total === 1 ? 'challan' : 'challans'} · {groups.length} {groups.length === 1 ? 'dealer' : 'dealers'}</X>
      </View>
      {!groups.length && !loose.length ? <Box><Empty icon={empty.icon} title={empty.title} text={empty.text} /></Box>
        : groups.map(({ d, list: cs }) => <Box key={d.id} title={d.name} right={<X s={12} c={T.slate}>{d.city} · {cs.length} {cs.length === 1 ? 'challan' : 'challans'}</X>}>
          <View style={{ paddingHorizontal: 14 }}>{cs.map((c, i) => <Line key={c.no} last={i === cs.length - 1} onPress={() => setSelChallan(c.no)}
            av={<Avatar n={c.receivedAt ? 'box' : 'truck'} tone={c.no === selChallan ? 'amber' : c.receivedAt ? 'green' : 'vio'} />}
            title={<Mono>{c.no}</Mono>} sub={`Sent ${dLong(c.at)} · ${shown(c)}${c.vehicle ? ` · ${c.vehicle}` : ''}`} right={chip(c)} />)}</View>
        </Box>)}
      {loose.length > 0 && <Box title="Not on a challan" right={<X s={12} c={T.slate}>{count(loose.length)}</X>}><View style={{ paddingHorizontal: 14 }}>{loose.map((e, i, arr) => row(e, i, arr, false))}</View></Box>}
    </Stack>;
    if (!sel) return a.wide ? <Cols weights={[1, 1.45]}>{list}<Box><Empty icon={only ? empty.icon : 'truck'} title="Choose a challan" text={only ? 'Its batteries in this list show here.' : 'Its batteries, their stage and the approve / reject buttons show here.'} /></Box></Cols> : list;
    const entries = sel.entryIds.filter(inView).map(ref => state.entries.find(e => e.id === ref)).filter((e): e is Entry => !!e);
    const unmatched = only ? [] : sel.rows.filter(r => !entries.some(e => e.id === r.ref));
    const stillOnWay = only ? [] : entries.filter(e => e.returnState === 'In transit');
    const download = async () => {
      const dealer = state.dealers.find(x => x.id === sel.dealerId);
      if (!dealer) { a.toast('The dealer for this challan is not loaded yet. Refresh and try again.'); return; }
      try { await saveHtmlDocument(challanHtml(sel, dealer), `Challan-${sel.no}`, `Challan ${sel.no}`); a.toast(`Challan ${sel.no} downloaded — the same copy the dealer has. Open it to print or check each battery.`); }
      catch { a.toast('The challan could not be saved on this device.'); }
    };
    const detail = <Box title={`${sel.no} · ${dealerName(sel.dealerId)}`}
      right={<View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Btn kind="ghost" sm icon="down" label="Download challan" onPress={download} />
        {canEdit && !sel.receivedAt && stillOnWay.length ? <Btn kind="blue" sm icon="box" label={`Confirm all ${stillOnWay.length} arrived`} onPress={() => openAct({ entries: stillOnWay, to: 'Received', label: `Confirm challan ${sel.no} arrived`, whole: sel.serverId })} /> : chip(sel)}</View>}>
      <View style={{ paddingHorizontal: 14, paddingTop: 11 }}><KV cols={a.wide ? 3 : 2} pairs={[['Dealer', dealerName(sel.dealerId)], ['Sent', dLong(sel.at)], ['Arrived', sel.receivedAt ? dLong(sel.receivedAt) : 'Not yet'], ['Vehicle', sel.vehicle || '—'], ['Collected by', sel.driver || '—'], [only ? (tab === 'rejected' ? 'Rejected' : 'Claimed') : 'Batteries', only ? `${entries.length} of ${sel.rows.length}` : String(sel.rows.length)]]} /></View>
      <View style={{ paddingHorizontal: 14 }}>
        {entries.map((e, i, arr) => row(e, i, unmatched.length ? [...arr, e] : arr, !only))}
        {unmatched.map((r, i) => <Line key={r.lineId || r.serial} last={i === unmatched.length - 1} av={<Avatar n="batt" tone="mute" />}
          title={<Mono>{r.serial}</Mono>} sub={`${r.model} · ${r.ref} · ${r.fault}`} right={<Chip tone={stageChip(r.stage)[1]} icon={stageChip(r.stage)[2]} label={stageChip(r.stage)[0]} />} />)}
      </View>
    </Box>;
    return a.wide ? <Cols weights={[1, 1.45]}>{list}{detail}</Cols>
      : <Stack><Btn kind="ghost" sm label={only ? '← Back to the list' : '← All challans'} style={{ alignSelf: 'flex-start' }} onPress={() => setSelChallan(null)} />{detail}</Stack>;
  };
  return <Page title="Old battery returns" sub="Every replaced battery, from the dealer’s shop to claimed or rejected"
    tabs={<Tabs value={tab} onChange={t => { setTab(t); setSelChallan(null); }} items={[['challans', `Challans ${state.challans.length}`], ['way', `On the way ${onWay.length}`], ['dealers', `At dealers ${atDealer.length}`], ['company', `At the company ${atCompany.length}`], ['claimed', `Claimed ${claimed.length}`], ['rejected', `Rejected ${rejected.length}`]]} />}>
    <Kpis cols={a.wide ? 4 : 2} items={[{ v: String(atDealer.length), l: 'Still at dealers', tone: 'flag', onPress: () => setTab('dealers') }, { v: String(onWay.length), l: 'On the way', onPress: () => setTab('way') }, { v: String(receivedThisMonth), l: 'Arrived this month' }, { v: String(atDealer.filter(e => ageDays(e.date) > 30).length), l: 'At a dealer over 30 days', tone: 'bad', onPress: () => setTab('dealers') }]} />
    <View style={{ height: 14 }} />
    {tab === 'challans' && challanView()}
    {tab === 'claimed' && challanView(claimed, { icon: 'check', title: 'Nothing claimed yet', text: 'A battery shows here, under its dealer and challan, once you approve it at the factory.' })}
    {tab === 'rejected' && challanView(rejected, { icon: 'x', title: 'Nothing rejected', text: 'A battery you refuse shows here, under its dealer and challan, with the reason the dealer sees.' })}
    {tab === 'way' && <Stack>
      <Banner tone="info" icon="truck"><B>Scanning in is not approving.</B> Confirm each battery as it comes off the van and choose the plant that made it, then approve or reject it once it has been checked.</Banner>
      {!openChallans.length && !looseOnWay.length && <Box><Empty icon="truck" title="Nothing on the way" text="When a dealer dispatches old batteries, their challan appears here." /></Box>}
      {openChallans.map(c => { const list = onWay.filter(e => c.entryIds.includes(e.id));
        return <Box key={c.no} title={c.no} right={canEdit ? <Btn kind="blue" sm icon="box" label={`Confirm all ${list.length} arrived`} onPress={() => openAct({ entries: list, to: 'Received', label: `Confirm challan ${c.no} arrived`, whole: c.serverId })} /> : <StatusChip status="In transit" />}>
          <View style={{ paddingHorizontal: 14, paddingTop: 11 }}><KV cols={a.wide ? 4 : 2} pairs={[['From', dealerName(c.dealerId)], ['Sent', `${dLong(c.at)}`], ['Vehicle', c.vehicle || '—'], ['Collected by', c.driver || '—']]} /></View>
          <View style={{ paddingHorizontal: 14 }}>{list.map((e, i, arr) => row(e, i, arr))}</View>
        </Box>; })}
      {looseOnWay.length > 0 && <Box title="Dispatched without a challan"><View style={{ paddingHorizontal: 14 }}>{looseOnWay.map((e, i, arr) => row(e, i, arr))}</View></Box>}
    </Stack>}
    {tab === 'dealers' && <Cols weights={[1, 1.55]}>
      <Box title="By dealer"><Table rows={byDealer} keyOf={x => x.d.id} onRow={x => a.go('dealer', x.d.id)} empty="Every old battery has left the dealers."
        cols={[{ h: 'Dealer', w: 1.4, cell: x => <X s={13.5} w={7}>{x.d.name}</X> }, { h: 'At shop', w: 0.6, cell: x => String(x.list.length) }, { h: 'Oldest', w: 0.7, cell: x => `${Math.max(...x.list.map(e => ageDays(e.date)))} days` }, { h: '', w: 0.7, cell: x => Math.max(...x.list.map(e => ageDays(e.date))) > 30 ? <Chip tone="bad" icon="alert" label="Chase" /> : <Chip tone="live" label="Normal" /> }]}
        mobile={{ title: x => x.d.name, sub: x => `${x.list.length} at shop · oldest ${Math.max(...x.list.map(e => ageDays(e.date)))} days` }} /></Box>
      <Box title="Every battery still at a dealer">{atDealer.length ? <View style={{ paddingHorizontal: 14 }}>{atDealer.map((e, i, arr) => <Line key={e.id} last={i === arr.length - 1} onPress={() => a.go('entry', e.id)} av={<Avatar n="shop" tone={ageDays(e.date) > 30 ? 'red' : 'amber'} />}
        title={<Mono>{e.items.map(it => it.oldSerial).filter(Boolean).join(', ')}</Mono>} sub={`${dealerName(e.dealerId)} · ${e.id} · ${ageDays(e.date)} days · ${e.handover ? 'handed over' : 'handover not confirmed'}`}
        right={canEdit ? <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: a.wide ? 360 : 150 }}>
          {!e.handover && <Btn kind="ghost" sm label="Confirm handover" onPress={() => setHandover(e)} />}
          <Btn kind="ghost" sm icon="truck" label="Record dispatch" onPress={() => openAct({ entries: [e], to: 'In transit', label: 'Record dispatch (challan or transport details)' })} /></View> : undefined} />)}</View>
        : <X s={13.5} c={T.slate} style={{ padding: 14 }}>No old batteries waiting at dealers.</X>}</Box>
    </Cols>}
    {tab === 'company' && (() => {
      if (!plants.length) return <Box title="At the company">{atCompany.length ? <View style={{ paddingHorizontal: 14 }}>{atCompany.map((e, i, arr) => row(e, i, arr))}</View> : <Empty icon="box" title="Nothing at the company" text="Batteries appear here once a challan is confirmed." />}</Box>;
      // one box per plant that made the batteries (D-19); switched-off plants still hold their old batteries
      const NOT_SET = 'Plant not set';
      const groups = [...plants.map(p => ({ key: p.id, name: p.name, off: !p.active, list: atCompany.filter(e => plantOf(e)?.id === p.id) })),
        { key: 'none', name: NOT_SET, off: false, list: atCompany.filter(e => !plantOf(e)) }]
        .filter(g => g.list.length && (plantF === 'All' || plantF === g.name));
      return <Stack>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <FilterPick label="Plant" value={plantF} options={[...plants.map(p => p.name), NOT_SET]} onChange={setPlantF} />
          <X s={12.5} c={T.slate}>{groups.reduce((t, g) => t + g.list.length, 0)} {groups.reduce((t, g) => t + g.list.length, 0) === 1 ? 'battery' : 'batteries'} · sorted by the plant that made them</X>
        </View>
        {!groups.length ? <Box><Empty icon="box" title={atCompany.length ? 'None from this plant' : 'Nothing at the company'} text="Batteries appear here once they are confirmed as arrived." /></Box>
          : groups.map(g => <Box key={g.key} title={g.name} right={<View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>{g.off ? <Chip tone="mute" label="Switched off" /> : null}<X s={12} c={T.slate}>{g.list.length} {g.list.length === 1 ? 'battery' : 'batteries'}</X></View>}>
            <View style={{ paddingHorizontal: 14 }}>{g.list.map((e, i, arr) => row(e, i, arr))}</View>
          </Box>)}
      </Stack>;
    })()}
    <ReasonDialog open={!!act} title={act?.label || ''} confirm={act?.to === 'Scrapped' ? 'Mark scrapped' : 'Confirm'} kind={act?.to === 'Scrapped' ? 'danger' : 'blue'} onClose={() => setAct(null)}
      onConfirm={r => {
        if (!act) return false;
        const plant = pickedPlant();
        if (needsPlant && !plant) { setPlantErr(act.whole ? 'Choose the plant that made these batteries.' : 'Choose the plant that made this battery.'); return false; }
        return apply(act.entries, act.to, r, plant?.id, act.whole);
      }}
      suggestions={act?.to === 'Received' ? ['Scanned in at Nashik warehouse'] : act?.to === 'Testing' ? ['Sent to the test bench'] : act?.to === 'Repaired' ? ['Cells replaced, holds charge'] : act?.to === 'Scrapped' ? ['Dead cells — not repairable', 'Cracked case'] : act?.to === 'Closed' ? ['Checked and closed'] : act?.to === 'In transit' ? ['Company van pickup'] : []}
      intro={act ? `${act.entries.length} ${act.entries.length === 1 ? 'battery' : 'batteries'} · ${act.entries.map(e => e.id).join(', ')}` : undefined}>
      {act && needsPlant ? <>
        {/* the plant is read off the label, so the label's number is right above the choice */}
        {!act.whole && act.entries.length === 1 ? <Plate style={{ marginBottom: 13 }}><PlateLab>Number on the battery</PlateLab><PlateVal size={19}>{codesOf(act.entries[0]!) || '—'}</PlateVal></Plate> : null}
        <Select label={act.whole ? 'Plant that made these batteries' : 'Plant that made this battery'} req value={plantName} ph="Choose the plant"
          options={activePlants.map(p => ({ v: p.name }))} onChange={v => { setPlantName(v); setPlantErr(''); }} error={plantErr}
          hint={act.whole ? 'Every battery arriving now is counted under this plant. If they come from different plants, confirm them one by one instead.' : 'Read it from the number on the battery’s label.'} />
      </> : null}
    </ReasonDialog>
    <ReasonDialog open={!!retag} title={`Plant for ${retag ? codesOf(retag) : ''}`} confirm="Save plant" kind="blue" onClose={() => setRetag(null)}
      suggestions={['Misread the label', 'Arrived before plants were tracked']}
      intro="Changes which plant this battery is counted under. The old and the new plant both stay in the audit log."
      onConfirm={r => {
        if (!retag) return false;
        const plant = pickedPlant();
        if (!plant) { setPlantErr('Choose the plant that made this battery.'); return false; }
        if (plant.id === plantOf(retag)?.id) { setPlantErr(`It is already counted under ${plant.name}.`); return false; }
        saveRetag(retag, plant.id, r);
      }}>
      <Select label="Plant that made this battery" req value={plantName} ph="Choose the plant" options={activePlants.map(p => ({ v: p.name }))} onChange={v => { setPlantName(v); setPlantErr(''); }} error={plantErr} />
    </ReasonDialog>
    <ReasonDialog open={decide?.kind === 'approve'} title={`Approve ${decide?.e.id || ''}`} confirm="Approve" kind="blue" onClose={() => setDecide(null)}
      suggestions={['Verified at the factory — manufacturing defect', 'Checked offline, warranty valid']} intro="The old battery is at the factory. Approving records the replacement with the original cover dates, and the dealer is shown it is approved for refund."
      onConfirm={r => decide ? dec.approve(decide.e, r) : false} />
    <ReasonDialog open={decide?.kind === 'reject'} title={`Reject ${decide?.e.id || ''}`} confirm="Reject" kind="danger" onClose={() => setDecide(null)}
      suggestions={['Physical damage — not covered', 'No fault found on testing', 'Serial does not match the label']} intro="The dealer sees this reason in their app."
      onConfirm={r => decide ? dec.reject(decide.e, r) : false} />
    <ReasonDialog open={!!handover} title="Confirm customer handover" confirm="Confirm handover" onClose={() => setHandover(null)} suggestions={['Given to the customer at the counter']} intro="Records that the customer received the new battery."
      onConfirm={r => { if (!handover) return false; if (!canEdit) { a.toast('Read-only access.'); return false; } setState(s => audit({ ...s, entries: s.entries.map(e => e.id === handover.id ? { ...e, handover: `${r} · ${new Date().toLocaleString('en-IN')}` } : e) }, 'Confirm handover', handover.id, r)); a.toast('Handover recorded.'); }} />
  </Page>;
}

/* ---------- batteries by plant (D-19) ---------- */
const NO_PLANT = 'none';
const decisionChip = (status?: string): [string, Tone, IconName] => status === 'Approved' ? ['Approved', 'live', 'check'] : status === 'Rejected' ? ['Refused', 'bad', 'x'] : ['To decide', 'warn', 'clock'];

/** Every old battery that has reached head office, under the plant (branch) that made it — decided or not. */
export function ByPlant() {
  const a = useA(); const { state } = useStore();
  const [plantF, setPlantF] = useState('all'), [dealer, setDealer] = useState('All'), [q, setQ] = useState('');
  const plants = state.plants ?? [];
  const plantName = (id?: string) => plants.find(p => p.id === id)?.name ?? 'Plant not set';
  const dealerName = (d: string) => state.dealers.find(x => x.id === d)?.name || d;
  const entryOf = (ref: string) => state.entries.find(e => e.id === ref);
  // a challan line that is past "In transit" is a battery head office has in hand; its plant was chosen on arrival
  const arrived = state.challans.flatMap(c => c.rows.filter(r => r.stage && r.stage !== 'In transit').map(r => ({
    ...r, key: r.lineId || `${c.no}:${r.serial}`, challan: c.no, dealerId: c.dealerId,
    at: (r.stage === 'Received' ? r.stagedAt : c.receivedAt ?? r.stagedAt) ?? c.at, plant: r.plantId && plants.some(p => p.id === r.plantId) ? r.plantId : NO_PLANT,
  }))).sort((x, y) => y.at.localeCompare(x.at));
  const countOf = (id: string) => arrived.filter(r => r.plant === id).length;
  const unset = countOf(NO_PLANT);
  const dealerId = state.dealers.find(d => d.name === dealer)?.id;
  const rows = arrived.filter(r => (plantF === 'all' || r.plant === plantF) && (!dealerId || r.dealerId === dealerId) && (!q || r.serial.includes(q.trim())));
  const chip = (ref: string) => { const [l, tone, icon] = decisionChip(entryOf(ref)?.status); return <Chip tone={tone} icon={icon} label={l} />; };
  const open = (r: typeof arrived[number]) => { if (entryOf(r.ref)) a.go('entry', r.ref); };

  if (!plants.length) return <Page title="Batteries by plant" sub="Old batteries sorted by the plant that made them">
    <Box><Empty icon="grid" title="No plants yet" text="Add your plants under Models & serial rules → Plants. Each battery is then tagged with its plant when it arrives." action={<Btn kind="ghost" sm label="Open Models & serial rules" onPress={() => a.go('catalogue')} />} /></Box>
  </Page>;

  return <Page title="Batteries by plant" sub="Every old battery that has arrived, under the plant that made it"
    tabs={<Tabs value={plantF} onChange={setPlantF} items={[['all', `All ${arrived.length}`], ...plants.filter(p => p.active || countOf(p.id)).map(p => [p.id, `${p.name} ${countOf(p.id)}`] as [string, string]), ...(unset ? [[NO_PLANT, `Plant not set ${unset}`] as [string, string]] : [])]} />}>
    <Stack>
      {plantF === 'all' && <Kpis cols={a.wide ? 4 : 2} items={[...plants.filter(p => p.active || countOf(p.id)).map(p => ({ v: String(countOf(p.id)), l: p.active ? p.name : `${p.name} (switched off)`, onPress: () => setPlantF(p.id) })), ...(unset ? [{ v: String(unset), l: 'Plant not set', tone: 'flag' as const, onPress: () => setPlantF(NO_PLANT) }] : [])]} />}
      {plantF === NO_PLANT && <Banner tone="warn" icon="alert">These arrived before plants were tracked, or without one. Open <B>Old battery returns → At the company</B> and use <B>Set plant</B> on each.</Banner>}
      <Box title={plantF === 'all' ? 'All arrived batteries' : plantF === NO_PLANT ? 'Plant not set' : plantName(plantF)}
        right={<X s={12} c={T.slate}>{rows.length} {rows.length === 1 ? 'battery' : 'batteries'}</X>}
        filters={<><SearchBox value={q} onChange={v => setQ(v.replace(/\D/g, ''))} ph="Battery number" /><FilterPick label="Dealer" value={dealer} options={[...new Set(arrived.map(r => r.dealerId))].map(dealerName)} onChange={setDealer} /></>}>
        <Table rows={rows} keyOf={r => r.key} onRow={open} empty={arrived.length ? 'No batteries match.' : 'No old battery has arrived yet. They appear here once head office confirms them off the van.'}
          cols={[
            { h: 'Battery', w: 1.1, cell: r => <X s={13} f="m" w={6}>{r.serial}</X> },
            { h: 'Model', w: 0.5, cell: r => <X s={13.5} w={7}>{r.model}</X> },
            ...(plantF === 'all' ? [{ h: 'Plant', w: 0.9, cell: (r: typeof rows[number]) => <X s={13.5} c={r.plant === NO_PLANT ? T.slate : T.ink}>{plantName(r.plant)}</X> }] : []),
            { h: 'Dealer', w: 1.2, cell: r => dealerName(r.dealerId) },
            { h: 'Challan', w: 0.9, cell: r => <X s={12.5} f="m" c={T.slate}>{r.challan}</X> },
            { h: 'Arrived', w: 0.6, cell: r => dShort(r.at) },
            { h: 'Decision', w: 0.8, cell: r => chip(r.ref) },
          ]}
          mobile={{ title: r => <Mono>{r.serial}</Mono>, sub: r => `${r.model} · ${plantF === 'all' ? `${plantName(r.plant)} · ` : ''}${dealerName(r.dealerId)} · ${dShort(r.at)}`, right: r => chip(r.ref) }} />
      </Box>
    </Stack>
  </Page>;
}
