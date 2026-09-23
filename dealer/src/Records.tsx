import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { useStore } from '@felix/shared/store';
import { Audit, normalize, today } from '@felix/shared/domain';
import { printHtml, escapeHtml } from '@felix/shared/reports';
import { T, family } from '@felix/shared/ui/theme';
import { X, Mono, Ic, Btn, Card, CardH, Chip, StatusChip, Field, Hint, Banner, KV, SecT, Line, Avatar, IconBtn, Plate, PlateLab, PlateVal, AvTone, B } from '@felix/shared/ui/kit';
import { Screen, AppBar, Sheet, useD } from './shell';
import { PickList } from '@felix/shared/ui/pick';
import { EntryLine, openEntry, useSyncNow } from './Home';
import { getAccessToken } from '@felix/shared/api/session';
import { entryTrail } from '@felix/shared/api/audit';

// backend audit actions → the words this screen already uses (see `label` below)
const TRAIL_LABEL: Record<string, string> = { 'entry.submitted': 'Entry submitted', 'entry.approved': 'Entry approved', 'entry.rejected': 'Reject entry' };
import { ScanSheet } from './Capture';
import { avatarTone, coverChip, coverOf, dLong, dShort, dealerEntries, findBattery, firstProblem, monthLong, spanLong, tShort } from '@felix/shared/data';

const FILTERS = ['all', 'rep', 'month', 'fix', 'notsent'] as const;

/* d18 · my entries */
export function D18({ p }: { p?: string }) {
  const d = useD(); const { state, dealerId } = useStore();
  const [f, setF] = useState<string>(p && (FILTERS as readonly string[]).includes(p) ? p : 'all'), [code, setCode] = useState(p?.startsWith('code:') ? p.slice(5) : ''), [sheet, setSheet] = useState(false);
  const all = dealerEntries(state, dealerId), month = today().slice(0, 7);
  const fix = all.filter(e => ['Conflict', 'Rejected'].includes(e.status)), notSent = all.filter(e => ['Draft', 'Pending sync'].includes(e.status));
  const test: Record<string, (e: typeof all[number]) => boolean> = { all: () => true, rep: e => e.type === 'Replacement', month: e => e.date.startsWith(month), fix: e => fix.includes(e), notsent: e => notSent.includes(e) };
  const rows = all.filter(test[f]).filter(e => !code || e.items.some(i => normalize(i.code) === code || normalize(i.oldSerial) === code));
  const pills: [string, string][] = [['all', `All ${all.length}`], ['rep', 'Replacement'], ['month', 'This month'], ['fix', `Needs fixing ${fix.length}`], ['notsent', `Not sent ${notSent.length}`]];
  const Pill = ({ on, label, onPress, x }: { on: boolean; label: string; onPress: () => void; x?: boolean }) =>
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={{ flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: on ? T.steelSoft : T.white, borderWidth: 1, borderColor: on ? '#A9C4EE' : T.zinc3, borderRadius: 7, paddingVertical: 5, paddingHorizontal: 10 }}>
      <X s={12.5} c={on ? '#22468A' : T.ink} numberOfLines={1}>{label}</X>{x && <Ic n="x" size={13} color={T.slate} />}</Pressable>;
  return <Screen tab="list" top={<AppBar title="My entries" back="d07" right={<IconBtn n="filter" label="Filter entries" onPress={() => setSheet(true)} />} />}
    overlay={<Sheet open={sheet} title="Show entries" onClose={() => setSheet(false)}><PickList options={pills.map(([k, l]) => ({ v: l, sub: k === 'fix' ? 'Serial exceptions and refused requests' : k === 'notsent' ? 'Unfinished or saved on this phone' : undefined }))} value={pills.find(x => x[0] === f)![1]} onPick={v => { setF(pills.find(x => x[1] === v)![0]); setSheet(false); }} /></Sheet>}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12, flexGrow: 0 }} contentContainerStyle={{ gap: 7, paddingBottom: 3 }}>
      {code ? <Pill on x label={`Serial ${code}`} onPress={() => setCode('')} /> : null}
      {pills.map(([k, l]) => <Pill key={k} on={f === k} label={l} onPress={() => setF(k)} />)}
    </ScrollView>
    <Card>{rows.length ? rows.map((e, i) => <EntryLine key={e.id} e={e} showType last={i === rows.length - 1} onPress={() => openEntry(d, d.setFlow, e)} />)
      : <X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>No entries match this view.</X>}</Card>
    <Hint icon="doc" center style={{ marginTop: 14 }}>Showing {rows.length} of {all.length}</Hint>
  </Screen>;
}

/* d19 · entry detail */
export function D19({ p }: { p?: string }) {
  const d = useD(); const { state, setState, dealerId, audit } = useStore(); const sync = useSyncNow();
  const [ask, setAsk] = useState(false), [what, setWhat] = useState(''), [why, setWhy] = useState('');
  const e = state.entries.find(x => x.id === p && x.dealerId === dealerId);
  // the server's own trail for a sent entry (audit module) — local audits cover demo entries
  const [trail, setTrail] = useState<Audit[]>([]);
  useEffect(() => {
    if (!e?.apiId) { setTrail([]); return; }
    let alive = true;
    getAccessToken().then(t => (t ? entryTrail(e.apiId!, t) : null)).then(r => { if (alive && r) setTrail(r.items.map(x => ({ id: String(x.id), actor: x.actor.name ?? x.actor.role, action: TRAIL_LABEL[x.action] ?? x.action, ref: e.id, reason: x.reason ?? '', at: x.at }))); }).catch(() => {});
    return () => { alive = false; };
  }, [e?.apiId]);
  if (!e) return <Screen tab="list" top={<AppBar title="Entry" back="d18" />}><X c={T.slate}>This entry is not in your shop’s records.</X></Screen>;
  const rep = e.type === 'Replacement', problem = firstProblem(e, state);
  const history = (trail.length ? trail : state.audits.filter(a => a.ref === e.id)).sort((a, b) => a.at.localeCompare(b.at));
  const icon = (action: string): [any, AvTone] => /approved/i.test(action) ? ['check', 'green'] : /reject/i.test(action) ? ['x', 'red'] : /review|correction/i.test(action) ? ['eye', 'amber'] : /submitted|sent/i.test(action) ? ['check', 'green'] : ['doc', 'mute'];
  const label = (action: string, actor: string) => action === 'Entry submitted' ? (actor.includes(dealerId) ? 'You sent the entry' : 'Entry sent') : action === 'Entry approved' ? 'Head office approved the claim' : action === 'Reject entry' ? 'Head office refused the claim' : action === 'Start review' ? 'Head office started a review' : action === 'Correction requested' ? 'Correction asked for' : action;
  const send = () => {
    if (what.trim().length < 3 || why.trim().length < 5) { d.toast('Say what should change and why.'); return; }
    if (e.apiId) { d.toast('Correction requests are not available in this version. Call head office to change a sent entry.'); return; }
    setState(s => audit({ ...s, entries: s.entries.map(x => x.id === e.id ? { ...x, correction: { reason: why.trim(), value: what.trim(), status: 'Pending' } } : x) }, 'Correction requested', e.id, why.trim(), e.remarks, what.trim()));
    setAsk(false); setWhat(''); setWhy(''); d.toast('Sent to head office. You will see their answer here.');
  };
  return <Screen tab="list" top={<AppBar title="Entry" back="d18" />}
    overlay={<Sheet open={ask} title="Ask head office to fix it" onClose={() => setAsk(false)}>
      <X s={14} c={T.slate} style={{ marginBottom: 12 }}>A sent entry cannot be edited from the shop. Head office makes the change and keeps the original readable.</X>
      <Field label="What should change?" req value={what} onChange={setWhat} ph="e.g. Serial 26080319 should be 26080318" multiline />
      <Field label="Why" req value={why} onChange={setWhy} ph="e.g. Misread the label in low light" multiline />
      <Btn kind="blue" icon="check" label="Send to head office" onPress={send} /></Sheet>}>
    {e.status === 'Conflict' && <Banner tone="bad" icon="alert" style={{ marginBottom: 12 }}><B>This entry cannot be approved yet.</B> {problem || 'Head office found a problem with a serial on it.'} Fix the serial or ask head office to review it.</Banner>}
    {e.status === 'Rejected' && <Banner tone="bad" icon="x" style={{ marginBottom: 12 }}><B>Head office refused this entry.</B> {e.decisionReason || state.audits.find(a => a.ref === e.id && a.action === 'Reject entry')?.reason || 'Ask head office for the reason.'}</Banner>}
    {e.status === 'Pending sync' && <Banner tone="warn" icon="sync" style={{ marginBottom: 12 }}><B>Saved on this phone.</B> It is sent to head office when signal returns.</Banner>}
    {e.status === 'Draft' && <Banner tone="info" icon="pen" style={{ marginBottom: 12 }}><B>Not sent yet.</B> Continue where you left off.</Banner>}
    {['Submitted', 'Under Review'].includes(e.status) && <Banner tone="info" icon="clock" style={{ marginBottom: 12 }}><B>With head office.</B> {rep ? 'The claim is decided once the old battery is back and checked.' : 'Head office confirms it shortly.'}</Banner>}
    {e.correction?.status === 'Pending' && <Banner tone="warn" icon="eye" style={{ marginBottom: 12 }}><B>Correction asked for.</B> “{e.correction.value}” — waiting for head office.</Banner>}
    <Card><CardH mono title={e.id} right={<StatusChip status={e.status} />} />
      <KV pairs={[['Type', e.type], ['Date', dLong(e.date)], ['Place', e.place], ['Customer', e.customer || '—'], ['Total batteries', String(e.items.length)], ['Sent', e.status === 'Draft' ? 'Not yet' : `${dShort(e.createdAt)}, ${tShort(e.createdAt)}`]]} /></Card>
    <SecT title="Batteries in this entry" />
    {e.items.map((it, i) => <Card key={it.id} style={[{ flexDirection: 'row', gap: 11, alignItems: 'center' }, i ? { marginTop: 11 } : null]} label={`Open battery ${it.code}`} onPress={() => it.code ? d.go('d24', it.code) : undefined}>
      <Avatar n="batt" tone={avatarTone(e.status) as AvTone} />
      <View style={{ flex: 1 }}><X s={14.5} w={6}>{it.model} · <Mono>{it.code || '—'}</Mono></X><X s={12.5} c={T.slate} style={{ marginTop: 2 }}>{it.oldSerial ? <>was <Mono>{it.oldSerial}</Mono> · </> : null}qty 1{it.fault ? ` · ${it.fault}` : ''}</X></View>
      <Ic n="chev" size={22} color={T.zinc3} /></Card>)}
    <SecT title="History of this entry" />
    <Card>{history.length || e.returnState ? <>
      {history.map((h, i) => { const [n, tone] = icon(h.action); return <Line key={h.id} last={i === history.length - 1 && !e.returnState} av={<Avatar n={n} tone={tone} />} title={label(h.action, h.actor)} titleSize={14} sub={`${dShort(h.at)} ${tShort(h.at)}${h.actor.includes(dealerId) ? '' : ` · ${h.actor.split(' · ')[0]}`}`} />; })}
      {e.returnState && <Line last av={<Avatar n="truck" tone="vio" />} title={`Old battery · ${e.returnState.toLowerCase()}`} titleSize={14} sub={e.returnNote || 'Tracked with head office'} />}
    </> : <X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>Nothing recorded yet.</X>}</Card>
    {e.status === 'Draft' && <Btn kind="primary" icon="pen" label="Continue this entry" style={{ marginTop: 13 }} onPress={() => openEntry(d, d.setFlow, e)} />}
    {e.status === 'Pending sync' && <Btn kind="primary" icon="sync" label="Send now" style={{ marginTop: 13 }} onPress={sync} />}
    {['Conflict', 'Rejected'].includes(e.status) && e.correction?.status !== 'Pending' && <Btn kind="ghost" icon="pen" label="Ask head office to fix it" style={{ marginTop: 13 }} onPress={() => setAsk(true)} />}
    {rep && !['Draft', 'Pending sync'].includes(e.status) && <Btn kind="blue" icon="check" label="Head office decision" style={{ marginTop: 9 }} onPress={() => d.go('d32', e.id)} />}
  </Screen>;
}

/* d23 · serial search */
export function D23({ p }: { p?: string }) {
  const d = useD(); const { state, dealerId } = useStore();
  const [q, setQ] = useState(''), [scan, setScan] = useState(p === 'scan');
  const entries = dealerEntries(state, dealerId).filter(e => e.status !== 'Draft');
  const res = useMemo(() => {
    const t0 = Date.now(), n = q.trim().toLowerCase();
    if (!n) return { list: [] as string[], ents: [] as typeof entries, secs: 0 };
    const codes = new Set<string>();
    state.batteries.filter(b => b.dealerId === dealerId && [b.code, b.serial, b.oldSerial || '', b.customer, b.model].some(v => v.toLowerCase().includes(n))).forEach(b => codes.add(b.code));
    entries.forEach(e => e.items.forEach(i => { if (i.code && [i.code, i.serial].some(v => v.toLowerCase().includes(n))) codes.add(i.code); if (i.oldSerial && i.oldSerial.toLowerCase().includes(n) && findBattery(state, i.oldSerial)?.dealerId === dealerId) codes.add(i.oldSerial); }));
    const ents = entries.filter(e => [e.id, e.customer, e.order].some(v => v.toLowerCase().includes(n)));
    return { list: [...codes].slice(0, 20), ents: ents.slice(0, 10), secs: (Date.now() - t0) / 1000 };
  }, [q, state, dealerId]);
  const recent = (d.recent.length ? d.recent : state.batteries.filter(b => b.dealerId === dealerId && b.state !== 'Available').slice(-3).reverse().map(b => b.code)).slice(0, 5);
  const found = res.list.length + res.ents.length;
  return <Screen tab="search" overlay={<ScanSheet open={scan} title="Scan a battery" onClose={() => setScan(false)} onCode={c => setQ(c)} />}
    top={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 8, paddingHorizontal: 15, paddingBottom: 13, backgroundColor: T.zinc, borderBottomWidth: 1, borderBottomColor: T.zinc2 }}>
      <View style={{ flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: T.white, borderWidth: 1.5, borderColor: q ? T.ink3 : T.zinc3, borderRadius: 9, paddingHorizontal: 13 }}>
        <Ic n="search" color={T.slate} />
        <TextInput accessibilityLabel="Search serial, customer or request" value={q} onChangeText={setQ} placeholder="Serial, customer or request" placeholderTextColor="#93A0AF" autoCorrect={false} autoCapitalize="none" returnKeyType="search"
          style={[{ flex: 1, fontFamily: family(q ? 'm' : 'b', q ? 6 : 4), fontSize: 16, color: T.ink, padding: 0 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
        {!!q && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')}><Ic n="x" color={T.slate} /></Pressable>}
      </View>
      <IconBtn n="scan" label="Scan a battery" onPress={() => setScan(true)} />
    </View>}>
    <Hint style={{ marginBottom: 12, marginTop: 0 }}>Type any part of a code, a short serial, an old serial, a customer or an order number.</Hint>
    {q.trim() ? <>
      <SecT first title={`${found} ${found === 1 ? 'match' : 'matches'} · found in ${res.secs < 0.1 ? 'under 0.1' : res.secs.toFixed(1)} s`} />
      {res.list.map((code, i) => {
        const b = findBattery(state, code), cover = coverOf(b, state), [cl, ct] = coverChip(cover?.status || '');
        const repEntry = entries.find(e => e.type === 'Replacement' && e.items.some(it => it.code === code));
        return <Card key={code} style={[{ borderColor: '#A9C4EE' }, i ? { marginTop: 11 } : null]} label={`Open ${code}`} onPress={() => d.go('d24', code)}>
          <CardH mono title={code} right={b ? <Chip tone={ct} icon={cover?.status === 'Active' ? 'shield' : 'clock'} label={cl} /> : <Chip tone="info" icon="clock" label="On a request" />} />
          <KV pairs={[['Model', b?.model || repEntry?.items.find(it => it.code === code)?.model || '—'], ['Serial', b?.serial || code.slice(-4), 'mono'], ['Dealer', state.dealers.find(x => x.id === dealerId)?.name || '—'], ['Replaced', repEntry ? dShort(repEntry.date) : '—'], ['Was', b?.oldSerial || repEntry?.items.find(it => it.code === code)?.oldSerial || '—', 'mono'], ['Cover ends', cover ? dLong(cover.expiry) : '—']]} />
          <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}><Ic n="chev" color={T.steel} /><X s={13} w={6} c={T.steel}>Open full history</X></View>
        </Card>;
      })}
      {res.ents.length > 0 && <Card style={res.list.length ? { marginTop: 11 } : undefined}>{res.ents.map((e, i) => <EntryLine key={e.id} e={e} last={i === res.ents.length - 1} onPress={() => d.go('d19', e.id)} />)}</Card>}
      {!found && <Card><X s={13.5} c={T.slate}>Nothing in your shop’s records matches “{q.trim()}”. Check the label, or try the last 4 digits.</X></Card>}
    </> : <>
      <SecT first title="Recently opened" />
      <Card>{recent.length ? recent.map((code, i) => { const b = findBattery(state, code), cover = coverOf(b, state);
        return <Line key={code} last={i === recent.length - 1} onPress={() => d.go('d24', code)} av={<Avatar n="batt" tone="mute" />} title={code} titleMono sub={`${b?.model || '—'} · ${!b ? 'on a request' : b.state === 'Returned' ? 'returned' : cover?.status === 'Expired' ? 'cover ended' : b.customer ? 'with customer' : 'in stock'}`} chev />; })
        : <X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>Batteries you open appear here.</X>}</Card>
    </>}
  </Screen>;
}

/* d24 · battery detail & warranty */
export function D24({ p = '' }: { p?: string }) {
  const d = useD(); const { state, dealerId } = useStore();
  useEffect(() => { if (p) d.addRecent(p); }, [p]);
  const b = findBattery(state, p), cover = coverOf(b, state);
  const entries = dealerEntries(state, dealerId).filter(e => e.items.some(i => i.code === p || i.oldSerial === p));
  const repEntry = entries.find(e => e.type === 'Replacement' && e.items.some(i => i.code === p));
  const pending = !b ? entries.find(e => e.items.some(i => i.code === p)) : undefined;
  const dealer = state.dealers.find(x => x.id === (b?.dealerId || dealerId));
  const download = () => printHtml(`<h1>Felix Batteries · Battery ${escapeHtml(p)}</h1><p>${escapeHtml(b?.model || '')} · serial ${escapeHtml(b?.serial || p.slice(-4))} · made ${escapeHtml(monthLong(b?.mfg))}<br/>${escapeHtml(dealer?.name || '')} · ${escapeHtml(dealer?.city || '')}</p><p>Cover: ${escapeHtml(cover ? `${dLong(cover.start)} → ${dLong(cover.expiry)} (${cover.status})` : 'not on record')}</p><table><tr><th>Request</th><th>Type</th><th>Date</th><th>Status</th></tr>${entries.map(e => `<tr><td>${escapeHtml(e.id)}</td><td>${escapeHtml(e.type)}</td><td>${escapeHtml(dLong(e.date))}</td><td>${escapeHtml(e.status)}</td></tr>`).join('')}</table>`).catch(() => d.toast('Printing is not available on this device.'));
  if (b && b.dealerId !== dealerId) return <Screen tab="search" top={<AppBar title="Battery" back="d23" />}><Banner tone="bad" icon="lock"><B>Held by another shop.</B> This battery is recorded against a different dealer, so its history is not shown here.</Banner></Screen>;
  if (!b && !pending) return <Screen tab="search" top={<AppBar title="Battery" back="d23" />}><Banner tone="warn" icon="alert"><B>Not on record.</B> {p} is not in your shop’s records yet.</Banner></Screen>;
  const it = pending?.items.find(i => i.code === p);
  const custody: [string, 'live' | 'info' | 'mute' | 'vio', any] = !b ? ['Waiting for approval', 'info', 'clock'] : b.state === 'Available' ? ['In your stock', 'live', 'box'] : b.state === 'Returned' ? ['Returned', 'mute', 'truck'] : b.state === 'Repair' ? ['In repair', 'vio', 'wrench'] : ['With customer', 'info', 'user'];
  const [cl, ct] = coverChip(cover?.status || '');
  return <Screen tab="search" top={<AppBar title="Battery" back="d23" right={<IconBtn n="down" label="Download battery history" onPress={download} />} />}>
    <Plate style={{ marginBottom: 12 }}><PlateLab>SERIAL NUMBER</PlateLab><PlateVal size={24}>{p}</PlateVal>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
        <Chip tone={ct} icon="shield" label={cl} /><Chip tone={custody[1]} icon={custody[2]} label={custody[0]} />
        {!!cover?.replacements && <Chip tone="vio" icon="link" label={`${cover.replacements} ${cover.replacements === 1 ? 'replacement' : 'replacements'}`} />}</View></Plate>
    {pending && <Banner tone="info" icon="clock" style={{ marginBottom: 12 }}><B>Not in the register yet.</B> It is on request {pending.id}, waiting for head office.</Banner>}
    <Card><KV pairs={[['Model', b?.model || it?.model || '—'], ['Serial', b?.serial || it?.serial || p.slice(-4), 'mono'], ['Made', monthLong(b?.mfg || it?.mfg)], ['Dealer', dealer?.name || '—'], ['City', dealer?.city || '—'], ['Replaced on', repEntry ? dLong(repEntry.date) : '—'], ['Old serial', b?.oldSerial || it?.oldSerial || '—', 'mono']]} /></Card>
    <SecT title="Warranty" />
    <Card style={cover?.status === 'Active' ? { borderColor: '#B8DFCB' } : undefined}>
      {cover ? <><KV pairs={[['Cover started', dLong(cover.start)], ['Cover ends', dLong(cover.expiry)], ['Left', cover.status === 'Expired' ? 'None' : spanLong(cover.leftSpan)], ['Policy', `Standard ${cover.months} months`]]} />
        <Banner tone="ok" icon="shield" style={{ marginTop: 11 }}>Dates come from the first sale in this chain. Nobody can type a different end date.</Banner></>
        : <Banner tone="warn" icon="alert">No cover dates on record. Head office sets them from the first sale — nothing is guessed.</Banner>}
    </Card>
    <SecT title="Open" />
    <Card><Line last onPress={() => d.go('d18', `code:${p}`)} av={<Avatar n="list" tone="mute" />} title="Entries using this battery" sub={`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`} chev /></Card>
  </Screen>;
}
