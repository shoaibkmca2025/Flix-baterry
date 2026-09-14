import React, { useState } from 'react';
import { View } from 'react-native';
import { useStore } from '../store';
import { Entry, today, uid } from '../domain';
import { T } from '../dealer/theme';
import { X, B, Mono, Btn, Card, CardH, Chip, StatusChip, Field, Hint, Banner, KV, Kpis, Line, Avatar, Tone, IconName } from '../dealer/kit';
import { ageDays, dLong, dShort } from '../dealer/data';
import { Page, Box, Cols, Stack, Table, Pills, SearchBox, FilterPick, Tabs, Dialog, ReasonDialog, Select, Empty, useA } from './ui';

const STATES = ['Available', 'Allocated', 'Sold', 'Returned', 'Replacement', 'Repair', 'Damaged', 'Scrap'];
const TRANSITIONS: Record<string, string[]> = { Available: ['Allocated', 'Sold', 'Repair', 'Damaged', 'Scrap'], Allocated: ['Available', 'Sold', 'Returned'], Sold: ['Returned', 'Repair'], Returned: ['Repair', 'Available', 'Damaged', 'Scrap'], Replacement: ['Returned', 'Repair'], Repair: ['Available', 'Returned', 'Damaged', 'Scrap'], Damaged: ['Repair', 'Scrap'] };

/* ---------- stock ---------- */
export function Stock({ id }: { id?: string }) {
  const a = useA(); const { state, setState, audit, canEdit } = useStore();
  const [tab, setTab] = useState('overview'), [model, setModel] = useState('All'), [st, setSt] = useState('All'), [dealer, setDealer] = useState('All'), [q, setQ] = useState('');
  const [move, setMove] = useState(!!id?.startsWith('move:')), [code, setCode] = useState(id?.startsWith('move:') ? id.slice(5) : ''), [to, setTo] = useState('Available'), [target, setTarget] = useState(''), [reason, setReason] = useState(''), [err, setErr] = useState('');
  const [thr, setThr] = useState<{ id: string; value: string } | null>(null);
  const dealerName = (d: string) => state.dealers.find(x => x.id === d)?.name || d;
  const dealerId = state.dealers.find(d => d.name === dealer)?.id;
  const batteries = state.batteries.filter(b => (model === 'All' || b.model === model) && (st === 'All' || b.state === st) && (!dealerId || b.dealerId === dealerId) && (!q || b.code.includes(q) || b.customer.toLowerCase().includes(q.toLowerCase())));
  const available = (m: string, d?: string) => state.batteries.filter(b => b.model === m && b.state === 'Available' && (!d || b.dealerId === d)).length;
  const low = state.models.filter(m => m.active && available(m.id) < m.threshold);
  const current = state.batteries.find(b => b.code === code.trim());
  const post = () => {
    const b = current;
    if (!b) { setErr('That serial is not in the register.'); return; }
    if (reason.trim().length < 5) { setErr('Give a reason for the movement.'); return; }
    if (b.state === 'Scrap') { setErr('Scrap is final. Record an admin correction instead.'); return; }
    const dest = target || b.dealerId;
    if (b.state === to && b.dealerId === dest) { setErr('Choose a different state or dealer.'); return; }
    if (!TRANSITIONS[b.state]?.includes(to) && b.dealerId === dest) { setErr(`A ${b.state.toLowerCase()} battery cannot move straight to ${to.toLowerCase()}.`); return; }
    if (state.offline) { setErr('Stock movements need online mode.'); return; }
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
  Received: [['Testing', 'Send for testing', 'blue']],
  Testing: [['Repaired', 'Mark repaired', 'blue'], ['Scrapped', 'Mark scrapped', 'danger']],
  Repaired: [['Closed', 'Close return', 'blue']],
  Scrapped: [['Closed', 'Close return', 'blue']],
};
const stageChip = (s?: string): [string, Tone, IconName] => s === 'In transit' ? ['On the way', 'vio', 'truck'] : s === 'Received' ? ['Arrived', 'live', 'box'] : s === 'Testing' ? ['Being tested', 'warn', 'eye'] : s === 'Repaired' ? ['Repaired', 'live', 'wrench'] : s === 'Scrapped' ? ['Scrapped', 'mute', 'x'] : s === 'Closed' ? ['Closed', 'live', 'check'] : ['At dealer', 'warn', 'shop'];

export function Returns() {
  const a = useA(); const { state, setState, audit, canEdit } = useStore();
  const [tab, setTab] = useState('way'), [act, setAct] = useState<{ entries: Entry[]; to: string; label: string } | null>(null), [handover, setHandover] = useState<Entry | null>(null);
  const dealerName = (d: string) => state.dealers.find(x => x.id === d)?.name || d;
  const reps = state.entries.filter(e => e.type === 'Replacement' && !['Draft', 'Rejected', 'Cancelled', 'Pending sync'].includes(e.status));
  const atDealer = reps.filter(e => !e.returnState || e.returnState === 'At dealer');
  const onWay = reps.filter(e => e.returnState === 'In transit');
  const atCompany = reps.filter(e => ['Received', 'Testing', 'Repaired', 'Scrapped'].includes(e.returnState || ''));
  const closed = reps.filter(e => e.returnState === 'Closed');
  const challanOf = (e: Entry) => state.challans.find(c => c.entryIds.includes(e.id));
  const openChallans = state.challans.filter(c => c.entryIds.some(id => onWay.some(e => e.id === id)));
  const looseOnWay = onWay.filter(e => !challanOf(e));
  const month = today().slice(0, 7);
  const receivedThisMonth = state.audits.filter(x => x.action === 'Received' && x.at.startsWith(month)).length;
  const apply = (entries: Entry[], to: string, reason: string) => {
    if (!canEdit) { a.toast('Read-only access.'); return false; }
    setState(s => entries.reduce((acc, e) => audit({ ...acc, entries: acc.entries.map(x => x.id === e.id ? { ...x, returnState: to, returnNote: reason } : x) }, to, e.id, reason, e.returnState || 'At dealer', to), s));
    a.toast(entries.length > 1 ? `${entries.length} batteries marked “${stageChip(to)[0].toLowerCase()}”.` : `Marked “${stageChip(to)[0].toLowerCase()}”.`);
  };
  const byDealer = state.dealers.map(d => ({ d, list: atDealer.filter(e => e.dealerId === d.id) })).filter(x => x.list.length).sort((x, y) => y.list.length - x.list.length);
  const row = (e: Entry, i: number, arr: Entry[], showActions = true) => {
    const [l, t, ic] = stageChip(e.returnState);
    return <Line key={e.id} last={i === arr.length - 1} onPress={() => a.go('entry', e.id)} av={<Avatar n={ic} tone={t === 'vio' ? 'vio' : t === 'live' ? 'green' : t === 'mute' ? 'mute' : 'amber'} />}
      title={<Mono>{e.items.map(it => it.oldSerial).filter(Boolean).join(', ') || '—'}</Mono>}
      sub={`${e.items[0]?.model} · ${e.id} · ${dealerName(e.dealerId)} · claim ${e.status === 'Approved' ? 'approved' : e.status === 'Conflict' ? 'serial exception' : 'waiting'}`}
      right={<View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: a.wide ? 420 : 170 }}>
        <Chip tone={t} icon={ic} label={l} />
        {showActions && canEdit && (STAGE_NEXT[e.returnState || ''] || []).map(([to, label, kind]) => <Btn key={to} kind={kind === 'danger' ? 'ghost' : kind} sm label={label} color={kind === 'danger' ? T.terminal : undefined} borderColor={kind === 'danger' ? '#F0C7BC' : undefined} onPress={() => setAct({ entries: [e], to, label })} />)}
      </View>} />;
  };
  return <Page title="Old battery returns" sub="Every replaced battery, from the dealer’s shop to a closed claim"
    tabs={<Tabs value={tab} onChange={setTab} items={[['way', `On the way ${onWay.length}`], ['dealers', `At dealers ${atDealer.length}`], ['company', `At the company ${atCompany.length}`], ['closed', `Closed ${closed.length}`]]} />}>
    <Kpis cols={a.wide ? 4 : 2} items={[{ v: String(atDealer.length), l: 'Still at dealers', tone: 'flag', onPress: () => setTab('dealers') }, { v: String(onWay.length), l: 'On the way', onPress: () => setTab('way') }, { v: String(receivedThisMonth), l: 'Arrived this month' }, { v: String(atDealer.filter(e => ageDays(e.date) > 30).length), l: 'At a dealer over 30 days', tone: 'bad', onPress: () => setTab('dealers') }]} />
    <View style={{ height: 14 }} />
    {tab === 'way' && <Stack>
      <Banner tone="info" icon="truck"><B>Scanning in is not approving.</B> Confirm a challan when the van arrives, then test each battery. The claim itself is approved from “Requests to approve”.</Banner>
      {!openChallans.length && !looseOnWay.length && <Box><Empty icon="truck" title="Nothing on the way" text="When a dealer dispatches old batteries, their challan appears here." /></Box>}
      {openChallans.map(c => { const list = onWay.filter(e => c.entryIds.includes(e.id));
        return <Box key={c.no} title={c.no} right={canEdit ? <Btn kind="blue" sm icon="box" label={`Confirm all ${list.length} arrived`} onPress={() => setAct({ entries: list, to: 'Received', label: `Confirm challan ${c.no} arrived` })} /> : <StatusChip status="In transit" />}>
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
          <Btn kind="ghost" sm icon="truck" label="Record dispatch" onPress={() => setAct({ entries: [e], to: 'In transit', label: 'Record dispatch (challan or transport details)' })} /></View> : undefined} />)}</View>
        : <X s={13.5} c={T.slate} style={{ padding: 14 }}>No old batteries waiting at dealers.</X>}</Box>
    </Cols>}
    {tab === 'company' && <Box title="At the company">{atCompany.length ? <View style={{ paddingHorizontal: 14 }}>{atCompany.map((e, i, arr) => row(e, i, arr))}</View> : <Empty icon="box" title="Nothing at the company" text="Batteries appear here once a challan is confirmed." />}</Box>}
    {tab === 'closed' && <Box title="Closed returns">{closed.length ? <View style={{ paddingHorizontal: 14 }}>{closed.map((e, i, arr) => row(e, i, arr, false))}</View> : <Empty icon="check" title="No closed returns yet" />}</Box>}
    <ReasonDialog open={!!act} title={act?.label || ''} confirm={act?.to === 'Scrapped' ? 'Mark scrapped' : 'Confirm'} kind={act?.to === 'Scrapped' ? 'danger' : 'blue'} onClose={() => setAct(null)} onConfirm={r => act ? apply(act.entries, act.to, r) : false}
      suggestions={act?.to === 'Received' ? ['Scanned in at Nashik warehouse', 'All batteries on the challan arrived'] : act?.to === 'Testing' ? ['Sent to the test bench'] : act?.to === 'Repaired' ? ['Cells replaced, holds charge'] : act?.to === 'Scrapped' ? ['Dead cells — not repairable', 'Cracked case'] : act?.to === 'Closed' ? ['Checked and closed'] : act?.to === 'In transit' ? ['Company van pickup'] : []}
      intro={act ? `${act.entries.length} ${act.entries.length === 1 ? 'battery' : 'batteries'} · ${act.entries.map(e => e.id).join(', ')}` : undefined} />
    <ReasonDialog open={!!handover} title="Confirm customer handover" confirm="Confirm handover" onClose={() => setHandover(null)} suggestions={['Given to the customer at the counter']} intro="Records that the customer received the new battery."
      onConfirm={r => { if (!handover) return false; if (!canEdit) { a.toast('Read-only access.'); return false; } setState(s => audit({ ...s, entries: s.entries.map(e => e.id === handover.id ? { ...e, handover: `${r} · ${new Date().toLocaleString('en-IN')}` } : e) }, 'Confirm handover', handover.id, r)); a.toast('Handover recorded.'); }} />
  </Page>;
}
