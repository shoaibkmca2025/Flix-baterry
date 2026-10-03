import React, { useState } from 'react';
import { View, Pressable, Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useStore } from '@felix/shared/store';
import { Challan, Entry, tagOf } from '@felix/shared/domain';
import { printHtml, escapeHtml, saveHtmlDocument } from '@felix/shared/reports';
import { T } from '@felix/shared/ui/theme';
import { X, B, Ic, Btn, BtnRow, Card, CardH, Chip, StatusChip, Field, Hint, Banner, KV, SecT, Line, Avatar, BigOk, CheckBox, Kpis, Plate, PlateLab, PlateVal, AvTone, Tone, IconName, tap, TagChip, AdminChip } from '@felix/shared/ui/kit';
import { Screen, AppBar, useD, useAbove } from './shell';
import { useMyDealerNames } from './Network';
import { getAccessToken } from '@felix/shared/api/session';
import { createChallan } from '@felix/shared/api/returns';
import { toChallan } from '@felix/shared/api/mapping';
import { errorMessage } from '@felix/shared/api/client';
import { useSync } from '@felix/shared/api/sync';
import { ageDays, approvedForRefund, challanHtml, challanStatus, coverOf, dLong, dShort, decisionOf, findBattery, nextChallanNo, personOf, refunds, spanShort, tShort, toSendBack, travellingSerial, tagSummary } from '@felix/shared/data';

const oldList = (e: Entry) => e.items.map(i => i.oldSerial).filter(Boolean).join(', ');

/* d32 · the decision on a request — from the distributor, or head office, by who is reading */
export function D32({ p }: { p?: string }) {
  const d = useD(); const { state } = useStore();
  const { above, Above } = useAbove();
  const e = state.entries.find(x => x.id === p);
  if (!e) return <Screen tab="list" top={<AppBar title={`${Above} decision`} back="d18" />}><X c={T.slate}>This request could not be found.</X></Screen>;
  const decided = decisionOf(state, e.id), rep = e.type === 'Replacement';
  const cover = rep ? coverOf(findBattery(state, e.items[0]?.oldSerial || ''), state) : null;
  const approved = e.status === 'Approved', refused = e.status === 'Rejected';
  const back = e.returnState && e.returnState !== 'At dealer';
  const meaning: [string, IconName, AvTone][] = refused
    ? [['The customer keeps the battery you already gave', 'user', 'green'], ['This battery is not approved for refund', 'x', 'red'], [`${Above} settles it with you separately`, 'phone', 'amber']]
    : [['The customer keeps the battery you already gave', 'user', 'green'], [`Cover still ends ${cover ? dLong(cover.expiry) : 'on the original date'} — unchanged`, 'shield', 'green'], back ? [`The old battery is ${e.returnState?.toLowerCase()} at the company`, 'truck', 'green'] : [approved ? 'The old battery is now due back to the company' : 'The old battery goes back at the next pickup', 'truck', 'amber']];
  return <Screen tab="list" top={<AppBar title={`${Above} decision`} back="d18" right={approved ? <Chip tone="live" icon="check" label="Approved" /> : refused ? <Chip tone="bad" icon="x" label="Refused" /> : <Chip tone="warn" icon="clock" label="Waiting" />} />}>
    {approved && <Banner tone="ok" icon="check" style={{ marginBottom: 13 }}><B>Approved on {dShort(decided?.at || e.date)} by {personOf(decided?.actor)}.</B> {decided?.reason || `${Above} checked the claim and accepted it.`}</Banner>}
    {refused && <Banner tone="bad" icon="x" style={{ marginBottom: 13 }}><B>Refused on {dShort(decided?.at || e.date)} by {personOf(decided?.actor)}.</B> {decided?.reason || 'The claim is outside the warranty.'}</Banner>}
    {!approved && !refused && <Banner tone="warn" icon="clock" style={{ marginBottom: 13 }}><B>Waiting for {above}.</B> {e.status === 'Pending sync' ? 'This request is still saved on your phone and has not been sent yet.' : e.status === 'Conflict' ? `${Above} has a question about a serial on this request — open it to see what to fix.` : 'The battery is already with the customer. The claim is decided once the old battery is back and checked.'}</Banner>}
    <Card><CardH mono title={e.id} right={<StatusChip status={e.status} />} />
      <KV pairs={rep ? [['Old battery', oldList(e) || '—', 'mono'], ['New battery', e.items.map(i => i.code).join(', '), 'mono'], ['Finding', decided?.reason ? (approved ? 'Claim accepted' : 'Claim refused') : 'Not checked yet'], ['Checked by', decided ? personOf(decided.actor) : '—'], ['Cover ends', cover ? dLong(cover.expiry) : 'Set by head office'], ['Remaining', cover ? spanShort(cover.leftSpan) : '—']]
        : [['Battery', e.items.map(i => i.code).join(', '), 'mono'], ['Type', e.type], ['Checked by', decided ? personOf(decided.actor) : '—'], ['Date', dLong(e.date)]]} /></Card>
    {/* approved for refund — and nothing more: no amount, no note (client, 28 Sep 2026 — D-20) */}
    {approvedForRefund(e) && <Card style={{ borderColor: '#B8DFCB', backgroundColor: '#F7FCF9', marginTop: 11 }}><CardH title="Approved for refund" right={<StatusChip status="Approved" label="Approved for refund" />} />
      <KV pairs={[['Approved on', dLong(decided?.at || e.decidedAt || e.date)], ['Request', e.id, 'mono']]} />
      <Btn kind="ghost" sm icon="doc" label="See all approved refunds" style={{ alignSelf: 'stretch', marginTop: 11 }} onPress={() => d.go('d37')} /></Card>}
    <SecT title="What this means" />
    <Card>{meaning.map((r, i) => <Line key={r[0]} last={i === meaning.length - 1} av={<Avatar n={r[1]} tone={r[2]} />} title={r[0]} titleSize={14} />)}</Card>
    {rep && !back && !refused && <Btn kind="primary" icon="truck" label="Old batteries to send back" style={{ marginTop: 13 }} onPress={() => d.tab('d33')} />}
    <Hint style={{ marginTop: 10 }}>If a claim is ever refused, you are told why here — the battery stays with the customer and {above} settles it with you.</Hint>
  </Screen>;
}

/* d33 · old batteries to send back */
export function D33() {
  const d = useD(); const { state, setState, dealerId, audit } = useStore(); const { sync } = useSync();
  const shop = state.dealers.find(x => x.id === dealerId);
  // a dealer hands old batteries to its distributor by hand; only the distributor dispatches (client, 2 Oct 2026)
  if (shop?.kind === 'Dealer') return <Screen top={<AppBar title="Old batteries" back="d07" />}>
    <Banner tone="info" icon="truck"><B>Hand your old batteries to your distributor.</B> {shop.distributor ? `${shop.distributor.name} (+91 ${shop.distributor.mobile})` : 'Your distributor'} collects them and sends them to head office on a challan — you do not dispatch them yourself.</Banner>
  </Screen>;
  return <D33Dispatch />;
}

function D33Dispatch() {
  const d = useD(); const { state, setState, dealerId, audit } = useStore(); const { sync } = useSync();
  // his own old batteries and those his dealers handed him, once he approved their requests
  const rows = toSendBack(state, dealerId, true);
  const names = useMyDealerNames(); // a dealer's customer is not sent to the distributor — show which dealer it came from
  // special requests he holds the old battery of, but may not send until head office approves (client, 3 Oct 2026)
  const held = state.entries.filter(e => e.type === 'Replacement' && e.special === 'Pending' && !['With distributor', 'Rejected', 'Draft'].includes(e.status)
    && (!e.returnState || e.returnState === 'At dealer') && (e.dealerId === dealerId || e.items.some(i => i.oldSerial && i.arrivedAtDistributor)));
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
    // A challan has to reach head office to mean anything — never make one that lives only on this phone.
    if (token) {
      const entryIds = picked.map(e => e.apiId).filter((x): x is string => !!x);
      const unsent = picked.filter(e => !e.apiId).map(e => e.id);
      if (unsent.length) { d.toast(`${unsent.join(', ')} ${unsent.length === 1 ? 'is' : 'are'} still saved on this phone. Tap Sync now on Home to send ${unsent.length === 1 ? 'it' : 'them'} first, or untick ${unsent.length === 1 ? 'it' : 'them'}.`); return; }
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
      rows: picked.flatMap(e => e.items.filter(i => travellingSerial(e, i)).map(i => ({ serial: travellingSerial(e, i), model: findBattery(state, travellingSerial(e, i))?.model || i.model, ref: e.id, kind: tagOf(e), byAdmin: e.byAdmin, fault: i.fault || i.remarks || '—' }))) };
    record(c, ' (preview)');
  };
  return <Screen tab="truck" top={<AppBar title="Old batteries to send back" back="d07" right={<Chip tone="warn" label={`${rows.length} waiting`} />} />}
    footer={rows.length ? <Btn kind="primary" big icon="truck" label={busy ? 'Sending…' : `Dispatch ${count} ${count === 1 ? 'battery' : 'batteries'} to company`} disabled={!count || busy} onPress={dispatch} /> : undefined}>
    <Banner tone="info" icon="truck" style={{ marginBottom: 13 }}>When the company van comes, tick the batteries you are handing over and tap the button. The challan is made for you — no paper list to write.</Banner>
    {held.length > 0 && <Banner tone="warn" icon="alert" style={{ marginBottom: 13 }}><B>{held.length} special {held.length === 1 ? 'request' : 'requests'} waiting for head office.</B> {held.map(e => e.id).join(', ')} — cannot be sent yet.</Banner>}
    {/* One challan, two sections (client, 3 Oct 2026). The van takes both, but a man counting
        batteries into it counts replacements and sales returns separately, so they are never
        shown as one run of ticks. An empty section is not drawn at all. */}
    {(['RP', 'SR'] as const).map(tag => {
      const mine = rows.filter(e => tagOf(e) === tag);
      if (!mine.length) return null;
      return <Card key={tag} style={tag === 'SR' ? { marginTop: 12 } : undefined}>
        <CardH title={tag === 'RP' ? 'Replacements — old batteries' : 'Sales returns'}
          right={<View style={{ flexDirection: 'row', gap: 7 }}><TagChip tag={tag} /><Chip tone="mute" label={`${mine.length}`} /></View>} />
      {mine.map((e, i) => {
        const on = !off.includes(e.id), age = ageDays(e.date), it = e.items[0];
        return <Pressable key={e.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setOff(o => on ? [...o, e.id] : o.filter(x => x !== e.id))}
          style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 13, borderBottomWidth: i < mine.length - 1 ? 1 : 0, borderBottomColor: T.zinc2 }}>
          <CheckBox on={on} />
          <View style={{ flex: 1, minWidth: 0 }}><X s={14.5} w={6} f="m">{oldList(e)}</X><X s={12.5} c={T.slate} style={{ marginTop: 2 }}>{findBattery(state, it.oldSerial)?.model || it.model} · {e.id}</X><X s={12.5} c={T.slate} style={{ marginTop: 2 }}>{e.dealerId === dealerId ? (e.customer || 'Customer not named') : `From ${names[e.dealerId] || 'your dealer'}`}</X></View>
          {e.byAdmin && <AdminChip />}
          <Chip tone={age > 30 ? 'bad' : 'warn'} icon="clock" label={age === 0 ? 'Today' : `${age} ${age === 1 ? 'day' : 'days'}`} />
        </Pressable>;
      })}
    </Card>;
    })}
    {!rows.length && <Card><X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>Nothing to send back. Old batteries from replacements, and sales returns, appear here.</X></Card>}
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
/** What a van is carrying: the two sections, and what head office put on it. */
function challanMix(c: Challan) {
  const n = (f: (r: Challan['rows'][number]) => boolean) => c.rows.filter(f).length;
  const rp = n(r => (r.kind ?? 'RP') === 'RP'), sr = n(r => r.kind === 'SR'), admin = n(r => !!r.byAdmin);
  return <>
    {rp > 0 && <Chip tone="live" label={`RP ${rp}`} />}
    {sr > 0 && <Chip tone="vio" label={`SR ${sr}`} />}
    {admin > 0 && <AdminChip n={admin} />}
  </>;
}

export function D34({ p }: { p?: string }) {
  const d = useD(); const { state } = useStore();
  const c = state.challans.find(x => x.no === p);
  if (!c) return <Screen tab="truck" top={<AppBar title="Dispatch" back="d33" />}><X c={T.slate}>This challan could not be found.</X></Screen>;
  const eta = new Date(Date.parse(c.at) + 2 * 86400000).toISOString();
  return <Screen tab="truck" top={<View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingHorizontal: 15, paddingBottom: 13, backgroundColor: T.zinc, borderBottomWidth: 1, borderBottomColor: T.zinc2 }}>
    <View style={{ flex: 1 }} /><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => d.back('d33')} style={[tap, { width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2 }]}><Ic n="x" /></Pressable></View>}>
    <BigOk n="truck" />
    <X s={22} w={7} f="c" style={{ textAlign: 'center', marginBottom: 5 }}>{c.rows.length} {c.rows.length === 1 ? 'battery' : 'batteries'} dispatched</X>
    <X s={15} c={T.slate} style={{ textAlign: 'center', marginBottom: 16 }}>They are off your list and on the company’s. Show this screen to the driver if he asks.</X>
    <Plate><PlateLab center>CHALLAN NUMBER</PlateLab><PlateVal size={22} center>{c.no}</PlateVal></Plate>
    <Card style={{ marginTop: 12 }}><KV pairs={[['Batteries', String(c.rows.length)], ['Handed to', c.vehicle ? `Company van · ${c.vehicle}` : 'Company van'], ['Date', `${dLong(c.at)}, ${tShort(c.at)}`], ['Expected at company', dLong(eta)]]} /></Card>
    <SecT title="On this challan" />
    {/* what the van is carrying, in one line: the two sections, and how much of it head office
        recorded rather than a shop (client, 3 Oct 2026) */}
    <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginBottom: 9 }}>{challanMix(c)}</View>
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
          label: e && approvedForRefund(e) ? 'Approved for refund' : e?.status === 'Approved' ? 'Being checked' : e?.status === 'Rejected' ? `Refused${audit?.reason ? ` · ${audit.reason}` : ''}` : st.status === 'In transit' ? 'On the way' : 'Being checked' } as const; });
      const refused = outcomes.filter(o => o.e?.status === 'Rejected');
      return <Card key={c.no} style={ci ? { marginTop: 11 } : undefined} onPress={() => d.go('d36', c.no)} label={`Open challan ${c.no}`}>
        <CardH mono title={c.no} right={<StatusChip status={st.status} label={st.label} />} />
        <X s={12.5} c={T.slate} style={{ marginBottom: 4 }}>Sent {dShort(c.at)} · {c.rows.length} {c.rows.length === 1 ? 'battery' : 'batteries'} · {st.sub}</X>
        <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginBottom: 7 }}>{challanMix(c)}</View>
        {outcomes.map((o, i) => <Line key={o.r.serial} last={i === outcomes.length - 1} title={o.r.serial} titleMono right={<Chip tone={o.tone} icon={o.icon} label={o.label} />} />)}
        {refused.length > 0 && <Banner tone="bad" icon="alert" style={{ marginTop: 11 }}><B>{refused.length === 1 ? 'One refused.' : `${refused.length} refused.`}</B> {refused.map(o => o.r.serial).join(', ')} — head office has raised it with you separately.</Banner>}
      </Card>;
    })}
  </Screen>;
}

/* d36 · challan document */
/**
 * How this challan came back: which batteries head office approved and which it refused. The
 * dealer sends 10 and wants the answer as a batch, not ten separate requests to go hunting
 * through (client, 2 Oct 2026). Nothing shows until head office has decided something.
 */
function ChallanOutcome({ c }: { c: Challan }) {
  const group = (...want: string[]) => c.rows.filter(r => want.includes(r.outcome ?? 'travelling'));
  // 'passed' has been checked and is good but not yet approved for refund — to the dealer that is
  // not yet a yes, so it sits with the batteries still being looked at rather than under Approved.
  const approved = group('claimed'), rejected = group('rejected'), waiting = group('travelling', 'arrived', 'passed');
  if (!approved.length && !rejected.length) return null; // nothing decided yet — the challan copy below says it is on its way
  const Group = ({ title, rows, tone, icon, chip, av }: { title: string; rows: Challan['rows']; tone: Tone; icon: IconName; chip: string; av: AvTone }) =>
    !rows.length ? null : <Card style={{ marginBottom: 11 }}>
      <CardH title={`${title} · ${rows.length}`} right={<Chip tone={tone} icon={icon} label={chip} />} />
      {rows.map((r, i) => <Line key={r.lineId || r.serial} last={i === rows.length - 1} titleMono title={r.serial}
        sub={`${r.model}${r.outcomeReason ? ` · ${r.outcomeReason}` : ''}`} av={<Avatar n={icon} tone={av} />} />)}
    </Card>;
  return <View style={{ marginBottom: 13 }}>
    <Group title="Approved" rows={approved} tone="live" icon="check" chip="Approved" av="green" />
    <Group title="Not approved" rows={rejected} tone="bad" icon="x" chip="Refused" av="red" />
    <Group title="Still being checked" rows={waiting} tone="mute" icon="clock" chip="With the company" av="mute" />
  </View>;
}

function ChallanDoc({ c }: { c: Challan }) {
  const { state } = useStore(); const dealer = state.dealers.find(x => x.id === c.dealerId)!;
  const cell = { borderWidth: 1, borderColor: T.zinc3, paddingVertical: 5, paddingHorizontal: 6, marginRight: -1, marginBottom: -1 } as const;
  // The paper challan the driver carries: Request Ref. dropped and four columns left blank for
  // the factory to write in by hand as each battery is opened (client, 3 Oct 2026).
  const cols = [0.3, 1.35, 0.8, 1.15, 0.75, 0.75, 0.75, 1.1];
  const Meta = ({ k, children }: { k: string; children: React.ReactNode }) => <View style={{ width: '50%', paddingRight: 12, marginBottom: 4 }}><X s={11.5} c={T.slate}>{k}</X><X s={11.5} c="#1B2430">{children}</X></View>;
  return <View style={{ backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2, borderRadius: 8, paddingVertical: 18, paddingHorizontal: 16 }}>
    <View style={{ alignItems: 'center', borderBottomWidth: 2, borderBottomColor: T.ink, paddingBottom: 11, marginBottom: 11 }}>
      <X s={19} w={7} f="c">FELIX BATTERIES INDUSTRIES</X><X s={11} c={T.slate} style={{ marginTop: 2, textAlign: 'center' }}>Battery Distribution & Warranty Operations · Nashik, Maharashtra</X></View>
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
      <View style={{ flexDirection: 'row' }}>{['#', 'SERIAL NO.', 'MODEL', 'REPORTED FAULT', 'PLANT', 'VOLTAGE', 'GRAVITY', 'REMARK'].map((h, i) => <View key={h} style={[cell, { flex: cols[i], backgroundColor: T.zinc }]}><X s={11} w={7} lh={1.3} c="#1B2430">{h}</X></View>)}</View>
      {c.rows.map((r, ri) => <View key={r.serial} style={{ flexDirection: 'row' }}>{[String(ri + 1), r.serial, r.model, r.fault, '', '', '', ''].map((v, i) => <View key={i} style={[cell, { flex: cols[i], minHeight: 26 }]}><X s={i === 1 ? 10 : 11} f={i === 1 ? 'm' : 'b'} w={i === 1 ? 6 : 4} lh={1.3} c="#1B2430">{v}</X></View>)}</View>)}
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1.5, borderTopColor: T.ink, paddingTop: 7, marginBottom: 12 }}><X s={12.5} w={7}>Total batteries returned</X><X s={12.5} w={7}>{c.rows.length}</X></View>
    <View style={{ borderLeftWidth: 2, borderLeftColor: T.volt, paddingLeft: 9, marginBottom: 16 }}><X s={11} c={T.slate}>Returned for warranty inspection only. No sale value. Each battery remains the property of Felix Batteries Industries. Claims are decided after inspection at the company.</X></View>
    <View style={{ flexDirection: 'row', gap: 10 }}>{['Distributor signature', 'Driver signature', 'Received at company'].map(s => <View key={s} style={{ flex: 1, borderTopWidth: 1, borderTopColor: T.ink3, paddingTop: 5 }}><X s={11} c={T.slate} style={{ textAlign: 'center' }}>{s}</X></View>)}</View>
  </View>;
}
export function D36({ p }: { p?: string }) {
  const d = useD(); const { state } = useStore();
  const c = state.challans.find(x => x.no === p);
  if (!c) return <Screen tab="truck" top={<AppBar title="Challan" back="d35" />}><X c={T.slate}>This challan could not be found.</X></Screen>;
  const dealer = state.dealers.find(x => x.id === c.dealerId)!;
  const download = async () => {
    try {
      await saveHtmlDocument(challanHtml(c, dealer), `Challan-${c.no}`, `Challan ${c.no}`);
      if (Platform.OS === 'web') d.toast('Challan downloaded. Open it and print or save as PDF.');
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
    <ChallanOutcome c={c} />
    <ChallanDoc c={c} />
    <BtnRow style={{ marginTop: 13 }}><Btn kind="primary" icon="down" label="Download" onPress={download} /><Btn kind="ghost" icon="phone" label="Share" onPress={share} /></BtnRow>
    <Hint icon="shield" style={{ marginTop: 11 }}>The same challan is on the company’s screen already. If the driver loses the paper, nothing is lost.</Hint>
  </Screen>;
}

/* d37 · refunds — which batteries are approved for refund (no amounts, D-20) */
export function D37() {
  const d = useD(); const { state, dealerId } = useStore();
  const { Above } = useAbove();
  const dealer = state.dealers.find(x => x.id === dealerId)!, r = refunds(state, dealerId, dealer.kind !== 'Dealer');
  const statement = () => printHtml(`<h1>Felix Batteries · Approved for refund</h1><p><b>${escapeHtml(dealer.name)}</b> · ${escapeHtml(dealer.city)} · ${escapeHtml(dealer.id)}<br/>Generated ${escapeHtml(dLong(new Date().toISOString()))}</p>
    <table><thead><tr><th>Request</th><th>Batteries</th><th>Approved on</th></tr></thead><tbody>${r.approved.map(x => `<tr><td>${escapeHtml(x.entry.id)}</td><td>${escapeHtml(x.entry.items.map(i => `${i.oldSerial} · ${i.model}`).join(', '))}</td><td>${escapeHtml(dLong(x.date))}</td></tr>`).join('')}</tbody></table>
    <p>Approved for refund: <b>${r.approved.length}</b> · Still being checked: ${r.checking.length} · Refused: ${r.refused.length}</p>`).then(() => d.toast('Statement ready.')).catch(() => d.toast('The statement could not be printed on this device.'));
  return <Screen tab="truck" top={<AppBar title="Refunds" back="d32" right={<Chip tone="live" label={`${r.monthCount} this month`} />} />}>
    {/* Quantities, never an amount (client, 28 Sep 2026 D-20, restated 3 Oct 2026). */}
    <Banner tone="ok" icon="check" style={{ marginBottom: 13 }}><B>These batteries are approved for refund.</B> Each one is approved after it is checked at the factory. Replacements and sales returns are counted apart.</Banner>
    <Kpis items={[{ v: String(r.monthCount), l: 'Approved this month' }, { v: String(r.approved.length), l: 'Approved for refund', sub: tagSummary(r.byTag.approved) }, { v: String(r.checking.length), l: 'Still being checked', tone: 'flag' }, { v: String(r.refused.length), l: 'Refused', tone: 'bad' }]} />
    <SecT title="Approved for refund" />
    <Card>{r.approved.length ? r.approved.map((x, i) => <Line key={x.entry.id} last={i === r.approved.length - 1} onPress={() => d.go('d32', x.entry.id)} av={<Avatar n="check" tone="green" />} title={oldList(x.entry) || x.entry.id} titleMono
      sub={`${x.entry.items[0]?.model} · ${x.entry.id} · ${dShort(x.date)}`}
      right={<View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><TagChip tag={tagOf(x.entry)} /><StatusChip status="Approved" label="Approved for refund" /></View>} />) : <X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>Nothing approved yet. Batteries appear here once head office approves them.</X>}</Card>
    {r.refused.length > 0 && <><SecT title="Refused" />
      <Card>{r.refused.map((e, i) => <Line key={e.id} last={i === r.refused.length - 1} onPress={() => d.go('d32', e.id)} av={<Avatar n="x" tone="red" />} title={oldList(e) || e.id} titleMono
        sub={`${e.items[0]?.model} · ${dShort(e.date)} · ${decisionOf(state, e.id)?.reason || 'outside cover'}`} right={<StatusChip status="Rejected" label="Not approved" />} />)}
        <Hint style={{ marginTop: 10 }}>The customer kept the battery. {Above} has raised this one with you separately.</Hint></Card></>}
    <Btn kind="ghost" icon="down" label="Download list" style={{ marginTop: 13 }} onPress={statement} />
  </Screen>;
}
