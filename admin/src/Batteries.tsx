import React, { useState } from 'react';
import { View, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as XLSX from 'xlsx';
import { useStore } from '@felix/shared/store';
import { useLive } from '@felix/shared/api/sync';

const NOT_IN_V1 = 'Not available in this version — warranty overrides, policies and the catalogue are managed on the server later.';
import { Battery, Model, chainFor, deriveCode, expiryFrom, normalize, today, uid, warranty } from '@felix/shared/domain';
import { T } from '@felix/shared/ui/theme';
import { X, B, Mono, Btn, Card, CardH, Chip, StatusChip, Field, Hint, Banner, KV, Kpis, Line, Avatar, Plate, PlateLab, PlateVal, Meter } from '@felix/shared/ui/kit';
import { coverChip, coverOf, dLong, dShort, monthLong, spanLong, spanShort } from '@felix/shared/data';
import { Page, Box, Cols, Stack, Table, Pills, SearchBox, Tabs, Dialog, ReasonDialog, Select, ToggleRow, EntryTable, ScanDialog, Empty, useA } from './ui';

const stateChip = (s: string) => <Chip tone={s === 'Available' ? 'live' : s === 'Returned' || s === 'Scrap' ? 'mute' : s === 'Repair' || s === 'Damaged' ? 'vio' : 'info'} label={s === 'Sold' || s === 'Replacement' ? 'With customer' : s} />;
const coverCell = (b: Battery) => { const [l, t] = coverChip(warranty(b).status); return <Chip tone={t} icon="shield" label={l} />; };

/* ---------- battery search ---------- */
export function Search({ id }: { id?: string }) {
  const a = useA(); const { state } = useStore();
  const [q, setQ] = useState(id || ''), [scan, setScan] = useState(false);
  const dealerName = (d: string) => state.dealers.find(x => x.id === d)?.name || d;
  const n = q.trim().toLowerCase();
  const batteries = n ? state.batteries.filter(b => [b.code, b.serial, b.oldSerial || '', b.model, b.customer, dealerName(b.dealerId)].some(v => v.toLowerCase().includes(n))) : [];
  const entries = n ? state.entries.filter(e => [e.id, e.customer, e.order, ...e.items.flatMap(i => [i.code, i.oldSerial])].some(v => v.toLowerCase().includes(n))) : [];
  const dealers = n ? state.dealers.filter(d => [d.name, d.id, d.mobile].some(v => v.toLowerCase().includes(n))) : [];
  const recent = [...state.movements].reverse().map(m => m.code).filter((c, i, arr) => arr.indexOf(c) === i).slice(0, 6).map(c => state.batteries.find(b => b.code === c)).filter(Boolean) as Battery[];
  const batteryTable = (rows: Battery[]) => <Table rows={rows} keyOf={b => b.code} onRow={b => a.go('battery', b.code)} empty="No batteries match."
    cols={[{ h: 'Serial', w: 1, cell: b => <X s={13} f="m" w={6}>{b.code}</X> }, { h: 'Model', w: 0.6, cell: b => <X s={13.5} w={7}>{b.model}</X> }, { h: 'Dealer', w: 1.3, cell: b => dealerName(b.dealerId) }, { h: 'Customer', w: 1.2, cell: b => b.customer || '—' }, { h: 'Where', w: 1, cell: b => stateChip(b.state) }, { h: 'Cover', w: 1.1, cell: coverCell }]}
    mobile={{ av: () => <Avatar n="batt" tone="mute" />, title: b => <Mono>{b.code}</Mono>, sub: b => `${b.model} · ${dealerName(b.dealerId)}`, right: coverCell }} />;
  return <Page title="Battery search" sub="Any part of a serial, an old serial, a customer, a dealer or a reference"
    actions={<Btn kind="blue" sm icon="scan" label="Scan a battery" onPress={() => setScan(true)} />}>
    <View style={{ flexDirection: 'row', marginBottom: 14 }}><SearchBox value={q} onChange={setQ} ph="e.g. 0047, 21030047, Suresh Transport, ENT-26-09-0412" style={{ minHeight: 44 }} /></View>
    {n ? <Stack>
      <Box title={`${batteries.length} ${batteries.length === 1 ? 'battery' : 'batteries'}`}>{batteryTable(batteries)}</Box>
      {entries.length > 0 && <Box title={`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}><EntryTable entries={entries} onOpen={e => a.go(e.status === 'Draft' ? 'new' : 'entry', e.id)} /></Box>}
      {dealers.length > 0 && <Box title="Dealers"><View style={{ paddingHorizontal: 14 }}>{dealers.map((d, i) => <Line key={d.id} last={i === dealers.length - 1} onPress={() => a.go('dealer', d.id)} av={<Avatar n="shop" />} title={d.name} sub={`${d.id} · ${d.city}`} right={<StatusChip status={d.status} />} />)}</View></Box>}
    </Stack> : <Box title="Recently moved batteries">{batteryTable(recent)}</Box>}
    <ScanDialog open={scan} onClose={() => setScan(false)} onCode={setQ} />
  </Page>;
}

/* ---------- battery detail & chain ---------- */
export function BatteryDetail({ id = '' }: { id?: string }) {
  const live = useLive();
  const a = useA(); const { state, setState, audit, canEdit } = useStore();
  const [override, setOverride] = useState(false), [days, setDays] = useState('14');
  const b = state.batteries.find(x => normalize(x.code) === normalize(id));
  const related = state.entries.filter(e => e.items.some(i => i.code === id || i.oldSerial === id));
  if (!b) return <Page back title={id} sub="Not in the register"><Stack>
    <Banner tone="warn" icon="alert"><B>Not in the battery register yet.</B> {related.length ? 'It appears on an entry that has not been approved.' : 'No entry uses this serial.'}</Banner>
    {related.length > 0 && <Box title="Entries using it"><EntryTable entries={related} onOpen={e => a.go('entry', e.id)} /></Box>}</Stack></Page>;
  const cover = coverOf(b, state), chain = chainFor(b.code, state.batteries), w = warranty(b);
  const dealer = state.dealers.find(d => d.id === b.dealerId);
  const moves = state.movements.filter(m => m.code === b.code).reverse();
  const ovs = state.overrides.filter(o => o.code === b.code);
  const [cl, ct] = coverChip(w.status);
  return <Page back title={b.code} sub={`${b.model} · ${dealer?.name || b.dealerId}`}
    actions={canEdit ? <>
      <Btn kind="primary" sm icon="wrench" label="Start a replacement" onPress={() => a.go('new', `claim:${b.code}`)} />
      {b.expiry && <Btn kind="ghost" sm icon="flag" label="Ask for a warranty override" onPress={() => setOverride(true)} />}
      <Btn kind="ghost" sm icon="box" label="Post a stock movement" onPress={() => a.go('stock', `move:${b.code}`)} />
    </> : undefined}>
    <Cols weights={[1.55, 1]}>
      <Stack>
        <Plate><PlateLab>SERIAL NUMBER</PlateLab><PlateVal size={24}>{b.code}</PlateVal>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 11, flexWrap: 'wrap' }}><Chip tone={ct} icon="shield" label={cl} />{stateChip(b.state)}{chain.length > 1 && <Chip tone="vio" icon="link" label={`${chain.length - 1} ${chain.length === 2 ? 'replacement' : 'replacements'}`} />}</View></Plate>
        <Box title="Chain from the first sale" right={<Chip tone="vio" icon="link" label={`${chain.length} ${chain.length === 1 ? 'link' : 'links'}`} />} pad>
          {chain.map((c, i) => { const e = state.entries.find(x => x.type === 'Replacement' && x.items.some(it => it.code === c.code)); const now = c.code === b.code;
            return <View key={c.code} style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ width: 34, alignItems: 'center' }}><View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: now ? T.live : i === 0 ? T.slate : T.steel }}><X s={12} w={7} c={T.white}>{i + 1}</X></View>{i < chain.length - 1 && <View style={{ width: 2, flex: 1, minHeight: 22, backgroundColor: T.zinc3 }} />}</View>
              <View style={{ flex: 1, paddingBottom: 15 }}>
                <X s={14.5} w={7}>{i === 0 ? 'First sale' : `Replaced with ${c.code}`}</X>
                <X s={12.5} c={T.slate}>{c.model} · {i === 0 ? `sold ${dLong(c.start)}` : e ? `${dLong(e.date)} · ${e.id}` : 'replacement'} · {c.customer || 'no customer'}</X>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>{stateChip(c.state)}{now && <Chip tone="live" label="This battery" />}{c.code !== b.code && <Btn kind="ghost" sm label="Open" onPress={() => a.go('battery', c.code)} />}</View>
              </View></View>; })}
          {chain.length > 2 && <Banner tone="warn" icon="alert"><B>Replaced more than once inside one cover period.</B> Usually this points at fitting or charging, not the battery. Worth a call to the dealer.</Banner>}
        </Box>
        <Box title="Warranty" pad>
          {cover ? <>
            <Meter used={cover.used} labels={[`${dLong(cover.start)} · first sale`, 'Today', `${dLong(cover.expiry)} · ends`]} />
            <View style={{ height: 12 }} />
            <KV cols={a.wide ? 3 : 2} pairs={[['Cover started', dLong(cover.start)], ['Cover ends', dLong(cover.expiry)], ['Remaining', w.status === 'Expired' ? 'None' : spanLong(cover.leftSpan)], ['Policy', `${b.policy || '—'} · ${cover.months} months`], ['Replacements in chain', String(cover.replacements)], ['Overrides', ovs.length ? ovs.map(o => `${o.days}d ${o.status.toLowerCase()}`).join(', ') : 'None']]} />
            <Banner tone="ok" icon="shield" style={{ marginTop: 12 }}>These dates belong to the first sale in the chain. A replacement never starts a new term; only an approved override can move the end date.</Banner>
          </> : <Banner tone="warn" icon="alert">No cover dates on record. They are never guessed — they are set when a sale with a date is approved.</Banner>}
        </Box>
      </Stack>
      <Stack>
        <Card><CardH title="This battery" right={stateChip(b.state)} />
          <KV pairs={[['Model', b.model], ['Short serial', b.serial, 'mono'], ['Made', monthLong(b.mfg)], ['Dealer', dealer?.name || b.dealerId], ['Customer', b.customer || '—'], ['Old serial', b.oldSerial || '—', 'mono']]} />
          {dealer && <Btn kind="ghost" sm icon="shop" label="Open dealer" style={{ marginTop: 11 }} onPress={() => a.go('dealer', dealer.id)} />}</Card>
        <Box title="Entries using this battery"><EntryTable compact entries={related} onOpen={e => a.go('entry', e.id)} empty="No entries yet." /></Box>
        <Box title="Stock movements">{moves.length ? <View style={{ paddingHorizontal: 14 }}>{moves.map((m, i) => <Line key={m.id} last={i === moves.length - 1} av={<Avatar n="box" tone="mute" />} title={`${m.from} → ${m.to}`} titleSize={14} sub={`${dShort(m.date)} · ${m.reason}`} />)}</View> : <X s={13.5} c={T.slate} style={{ padding: 14 }}>No movements posted.</X>}</Box>
      </Stack>
    </Cols>
    <ReasonDialog open={override} title="Ask for a warranty override" confirm="Add to override requests" onClose={() => setOverride(false)} intro={`Cover currently ends ${dLong(b.expiry)}. The request goes to the override queue — it changes nothing until it is approved.`}
      onConfirm={r => { if (live) { a.toast(NOT_IN_V1); return false; } if (!/^\d+$/.test(days) || Number(days) < 1) { a.toast('Enter a whole number of extra days.'); return false; } setState(s => audit({ ...s, overrides: [{ id: uid('OVR'), code: b.code, days: Number(days), reason: r, status: 'Pending' }, ...s.overrides] }, 'Warranty override requested', b.code, r)); a.toast('Override request added to the queue.'); }}>
      <Field label="Extra days asked for" req mono numeric value={days} onChange={setDays} />
    </ReasonDialog>
  </Page>;
}

/* ---------- warranty ---------- */
export function Warranty({ id }: { id?: string }) {
  const live = useLive();
  const a = useA(); const { state, setState, audit, canEdit, role } = useStore();
  const [tab, setTab] = useState(id === 'overrides' ? 'overrides' : 'register'), [filter, setFilter] = useState('All'), [q, setQ] = useState('');
  const [editor, setEditor] = useState(false), [months, setMonths] = useState('24'), [effective, setEffective] = useState(today()), [anchor, setAnchor] = useState('Original sale'), [allow, setAllow] = useState(false), [maxDays, setMaxDays] = useState('0'), [alertDays, setAlertDays] = useState('30'), [reason, setReason] = useState('');
  const [decision, setDecision] = useState<{ id: string; status: 'Approved' | 'Rejected' } | null>(null);
  const dealerName = (d: string) => state.dealers.find(x => x.id === d)?.name || d;
  const register = state.batteries.filter(b => (filter === 'All' || warranty(b).status === filter) && [b.code, b.customer, dealerName(b.dealerId)].some(v => v.toLowerCase().includes(q.toLowerCase())));
  const pendingOv = state.overrides.filter(o => o.status === 'Pending');
  const inForce = [...state.policies].filter(p => p.effective <= today()).sort((x, y) => y.effective.localeCompare(x.effective))[0];
  const chains = state.batteries.filter(b => !b.oldSerial && state.batteries.some(x => x.oldSerial === b.code)).map(root => ({ root, chain: chainFor(root.code, state.batteries) })).filter(c => c.chain.length > 1);
  const extended = state.batteries.filter(b => { if (!b.oldSerial) return false; const root = chainFor(b.code, state.batteries)[0]; return root && root.expiry !== b.expiry && !state.overrides.some(o => o.code === b.code && o.status === 'Approved'); }).length;
  const savePolicy = () => {
    if (!/^\d+$/.test(months) || Number(months) < 1 || !/^\d+$/.test(maxDays) || !/^\d+$/.test(alertDays) || !/^\d{4}-\d{2}-\d{2}$/.test(effective) || effective < today() || !Number.isFinite(Date.parse(effective)) || reason.trim().length < 5) { a.toast('Use today or a future date, a positive term, whole days, and a reason.'); return; }
    if (live) { a.toast(NOT_IN_V1); return; }
    setState(s => audit({ ...s, policies: [{ id: uid('POL'), months: Number(months), effective, anchor, overrides: allow, maxDays: Number(maxDays), alertDays: Number(alertDays) }, ...s.policies] }, 'Policy version created', 'POLICY', reason));
    setEditor(false); setReason(''); a.toast('New policy version saved. Batteries already sold keep their dates.');
  };
  const decide = (why: string) => {
    if (!decision) return false;
    const o = state.overrides.find(x => x.id === decision.id)!; const b = state.batteries.find(x => x.code === o.code); const p = state.policies.find(x => x.id === b?.policy);
    if (decision.status === 'Approved' && (!p?.overrides || o.days > p.maxDays || !b?.expiry)) { a.toast('This battery’s policy does not allow that extension, so it cannot be approved.'); return false; }
    if (live) { a.toast(NOT_IN_V1); return; }
    setState(s => { const end = b?.expiry ? new Date(Date.parse(b.expiry) + o.days * 86400000).toISOString().slice(0, 10) : undefined; return audit({ ...s, overrides: s.overrides.map(x => x.id === o.id ? { ...x, status: decision.status } : x), batteries: decision.status === 'Approved' ? s.batteries.map(x => x.code === o.code ? { ...x, expiry: end } : x) : s.batteries }, `Warranty override ${decision.status.toLowerCase()}`, o.code, why, b?.expiry, decision.status === 'Approved' ? end : b?.expiry); });
    a.toast('Override decision recorded against the battery.');
  };
  return <Page title="Warranty" sub="One cover period from the first sale — carried through every replacement"
    tabs={<Tabs value={tab} onChange={setTab} items={[['register', 'Batteries in cover'], ['policies', 'Policy versions'], ['overrides', `Override requests${pendingOv.length ? ` ${pendingOv.length}` : ''}`], ['continuity', 'How cover carries over']]} />}>
    {tab === 'register' && <Box filters={<><Pills value={filter} onChange={setFilter} items={['All', 'Active', 'Expiring soon', 'Expired', 'Not on record'].map(s => [s, `${s} ${s === 'All' ? state.batteries.length : state.batteries.filter(b => warranty(b).status === s).length}`] as [string, string])} /><SearchBox value={q} onChange={setQ} ph="Serial, customer or dealer" /></>}>
      <Table rows={register} keyOf={b => b.code} onRow={b => a.go('battery', b.code)} empty="No batteries match."
        cols={[{ h: 'Serial', w: 1, cell: b => <X s={13} f="m" w={6}>{b.code}</X> }, { h: 'Model', w: 0.5, cell: b => <X s={13.5} w={7}>{b.model}</X> }, { h: 'Dealer', w: 1.3, cell: b => dealerName(b.dealerId) }, { h: 'Customer', w: 1.2, cell: b => b.customer || '—' }, { h: 'Started', w: 0.9, cell: b => dLong(b.start) }, { h: 'Ends', w: 0.9, cell: b => dLong(b.expiry) }, { h: 'Status', w: 1.1, cell: coverCell }]}
        mobile={{ title: b => <Mono>{b.code}</Mono>, sub: b => `${b.model} · ends ${dLong(b.expiry)}`, right: coverCell }} />
    </Box>}
    {tab === 'policies' && <Cols weights={[1.55, 1]}>
      <Box title="Policies" right={role === 'Main Admin' && canEdit ? <Btn kind="ghost" sm icon="plus" label="New version" onPress={() => setEditor(true)} /> : undefined}>
        <Table rows={[...state.policies].sort((x, y) => y.effective.localeCompare(x.effective))} keyOf={p => p.id}
          cols={[{ h: 'Version', w: 1, cell: p => <X s={13} f="m" w={6}>{p.id}</X> }, { h: 'Applies from', w: 1, cell: p => dLong(p.effective) }, { h: 'Term', w: 0.7, cell: p => `${p.months} months` }, { h: 'Counts from', w: 0.9, cell: p => p.anchor }, { h: 'Overrides', w: 0.9, cell: p => p.overrides ? `Up to ${p.maxDays} days` : 'Not allowed' }, { h: 'Status', w: 0.9, cell: p => p.id === inForce?.id ? <Chip tone="live" icon="check" label="In force" /> : p.effective > today() ? <Chip tone="info" icon="clock" label="Scheduled" /> : <Chip tone="mute" label="Historic" /> }]}
          mobile={{ title: p => <Mono>{p.id}</Mono>, sub: p => `${p.months} months · from ${dLong(p.effective)}`, right: p => p.id === inForce?.id ? <Chip tone="live" label="In force" /> : <Chip tone="mute" label={p.effective > today() ? 'Scheduled' : 'Historic'} /> }} />
      </Box>
      <Card><CardH title="The rule in one line" />
        <Banner tone="ok" icon="shield"><B>A replacement inherits the original start and end date.</B> Sold 10 Jan 2026 → cover ends 09 Jan 2028. Replaced 10 Jan 2027 → still ends 09 Jan 2028.</Banner>
        <Banner tone="info" icon="lock" style={{ marginTop: 11 }}>A new version only affects sales from its start date. Batteries already sold keep the version that created them.</Banner>
        {role !== 'Main Admin' && <Hint icon="lock">Only the Main Admin can publish a policy version.</Hint>}
      </Card>
    </Cols>}
    {tab === 'overrides' && <Stack>
      <Banner tone="warn" icon="flag"><B>An override never happens quietly.</B> It needs a reason, is checked against the battery’s policy, and stays attached to the battery for good.</Banner>
      {!state.overrides.length ? <Box><Empty icon="flag" title="No override requests" text="Ask for one from a battery’s page." /></Box> : [...pendingOv, ...state.overrides.filter(o => o.status !== 'Pending')].map(o => {
        const b = state.batteries.find(x => x.code === o.code), p = state.policies.find(x => x.id === b?.policy);
        const allowed = !!p?.overrides && o.days <= (p?.maxDays || 0) && !!b?.expiry;
        return <Card key={o.id}><CardH mono title={o.code} right={<StatusChip status={o.status === 'Pending' ? 'Under Review' : o.status} label={o.status === 'Pending' ? 'Waiting' : o.status} />} />
          <KV cols={a.wide ? 4 : 2} pairs={[['Dealer', b ? dealerName(b.dealerId) : '—'], ['Cover ends', dLong(b?.expiry)], ['Extra days asked', String(o.days)], ['Policy allows', p?.overrides ? `Up to ${p.maxDays} days` : 'No overrides']]} />
          <X s={13.5} c={T.ink3} style={{ marginTop: 10 }}>“{o.reason}”</X>
          {o.status === 'Pending' && !allowed && <Banner tone="bad" icon="lock" style={{ marginTop: 10 }}>The battery’s policy does not allow this extension. It can only be refused.</Banner>}
          {canEdit && o.status === 'Pending' && <View style={{ flexDirection: 'row', gap: 9, marginTop: 12, flexWrap: 'wrap' }}>
            <Btn kind="ghost" sm label="Open battery" onPress={() => a.go('battery', o.code)} />
            <Btn kind="ghost" sm label="Refuse" color={T.terminal} borderColor="#F0C7BC" onPress={() => setDecision({ id: o.id, status: 'Rejected' })} />
            <Btn kind="blue" sm label="Approve override" disabled={!allowed} onPress={() => setDecision({ id: o.id, status: 'Approved' })} /></View>}
        </Card>;
      })}
    </Stack>}
    {tab === 'continuity' && <Stack>
      <Kpis cols={a.wide ? 4 : 2} items={[{ v: String(state.batteries.filter(b => warranty(b).status === 'Active').length), l: 'Batteries in cover' }, { v: String(extended), l: 'Extended by a replacement', tone: extended ? 'bad' : undefined }, { v: String(chains.filter(c => c.chain.length > 2).length), l: 'Chains replaced twice or more', tone: 'flag' }, { v: String(state.overrides.filter(o => o.status === 'Approved').length), l: 'Approved overrides', tone: 'flag' }]} />
      <Banner tone="ok" icon="shield"><B>The rule is enforced when an entry is approved.</B> The first sale in a chain sets the start and end date. Every later replacement inherits both, with the policy version that produced them. No form, import or admin screen lets anyone type a different end date — only an approved override moves it.</Banner>
      <Box title="Chains with a replacement">
        <Table rows={chains} keyOf={c => c.root.code} onRow={c => a.go('battery', c.chain[c.chain.length - 1].code)} empty="No replacements approved yet."
          cols={[{ h: 'Chain root', w: 1, cell: c => <X s={13} f="m" w={6}>{c.root.code}</X> }, { h: 'First sold', w: 0.9, cell: c => dLong(c.root.start) }, { h: 'Cover ends', w: 0.9, cell: c => <X s={13.5} w={7}>{dLong(c.root.expiry)}</X> }, { h: 'Replacements', w: 0.7, cell: c => String(c.chain.length - 1) }, { h: 'In use now', w: 1, cell: c => <X s={13} f="m" w={6}>{c.chain[c.chain.length - 1].code}</X> }, { h: 'Remaining', w: 0.8, cell: c => { const cv = coverOf(c.chain[c.chain.length - 1], state); return cv ? (cv.status === 'Expired' ? 'Ended' : spanShort(cv.leftSpan)) : '—'; } }]}
          mobile={{ title: c => <Mono>{c.root.code}</Mono>, sub: c => `${c.chain.length - 1} replaced · ends ${dLong(c.root.expiry)}` }} />
      </Box>
    </Stack>}
    <Dialog open={editor} title="New policy version" sub="Applies to sales from its start date only" onClose={() => setEditor(false)}>
      <View style={{ flexDirection: 'row', gap: 9 }}><Field style={{ flex: 1 }} label="Standard term (months)" req mono numeric value={months} onChange={setMonths} /><Field style={{ flex: 1 }} label="Applies from" req mono value={effective} onChange={setEffective} ph="YYYY-MM-DD" /></View>
      <Select label="Cover counts from" req value={anchor} options={['Original sale', 'Activation']} onChange={setAnchor} />
      <Field label="On replacement" value="Continue the original cover" readonly hint="Locked. A replacement never restarts cover." hintIcon="lock" />
      <Card style={{ paddingVertical: 0, marginBottom: 13 }}><ToggleRow last label="Allow approved overrides" sub="Extensions still need a reason and approval" value={allow} onChange={setAllow} /></Card>
      <View style={{ flexDirection: 'row', gap: 9 }}><Field style={{ flex: 1 }} label="Longest extension (days)" mono numeric value={maxDays} onChange={setMaxDays} /><Field style={{ flex: 1 }} label="Warn before cover ends (days)" mono numeric value={alertDays} onChange={setAlertDays} /></View>
      <Field label="Why this change" req value={reason} onChange={setReason} multiline />
      <Banner tone="warn" icon="alert" style={{ marginBottom: 13 }}>{state.batteries.filter(b => warranty(b).status === 'Active').length} batteries are in cover now. None of their dates move.</Banner>
      <Btn kind="blue" icon="check" label="Publish version" onPress={savePolicy} />
    </Dialog>
    <ReasonDialog open={!!decision} title={decision?.status === 'Approved' ? 'Approve override' : 'Refuse override'} confirm={decision?.status === 'Approved' ? 'Approve override' : 'Refuse override'} kind={decision?.status === 'Approved' ? 'blue' : 'danger'} onClose={() => setDecision(null)} onConfirm={decide}
      intro={decision?.status === 'Approved' ? 'The new end date is stored beside the original working, which stays readable.' : 'The dealer is told the reason.'} />
  </Page>;
}

/* ---------- models, serial rules, bulk import ---------- */
export function Catalogue() {
  const live = useLive();
  const a = useA(); const { state, setState, audit, canEdit } = useStore();
  const [tab, setTab] = useState('models'), [edit, setEdit] = useState<(Model & { isNew?: boolean }) | null>(null), [raw, setRaw] = useState<any[][]>([]), [filename, setFilename] = useState(''), [message, setMessage] = useState('');
  async function pick() {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/vnd.ms-excel'], copyToCacheDirectory: true });
      if (r.canceled) return; const f = r.assets[0];
      const bytes = Platform.OS === 'web' ? await (await fetch(f.uri)).arrayBuffer() : await new File(f.uri).arrayBuffer();
      const book = XLSX.read(bytes, { type: 'array', raw: true });
      setRaw(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: false })); setFilename(f.name); setMessage('');
    } catch { a.toast('That file could not be read. Choose an XLSX or CSV file.'); }
  }
  const headers = (raw[0] || []).map(String);
  const staged = raw.slice(1).filter(r => r.some(Boolean)).map((r, i) => {
    const get = (name: string) => String(r[headers.indexOf(name)] || '').trim();
    const code = get('Code'), model = get('Model'), dealerId = get('Dealer ID'); const errors: string[] = [];
    if (!/^\d{8}$/.test(code) || !deriveCode(code).mfg) errors.push('Invalid code');
    if (!state.models.some(m => m.id === model)) errors.push('Unknown model');
    if (!state.dealers.some(d => d.id === dealerId)) errors.push('Unknown dealer');
    if (state.batteries.some(b => b.code === code) || raw.slice(1, i + 1).some(x => String(x[headers.indexOf('Code')]) === code)) errors.push('Duplicate code');
    return { idx: i, code, model, dealerId, serial: get('Serial No') || deriveCode(code).serial, mfg: deriveCode(code).mfg, errors };
  });
  const saveModel = () => {
    if (!edit) return;
    if (!edit.id.trim() || !edit.capacity.trim()) { a.toast('A model name and capacity are needed.'); return; }
    if (edit.isNew && state.models.some(m => m.id === edit.id.trim())) { a.toast('That model already exists — edit it instead.'); return; }
    const { isNew, ...m } = { ...edit, id: edit.id.trim() };
    if (live) { a.toast(NOT_IN_V1); return; }
    setState(s => audit({ ...s, models: [...s.models.filter(x => x.id !== m.id), m] }, 'Model saved', m.id, isNew ? 'Model added to the catalogue' : 'Catalogue updated'));
    setEdit(null); a.toast('Model saved.');
  };
  return <Page title="Models & serial rules" sub="What dealers can choose, and how every serial is checked"
    tabs={<Tabs value={tab} onChange={setTab} items={[['models', 'Models'], ['rules', 'Serial rules'], ['import', 'Bulk import']]} />}>
    {tab === 'models' && <Stack>
      <Box title={`${state.models.length} models`} right={canEdit ? <Btn kind="ghost" sm icon="plus" label="Add model" onPress={() => setEdit({ id: '', type: 'IT', capacity: '', months: 24, threshold: 5, active: true, isNew: true })} /> : undefined}>
        <Table rows={state.models} keyOf={m => m.id} onRow={canEdit ? m => setEdit({ ...m }) : undefined}
          cols={[{ h: 'Model', w: 0.7, cell: m => <X s={14} w={7}>{m.id}</X> }, { h: 'Type', w: 1, cell: m => m.type }, { h: 'Capacity', w: 0.8, cell: m => m.capacity }, { h: 'Code pattern', w: 1, cell: () => <X s={12.5} f="m" w={6}>YYMM####</X> }, { h: 'Warranty', w: 0.8, cell: m => `${m.months} months` }, { h: 'Reorder at', w: 0.7, cell: m => String(m.threshold) }, { h: 'On record', w: 0.7, cell: m => String(state.batteries.filter(b => b.model === m.id).length) }, { h: 'Status', w: 0.8, cell: m => m.active ? <Chip tone="live" icon="check" label="Active" /> : <Chip tone="mute" icon="clock" label="Retired" /> }]}
          mobile={{ av: () => <Avatar n="batt" tone="mute" />, title: m => m.id, sub: m => `${m.type} · ${m.capacity} · ${m.months} months`, right: m => m.active ? <Chip tone="live" label="Active" /> : <Chip tone="mute" label="Retired" /> }} />
      </Box>
      <Banner tone="info" icon="shield">Retiring a model hides it from new entries only. Every old record that used it still displays correctly.</Banner>
    </Stack>}
    {tab === 'rules' && <Cols>
      <Card><CardH title="How a serial is read" right={<Chip tone="live" label="All models" />} />
        <Field label="Pattern" value="8 digits · YYMM then a 4-digit serial" readonly mono />
        <Plate style={{ marginBottom: 13 }}><PlateLab>EXAMPLE</PlateLab><PlateVal>21030047</PlateVal><X s={13} c="#9BA9BB" style={{ marginTop: 4 }}>made March 2021 · short serial 0047</X></Plate>
        <Banner tone="warn" icon="alert">Serials are stored as written. 0047 is never turned into 47 — on screen or in the Excel export.</Banner>
        <Hint icon="lock">Family-specific patterns will be confirmed with Felix before production data is connected.</Hint>
      </Card>
      <Card><CardH title="Checks run on every entry" />
        {([['Old serial cannot equal the new serial', 'Always blocked', 'bad'], ['Serial already active with a customer', 'Blocked', 'bad'], ['Battery held by another dealer', 'Blocked', 'bad'], ['Old battery already replaced', 'Blocked', 'bad'], ['Cover already ended, no approved override', 'Blocked', 'bad'], ['Old serial missing from the register', 'Flagged, not blocked', 'warn'], ['Date more than 30 days back', 'Blocked', 'bad'], ['Month fields not YYYY-MM', 'Blocked', 'bad']] as const).map((r, i, arr) =>
          <Line key={r[0]} last={i === arr.length - 1} title={r[0]} titleSize={13.5} right={<Chip tone={r[2]} label={r[1]} />} />)}
      </Card>
    </Cols>}
    {tab === 'import' && <Cols weights={[1.55, 1]}>
      <Card><CardH title={filename ? `Trial run · ${filename}` : 'Bring in the existing register'} right={filename ? <Chip tone="vio" label="Checked, not imported" /> : undefined} />
        {!filename && <X s={14} c={T.slate} style={{ marginBottom: 12 }}>Choose the Excel or CSV file. Every row is checked first — nothing enters the register until you confirm.</X>}
        <Btn kind={filename ? 'ghost' : 'blue'} icon="upload" label={filename ? 'Choose a different file' : 'Choose XLSX or CSV'} disabled={!canEdit} onPress={pick} />
        {filename && <>
          <View style={{ height: 12 }} />
          <Kpis items={[{ v: String(staged.length), l: 'Rows read' }, { v: String(staged.filter(r => !r.errors.length).length), l: 'Ready to import' }, { v: String(staged.filter(r => r.errors.length).length), l: 'Need fixing', tone: staged.some(r => r.errors.length) ? 'bad' : undefined }]} />
          <View style={{ height: 12 }} />
          <Box><Table rows={staged} keyOf={r => String(r.idx)}
            cols={[{ h: 'Code', w: 1, cell: r => <X s={13} f="m" w={6}>{r.code || '—'}</X> }, { h: 'Model', w: 0.6, cell: r => r.model || '—' }, { h: 'Dealer', w: 0.8, cell: r => r.dealerId || '—' }, { h: 'Made', w: 0.7, cell: r => r.mfg || '—' }, { h: 'Check', w: 1.3, cell: r => r.errors.length ? <Chip tone="bad" icon="alert" label={r.errors.join(', ')} /> : <Chip tone="live" icon="check" label="Ready" /> }]}
            mobile={{ title: r => <Mono>{r.code || '—'}</Mono>, sub: r => `${r.model} · ${r.dealerId}`, right: r => r.errors.length ? <Chip tone="bad" label="Fix" /> : <Chip tone="live" label="Ready" /> }} /></Box>
          {message ? <Banner tone="ok" icon="check" style={{ marginTop: 12 }}>{message}</Banner> : null}
          <Btn kind="blue" icon="check" label={`Import ${staged.length} rows`} style={{ marginTop: 12 }} disabled={!staged.length || staged.some(r => r.errors.length > 0) || !canEdit}
            onPress={() => { if (live) { a.toast(NOT_IN_V1); return; } setState(s => audit({ ...s, batteries: [...s.batteries, ...staged.map(({ errors, idx, ...r }) => ({ ...r, customer: '', state: 'Available' }))] }, 'Serial import', 'IMPORT', `${filename}: ${staged.length} rows committed`)); setMessage(`${staged.length} serials imported. Cover dates stay “not on record” — nothing is invented.`); setRaw([]); a.toast('Serial register imported.'); }} />
          {staged.some(r => r.errors.length > 0) && <Hint tone="err">Fix the rows marked in red in the file, then choose it again.</Hint>}
        </>}
      </Card>
      <Card><CardH title="Columns the file needs" />
        {[['Code', 'Required · 8 digits, formatted as text'], ['Model', 'Required · must be in the catalogue'], ['Dealer ID', 'Required · e.g. FPP-014'], ['Serial No', 'Optional · read from the code if empty']].map((r, i, arr) => <Line key={r[0]} last={i === arr.length - 1} title={<Mono>{r[0]}</Mono>} sub={r[1]} />)}
        <Banner tone="info" icon="shield" style={{ marginTop: 11 }}>Imported batteries start as available stock. Historic cover dates are left “not on record” rather than guessed.</Banner>
      </Card>
    </Cols>}
    <Dialog open={!!edit} title={edit?.isNew ? 'Add a model' : `Edit ${edit?.id}`} onClose={() => setEdit(null)} width={500}>{edit && <>
      <Field label="Model name" req value={edit.id} onChange={v => setEdit({ ...edit, id: v.toUpperCase() })} readonly={!edit.isNew} hint={edit.isNew ? undefined : 'A model name cannot change once batteries use it.'} hintIcon="lock" caps />
      <View style={{ flexDirection: 'row', gap: 9 }}><Field style={{ flex: 1 }} label="Type" value={edit.type} onChange={type => setEdit({ ...edit, type })} /><Field style={{ flex: 1 }} label="Capacity" req value={edit.capacity} onChange={capacity => setEdit({ ...edit, capacity })} ph="e.g. 150 Ah" /></View>
      <View style={{ flexDirection: 'row', gap: 9 }}><Field style={{ flex: 1 }} label="Warranty (months)" mono numeric value={String(edit.months)} onChange={v => setEdit({ ...edit, months: Number(v.replace(/\D/g, '') || 0) })} /><Field style={{ flex: 1 }} label="Reorder level" mono numeric value={String(edit.threshold)} onChange={v => setEdit({ ...edit, threshold: Number(v.replace(/\D/g, '') || 0) })} /></View>
      <Card style={{ paddingVertical: 0, marginBottom: 13 }}><ToggleRow last label="Dealers can choose it" sub="Turn off to retire the model" value={edit.active} onChange={active => setEdit({ ...edit, active })} /></Card>
      <Btn kind="blue" icon="check" label="Save model" onPress={saveModel} />
    </>}</Dialog>
  </Page>;
}
