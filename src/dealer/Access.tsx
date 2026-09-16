import React, { useEffect, useState } from 'react';
import { View, Pressable, Platform } from 'react-native';
import { useStore } from '../store';
import { Dealer } from '../domain';
import { T } from './theme';
import { X, B, Ic, Btn, BtnRow, Card, CardH, Chip, StatusChip, Field, Hint, Banner, Steps, KV, SecT, Line, Avatar, BigOk, OtpBoxes, Gap } from './kit';
import { Screen, AppBar, Sheet, PickList, useD } from './shell';
import { Photo, pickDocument, takePhoto } from './media';
import { dLong, tShort } from './data';
import { requestOtp, verifyOtp, type VerifyOtpLoginResult, type VerifyOtpVerifiedResult } from '../api/auth';
import { registerDealer } from '../api/dealers';
import { ApiError } from '../api/client';
import { saveTokens, dealerStatusLabel } from '../api/session';
import { getMastersBundle, type City } from '../api/masters';

const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);
const grouped = (m: string) => m.length > 5 ? `${m.slice(0, 5)} ${m.slice(5)}` : m;
const phonePre = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><Ic n="phone" size={20} color={T.slate} /><X s={16} f="m" w={6}>+91</X></View>;

// Real city list from the backend (architecture.md §19 GET /masters), replacing the
// hardcoded local demo list — closes the id-vs-name gap flagged after the auth+dealers pass.
function useCities() {
  const [cities, setCities] = useState<City[]>([]);
  useEffect(() => { getMastersBundle().then(r => setCities(r.cities)).catch(() => {}); }, []);
  return cities;
}

/* d01 · splash */
export function D01() {
  const d = useD();
  const web = Platform.OS === 'web';
  const install = () => {
    const prompt = web ? (globalThis as any).__felixInstallPrompt : null;
    if (prompt) { prompt.prompt(); (globalThis as any).__felixInstallPrompt = null; }
    d.go('d02');
  };
  return <Screen bg={T.ink} center>
    <View style={{ width: 86, height: 86, borderRadius: 22, backgroundColor: T.volt, alignItems: 'center', justifyContent: 'center' }}><Ic n="batt" color="#2A1F02" /></View>
    <X s={31} w={7} f="c" c={T.white} lh={1.05} style={{ textAlign: 'center' }}>{'Felix Batteries\nDealer App'}</X>
    <X s={14} c="#93A2B4" style={{ textAlign: 'center', maxWidth: 250 }}>Record a replacement in under a minute. Works without signal.</X>
    <View style={{ height: 14 }} />
    {web ? <>
      <Btn kind="primary" icon="down" label="Install app" style={{ width: 250 }} onPress={install} />
      <Btn label="Open in browser" style={{ width: 250, backgroundColor: 'rgba(255,255,255,0.1)' }} onPress={() => d.go('d02')} />
    </> : <Btn kind="primary" icon="chev" label="Get started" style={{ width: 250 }} onPress={() => d.go('d02')} />}
    <X s={12} c="#6F7F93" style={{ marginTop: 14 }}>v1.0 · काम इंटरनेटशिवायही चालते</X>
  </Screen>;
}
if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener?.('beforeinstallprompt', (e: any) => { e.preventDefault(); (globalThis as any).__felixInstallPrompt = e; });

function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => { if (left <= 0) return; const t = setTimeout(() => setLeft(l => l - 1), 1000); return () => clearTimeout(t); }, [left]);
  return [left, setLeft] as const;
}

/* d02 · sign in */
export function D02() {
  const d = useD(); const { state, setState } = useStore();
  const cities = useCities();
  const [mobile, setMobile] = useState(''), [code, setCode] = useState(''), [sent, setSent] = useState(false), [error, setError] = useState<{ mobile?: string; code?: string }>({});
  const [challengeId, setChallengeId] = useState(''), [busy, setBusy] = useState(false);
  const [left, setLeft] = useCountdown();
  const send = async () => {
    if (mobile.length !== 10) { setError({ mobile: 'Enter the 10-digit mobile number.' }); return; }
    setError({}); setBusy(true);
    try {
      const { challengeId: id } = await requestOtp(mobile, 'login');
      setChallengeId(id); setSent(true); setLeft(30); d.toast('Code sent to your phone.');
    } catch (e) {
      setError({ mobile: e instanceof ApiError ? e.message : 'Could not reach the server. Try again.' });
    } finally { setBusy(false); }
  };
  const signIn = async () => {
    if (mobile.length !== 10) { setError({ mobile: 'Enter the 10-digit mobile number.' }); return; }
    if (code.length < 6) { setError({ code: 'Enter all 6 digits of the code.' }); return; }
    if (!challengeId) { setError({ mobile: 'Send the code first.' }); return; }
    setBusy(true);
    try {
      const result = (await verifyOtp(challengeId, code)) as VerifyOtpLoginResult;
      const dealer = result.dealer;
      if (!dealer) { setError({ mobile: 'No shop is registered with this number. Register your shop first.' }); return; }
      // bridge: the rest of the app still reads from the local demo store, not the API directly (yet).
      // dealer.cityId is a uuid; resolved to a name via GET /masters (fixes the gap from the previous session).
      const mapped: Dealer = {
        id: dealer.id, name: dealer.name, contact: dealer.contactPerson, mobile: dealer.mobile,
        email: dealer.email || '', city: cities.find(c => c.id === dealer.cityId)?.name || dealer.cityId,
        place: dealer.place || '', address: dealer.address,
        pin: dealer.pin, state: dealer.state, status: dealerStatusLabel(dealer.status),
      };
      setState(s => ({ ...s, dealers: [mapped, ...s.dealers.filter(x => x.id !== mapped.id)] }));
      await saveTokens(result.accessToken, result.refreshToken);
      d.signIn(dealer.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'dealer_not_active') {
        const details = e.details as { status?: string; dealerId?: string } | undefined;
        if (details?.status === 'pending_approval' && details.dealerId) { d.go('d05', details.dealerId); return; }
        setError({ mobile: e.message });
      } else {
        setError({ code: e instanceof ApiError ? e.message : 'Could not reach the server. Try again.' });
      }
    } finally { setBusy(false); }
  };
  return <Screen top={<AppBar title="Sign in" />}>
    <Banner tone="info" icon="phone" style={{ marginBottom: 14 }}>Use the mobile number you registered with. We will send a 6-digit code.</Banner>
    <Field label="Mobile number" req mr="मोबाइल नंबर" value={grouped(mobile)} onChange={v => setMobile(digits(v, 10))} phone mono pre={phonePre} ph="98765 43210" error={error.mobile} maxLength={11} />
    <Card style={{ marginBottom: 13 }}>
      <CardH title="Enter code" right={!sent ? <Pressable accessibilityRole="button" onPress={send}><Chip tone="info" icon="phone" label="Send code" /></Pressable>
        : left > 0 ? <Chip tone="mute" icon="clock" label={`Resend in ${left}s`} /> : <Pressable accessibilityRole="button" onPress={send}><Chip tone="info" icon="sync" label="Resend code" /></Pressable>} />
      <OtpBoxes value={code} onChange={v => { setCode(v); setError({}); }} />
      {error.code ? <Hint tone="err">{error.code}</Hint> : <Hint icon="lock">Check your SMS for the code.</Hint>}
    </Card>
    <Btn kind="primary" icon="check" label="Sign in" onPress={signIn} disabled={busy} />
    <BtnRow><Btn kind="ghost" sm label="Forgot password" style={{ alignSelf: 'stretch' }} onPress={() => d.go('d03')} /><Btn kind="ghost" sm label="New dealer? Register" style={{ alignSelf: 'stretch' }} onPress={() => d.go('d04')} /></BtnRow>
    <Pressable accessibilityRole="button" onPress={d.headOffice} style={{ alignSelf: 'center', marginTop: 22, padding: 6 }}><X s={12.5} w={6} c={T.slate} style={{ textDecorationLine: 'underline' }}>Head office staff? Open the admin workspace</X></Pressable>
  </Screen>;
}

/* d03 · reset password — not yet wired to /auth/password/forgot+reset; still local-only */
export function D03() {
  const d = useD(); const { state } = useStore();
  const [mobile, setMobile] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [err, setErr] = useState<Record<string, string>>({});
  const save = () => {
    const e: Record<string, string> = {};
    if (mobile.length !== 10) e.mobile = 'Enter the 10-digit mobile number.';
    else if (!state.dealers.some(x => digits(x.mobile, 10) === mobile)) e.mobile = 'This number is not registered with any shop.';
    if (pw.length < 8) e.pw = 'At least 8 characters.';
    if (pw2 !== pw) e.pw2 = 'The two passwords do not match.';
    setErr(e); if (Object.keys(e).length) return;
    d.go('d02'); d.toast('Password changed. Sign in with the new one.');
  };
  return <Screen top={<AppBar title="Reset password" back="d02" />}>
    <X s={14} c={T.slate} style={{ marginBottom: 14 }}>We will verify your registered mobile number, then let you set a new password.</X>
    <Field label="Registered mobile" req value={grouped(mobile)} onChange={v => setMobile(digits(v, 10))} phone mono ph="98765 43210" maxLength={11} error={err.mobile} />
    <Field label="New password" req value={pw} onChange={setPw} secure ph="••••••••" error={err.pw} hint="At least 8 characters. Avoid your shop name." hintIcon="shield" />
    <Field label="Repeat new password" req value={pw2} onChange={setPw2} secure ph="••••••••" error={err.pw2} />
    <Btn kind="blue" label="Save new password" onPress={save} />
  </Screen>;
}

/* d04 · self-registration */
export function D04() {
  const d = useD(); const { setState } = useStore();
  const cities = useCities();
  const [f, setF] = useState({ name: '', contact: '', mobile: '', email: '', city: '', state: 'Maharashtra', pin: '', place: '', address: '', password: '' });
  const [gst, setGst] = useState(''), [shopPhoto, setShopPhoto] = useState(''), [verified, setVerified] = useState(false), [otpOpen, setOtpOpen] = useState(false), [otp, setOtp] = useState(''), [cityOpen, setCityOpen] = useState(false), [err, setErr] = useState<Record<string, string>>({});
  const [challengeId, setChallengeId] = useState(''), [verifiedToken, setVerifiedToken] = useState(''), [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => { setF(x => ({ ...x, [k]: v })); setErr(e => ({ ...e, [k]: '' })); };
  const openVerify = async () => {
    setOtp(''); setBusy(true);
    try {
      const { challengeId: id } = await requestOtp(f.mobile, 'register');
      setChallengeId(id); setOtpOpen(true);
    } catch (e) {
      d.toast(e instanceof ApiError ? e.message : 'Could not send the code. Try again.');
    } finally { setBusy(false); }
  };
  const confirmCode = async () => {
    setBusy(true);
    try {
      const result = (await verifyOtp(challengeId, otp)) as VerifyOtpVerifiedResult;
      setVerifiedToken(result.verifiedToken); setVerified(true); setOtpOpen(false); setErr(e => ({ ...e, mobile: '' }));
    } catch (e) {
      d.toast(e instanceof ApiError ? e.message : 'That code is not right.');
    } finally { setBusy(false); }
  };
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Enter the shop name.';
    if (!f.contact.trim()) e.contact = 'Enter the owner or contact person.';
    if (f.mobile.length !== 10) e.mobile = 'Enter the 10-digit mobile number.';
    else if (!verified) e.mobile = 'Verify this number with the SMS code.';
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'This email does not look right.';
    if (!f.city) e.city = 'Choose your city.';
    if (!f.state.trim()) e.state = 'Enter the state.';
    if (!/^\d{6}$/.test(f.pin)) e.pin = '6 digits.';
    if (!f.address.trim()) e.address = 'Enter the full shop address.';
    if (f.password.length < 8) e.password = 'At least 8 characters.';
    setErr(e); if (Object.values(e).some(Boolean)) { d.toast('Some details need a look — they are marked in red.'); return; }
    setBusy(true);
    try {
      const result = await registerDealer({
        verifiedToken, name: f.name.trim(), contactPerson: f.contact.trim(), mobile: f.mobile,
        email: f.email.trim() || undefined, city: f.city, state: f.state.trim(), pin: f.pin,
        place: f.place.trim() || undefined, address: f.address.trim(), password: f.password,
      });
      const dealer: Dealer = { id: result.id, name: result.name, contact: f.contact.trim(), mobile: f.mobile, email: f.email.trim(), city: f.city, place: f.place.trim(), address: f.address.trim(), pin: f.pin, state: f.state.trim(), status: dealerStatusLabel(result.status), documents: [gst && `GST certificate · ${gst}`, shopPhoto && 'Shop photo'].filter(Boolean) as string[] };
      setState(s => ({ ...s, dealers: [dealer, ...s.dealers] }));
      d.go('d05', dealer.id);
    } catch (e) {
      if (e instanceof ApiError && e.field) setErr(x => ({ ...x, [e.field!]: e.message }));
      d.toast(e instanceof ApiError ? e.message : 'Could not reach the server. Try again.');
    } finally { setBusy(false); }
  };
  return <Screen top={<AppBar title="Register your shop" back="d02" />} overlay={<>
    <Sheet open={cityOpen} title="Choose city" onClose={() => setCityOpen(false)}><PickList options={cities.map(c => ({ v: c.name }))} value={f.city} onPick={v => { set('city')(v); setCityOpen(false); }} /></Sheet>
    <Sheet open={otpOpen} title="Verify mobile number" onClose={() => setOtpOpen(false)}>
      <X s={14} c={T.slate} style={{ marginBottom: 12 }}>Enter the 6-digit code sent to +91 {grouped(f.mobile)}.</X>
      <OtpBoxes value={otp} onChange={setOtp} autoFocus />
      <Hint icon="lock">Check your SMS for the code.</Hint>
      <Btn kind="primary" icon="check" label="Confirm code" style={{ marginTop: 14 }} onPress={confirmCode} disabled={busy} />
    </Sheet></>}>
    <Steps labels={['Shop', 'Owner', 'Address']} now={1} />
    <Gap h={12} />
    <Field label="Dealer / company name" req mr="दुकानाचे नाव" value={f.name} onChange={set('name')} ph="Shop name on the board" error={err.name} />
    <Field label="Contact person" req value={f.contact} onChange={set('contact')} ph="Owner or manager" error={err.contact} />
    <Field label="Mobile number" req mono phone value={grouped(f.mobile)} onChange={v => { set('mobile')(digits(v, 10)); setVerified(false); }} ph="98765 43210" maxLength={11} error={err.mobile}
      tail={verified ? <Chip tone="live" icon="check" label="OTP verified" /> : f.mobile.length === 10 ? <Pressable accessibilityRole="button" onPress={openVerify}><Chip tone="info" icon="phone" label="Verify" /></Pressable> : undefined} />
    <Field label="Email" mr="for alerts and recovery" value={f.email} onChange={set('email')} ph="name@shop.in" error={err.email} />
    <Field label="City" req value={f.city} ph="Choose city" onPress={() => setCityOpen(true)} tail={<Ic n="chev" color={T.slate} />} error={err.city} hint="Chosen from the company city list — not typed." hintIcon="pin" />
    <View style={{ flexDirection: 'row', gap: 9 }}>
      <Field style={{ flex: 1 }} label="State" req value={f.state} onChange={set('state')} error={err.state} />
      <Field style={{ flex: 1 }} label="PIN code" req mono numeric maxLength={6} value={f.pin} onChange={v => set('pin')(digits(v, 6))} ph="424001" error={err.pin} />
    </View>
    <Field label="Place / area" value={f.place} onChange={set('place')} ph="Road or area" />
    <Field label="Full address" req value={f.address} onChange={set('address')} ph="Shop number, building, road" error={err.address} />
    <Field label="Dealer code" value="" ph="Admin will assign one" readonly />
    <Field label="Password" req secure value={f.password} onChange={set('password')} ph="••••••••" error={err.password} />
    <Card><CardH title="Shop documents" right={<Chip tone="mute" label="Optional" />} />
      <View style={{ flexDirection: 'row', gap: 9 }}>
        <Photo label={gst ? 'GST certificate ✓' : 'GST certificate'} icon="doc" has={!!gst} onPress={async () => { const n = await pickDocument(d.toast); if (n) setGst(n); }} />
        <Photo label={shopPhoto ? 'Shop photo ✓' : 'Shop photo'} uri={shopPhoto || undefined} onPress={async () => { const u = await takePhoto(d.toast); if (u) setShopPhoto(u); }} />
      </View></Card>
    <Btn kind="primary" icon="check" label="Send for approval" style={{ marginTop: 12 }} onPress={submit} disabled={busy} />
  </Screen>;
}

/* d05 · registration pending */
export function D05({ p }: { p?: string }) {
  const d = useD(); const { state } = useStore();
  const dealer = state.dealers.find(x => x.id === p);
  const sent = state.audits.find(a => a.ref === p && a.action === 'Dealer registered')?.at;
  const approved = dealer?.status === 'Active';
  return <Screen top={<AppBar title="Registration sent" />}>
    <BigOk n={approved ? 'check' : 'clock'} bg={approved ? T.live : T.volt} />
    <X s={21} w={7} f="c" style={{ textAlign: 'center', marginBottom: 6 }}>{approved ? 'Your shop is approved' : 'Waiting for approval'}</X>
    <X s={15} c={T.slate} style={{ textAlign: 'center', marginBottom: 18 }}>{approved ? 'You can sign in and record entries now.' : 'Felix Batteries will review your shop details. You cannot record entries until then.'}</X>
    {dealer && <Card><KV pairs={[['Shop', dealer.name], ['City', dealer.city], ['Mobile', `+91 ${grouped(digits(dealer.mobile, 10))}`, 'mono'], ['Submitted', sent ? `${dLong(sent)}, ${tShort(sent)}` : '—']]} /></Card>}
    <Banner tone="info" icon="bell" style={{ marginTop: 12 }}>You will get an SMS and an in-app message the moment a decision is made. Most reviews finish the same working day.</Banner>
    <BtnRow><Btn kind="ghost" label="Back to sign in" onPress={() => d.go('d02')} />
      {approved ? <Btn kind="blue" label="Sign in now" onPress={() => d.signIn(dealer!.id)} /> : <Btn kind="blue" label="Preview approved app" onPress={() => { d.signIn('FPP-014'); d.toast('Preview: showing the demo shop, Felix Power Point.'); }} />}</BtnRow>
  </Screen>;
}

/* d06 · shop profile & documents */
export function D06() {
  const d = useD(); const { state, setState, dealerId, audit } = useStore();
  const dealer = state.dealers.find(x => x.id === dealerId)!;
  const docs = dealer.documents || [];
  const gst = docs.find(x => x.startsWith('GST')), photo = docs.find(x => x.startsWith('Shop photo'));
  const add = (doc: string) => setState(s => audit({ ...s, dealers: s.dealers.map(x => x.id === dealerId ? { ...x, documents: [...(x.documents || []), doc] } : x) }, 'Dealer document added', dealerId, doc));
  return <Screen tab="user" top={<AppBar title="Shop profile" back="d09" />}>
    <Card><CardH title={dealer.name} right={<StatusChip status={dealer.status} />} />
      <KV pairs={[['Dealer code', dealer.id, 'mono'], ['City', dealer.city], ['Place', dealer.place || '—'], ['Contact', dealer.contact], ['Mobile', `+91 ${grouped(digits(dealer.mobile, 10))}`, 'mono'], ['Email', dealer.email || '—']]} /></Card>
    <SecT title="Documents" />
    <Card>
      <Line av={<Avatar n="doc" tone={gst ? 'blue' : 'mute'} />} title="GST certificate" sub={gst ? gst.split(' · ')[1] || 'Uploaded' : 'Not uploaded'}
        right={gst ? <Chip tone="info" icon="check" label="Uploaded" /> : <Btn kind="ghost" sm label="Add" onPress={async () => { const n = await pickDocument(d.toast); if (n) { add(`GST certificate · ${n}`); d.toast('GST certificate added. Head office will verify it.'); } }} />} />
      <Line last av={<Avatar n="cam" tone={photo ? 'blue' : 'mute'} />} title="Shop photo" sub={photo ? 'Uploaded' : 'Not uploaded'}
        right={photo ? <Chip tone="info" icon="check" label="Uploaded" /> : <Btn kind="ghost" sm label="Add" onPress={async () => { const u = await takePhoto(d.toast); if (u) { add('Shop photo'); d.toast('Shop photo added.'); } }} />} />
    </Card>
    <Banner tone="info" icon="lock" style={{ marginTop: 12 }}>Name, city and dealer code are locked by Felix Batteries. Ask an admin to change them — every edit is recorded.</Banner>
  </Screen>;
}
