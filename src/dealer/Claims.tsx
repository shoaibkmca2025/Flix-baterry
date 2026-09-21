import React, { useState } from 'react';
import { View, Pressable, Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useStore } from '../store';
import { Challan, Entry } from '../domain';
import { printHtml, escapeHtml } from '../reports';
import { T } from './theme';
import { X, B, Ic, Btn, BtnRow, Card, CardH, Chip, StatusChip, Field, Hint, Banner, KV, SecT, Line, Avatar, BigOk, CheckBox, Kpis, Plate, PlateLab, PlateVal, AvTone, IconName } from './kit';
import { Screen, AppBar, useD } from './shell';
import { getAccessToken } from '../api/session';
import { createChallan } from '../api/returns';
import { toChallan } from '../api/mapping';
import { errorMessage } from '../api/client';
import { useSync } from '../api/sync';
import { ageDays, challanHtml, challanStatus, coverOf, creditNotes, CREDIT_VALUE, dLong, dShort, decisionOf, findBattery, nextChallanNo, personOf, rupees, spanShort, tShort, toSendBack } from './data';

const oldList = (e: Entry) => e.items.map(i => i.oldSerial).filter(Boolean).join(', ');

/* d32 · head office decision */
export function D32({ p }: { p?: string }) {
  const d = useD(); const { state } = useStore();
  const e = state.entries.find(x => x.id === p);
  if (!e) return <Screen tab="list" top={<AppBar title="Head office decision" back="d18" />}><X c={T.slate}>This request could not be found.</X></Screen>;
  const decided = decisionOf(state, e.id), rep = e.type === 'Replacement';
  const cover = rep ? coverOf(findBattery(state, e.items[0]?.oldSerial || ''), state) : null;
  const approved = e.status === 'Approved', refused = e.status === 'Rejected';
  const credit = e.items.reduce((t, i) => t + (CREDIT_VALUE[i.model] || 0), 0);
  const back = e.returnState && e.returnState !== 'At dealer';
  const meaning: [string, IconName, AvTone][] = refused
    ? [['The customer keeps the battery you already gave', 'user', 'green'], ['No credit is raised for this claim', 'x', 'red'], ['Head office settles it with you separately', 'phone', 'amber']]
    : [['The customer keeps the battery you already gave', 'user', 'green'], [`Cover still ends ${cover ? dLong(cover.expiry) : 'on the original date'} — unchanged`, 'shield', 'green'], back ? [`The old battery is ${e.returnState?.toLowerCase()} at the company`, 'truck', 'green'] : [approved ? 'The old battery is now due back to the company' : 'The old battery goes back at the next pickup', 'truck', 'amber']];
  return <Screen tab="list" top={<AppBar title="Head office decision" back="d18" right={approved ? <Chip tone="live" icon="check" label="Approved" /> : refused ? <Chip tone="bad" icon="x" label="Refused" /> : <Chip tone="warn" icon="clock" label="Waiting" />} />}>
    {approved && <Banner tone="ok" icon="check" style={{ marginBottom: 13 }}><B>Approved on {dShort(decided?.at || e.date)} by {personOf(decided?.actor)}.</B> {decided?.reason || 'Head office checked the claim and accepted it.'}</Banner>}
    {refused && <Banner tone="bad" icon="x" style={{ marginBottom: 13 }}><B>Refused on {dShort(decided?.at || e.date)} by {personOf(decided?.actor)}.</B> {decided?.reason || 'The claim is outside the warranty.'}</Banner>}
    {!approved && !refused && <Banner tone="warn" icon="clock" style={{ marginBottom: 13 }}><B>Waiting for head office.</B> {e.status === 'Pending sync' ? 'This request is still saved on your phone and has not been sent yet.' : e.status === 'Conflict' ? 'Head office has a question about a serial on this request — open it to see what to fix.' : 'The battery is already with the customer. The claim is decided once the old battery is back and checked.'}</Banner>}
    <Card><CardH mono title={e.id} right={<StatusChip status={e.status} />} />
      <KV pairs={rep ? [['Old battery', oldList(e) || '—', 'mono'], ['New battery', e.items.map(i => i.code).join(', '), 'mono'], ['Finding', decided?.reason ? (approved ? 'Claim accepted' : 'Claim refused') : 'Not checked yet'], ['Checked by', decided ? personOf(decided.actor) : '—'], ['Cover ends', cover ? dLong(cover.expiry) : 'Set by head office'], ['Remaining', cover ? spanShort(cover.leftSpan) : '—']]
        : [['Battery', e.items.map(i => i.code).join(', '), 'mono'], ['Type', e.type], ['Checked by', decided ? personOf(decided.actor) : '—'], ['Date', dLong(e.date)]]} /></Card>
    {approved && rep && <Card style={{ borderColor: '#B8DFCB', backgroundColor: '#F7FCF9', marginTop: 11 }}><CardH title="Credited to your account" right={<StatusChip status="Approved" label="Credited" />} />
      <KV pairs={[['Credit note', e.id.replace(/^ENT/, 'CN'), 'mono'], ['Amount', rupees(credit)], ['Credited on', dLong(decided?.at || e.date)], ['Against', e.id, 'mono']]} />
      <Btn kind="ghost" sm icon="doc" label="See all credit notes" style={{ alignSelf: 'stretch', marginTop: 11 }} onPress={() => d.go('d37')} /></Card>}
    <SecT title="What this means" />
    <Card>{meaning.map((r, i) => <Line key={r[0]} last={i === meaning.length - 1} av={<Avatar n={r[1]} tone={r[2]} />} title={r[0]} titleSize={14} />)}</Card>
    {rep && !back && !refused && <Btn kind="primary" icon="truck" label="Old batteries to send back" style={{ marginTop: 13 }} onPress={() => d.tab('d33')} />}
    <Hint style={{ marginTop: 10 }}>If a claim is ever refused, you are told why here — the battery stays with the customer and head office settles it with you.</Hint>
  </Screen>;
}

/* d33 · old batteries to send back */
export function D33() {
  const d = useD(); const { state, setState, dealerId, audit } = useStore(); const { sync } = useSync();
  const rows = toSendBack(state, dealerId);
  const [off, setOff] = useState<string[]>([]), [vehicle, setVehicle] = useState(''), [driver, setDriver] = useState(''), [busy, setBusy] = useState(false);
  const picked = rows.filter(e => !off.includes(e.id));
  const count = picked.reduce((t, e) => t + e.items.filter(i => i.oldSerial).length, 0);
  const past = state.challans.filter(c => c.dealerId === dealerId);
  const open = past.filter(c => challanStatus(c, state).status !== 'Closed').length;
  const record = (c: Challan, how: string) => {
    setState(s => audit({ ...s, challans: [c, ...s.challans.filter(x => x.no !== c.no)], entries: s.entries.map(e => c.entryIds.includes(e.id) ? { ...e, returnState: 'In transit', returnNote: `Challan ${c.no}${c.vehicle ? ` · ${c.vehicle}` : ''}` } : e) }, 'In transit', c.no, `Dealer dispatched ${c.rows.length} old batteries on challan ${c.no}${how}`));
    setOff([]); d.go('d34', c.no);
  };
  // Signed in for real: the server writes the challan and numbers it, so head office sees it
  // at once. The local-only path below is the demo/preview behaviour.
  const dispatch = async () => {
    if (!picked.length) { d.toast('Tick at least one battery to hand over.'); return; }
    const token = await getAccessToken();
    if (token && !state.offline) {
      const entryIds = picked.map(e => e.apiId).filter((x): x is string => !!x);
      if (entryIds.length < picked.length) { d.toast('Open Home first so your entries finish syncing, then try again.'); return; }
      setBusy(true);
      try {
        const result = await createChallan({ entryIds, vehicleNo: vehicle.trim().toUpperCase() || undefined, driverName: driver.trim() || undefined }, token);
        const refOf = new Map(picked.map(e => [e.apiId as string, e.id]));
        record(toChallan(result, id => refOf.get(id) || id), '');
        sync(true);
      } catch (err) {
        d.toast(errorMessage(err));
      } finally { setBusy(false); }
      return;
    }
    const at = new Date().toISOString();
    const c: Challan = { no: nextChallanNo(state), dealerId, at, vehicle: vehicle.trim().toUpperCase(), driver: driver.trim(), entryIds: picked.map(e => e.id),
      rows: picked.flatMap(e => e.items.filter(i => i.oldSerial).map(i => ({ serial: i.oldSerial, model: findBattery(state, i.oldSerial)?.model || i.model, ref: e.id, fault: i.fault || i.remarks || '—' }))) };
    record(c, ' (preview)');
  };
  return <Screen tab="truck" top={<AppBar title="Old batteries to send back" back="d07" right={<Chip tone="warn" label={`${rows.length} waiting`} />} />}
    footer={rows.length ? <Btn kind="primary" big icon="truck" label={busy ? 'Sending…' : `Dispatch ${count} ${count === 1 ? 'battery' : 'batteries'} to company`} disabled={!count || busy} onPress={dispatch} /> : undefined}>
    <Banner tone="info" icon="truck" style={{ marginBottom: 13 }}>When the company van comes, tick the batteries you are handing over and tap the button. The challan is made for you — no paper list to write.</Banner>
    <Card><CardH title="Ready to hand over" right={<Chip tone="mute" label="Tap to tick" />} />
      {rows.length ? rows.map((e, i) => {
        const on = !off.includes(e.id), age = ageDays(e.date), it = e.items[0];
        return <Pressable key={e.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setOff(o => on ? [...o, e.id] : o.filter(x => x !== e.id))}
          style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 13, borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: T.zinc2 }}>
          <CheckBox on={on} />
          <View style={{ flex: 1, minWidth: 0 }}><X s={14.5} w={6} f="m">{oldList(e)}</X><X s={12.5} c={T.slate} style={{ marginTop: 2 }}>{findBattery(state, it.oldSerial)?.model || it.model} · {e.id}</X><X s={12.5} c={T.slate} style={{ marginTop: 2 }}>{e.customer || 'Customer not named'}</X></View>
          <Chip tone={age > 30 ? 'bad' : 'warn'} icon="clock" label={age === 0 ? 'Today' : `${age} ${age === 1 ? 'day' : 'days'}`} />
        </Pressable>;
      }) : <X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>Nothing to send back. Old batteries from new replacements appear here.</X>}
    </Card>
    <Hint icon="lock" style={{ marginTop: 11 }}>The company decides each warranty claim only after it opens and checks that battery. Sending them back is what closes the claim.</Hint>
    {rows.length > 0 && <><SecT title="Pickup details" />
      <View style={{ flexDirection: 'row', gap: 9 }}>
        <Field style={{ flex: 1 }} label="Van number" value={vehicle} onChange={setVehicle} ph="MH18 BQ 4471" caps />
        <Field style={{ flex: 1 }} label="Driver name" value={driver} onChange={setDriver} ph="Driver" />
      </View></>}
    <SecT title="Already sent" />
    <Card style={{ flexDirection: 'row', gap: 11, alignItems: 'center' }} label="Past dispatches" onPress={() => d.go('d35')}>
      <Avatar n="truck" tone="vio" />
      <View style={{ flex: 1 }}><X s={14.5} w={6}>{past.length} past {past.length === 1 ? 'dispatch' : 'dispatches'}</X><X s={12.5} c={T.slate} style={{ marginTop: 2 }}>{past.length ? `${open} still being checked · ${past.length - open} closed` : 'Nothing sent yet'}</X></View>
      <Ic n="chev" size={22} color={T.zinc3} /></Card>
  </Screen>;
}

/* d34 · dispatched */
export function D34({ p }: { p?: string }) {
  const d = useD(); const { state } = useStore();
  const c = state.challans.find(x => x.no === p);
  if (!c) return <Screen tab="truck" top={<AppBar title="Dispatch" back="d33" />}><X c={T.slate}>This challan could not be found.</X></Screen>;
  const eta = new Date(Date.parse(c.at) + 2 * 86400000).toISOString();
  return <Screen tab="truck" top={<View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingHorizontal: 15, paddingBottom: 13, backgroundColor: T.zinc, borderBottomWidth: 1, borderBottomColor: T.zinc2 }}>
    <View style={{ flex: 1 }} /><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => d.back('d33')} style={{ width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2 }}><Ic n="x" /></Pressable></View>}>
    <BigOk n="truck" />
    <X s={22} w={7} f="c" style={{ textAlign: 'center', marginBottom: 5 }}>{c.rows.length} {c.rows.length === 1 ? 'battery' : 'batteries'} dispatched</X>
    <X s={15} c={T.slate} style={{ textAlign: 'center', marginBottom: 16 }}>They are off your list and on the company’s. Show this screen to the driver if he asks.</X>
    <Plate><PlateLab center>CHALLAN NUMBER</PlateLab><PlateVal size={22} center>{c.no}</PlateVal></Plate>
    <Card style={{ marginTop: 12 }}><KV pairs={[['Batteries', String(c.rows.length)], ['Handed to', c.vehicle ? `Company van · ${c.vehicle}` : 'Company van'], ['Date', `${dLong(c.at)}, ${tShort(c.at)}`], ['Expected at company', dLong(eta)]]} /></Card>
    <SecT title="On this challan" />
    <Card>{c.rows.map((r, i) => <Line key={r.serial} last={i === c.rows.length - 1} av={<Avatar n="check" tone="green" />} title={r.serial} titleMono sub={`${r.model} · ${r.ref}`} right={<StatusChip status={challanStatus(c, state).status} label={challanStatus(c, state).label} />} />)}</Card>
    <BtnRow><Btn kind="primary" icon="doc" label="Open challan" onPress={() => d.go('d36', c.no)} /><Btn kind="blue" icon="eye" label="Track it" onPress={() => d.go('d35')} /></BtnRow>
  </Screen>;
}

/* d35 · dispatches & outcomes */
export function D35() {
  const { state, dealerId } = useStore(); const d = useD();
  const list = state.challans.filter(c => c.dealerId === dealerId);
  return <Screen tab="truck" top={<AppBar title="Dispatches" back="d33" />}>
    <Banner tone="info" icon="eye" style={{ marginBottom: 13 }}>The company checks each battery it receives, then decides that claim. You see the outcome here — battery by battery.</Banner>
    {!list.length && <Card><X s={13.5} c={T.slate}>No dispatches yet. When the van collects old batteries, the challan appears here.</X></Card>}
    {list.map((c, ci) => {
      const st = challanStatus(c, state);
      const outcomes = c.rows.map(r => { const e = state.entries.find(x => x.id === r.ref); const audit = e && decisionOf(state, e.id);
        return { r, e, tone: e?.status === 'Approved' ? 'live' : e?.status === 'Rejected' ? 'bad' : 'warn', icon: e?.status === 'Approved' ? 'check' : e?.status === 'Rejected' ? 'x' : 'clock',
          label: e?.status === 'Approved' ? `Approved · ${rupees(CREDIT_VALUE[r.model] || 0)}` : e?.status === 'Rejected' ? `Refused${audit?.reason ? ` · ${audit.reason}` : ''}` : st.status === 'In transit' ? 'On the way' : 'Being checked' } as const; });
      const refused = outcomes.filter(o => o.e?.status === 'Rejected');
      return <Card key={c.no} style={ci ? { marginTop: 11 } : undefined} onPress={() => d.go('d36', c.no)} label={`Open challan ${c.no}`}>
        <CardH mono title={c.no} right={<StatusChip status={st.status} label={st.label} />} />
        <X s={12.5} c={T.slate} style={{ marginBottom: 4 }}>Sent {dShort(c.at)} · {c.rows.length} {c.rows.length === 1 ? 'battery' : 'batteries'} · {st.sub}</X>
        {outcomes.map((o, i) => <Line key={o.r.serial} last={i === outcomes.length - 1} title={o.r.serial} titleMono right={<Chip tone={o.tone} icon={o.icon} label={o.label} />} />)}
        {refused.length > 0 && <Banner tone="bad" icon="alert" style={{ marginTop: 11 }}><B>{refused.length === 1 ? 'One refused.' : `${refused.length} refused.`}</B> {refused.map(o => o.r.serial).join(', ')} — head office has raised it with you separately.</Banner>}
      </Card>;
    })}
  </Screen>;
}

/* d36 · challan document */
function ChallanDoc({ c }: { c: Challan }) {
  const { state } = useStore(); const dealer = state.dealers.find(x => x.id === c.dealerId)!;
  const cell = { borderWidth: 1, borderColor: T.zinc3, paddingVertical: 5, paddingHorizontal: 6, marginRight: -1, marginBottom: -1 } as const;
  const cols = [0.35, 1.45, 0.9, 1.6, 1.4];
  const Meta = ({ k, children }: { k: string; children: React.ReactNode }) => <View style={{ width: '50%', paddingRight: 12, marginBottom: 4 }}><X s={11.5} c={T.slate}>{k}</X><X s={11.5} c="#1B2430">{children}</X></View>;
  return <View style={{ backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2, borderRadius: 8, paddingVertical: 18, paddingHorizontal: 16 }}>
    <View style={{ alignItems: 'center', borderBottomWidth: 2, borderBottomColor: T.ink, paddingBottom: 11, marginBottom: 11 }}>
      <X s={19} w={7} f="c">FELIX BATTERIES INDUSTRIES</X><X s={10.5} c={T.slate} style={{ marginTop: 2, textAlign: 'center' }}>Battery Distribution & Warranty Operations · Nashik, Maharashtra</X></View>
    <X s={14} w={7} f="c" style={{ letterSpacing: 1.4, textAlign: 'center', marginTop: 10, marginBottom: 12 }}>MATERIAL RETURN CHALLAN</X>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
      <Meta k="Challan No."><X s={11.5} w={6} f="m">{c.no}</X></Meta>
      <Meta k="Date"><B>{dLong(c.at)}</B></Meta>
      <Meta k="From · Dealer"><B>{dealer.name}</B>{'\n'}{dealer.place ? `${dealer.place}, ` : ''}{dealer.city} · {dealer.id}</Meta>
      <Meta k="To"><B>Felix Batteries Industries</B>{'\n'}Warehouse, Nashik</Meta>
      <Meta k="Vehicle"><B>{c.vehicle || '—'}</B></Meta>
      <Meta k="Collected by"><B>{c.driver || '—'}</B></Meta>
    </View>
    <View style={{ marginBottom: 11, paddingRight: 1, paddingBottom: 1 }}>
      <View style={{ flexDirection: 'row' }}>{['#', 'SERIAL NO.', 'MODEL', 'REQUEST REF.', 'REPORTED FAULT'].map((h, i) => <View key={h} style={[cell, { flex: cols[i], backgroundColor: T.zinc }]}><X s={9.5} w={7} lh={1.3} c="#1B2430">{h}</X></View>)}</View>
      {c.rows.map((r, ri) => <View key={r.serial} style={{ flexDirection: 'row' }}>{[String(ri + 1), r.serial, r.model, r.ref, r.fault].map((v, i) => <View key={i} style={[cell, { flex: cols[i] }]}><X s={i === 1 || i === 3 ? 10 : 11} f={i === 1 || i === 3 ? 'm' : 'b'} w={i === 1 || i === 3 ? 6 : 4} lh={1.3} c="#1B2430">{v}</X></View>)}</View>)}
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1.5, borderTopColor: T.ink, paddingTop: 7, marginBottom: 12 }}><X s={12.5} w={7}>Total batteries returned</X><X s={12.5} w={7}>{c.rows.length}</X></View>
    <View style={{ borderLeftWidth: 2, borderLeftColor: T.volt, paddingLeft: 9, marginBottom: 16 }}><X s={10.5} c={T.slate}>Returned for warranty inspection only. No sale value. Each battery remains the property of Felix Batteries Industries. Claims are decided after inspection at the company.</X></View>
    <View style={{ flexDirection: 'row', gap: 10 }}>{['Dealer signature', 'Driver signature', 'Received at company'].map(s => <View key={s} style={{ flex: 1, borderTopWidth: 1, borderTopColor: T.ink3, paddingTop: 5 }}><X s={10} c={T.slate} style={{ textAlign: 'center' }}>{s}</X></View>)}</View>
  </View>;
}
export function D36({ p }: { p?: string }) {
  const d = useD(); const { state } = useStore();
  const c = state.challans.find(x => x.no === p);
  if (!c) return <Screen tab="truck" top={<AppBar title="Challan" back="d35" />}><X c={T.slate}>This challan could not be found.</X></Screen>;
  const dealer = state.dealers.find(x => x.id === c.dealerId)!;
  const download = async () => {
    try {
      if (Platform.OS === 'web') {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([challanHtml(c, dealer)], { type: 'text/html' })); a.download = `Challan-${c.no}.html`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 6000);
        d.toast('Challan downloaded. Open it and print or save as PDF.');
      } else { const { uri } = await Print.printToFileAsync({ html: challanHtml(c, dealer) }); await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Challan ${c.no}` }); }
    } catch { d.toast('The challan could not be saved on this device.'); }
  };
  const share = async () => {
    const text = `Felix Batteries · Material Return Challan ${c.no}\n${dealer.name}, ${dealer.city}\n${dLong(c.at)} · ${c.rows.length} batteries\n${c.rows.map(r => `${r.serial} (${r.model}) · ${r.ref}`).join('\n')}`;
    try {
      if (Platform.OS === 'web') {
        const nav = navigator as any;
        if (nav.share) await nav.share({ title: `Challan ${c.no}`, text });
        else { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank'); }
      } else { const { uri } = await Print.printToFileAsync({ html: challanHtml(c, dealer) }); await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Share challan ${c.no}` }); }
    } catch { /* the viewer closed the share sheet */ }
  };
  return <Screen tab="truck" top={<AppBar title="Challan" back="d34" backP={c.no} right={<Chip tone="mute" mono label={c.no} />} />}>
    <Banner tone="ok" icon="doc" style={{ marginBottom: 13 }}><B>Made for you when you tapped dispatch.</B> Nothing to write out. Keep a copy, give one to the driver.</Banner>
    <ChallanDoc c={c} />
    <BtnRow style={{ marginTop: 13 }}><Btn kind="primary" icon="down" label="Download" onPress={download} /><Btn kind="ghost" icon="phone" label="Share" onPress={share} /></BtnRow>
    <Hint icon="shield" style={{ marginTop: 11 }}>The same challan is on the company’s screen already. If the driver loses the paper, nothing is lost.</Hint>
  </Screen>;
}

/* d37 · credit notes */
export function D37() {
  const d = useD(); const { state, dealerId } = useStore();
  const cn = creditNotes(state, dealerId), dealer = state.dealers.find(x => x.id === dealerId)!;
  const statement = () => printHtml(`<h1>Felix Batteries · Credit statement</h1><p><b>${escapeHtml(dealer.name)}</b> · ${escapeHtml(dealer.city)} · ${escapeHtml(dealer.id)}<br/>Generated ${escapeHtml(dLong(new Date().toISOString()))}</p>
    <table><thead><tr><th>Credit note</th><th>Request</th><th>Batteries</th><th>Date</th><th>Amount</th></tr></thead><tbody>${cn.credited.map(c => `<tr><td>${escapeHtml(c.no)}</td><td>${escapeHtml(c.entry.id)}</td><td>${escapeHtml(c.entry.items.map(i => `${i.oldSerial} · ${i.model}`).join(', '))}</td><td>${escapeHtml(dLong(c.date))}</td><td>${escapeHtml(rupees(c.amount))}</td></tr>`).join('')}</tbody></table>
    <p>Total credited: <b>${escapeHtml(rupees(cn.credited.reduce((t, c) => t + c.amount, 0)))}</b> · Still being checked: ${cn.checking.length} · Refused: ${cn.refused.length}</p>`).then(() => d.toast('Statement ready.')).catch(() => d.toast('The statement could not be printed on this device.'));
  return <Screen tab="truck" top={<AppBar title="Credit notes" back="d32" right={<Chip tone="live" label={rupees(cn.monthTotal)} />} />}>
    <Banner tone="ok" icon="check" style={{ marginBottom: 13 }}><B>Every approved claim is credited to your account.</B> The credit is set against your next invoice from Felix Batteries.</Banner>
    <Kpis items={[{ v: rupees(cn.monthTotal), l: 'Credited this month' }, { v: String(cn.credited.length), l: 'Claims approved' }, { v: String(cn.checking.length), l: 'Still being checked', tone: 'flag' }, { v: String(cn.refused.length), l: 'Refused', tone: 'bad' }]} />
    <SecT title="Credited" />
    <Card>{cn.credited.length ? cn.credited.map((c, i) => <Line key={c.no} last={i === cn.credited.length - 1} onPress={() => d.go('d32', c.entry.id)} av={<Avatar n="check" tone="green" />} title={c.no} titleMono
      sub={`${c.entry.items.map(it => it.oldSerial || it.code).join(', ')} · ${c.entry.items[0]?.model} · ${dShort(c.date)}`}
      right={<X s={19} w={7} f="c" c="#12603C">{rupees(c.amount)}</X>} />) : <X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>No credits yet. Approved claims appear here.</X>}</Card>
    {cn.refused.length > 0 && <><SecT title="Refused" />
      <Card>{cn.refused.map((e, i) => <Line key={e.id} last={i === cn.refused.length - 1} onPress={() => d.go('d32', e.id)} av={<Avatar n="x" tone="red" />} title={oldList(e) || e.id} titleMono
        sub={`${e.items[0]?.model} · ${dShort(e.date)} · ${decisionOf(state, e.id)?.reason || 'outside cover'}`} right={<StatusChip status="Rejected" label="No credit" />} />)}
        <Hint style={{ marginTop: 10 }}>The customer kept the battery. Head office has raised this one with you separately.</Hint></Card></>}
    <Btn kind="ghost" icon="down" label="Download statement" style={{ marginTop: 13 }} onPress={statement} />
  </Screen>;
}
