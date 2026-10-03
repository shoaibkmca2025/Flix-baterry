import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, Image, Linking } from 'react-native';
import { useStore } from '@felix/shared/store';
import type { Entry } from '@felix/shared/domain';
import { useSync } from '@felix/shared/api/sync';
import { distributorDecide, markArrived } from '@felix/shared/api/entries';
import { listPhotos, type EntryPhoto } from '@felix/shared/api/photos';
import { T } from '@felix/shared/ui/theme';
import { X, B, Mono, Btn, Card, Chip, StatusChip, Field, Hint, Banner, Line, Avatar, Gap, KV, SecT, Plate, PlateLab, PlateVal, tap } from '@felix/shared/ui/kit';
import { PickList } from '@felix/shared/ui/pick';
import { dLong, dShort, monthShort, tShort, distributorStage, specialLine, specialOutcome, type DistributorStage } from '@felix/shared/data';
import { getAccessToken, dealerStatusLabel } from '@felix/shared/api/session';
import { createMyDealer, listMyDealers, setMyDealerStatus, type ApiDealer } from '@felix/shared/api/dealers';
import { ApiError, errorMessage } from '@felix/shared/api/client';
import { Screen, AppBar, Sheet, useD } from './shell';
import { useCities } from './Access';

// Head office → distributor → dealer (client, 2 Oct 2026). A distributor adds the dealers
// under him here; each is active at once and signs in with its mobile number and the SMS code.
// A dealer uses this same app with less authority: it records replacements and sales returns
// but hands its old batteries to the distributor instead of dispatching them.

const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);
const grouped = (m: string) => m.length > 5 ? `${m.slice(0, 5)} ${m.slice(5)}` : m;

/* d40 · my dealers */
export function D40() {
  const d = useD();
  const cities = useCities();
  const [rows, setRows] = useState<ApiDealer[] | null>(null);
  const [ask, setAsk] = useState<ApiDealer | null>(null), [why, setWhy] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) { setRows([]); return; }
    try { setRows((await listMyDealers(token)).items); } catch (e) { setRows([]); d.toast(errorMessage(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const cityOf = (id: string) => cities.find(c => c.id === id)?.name || '';
  const suspending = ask?.status === 'active';
  const change = async () => {
    if (!ask) return;
    if (why.trim().length < 5) { d.toast('Give a short reason (at least 5 characters).'); return; }
    const token = await getAccessToken(); if (!token) { d.toast('Your sign-in has ended. Sign in again.'); return; }
    setBusy(true);
    try {
      await setMyDealerStatus(ask.id, suspending ? 'suspended' : 'active', why.trim(), token);
      d.toast(suspending ? `${ask.name} is suspended and signed out.` : `${ask.name} can sign in again.`);
      setAsk(null); setWhy(''); load();
    } catch (e) { d.toast(errorMessage(e)); } finally { setBusy(false); }
  };
  const active = rows?.filter(r => r.status === 'active').length ?? 0;
  return <Screen top={<AppBar title="My dealers" back="d07" />} overlay={<Sheet open={!!ask} title={suspending ? `Suspend ${ask?.name ?? ''}` : `Re-activate ${ask?.name ?? ''}`} onClose={() => setAsk(null)}>
      <X s={14} c={T.slate} style={{ marginBottom: 12 }}>{suspending ? 'They are signed out at once and cannot send requests until you re-activate them. Their past requests stay.' : 'They can sign in and send requests again.'}</X>
      <Field label="Reason" req value={why} onChange={setWhy} ph={suspending ? 'e.g. Shop closed for now' : 'e.g. Shop open again'} multiline />
      <Btn kind={suspending ? 'danger' : 'primary'} label={suspending ? 'Suspend dealer' : 'Re-activate dealer'} onPress={change} disabled={busy} />
    </Sheet>}>
    <Banner tone="info" icon="people" style={{ marginBottom: 13 }}><B>Dealers under you.</B> They record replacements and sales returns in this app and send them to you to approve. They hand their old batteries to you — only you send them to head office.</Banner>
    <Btn kind="primary" big icon="plus" label="Add a dealer" onPress={() => d.go('d41')} />
    <Gap h={13} />
    <Card>{rows === null ? <X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>Loading your dealers…</X>
      : rows.length ? rows.map((r, i) => <Line key={r.id} last={i === rows.length - 1} av={<Avatar n="shop" tone={r.status === 'active' ? 'green' : 'mute'} />}
          title={r.name} sub={`${r.contactPerson} · +91 ${grouped(r.mobile)}${cityOf(r.cityId) ? ` · ${cityOf(r.cityId)}` : ''} · added ${dShort(r.createdAt)}`}
          right={<View style={{ alignItems: 'flex-end', gap: 6 }}><StatusChip status={dealerStatusLabel(r.status)} />
            {(r.status === 'active' || r.status === 'suspended') && <Pressable accessibilityRole="button" accessibilityLabel={`${r.status === 'active' ? 'Suspend' : 'Re-activate'} ${r.name}`} onPress={() => { setWhy(''); setAsk(r); }}>
              <X s={12.5} w={6} c={r.status === 'active' ? T.terminal : T.steel}>{r.status === 'active' ? 'Suspend' : 'Re-activate'}</X></Pressable>}</View>} />)
      : <X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>No dealers yet. Tap “Add a dealer” to add the first one.</X>}</Card>
    {rows && rows.length > 0 && <Hint icon="people" center style={{ marginTop: 12 }}>{active} active of {rows.length}</Hint>}
  </Screen>;
}

/* d41 · add a dealer */
export function D41() {
  const d = useD();
  const cities = useCities();
  const [f, setF] = useState({ name: '', contact: '', mobile: '', email: '', city: '', state: 'Maharashtra', place: '', address: '' });
  const [err, setErr] = useState<Record<string, string>>({}), [cityOpen, setCityOpen] = useState(false), [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => { setF(x => ({ ...x, [k]: v })); setErr(e => ({ ...e, [k]: '' })); };
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Enter the shop name.';
    if (!f.contact.trim()) e.contact = 'Enter the owner or contact person.';
    if (f.mobile.length !== 10) e.mobile = 'Enter the 10-digit mobile number.';
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'This email does not look right.';
    if (!f.city) e.city = 'Choose the city.';
    if (!f.state.trim()) e.state = 'Enter the state.';
    if (!f.address.trim()) e.address = 'Enter the full shop address.';
    setErr(e); if (Object.values(e).some(Boolean)) { d.toast('Some details need a look — they are marked in red.'); return; }
    const token = await getAccessToken(); if (!token) { d.toast('Your sign-in has ended. Sign in again.'); return; }
    setBusy(true);
    try {
      const made = await createMyDealer({ name: f.name.trim(), contactPerson: f.contact.trim(), mobile: f.mobile, email: f.email.trim() || undefined, city: f.city, state: f.state.trim(), place: f.place.trim() || undefined, address: f.address.trim() }, token);
      d.toast(`${made.name} is added. They sign in with +91 ${grouped(f.mobile)} and the SMS code.`);
      d.back('d40');
    } catch (ex) {
      if (ex instanceof ApiError && ex.field) setErr(x => ({ ...x, [ex.field!]: ex.message }));
      d.toast(errorMessage(ex));
    } finally { setBusy(false); }
  };
  return <Screen top={<AppBar title="Add a dealer" back="d40" />} overlay={<Sheet open={cityOpen} title="Choose city" onClose={() => setCityOpen(false)}><PickList options={cities.map(c => ({ v: c.name }))} value={f.city} onPick={v => { set('city')(v); setCityOpen(false); }} /></Sheet>}>
    <Field label="Dealer shop name" req mr="दुकानाचे नाव" value={f.name} onChange={set('name')} ph="Shop name on the board" error={err.name} />
    <Field label="Contact person" req value={f.contact} onChange={set('contact')} ph="Owner or manager" error={err.contact} />
    <Field label="Mobile number" req mono phone value={grouped(f.mobile)} onChange={v => set('mobile')(digits(v, 10))} ph="98765 43210" maxLength={11} error={err.mobile} hint="They sign in with this number and the SMS code." hintIcon="phone" />
    <Field label="Email" value={f.email} onChange={set('email')} ph="name@shop.in (optional)" error={err.email} />
    <Field select label="City" req value={f.city} ph="Choose city" onPress={() => setCityOpen(true)} error={err.city} hint="Chosen from the company city list — not typed." hintIcon="pin" />
    <Field label="State" req value={f.state} onChange={set('state')} error={err.state} />
    <Field label="Place / area" value={f.place} onChange={set('place')} ph="Road or area" />
    <Field label="Full address" req value={f.address} onChange={set('address')} ph="Shop number, building, road" error={err.address} />
    <Hint icon="shield">The dealer can use the app straight away — no approval from head office needed. You can suspend them later from My dealers.</Hint>
    <Btn kind="primary" icon="check" label={busy ? 'Adding…' : 'Add dealer'} style={{ marginTop: 12 }} onPress={submit} disabled={busy} />
  </Screen>;
}

/** A dealer's distributor, as the dealer sees it — who takes their old batteries. */
export function DistributorCard({ name, mobile, contact }: { name: string; mobile: string; contact?: string }) {
  return <Card style={{ flexDirection: 'row', gap: 11, alignItems: 'center' }}>
    <Avatar n="people" tone="vio" />
    <View style={{ flex: 1 }}><X s={12} w={6} c={T.slate}>YOUR DISTRIBUTOR</X><X s={15} w={7}>{name}</X><X s={12.5} c={T.slate}>{contact ? `${contact} · ` : ''}+91 {grouped(mobile)}</X></View>
    <Chip tone="vio" icon="truck" label="Takes your old batteries" />
  </Card>;
}

/* ---------- a distributor reviews his dealers' requests (client, 2 Oct 2026) ---------- */

/** The dealers under this distributor, by id — their names for the request lists. */
export function useMyDealerNames() {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    getAccessToken().then(t => (t ? listMyDealers(t) : null)).then(r => { if (alive && r) setNames(Object.fromEntries(r.items.map(x => [x.id, x.name]))); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return names;
}

const batteriesOf = (e: Entry) => { const it = e.items[0]; return `${it?.model || '—'} · ${it?.serial || it?.code?.slice(-4) || '····'}${e.items.length > 1 ? ` + ${e.items.length - 1} more` : ''}`; };

/* d42 · requests from my dealers */
export function D42() {
  const d = useD(); const { state, dealerId } = useStore(); const { sync } = useSync();
  const names = useMyDealerNames();
  useEffect(() => { sync(true); }, []);
  const theirs = state.entries.filter(e => e.dealerId !== dealerId && e.status !== 'Draft');
  const waiting = theirs.filter(e => e.status === 'With distributor').sort((a, b) => (a.createdAt || a.date).localeCompare(b.createdAt || b.date));
  const decided = theirs.filter(e => e.distributorDecidedAt).sort((a, b) => (b.distributorDecidedAt || '').localeCompare(a.distributorDecidedAt || '')).slice(0, 10);
  const row = (e: Entry, i: number, arr: Entry[]) => <Line key={e.id} last={i === arr.length - 1} onPress={() => d.go('d43', e.id)} label={`Review ${e.id}`}
    av={<Avatar n={e.type === 'Replacement' ? 'swap' : 'truck'} tone={e.status === 'With distributor' ? 'amber' : e.status === 'Rejected' ? 'red' : 'green'} />}
    title={names[e.dealerId] || 'Your dealer'} sub={`${e.type} · ${batteriesOf(e)}`} sub2={<Mono>{e.id} · {dShort(e.date)}</Mono>}
    right={<StatusChip status={e.status} label={e.status === 'Submitted' || e.status === 'Under Review' ? 'Sent to head office' : undefined} />} chev />;
  return <Screen top={<AppBar title="Requests from my dealers" back="d07" />}>
    <Banner tone="info" icon="people" style={{ marginBottom: 13 }}><B>Your dealers’ replacements and sales returns come to you first.</B> Check each one and its photos. Approving sends it to head office — and means you have the old battery from the dealer.</Banner>
    <SecT title={`Waiting for you · ${waiting.length}`} />
    <Card>{waiting.length ? waiting.map(row) : <X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>Nothing waiting. New requests from your dealers appear here.</X>}</Card>
    {decided.length > 0 && <><SecT title="Recently decided by you" /><Card>{decided.map(row)}</Card></>}
  </Screen>;
}

/* d43 · review one dealer request */
export function D43({ p }: { p?: string }) {
  const d = useD(); const { state } = useStore(); const { sync } = useSync();
  const names = useMyDealerNames();
  const e = state.entries.find(x => x.id === p);
  const [photos, setPhotos] = useState<EntryPhoto[] | null>(null);
  const [ask, setAsk] = useState<'approve' | 'refuse' | null>(null), [why, setWhy] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!e?.apiId) { setPhotos([]); return; }
    let alive = true;
    getAccessToken().then(t => (t ? listPhotos(e.apiId!, t) : null)).then(r => { if (alive) setPhotos(r?.items ?? []); }).catch(() => { if (alive) setPhotos([]); });
    return () => { alive = false; };
  }, [e?.apiId]);
  if (!e) return <Screen top={<AppBar title="Request" back="d42" />}><X c={T.slate}>This request is not in your list. Go back and open it again.</X></Screen>;
  const rep = e.type === 'Replacement', waiting = e.status === 'With distributor';
  const decide = async () => {
    if (!ask || !e.apiId) return;
    if (why.trim().length < 5) { d.toast('Give a short reason (at least 5 characters).'); return; }
    const token = await getAccessToken(); if (!token) { d.toast('Your sign-in has ended. Sign in again.'); return; }
    setBusy(true);
    try {
      await distributorDecide(e.apiId, ask, why.trim(), token);
      d.toast(ask === 'approve' ? `${e.id} approved and sent to head office.` : `${e.id} refused. The dealer sees your reason.`);
      setAsk(null); setWhy(''); await sync(true); d.back('d42');
    } catch (ex) { d.toast(errorMessage(ex)); } finally { setBusy(false); }
  };
  const open = (uri: string) => { Linking.openURL(uri).catch(() => d.toast('The photo could not be opened here.')); };
  const reasons = ask === 'approve' ? ['Battery checked, old battery received', 'Photos and serials match'] : ['Physical damage — not covered', 'Serial does not match the battery', 'Old battery not handed over'];
  return <Screen top={<AppBar title={e.id} back="d42" right={<StatusChip status={e.status} />} />}
    footer={waiting && e.apiId ? <View style={{ flexDirection: 'row', gap: 9 }}>
      <Btn kind="ghost" icon="x" label="Refuse" color={T.terminal} borderColor="#F0C7BC" style={{ flex: 1 }} onPress={() => { setWhy(''); setAsk('refuse'); }} />
      <Btn kind="primary" icon="check" label="Approve" style={{ flex: 1.4 }} onPress={() => { setWhy(''); setAsk('approve'); }} /></View> : undefined}
    overlay={<Sheet open={!!ask} title={ask === 'approve' ? 'Approve and send to head office' : 'Refuse this request'} onClose={() => setAsk(null)}>
      <X s={14} c={T.slate} style={{ marginBottom: 12 }}>{ask === 'approve' ? (e.special === 'Pending' ? 'Special request: head office decides next. Keep the old battery until it approves.' : `Head office makes the final decision${rep ? ' once the old battery reaches the factory' : ''}. Approving also records that you have the old battery from the dealer.`) : 'The request ends here. The dealer sees your reason in their app.'}</X>
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginBottom: 10 }}>{reasons.map(t =>
        <Pressable key={t} accessibilityRole="button" onPress={() => setWhy(t)} style={tap}><Chip tone={why === t ? 'info' : 'mute'} label={t} /></Pressable>)}</View>
      <Field label="Reason" req value={why} onChange={setWhy} ph="Why you are deciding this" multiline />
      <Btn kind={ask === 'approve' ? 'primary' : 'danger'} label={busy ? 'Saving…' : ask === 'approve' ? 'Approve and send' : 'Refuse request'} onPress={decide} disabled={busy} />
    </Sheet>}>
    {!waiting && <Banner tone={e.status === 'Rejected' ? 'bad' : 'ok'} icon={e.status === 'Rejected' ? 'x' : 'check'} style={{ marginBottom: 12 }}><B>{e.status === 'Rejected' ? 'Refused.' : 'Sent to head office.'}</B> {e.distributorReason || e.decisionReason || ''}</Banner>}
    {e.special && <Banner tone={e.special === 'Rejected' ? 'bad' : e.special === 'Approved' ? 'ok' : 'warn'} icon={e.special === 'Approved' ? 'check' : 'alert'} style={{ marginBottom: 12 }}>
      <B>Special request{e.special === 'Approved' ? ' — approved by head office' : e.special === 'Rejected' ? ' — rejected' : ''}.</B> {e.special === 'Rejected' ? 'No credit. New battery has no warranty. Do not send the old battery.'
        : e.special === 'Approved' ? 'You can send the old battery now.'
        : waiting ? 'Old battery is past its warranty. After you, head office decides.'
        : 'Waiting for head office. Do not send the old battery yet.'}</Banner>}
    <Card><KV pairs={[['Dealer', names[e.dealerId] || 'Your dealer'], ['Type', e.type], ['Date', dLong(e.date)], ['Sent', `${dShort(e.createdAt)}, ${tShort(e.createdAt)}`], ['Batteries', String(e.items.length)]]} /></Card>
    {e.items.map((it, i) => {
      const mine = photos?.filter(ph => (ph.itemSeq ?? 0) === i) ?? [];
      return <Card key={it.id} style={{ marginTop: 11 }}>
        <X s={14.5} w={7} style={{ marginBottom: 9 }}>Battery {i + 1} · {it.model}</X>
        <Plate style={{ marginBottom: 11 }}>{rep ? <>
          <PlateLab>OLD BATTERY OUT</PlateLab><PlateVal>{it.oldSerial || '—'}</PlateVal>
          <X s={19} c={T.volt} style={{ textAlign: 'center', marginVertical: 4 }}>↓</X>
          <PlateLab>NEW BATTERY IN</PlateLab><PlateVal color="#7FD3A9">{it.code || '—'}</PlateVal></> : <><PlateLab>RETURNED BATTERY</PlateLab><PlateVal>{it.code || '—'}</PlateVal></>}</Plate>
        <KV pairs={[['Made', monthShort(it.mfg)], [rep ? 'Problem' : 'Remarks', (rep ? it.fault : it.remarks) || '—'], ['Where it is', `${distributorStage(e, it).label} — ${distributorStage(e, it).hint}`]]} />
        {it.coverCase ? <Banner tone="warn" icon="clock" style={{ marginTop: 9 }}><B>{specialLine(it, e.date)}.</B> {specialOutcome(it)}</Banner> : null}
        {distributorStage(e, it).key === 'awaiting' && e.apiId && <Btn kind="blue" sm icon="box" label="Mark arrived" style={{ marginTop: 9, alignSelf: 'flex-start' }} onPress={async () => {
          const token = await getAccessToken(); if (!token) { d.toast('Your sign-in has ended. Sign in again.'); return; }
          try { await markArrived(e.apiId!, token, it.id); d.toast(e.special === 'Pending' ? 'Marked arrived. You can send it once head office approves the special request.' : 'Marked arrived. It is now ready to send from Send back.'); await sync(true); } catch (ex) { d.toast(errorMessage(ex)); }
        }} />}
        <X s={12} w={7} c={T.slate} style={{ marginTop: 11, marginBottom: 7 }}>PHOTOS</X>
        {photos === null ? <X s={13} c={T.slate}>Loading photos…</X>
          : mine.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>{mine.map(ph => <Pressable key={ph.id} accessibilityRole="imagebutton" accessibilityLabel={`Open photo: ${ph.tag}`} onPress={() => open(ph.url)} style={{ width: 130 }}>
              <Image source={{ uri: ph.url }} style={{ width: 130, height: 98, borderRadius: 9, backgroundColor: T.zinc2 }} resizeMode="cover" />
              <X s={12} w={6} c={T.slate} style={{ marginTop: 4 }}>{ph.tag === 'New label' ? 'New battery' : ph.tag}</X></Pressable>)}</View>
          : <X s={13} c={T.slate}>No photos for this battery.</X>}
      </Card>;
    })}
  </Screen>;
}

/* ---------- a distributor's requests, grouped by dealer (client, 3 Oct 2026) ---------- */

/** Counts for one dealer's batteries — what the distributor has to do next. */
function tally(rows: { e: Entry; it: Entry['items'][number] }[]) {
  const c = { requested: 0, awaiting: 0, arrived: 0, total: rows.length };
  rows.forEach(({ e, it }) => { const k = distributorStage(e, it).key; if (k === 'requested') c.requested++; else if (k === 'awaiting') c.awaiting++; else if (k === 'arrived') c.arrived++; });
  return c;
}
/** Every battery on the dealers' requests in this distributor's store, as (request, battery) pairs. */
const batteriesFrom = (entries: Entry[]) => entries.flatMap(e => e.items.map(it => ({ e, it })));

/** "From my dealers" inside My requests: one row per dealer, with what is waiting on the distributor. */
export function DealerGroups() {
  const d = useD(); const { state, dealerId } = useStore();
  const [dealers, setDealers] = useState<ApiDealer[] | null>(null);
  useEffect(() => {
    let alive = true;
    getAccessToken().then(t => (t ? listMyDealers(t) : null)).then(r => { if (alive) setDealers(r?.items ?? []); }).catch(() => { if (alive) setDealers([]); });
    return () => { alive = false; };
  }, []);
  const theirs = state.entries.filter(e => e.dealerId !== dealerId && e.status !== 'Draft');
  if (dealers === null) return <Card><X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>Loading your dealers…</X></Card>;
  if (!dealers.length) return <Card><X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>No dealers yet. Add them from Profile → My dealers.</X></Card>;
  const rows = dealers.map(dl => ({ dl, c: tally(batteriesFrom(theirs.filter(e => e.dealerId === dl.id))) }))
    .sort((a, b) => (b.c.requested + b.c.awaiting + b.c.arrived) - (a.c.requested + a.c.awaiting + a.c.arrived) || a.dl.name.localeCompare(b.dl.name));
  return <Card>{rows.map(({ dl, c }, i) => {
    const todo = [c.requested && `${c.requested} to approve`, c.awaiting && `${c.awaiting} to receive`, c.arrived && `${c.arrived} ready to send`].filter(Boolean).join(' · ');
    return <Line key={dl.id} last={i === rows.length - 1} onPress={() => d.go('d44', dl.id)} label={`Open ${dl.name}`}
      av={<Avatar n="shop" tone={c.requested || c.awaiting ? 'amber' : c.arrived ? 'green' : 'mute'} />}
      title={dl.name} sub={todo || (c.total ? `${c.total} ${c.total === 1 ? 'battery' : 'batteries'} · nothing waiting on you` : 'No requests yet')}
      right={dl.status !== 'active' ? <StatusChip status={dealerStatusLabel(dl.status)} /> : c.requested + c.awaiting + c.arrived ? <Chip tone="warn" label={String(c.requested + c.awaiting + c.arrived)} /> : undefined} chev />;
  })}</Card>;
}

/* d44 · one dealer's requests, battery by battery */
export function D44({ p }: { p?: string }) {
  const d = useD(); const { state } = useStore(); const { sync } = useSync();
  const names = useMyDealerNames();
  const [busy, setBusy] = useState('');
  useEffect(() => { sync(true); }, []);
  const rows = batteriesFrom(state.entries.filter(e => e.dealerId === p && e.status !== 'Draft'))
    .sort((a, b) => (b.e.createdAt || b.e.date).localeCompare(a.e.createdAt || a.e.date));
  const c = tally(rows);
  const arrive = async (e: Entry, itemId: string) => {
    if (!e.apiId) return;
    const token = await getAccessToken(); if (!token) { d.toast('Your sign-in has ended. Sign in again.'); return; }
    setBusy(itemId);
    try { await markArrived(e.apiId, token, itemId); d.toast(e.special === 'Pending' ? 'Marked arrived. You can send it once head office approves the special request.' : 'Marked arrived. It is now ready to send from Send back.'); await sync(true); }
    catch (ex) { d.toast(errorMessage(ex)); } finally { setBusy(''); }
  };
  const FILTERS: [string, string, (k: DistributorStage['key']) => boolean][] = [
    ['all', `All ${rows.length}`, () => true], ['requested', `To approve ${c.requested}`, k => k === 'requested'], ['awaiting', `To receive ${c.awaiting}`, k => k === 'awaiting'],
    ['arrived', `Ready to send ${c.arrived}`, k => k === 'arrived'], ['held', 'Waiting for head office', k => k === 'held'], ['done', 'Sent on', k => ['dispatched', 'factory', 'headoffice', 'approved', 'refused'].includes(k)],
  ];
  const [f, setF] = useState('all');
  const shown = rows.filter(({ e, it }) => FILTERS.find(x => x[0] === f)![2](distributorStage(e, it).key));
  return <Screen top={<AppBar title={names[p || ''] || 'Dealer'} back="d18" />}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>{FILTERS.map(([k, l]) =>
      <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: f === k }} onPress={() => setF(k)} style={tap}><Chip tone={f === k ? 'info' : 'mute'} label={l} /></Pressable>)}</View>
    <Card>{shown.length ? shown.map(({ e, it }, i) => {
      const s = distributorStage(e, it);
      return <View key={`${e.id}#${it.id}`} style={{ paddingVertical: 11, borderBottomWidth: i === shown.length - 1 ? 0 : 1, borderBottomColor: T.zinc2 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${e.id}`} onPress={() => d.go('d43', e.id)} style={{ flexDirection: 'row', gap: 11, alignItems: 'center' }}>
          <Avatar n={e.type === 'Replacement' ? 'swap' : 'truck'} tone={s.tone === 'warn' ? 'amber' : s.tone === 'bad' ? 'red' : s.tone === 'live' ? 'green' : s.tone === 'vio' ? 'vio' : 'mute'} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <X s={14.5} w={6} f="m">{it.oldSerial ? `${it.oldSerial} → ${it.code}` : it.code}</X>
            <X s={12.5} c={T.slate}>{e.type} · <Mono>{e.id}</Mono> · {dShort(e.date)}</X>
            <X s={12} c={T.slate}>{s.hint}</X>
            {it.coverCase ? <X s={12} w={6} c="#8A5A00">Special · {specialLine(it, e.date)}</X> : null}
          </View>
          <Chip tone={s.tone} label={s.label} />
        </Pressable>
        {s.key === 'awaiting' && e.apiId && <Btn kind="blue" sm icon="box" label={busy === it.id ? 'Saving…' : 'Mark arrived'} style={{ marginTop: 9, alignSelf: 'flex-start' }} onPress={() => arrive(e, it.id)} disabled={!!busy} />}
      </View>;
    }) : <X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>Nothing here.</X>}</Card>
    {c.arrived > 0 && <Btn kind="primary" icon="truck" label={`Send ${c.arrived} arrived ${c.arrived === 1 ? 'battery' : 'batteries'} to head office`} style={{ marginTop: 12 }} onPress={() => d.tab('d33')} />}
    <Hint icon="shield" style={{ marginTop: 10 }}>Approve on the photos and serial first. Mark a battery arrived only when the dealer hands it to you — only arrived batteries can go on a challan.</Hint>
  </Screen>;
}
