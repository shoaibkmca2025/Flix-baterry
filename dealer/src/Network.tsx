import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { T } from '@felix/shared/ui/theme';
import { X, B, Btn, Card, Chip, StatusChip, Field, Hint, Banner, Line, Avatar, Gap } from '@felix/shared/ui/kit';
import { PickList } from '@felix/shared/ui/pick';
import { dShort } from '@felix/shared/data';
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
  const [f, setF] = useState({ name: '', contact: '', mobile: '', email: '', city: '', state: 'Maharashtra', pin: '', place: '', address: '' });
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
    if (!/^\d{6}$/.test(f.pin)) e.pin = '6 digits.';
    if (!f.address.trim()) e.address = 'Enter the full shop address.';
    setErr(e); if (Object.values(e).some(Boolean)) { d.toast('Some details need a look — they are marked in red.'); return; }
    const token = await getAccessToken(); if (!token) { d.toast('Your sign-in has ended. Sign in again.'); return; }
    setBusy(true);
    try {
      const made = await createMyDealer({ name: f.name.trim(), contactPerson: f.contact.trim(), mobile: f.mobile, email: f.email.trim() || undefined, city: f.city, state: f.state.trim(), pin: f.pin, place: f.place.trim() || undefined, address: f.address.trim() }, token);
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
    <View style={{ flexDirection: 'row', gap: 9 }}>
      <Field style={{ flex: 1 }} label="State" req value={f.state} onChange={set('state')} error={err.state} />
      <Field style={{ flex: 1 }} label="PIN code" req mono numeric maxLength={6} value={f.pin} onChange={v => set('pin')(digits(v, 6))} ph="424001" error={err.pin} />
    </View>
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
