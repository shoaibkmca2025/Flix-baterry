import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useStore } from '../store';
import { Entry, Item, State, deriveCode, expiryFrom, newEntry, newItem, normalize, today, validateEntry } from '../domain';
import { T } from './theme';
import { X, B, Ic, Btn, Card, CardH, Chip, StatusChip, Field, Label, Hint, Banner, Steps, KV, SecT, Line, Avatar, BigOk, BigTile, ChipRow, CapBtn, IconBtn, Plate, PlateLab, PlateVal, Meter, Gap } from './kit';
import { Screen, AppBar, Sheet, PickList, useD } from './shell';
import { Photo, SignaturePad, locate, parseGps, takePhoto } from './media';
import { coverOf, coverChip, dLong, findBattery, monYear, monthLong, monthShort, nextEntryId, spanLong, spanShort, tShort } from './data';

const REP_STEPS = ['1 · Old battery', '2 · New battery', '3 · Check'];
const RET_STEPS = ['1 · Battery', '2 · Photos', '3 · Check'];
const FAULTS = ['Not holding charge', 'Low backup', 'Swollen case', 'Leaking', 'Other'];
const ACTIVE_ELSEWHERE = ['Submitted', 'Under Review', 'Conflict', 'Pending sync'];

/* ---------- flow helpers ---------- */
const tagFor = (base: string, i: number) => i === 0 ? base : `${base} · item ${i + 1}`;
const tagsOf = (e: Entry) => e.evidenceTags && e.evidenceTags.length === e.evidence.length ? e.evidenceTags : e.evidence.map(() => 'Photo');
const photoOf = (e: Entry, tag: string) => { const k = tagsOf(e).indexOf(tag); return k >= 0 ? e.evidence[k] : undefined; };
const photoCount = (e: Entry, i: number) => tagsOf(e).filter(t => i === 0 ? !t.includes(' · item ') : t.endsWith(` · item ${i + 1}`)).length;
function withPhoto(e: Entry, tag: string, uri: string): Partial<Entry> {
  const tags = [...tagsOf(e)], evidence = [...e.evidence], k = tags.indexOf(tag);
  if (k >= 0) evidence[k] = uri; else { tags.push(tag); evidence.push(uri); }
  return { evidence, evidenceTags: tags };
}
const codeFrom = (data: string) => (data.match(/\d{8}/)?.[0]) || data.replace(/\D/g, '').slice(0, 8);

/** Checks the dealer app adds on top of the shared validation. */
function dealerErrors(e: Entry, state: State) {
  const errs: Record<string, string> = { ...validateEntry(e, state) };
  const others = state.entries.filter(x => x.id !== e.id && ACTIVE_ELSEWHERE.includes(x.status));
  e.items.forEach((it, i) => {
    if (e.type === 'Replacement') {
      if (!it.fault) errs[`items.${i}.fault`] = 'Choose what is wrong with the old battery.';
      const dupOld = it.oldSerial && others.find(x => x.type === 'Replacement' && x.items.some(y => normalize(y.oldSerial) === normalize(it.oldSerial)));
      if (dupOld && !errs[`items.${i}.oldSerial`]) errs[`items.${i}.oldSerial`] = `This old battery is already on request ${dupOld.id}.`;
    }
    const dupNew = it.code && others.find(x => x.items.some(y => normalize(y.code) === normalize(it.code)));
    if (dupNew && !errs[`items.${i}.code`]) errs[`items.${i}.code`] = `This battery is already on request ${dupNew.id}.`;
  });
  return errs;
}
const itemErrors = (errs: Record<string, string>, i: number, fields: string[]) => Object.fromEntries(fields.filter(f => errs[`items.${i}.${f}`]).map(f => [f, errs[`items.${i}.${f}`]]));

function dealerWarnings(e: Entry, state: State): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const month = today().slice(0, 7);
  const recent = state.entries.filter(x => x.id !== e.id && x.status !== 'Draft' && x.date.startsWith(month)).flatMap(x => x.items.map(y => y.code));
  e.items.forEach((it, i) => {
    if (/^\d{8}$/.test(it.code)) { const near = recent.find(c => /^\d{8}$/.test(c) && Math.abs(Number(c) - Number(it.code)) === 1); if (near) out.push({ key: `items.${i}.code`, text: `Serial ${it.code} is close to ${near} already recorded this month.` }); }
    if (e.type === 'Replacement' && /^\d{8}$/.test(it.oldSerial) && !findBattery(state, it.oldSerial)) out.push({ key: `items.${i}.oldSerial`, text: `Old battery ${it.oldSerial} is not on record — head office will check it.` });
    if (e.type === 'Replacement' && (!photoOf(e, tagFor('Old battery', i)) || !photoOf(e, tagFor('New label', i)))) out.push({ key: `photos.${i}`, text: `Item ${i + 1} is missing the old battery or new label photo.` });
  });
  if (!e.customer.trim()) out.push({ key: 'items.0.customer', text: 'No customer name is on this entry.' });
  return out;
}

function useFlow() {
  const d = useD(); const { setState } = useStore();
  const f = d.flow;
  useEffect(() => { if (!f) d.tab('d10'); }, [f]);
  const upd = (v: Partial<Entry>) => d.setFlow(x => x && { ...x, entry: { ...x.entry, ...v } });
  const item = (v: Partial<Item>, i?: number) => d.setFlow(x => x && { ...x, entry: { ...x.entry, items: x.entry.items.map((it, j) => j === (i ?? x.cur) ? { ...it, ...v } : it) } });
  const saveDraft = () => { if (f) setState(s => ({ ...s, entries: [{ ...f.entry, status: 'Draft' }, ...s.entries.filter(e => e.id !== f.entry.id)] })); };
  return { f, d, upd, item, saveDraft };
}

/* ---------- scanner ---------- */
function ScanBox({ code, active, onCode, height = 212, label = 'Hold the label inside the box' }: { code?: string; active: boolean; onCode: (c: string) => void; height?: number; label?: string }) {
  const fired = useRef(false);
  useEffect(() => { if (active) fired.current = false; }, [active]);
  return <View style={{ backgroundColor: T.ink, borderRadius: 12, height, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {active && <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc_a', 'datamatrix'] }}
      onBarcodeScanned={({ data }) => { if (fired.current) return; fired.current = true; onCode(data); }} />}
    {!!code && <X s={13} f="m" w={5} c={T.white} style={{ position: 'absolute', top: 14 }}>{code}</X>}
    <View style={{ width: 196, height: height < 180 ? 84 : 118, borderWidth: 3, borderColor: T.volt, borderRadius: 8 }}>
      <View style={{ position: 'absolute', left: 8, right: 8, top: '50%', height: 2, backgroundColor: T.terminal, shadowColor: T.terminal, shadowOpacity: 1, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } }} /></View>
    <X s={12.5} c="#A8B6C7" style={{ position: 'absolute', bottom: 12 }}>{active ? label : label}</X>
  </View>;
}
function useScanner(onCode: (code: string) => void) {
  const d = useD(); const [perm, request] = useCameraPermissions(); const [active, setActive] = useState(false);
  const start = async () => {
    if (active) { setActive(false); return; }
    try { const ok = perm?.granted || (await request()).granted; if (!ok) { d.toast('Camera access declined. Type the serial instead — that is always allowed.'); return; } setActive(true); }
    catch { d.toast('The camera is not available here. Type the serial instead.'); }
  };
  const handle = (data: string) => { setActive(false); onCode(codeFrom(data)); };
  return { active, start, handle, stop: () => setActive(false) };
}
export function ScanSheet({ open, title, onClose, onCode }: { open: boolean; title: string; onClose: () => void; onCode: (c: string) => void }) {
  const [manual, setManual] = useState('');
  const sc = useScanner(c => { onCode(c); onClose(); });
  useEffect(() => { if (open) { setManual(''); sc.start(); } else sc.stop(); }, [open]);
  return <Sheet open={open} title={title} onClose={onClose}>
    <ScanBox active={sc.active} onCode={sc.handle} />
    <Btn kind="blue" sm icon="scan" label={sc.active ? 'Stop camera' : 'Start camera'} style={{ alignSelf: 'stretch', marginTop: 12 }} onPress={sc.start} />
    <Gap h={14} />
    <Field label="Or type the number on the label" mono numeric maxLength={8} value={manual} onChange={v => setManual(v.replace(/\D/g, ''))} ph="8 digits" />
    <Btn kind="primary" icon="check" label="Use this number" disabled={manual.length !== 8} onPress={() => { onCode(manual); onClose(); }} />
  </Sheet>;
}

/* d10 · entry type */
const TYPES: [string, string, 'wrench' | 'truck', boolean, string][] = [
  ['Replacement', 'बदली', 'wrench', true, 'Old battery comes back, a new one goes out. Warranty carries over.'],
  ['Sales Return', 'विक्री परत', 'truck', false, 'Battery returned to you — no replacement given.'],
];
export function D10() {
  const d = useD(); const { state, dealerId } = useStore();
  const dealer = state.dealers.find(x => x.id === dealerId)!;
  const start = (type: string) => {
    d.setFlow({ entry: { ...newEntry(dealerId, type), id: nextEntryId(state), place: dealer.place || dealer.city }, cur: 0, scanned: {} });
    d.go(type === 'Replacement' ? 'd11' : 'd13');
  };
  return <Screen top={<AppBar title="What are you recording?" back="d07" />}>
    <Banner tone="info" icon="alert" style={{ marginBottom: 15 }}>Choose one. The next screen then asks only for what that choice needs — nothing extra.</Banner>
    {TYPES.map(t => <BigTile key={t[0]} icon={t[2]} title={t[0]} sub={t[1]} desc={t[4]} hot={t[3]} onPress={() => start(t[0])} />)}
    <Hint icon="lock" style={{ marginTop: 4 }}>Only these two are switched on for dealers. Head office can turn on more types later without an app update.</Hint>
  </Screen>;
}

/* d11 · old battery */
export function D11() {
  const { f, d, upd, item, saveDraft } = useFlow(); const { state, dealerId } = useStore();
  const [scan, setScan] = useState(false), [errs, setErrs] = useState<Record<string, string>>({});
  if (!f) return null;
  const e = f.entry, i = f.cur, it = e.items[i];
  const old = /^\d{8}$/.test(it.oldSerial) ? findBattery(state, it.oldSerial) : undefined;
  const cover = coverOf(old, state);
  const setOld = (v: string) => {
    const code = v.replace(/\D/g, '').slice(0, 8);
    item({ oldSerial: code }); setErrs(x => ({ ...x, oldSerial: '' }));
    const b = code.length === 8 ? findBattery(state, code) : undefined;
    if (b && b.dealerId === dealerId) { if (!e.customer && b.customer) upd({ customer: b.customer }); if (!it.code) item({ oldSerial: code, model: b.model }); }
  };
  const next = () => {
    const all = dealerErrors(e, state), mine = itemErrors(all, i, ['oldSerial', 'fault']);
    setErrs(mine); if (Object.keys(mine).length) return;
    saveDraft(); d.go('d13');
  };
  const oldPhoto = photoOf(e, tagFor('Old battery', i));
  return <Screen top={<AppBar title="Old battery" back={i > 0 ? 'd12' : 'd10'} right={<Chip tone="mute" mono label={e.id} />} />}
    overlay={<ScanSheet open={scan} title="Scan the old battery" onClose={() => setScan(false)} onCode={c => { setOld(c); d.setFlow(x => x && { ...x, scanned: { ...x.scanned, [`old-${i}`]: true } }); d.toast('Scanned. Check the number matches the label.'); }} />}>
    <Steps labels={REP_STEPS} now={1} />
    <Gap h={14} />
    <Banner tone="info" icon="batt" style={{ marginBottom: 14 }}>Start with the battery the customer brought back. Scan it, or photograph the label and type the number.</Banner>
    <Field label="Old battery serial number" req mr="जुनी बॅटरी" mono numeric maxLength={8} value={it.oldSerial} onChange={setOld} ph="8 digits on the label" error={errs.oldSerial}
      tail={<><CapBtn n="scan" tone="alt" label="Scan old battery" onPress={() => setScan(true)} /><CapBtn n="cam" tone={oldPhoto ? 'done' : 'dark'} label="Photograph old battery label" onPress={async () => { const u = await takePhoto(d.toast); if (u) { upd(withPhoto(e, tagFor('Old battery', i), u)); d.toast('Photo saved. Check the number above matches it.'); } }} /></>} />
    {old && old.dealerId === dealerId && <Card style={{ borderColor: '#B8DFCB', backgroundColor: '#F7FCF9', marginBottom: 14 }}>
      <CardH title="Found on record" right={cover ? <Chip tone={coverChip(cover.status)[1]} icon={cover.status === 'Active' ? 'shield' : 'clock'} label={coverChip(cover.status)[0]} /> : <Chip tone="mute" label="No cover dates" />} />
      <KV pairs={[['Model', `${old.model} · ${state.models.find(m => m.id === old.model)?.type || ''}`], ['Sold', dLong(old.start)], ['Cover ends', dLong(old.expiry)], ['Sold by', state.dealers.find(x => x.id === old.dealerId)?.name || '—']]} />
    </Card>}
    {old && old.dealerId !== dealerId && <Card style={{ borderColor: '#F0C7BC', backgroundColor: '#FFF8F6', marginBottom: 14 }}>
      <CardH title="Held by another shop" right={<Chip tone="bad" icon="lock" label="Not yours" />} />
      <X s={13.5} c={T.slate}>This serial is recorded against a different dealer. Check the label again, or call head office.</X></Card>}
    {!old && it.oldSerial.length === 8 && <Card style={{ borderColor: '#EBD49C', backgroundColor: '#FFFBF1', marginBottom: 14 }}>
      <CardH title="Not on record" right={<Chip tone="warn" icon="eye" label="Head office will check" />} />
      <X s={13.5} c={T.slate}>Often an old sale from before the app. You can still send it — no cover dates will be guessed.</X></Card>}
    <View style={{ marginBottom: 13 }}><Label text="What is the problem?" req mr="काय बिघडले" /></View>
    <ChipRow options={FAULTS} value={it.fault || ''} onChange={v => { item({ fault: v }); setErrs(x => ({ ...x, fault: '' })); }} />
    {errs.fault && <Hint tone="err" style={{ marginTop: -9, marginBottom: 13 }}>{errs.fault}</Hint>}
    <Field label="Remarks" mr="शेरा" multiline value={it.remarks} onChange={v => item({ remarks: v })} ph="Anything head office should know" />
    <Field label="Customer" mr="ग्राहक" value={e.customer} onChange={v => upd({ customer: v })} ph="Customer or vehicle owner" />
    <Btn kind="primary" big iconAfter="chev" label="Next: the new battery" style={{ marginTop: 4 }} onPress={next} />
    <Hint icon="lock" center style={{ marginTop: 10 }}>Your shop, city and dealer code are added automatically.</Hint>
  </Screen>;
}

/* d13 · new (or returned) battery */
export function D13() {
  const { f, d, upd, item, saveDraft } = useFlow(); const { state, dealerId } = useStore();
  const [modelOpen, setModelOpen] = useState(false), [errs, setErrs] = useState<Record<string, string>>({});
  const setCode = (v: string, scanned = false) => {
    const code = v.replace(/\D/g, '').slice(0, 8);
    const b = code.length === 8 ? findBattery(state, code) : undefined;
    item({ code, ...deriveCode(code), ...(b && b.dealerId === dealerId ? { model: b.model } : {}) });
    d.setFlow(x => x && { ...x, scanned: { ...x.scanned, [`new-${x.cur}`]: scanned } });
    setErrs(x => ({ ...x, code: '', serial: '', model: '' }));
  };
  const sc = useScanner(c => { setCode(c, true); d.toast('Scanned. Check each line below.'); });
  if (!f) return null;
  const e = f.entry, i = f.cur, it = e.items[i], rep = e.type === 'Replacement';
  const stock = it.code.length === 8 ? findBattery(state, it.code) : undefined;
  const mine = stock && stock.dealerId === dealerId;
  const labelTag = tagFor(rep ? 'New label' : 'Label', i);
  const check = () => { const mineErrs = itemErrors(dealerErrors(e, state), i, ['code', 'serial', 'model']); setErrs(mineErrs); return !Object.keys(mineErrs).length; };
  const serialHint = it.code.length === 8 && !errs.code ? (mine ? { t: `In your stock · ${stock!.state}. Stored exactly as printed — leading zeros are kept.`, ok: true } : stock ? { t: 'Stored exactly as printed — leading zeros are kept.', ok: false } : { t: rep ? 'Not in your stock list — head office will check it. Leading zeros are kept.' : 'Not on record — head office will check it. Leading zeros are kept.', ok: false }) : { t: 'Stored exactly as printed — leading zeros are kept.', ok: false };
  return <Screen top={<AppBar title={rep ? 'New battery' : 'Returned battery'} back={rep ? 'd11' : 'd10'} right={<Chip tone="mute" mono label={e.id} />} />}
    overlay={<Sheet open={modelOpen} title="Battery model" onClose={() => setModelOpen(false)}>
      <PickList options={state.models.filter(m => m.active).map(m => ({ v: m.id, sub: `${m.type} · ${m.capacity}` }))} value={it.model} onPick={v => { item({ model: v }); setModelOpen(false); setErrs(x => ({ ...x, model: '' })); }} /></Sheet>}>
    <Steps labels={rep ? REP_STEPS : RET_STEPS} now={rep ? 2 : 1} />
    <Gap h={14} />
    <ScanBox code={it.code} active={sc.active} onCode={sc.handle} />
    <View style={{ flexDirection: 'row', gap: 9, marginTop: 12 }}>
      <Btn kind="blue" sm icon="scan" label={sc.active ? 'Stop camera' : 'Scan code'} style={{ flex: 1, alignSelf: 'stretch' }} onPress={sc.start} />
      <Btn kind="ghost" sm icon="cam" label="Photo of label" style={{ flex: 1, alignSelf: 'stretch' }} onPress={async () => { const u = await takePhoto(d.toast); if (u) { upd(withPhoto(e, labelTag, u)); d.toast('Label photo saved. Check the values below match it.'); } }} />
    </View>
    {f.scanned[`new-${i}`] ? <Banner tone="ok" icon="check" style={{ marginVertical: 14 }}><B>Read from the label.</B> Check each line. You can change any of them, and typing it all by hand is always allowed.</Banner>
      : <Banner tone="info" icon="scan" style={{ marginVertical: 14 }}><B>Scan the code on the label.</B> Or type the serial below — typing it all by hand is always allowed.</Banner>}
    <Field label="Battery model" req mr="मॉडेल" value={it.model} onPress={() => setModelOpen(true)} error={errs.model}
      tail={<>{mine && <Chip tone="live" label="From stock" />}<Ic n="chev" color={T.slate} /></>} />
    <Field label="Serial number" req mr="सिरीयल" mono numeric maxLength={8} value={it.code} onChange={v => setCode(v)} ph="8 digits on the label" error={errs.code || errs.serial}
      tail={<CapBtn n="cam" tone={photoOf(e, labelTag) ? 'done' : 'dark'} label="Photograph the serial" onPress={async () => { const u = await takePhoto(d.toast); if (u) { upd(withPhoto(e, labelTag, u)); d.toast('Photo of the serial saved.'); } }} />}
      hint={serialHint.t} hintTone={serialHint.ok ? 'ok' : undefined} hintIcon={serialHint.ok ? 'check' : 'alert'} />
    <Field label="Made in" value={it.mfg ? monthLong(it.mfg) : ''} ph="Worked out from the serial" readonly hint="Worked out from the serial. Nothing to fill in." hintIcon="lock" />
    <Btn kind="primary" big iconAfter="chev" label={rep ? 'Next: check the warranty' : 'Next: photos and proof'} style={{ marginTop: 14 }} onPress={() => { if (!check()) return; saveDraft(); d.go(rep ? 'd31' : 'd15'); }} />
    <Btn kind="ghost" icon="plus" label="Add another battery to this request" style={{ marginTop: 9 }} onPress={() => { if (!check()) return; saveDraft(); d.go('d12'); }} />
  </Screen>;
}

/* d12 · several batteries in one request */
export function D12() {
  const { f, d, upd, saveDraft } = useFlow(); const { state } = useStore();
  if (!f) return null;
  const e = f.entry, rep = e.type === 'Replacement', errs = dealerErrors(e, state);
  const ready = (i: number) => !Object.keys(errs).some(k => k.startsWith(`items.${i}.`));
  const editItem = (i: number, to: string) => { d.setFlow(x => x && { ...x, cur: i }); d.go(to); };
  return <Screen top={<AppBar title="Batteries in this entry" back="d13" right={<Chip tone="info" label={`${e.items.length} ${e.items.length === 1 ? 'item' : 'items'}`} />} />}>
    <Steps labels={rep ? REP_STEPS : RET_STEPS} now={rep ? 2 : 1} />
    <Gap h={13} />
    {e.items.map((it, i) => <Card key={it.id} style={i ? { marginTop: 11 } : undefined}>
      <CardH title={`Item ${i + 1} · ${it.model}`} right={ready(i) ? <StatusChip status="Approved" label="Ready" /> : <Chip tone="warn" icon="alert" label="Needs a look" />} />
      <KV pairs={rep ? [['New serial', it.code || '—', 'mono'], ['Old serial', it.oldSerial || '—', 'mono'], ['Mfg month', monthShort(it.mfg)], ['Quantity', '1']] : [['Serial', it.code || '—', 'mono'], ['Model', it.model], ['Mfg month', monthShort(it.mfg)], ['Quantity', '1']]} />
      <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}>
        <Btn kind="ghost" sm icon="pen" label="Edit" style={{ flex: 1, alignSelf: 'stretch' }} onPress={() => editItem(i, rep ? 'd11' : 'd13')} />
        <Btn kind="ghost" sm icon="cam" label={`Photos (${photoCount(e, i)})`} style={{ flex: 1, alignSelf: 'stretch' }} onPress={() => editItem(i, 'd15')} />
        {e.items.length > 1 && <Btn kind="ghost" sm icon="x" label="Remove" color={T.terminal} borderColor="#F0C7BC" style={{ alignSelf: 'stretch' }} onPress={() => { upd({ items: e.items.filter((_, j) => j !== i) }); d.setFlow(x => x && { ...x, cur: 0 }); }} />}
      </View>
    </Card>)}
    <Card style={{ marginTop: 11, borderStyle: 'dashed', flexDirection: 'row', gap: 11, alignItems: 'center' }} label="Add another battery" onPress={() => {
      const items = [...e.items, { ...newItem(), model: e.items[e.items.length - 1]?.model || 'M5' }];
      d.setFlow(x => x && { ...x, cur: items.length - 1, entry: { ...x.entry, items } }); d.go(rep ? 'd11' : 'd13');
    }}>
      <Avatar n="plus" tone="amber" /><View style={{ flex: 1 }}><X s={14.5} w={6}>Add another battery</X><X s={12.5} c={T.slate} style={{ marginTop: 2 }}>Same entry, one more line — the total updates by itself</X></View></Card>
    <Card style={{ backgroundColor: T.ink, borderColor: '#000', marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <View><X s={11.5} w={6} c="#8C9BAE">Total quantity</X><X s={28} w={7} f="c" c={T.white}>{e.items.length}</X></View>
      <X s={12.5} c="#9BA9BB" style={{ textAlign: 'right' }}>{'Calculated from the items.\nYou never type this.'}</X></Card>
    <Btn kind="primary" iconAfter="chev" label="Next: check and send" style={{ marginTop: 13 }} onPress={() => { saveDraft(); d.go('d16'); }} />
  </Screen>;
}

/* d31 · warranty carry-over */
export function D31() {
  const { f, d, upd } = useFlow(); const { state } = useStore();
  if (!f) return null;
  const e = f.entry, it = e.items[f.cur];
  const old = findBattery(state, it.oldSerial), cover = coverOf(old, state);
  const fresh = cover ? monYear(expiryFrom(today(), cover.months)) : '';
  return <Screen top={<AppBar title="Warranty carried over" back="d13" right={cover ? <Chip tone="live" icon="shield" label="Checked" /> : <Chip tone="warn" icon="alert" label="Not on record" />} />}>
    <Plate style={{ marginBottom: 13 }}>
      <PlateLab>{cover ? `OLD BATTERY · COVER STARTED ${dLong(cover.start).toUpperCase()}` : 'OLD BATTERY · NOT ON RECORD'}</PlateLab><PlateVal>{it.oldSerial || '—'}</PlateVal>
      <X s={12} w={6} c={T.volt} style={{ textAlign: 'center', letterSpacing: 0.96, marginTop: 9, marginBottom: 7 }}>SAME COVER MOVES ACROSS</X>
      <PlateLab>{cover ? `NEW BATTERY · COVER STILL ENDS ${dLong(cover.expiry).toUpperCase()}` : 'NEW BATTERY · COVER SET BY HEAD OFFICE'}</PlateLab><PlateVal color="#7FD3A9">{it.code || '—'}</PlateVal>
    </Plate>
    {cover ? <>
      <Card><CardH title="Cover remaining" right={<Chip tone={cover.status === 'Expired' ? 'bad' : 'live'} icon="clock" label={cover.status === 'Expired' ? 'Cover ended' : `${spanShort(cover.leftSpan)} left`} />} />
        <Meter used={cover.used} labels={[`${dLong(cover.start)} · sold`, 'Today', `${dLong(cover.expiry)} · ends`]} />
        <Gap h={12} />
        <KV pairs={[['Cover started', dLong(cover.start)], ['Cover ends', dLong(cover.expiry)], ['Already used', spanLong(cover.usedSpan)], ['Still remaining', cover.status === 'Expired' ? 'None' : spanLong(cover.leftSpan)], ['Policy', `Standard ${(cover.policy?.id || '').replace(/^POL-0*/, 'v')} · ${cover.months} months`], ['Replacements so far', String(cover.replacements)]]} />
      </Card>
      <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}>
        <View style={{ flex: 1, borderRadius: 9, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: T.terminalSoft, borderWidth: 1, borderColor: '#F0C7BC' }}>
          <Ic n="x" color="#8C2612" /><X s={12} w={7} c="#8C2612" style={{ marginBottom: 5 }}>Not what happens</X><X s={13} lh={1.35} c="#8C2612">New battery gets a fresh {cover.months} months from today, ending {fresh}.</X></View>
        <View style={{ flex: 1, borderRadius: 9, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: T.liveSoft, borderWidth: 1, borderColor: '#B8DFCB' }}>
          <Ic n="check" color="#0F5537" /><X s={12} w={7} c="#0F5537" style={{ marginBottom: 5 }}>What happens</X><X s={13} lh={1.35} c="#0F5537">New battery keeps the original dates. Cover ends {dLong(cover.expiry)}, as it always would have.</X></View>
      </View>
      {cover.status === 'Expired'
        ? <Banner tone="bad" icon="alert" style={{ marginTop: 13 }}><B>Cover ended on {dLong(cover.expiry)}.</B> Head office must approve an override before this replacement can be sent.</Banner>
        : <Banner tone="warn" icon="shield" style={{ marginTop: 13 }}><B>A replacement never extends cover.</B> The end date belongs to the first sale in the chain, not to the battery in your hand. It is the same for the second replacement and the tenth.</Banner>}
      <SecT title="Before you continue" />
      <Card style={{ flexDirection: 'row', gap: 11, alignItems: 'center', borderColor: '#B8DFCB' }} label="Record that the customer was told" onPress={() => { upd({ coverTold: new Date().toISOString() }); d.toast(`Noted on the entry: customer told the cover ends ${dLong(cover.expiry)}.`); }}>
        <Avatar n="check" tone={e.coverTold ? 'green' : 'mute'} />
        <View style={{ flex: 1 }}><X s={14.5} w={6}>I told the customer cover ends {dLong(cover.expiry)}</X>
          <X s={12.5} c={T.slate} style={{ marginTop: 2 }}>{e.coverTold ? `Recorded at ${tShort(e.coverTold)} — this line goes on the entry` : 'Tap to record it — this line goes on the entry and settles arguments later'}</X></View></Card>
    </> : <Banner tone="warn" icon="alert"><B>No cover dates on record for this battery.</B> Head office will look up the first sale and set the dates. Nothing is guessed, and a replacement never starts a new term.</Banner>}
    <Hint icon="lock" style={{ marginTop: 11 }}>There is no field anywhere in this app where an end date can be typed. It is always worked out from the policy and the first sale.</Hint>
    <Btn kind="primary" big icon="check" label="Next: send for approval" style={{ marginTop: 13 }} onPress={() => d.go('d16')} />
    <Btn kind="ghost" icon="cam" label="Add photos before sending" style={{ marginTop: 9 }} onPress={() => d.go('d15')} />
  </Screen>;
}

/* d15 · photos, location and signature */
export function D15() {
  const { f, d, upd } = useFlow();
  const [locating, setLocating] = useState(false);
  const tried = useRef(false);
  const addLocation = async () => {
    setLocating(true); const r = await locate(); setLocating(false);
    if (r.gps) d.setFlow(x => x && { ...x, entry: { ...x.entry, gps: r.gps } });
    else if (tried.current) d.toast(r.error === 'declined' ? 'Location declined. The entry still saves without it.' : 'Location is not available right now. The entry still saves.');
    tried.current = true;
  };
  useEffect(() => { if (f && !f.entry.gps && !tried.current) addLocation(); }, []);
  if (!f) return null;
  const e = f.entry, i = f.cur, rep = e.type === 'Replacement';
  const tiles = rep ? ['Old battery', 'New label', 'New battery', 'Fitted in vehicle'] : ['Returned battery', 'Label', 'Condition', 'Other'];
  const g = parseGps(e.gps);
  return <Screen top={<AppBar title="Photos and proof" back={rep ? 'd31' : 'd13'} right={<Chip tone="mute" label="Step 3 of 3" />} />}>
    <Banner tone="info" icon="cam" style={{ marginBottom: 13 }}>{rep ? 'Photos settle warranty arguments later. For a replacement, the old battery and the new label are required.' : 'Photos settle arguments later. Add the returned battery and its label.'}</Banner>
    {[0, 2].map(r => <View key={r} style={{ flexDirection: 'row', gap: 9, marginTop: r ? 9 : 0 }}>{tiles.slice(r, r + 2).map(t => {
      const tag = tagFor(t, i), uri = photoOf(e, tag);
      return <Photo key={t} label={uri ? `${t} ✓` : t} uri={uri} onPress={async () => { const u = await takePhoto(d.toast); if (u) upd(withPhoto(e, tag, u)); }} />;
    })}</View>)}
    {e.items.length > 1 && <Hint icon="batt">Photos for item {i + 1} of {e.items.length}.</Hint>}
    <SecT title="Location" />
    <Card>
      <Line last onPress={addLocation} label="Add location" av={<Avatar n="pin" tone={g ? 'green' : 'mute'} />}
        title={g ? (g.place || g.coords) : locating ? 'Finding your location…' : 'Add location'}
        sub={g ? `Accuracy ${g.accuracy} · captured ${tShort(g.at)}` : 'Tap to attach where this was recorded'}
        right={g ? <Chip tone="live" icon="check" label="On" /> : <Chip tone="mute" label="Off" />} />
      <Hint icon="shield">If you refuse location, the entry still saves. Nothing else is blocked.</Hint>
    </Card>
    <SecT title="Signature" />
    <Card>
      <SignaturePad value={e.signature} onChange={v => upd({ signature: v || undefined })} />
      <Hint icon="pen" style={{ marginTop: 9 }}>Customer acknowledgement — {e.customer || 'the customer'}. This records handover; it is not a legal e-signature.</Hint>
    </Card>
    <Btn kind="primary" iconAfter="chev" label="Next: check and send" style={{ marginTop: 13 }} onPress={() => d.go('d16')} />
  </Screen>;
}

/* d16 · review & send */
export function D16() {
  const { f, d } = useFlow(); const { state, setState, audit, dealerId } = useStore();
  if (!f) return null;
  const e = f.entry, rep = e.type === 'Replacement', dealer = state.dealers.find(x => x.id === dealerId)!;
  const errs = dealerErrors(e, state), errList = Object.entries(errs), warns = dealerWarnings(e, state);
  const jump = (key: string) => {
    const m = /^(items|photos)\.(\d+)\.?(\w*)/.exec(key); const i = m ? Number(m[2]) : 0;
    d.setFlow(x => x && { ...x, cur: Math.min(i, x.entry.items.length - 1) });
    if (m?.[1] === 'photos') d.go('d15');
    else if (['oldSerial', 'fault', 'customer'].includes(m?.[3] || '') && rep) d.go('d11');
    else if (m?.[1] === 'items') d.go('d13');
    else d.toast(errs[key] || 'Check this entry.');
  };
  const send = () => {
    if (errList.length) { jump(errList[0][0]); return; }
    const now = new Date().toISOString();
    const data: Entry = { ...e, status: state.offline ? 'Pending sync' : 'Submitted', createdAt: now, date: today(), items: e.items.map(it => ({ ...it, wr: it.oldSerial || it.wr })),
      handover: rep ? `Given to ${e.customer || 'the customer'} at the counter · ${dLong(now)}, ${tShort(now)}` : e.handover };
    setState(s => audit({ ...s, entries: [data, ...s.entries.filter(x => x.id !== data.id)] }, 'Entry submitted', data.id, state.offline ? 'Saved on the dealer phone to send later' : 'Sent from the dealer app'));
    d.setFlow(null); d.go('d17', data.id);
  };
  return <Screen top={<AppBar title="Check before sending" back="d12" />}>
    <Steps labels={rep ? REP_STEPS : RET_STEPS} now={3} />
    <Gap h={13} />
    {errList.length > 0 && <Banner tone="bad" icon="alert" style={{ marginBottom: 12 }}><B>{errList.length === 1 ? 'One thing must be fixed.' : `${errList.length} things must be fixed.`}</B> {errList[0][1]} <B u onPress={() => jump(errList[0][0])}>Go to the field</B></Banner>}
    {warns.length > 0 && <Banner tone="warn" icon="alert" style={{ marginBottom: 12 }}><B>{warns.length === 1 ? 'One thing to look at.' : `${warns.length} things to look at.`}</B> {warns[0].text} Not blocked — confirm it is correct. <B u onPress={() => jump(warns[0].key)}>Go to the field</B></Banner>}
    <Card><CardH title="Entry" right={<Chip tone="mute" mono label={e.id} />} />
      <KV pairs={[['Type', e.type], ['Date', dLong(today())], ['Shop', dealer.name], ['City / place', `${dealer.city} · ${e.place}`], ['Customer', e.customer || '—'], ['Items', `${e.items.length} ${e.items.length === 1 ? 'battery' : 'batteries'}`]]} /></Card>
    {e.items.map((it, i) => {
      const cover = rep ? coverOf(findBattery(state, it.oldSerial), state) : null;
      return <React.Fragment key={it.id}>
        <Card style={{ marginTop: 11 }}>
          <CardH title={`Item ${i + 1}`} right={!rep ? <Chip tone="info" icon="truck" label="Returned" /> : !cover ? <Chip tone="warn" icon="eye" label="Not on record" /> : cover.status === 'Expired' ? <Chip tone="bad" icon="clock" label="Cover ended" /> : <StatusChip status="Active" label="Warranty continues" />} />
          <Plate style={{ marginBottom: 11 }}>{rep ? <>
            <PlateLab>OLD BATTERY OUT</PlateLab><PlateVal>{it.oldSerial || '—'}</PlateVal>
            <X s={19} c={T.volt} style={{ textAlign: 'center', marginVertical: 5 }}>↓</X>
            <PlateLab>NEW BATTERY IN</PlateLab><PlateVal color="#7FD3A9">{it.code || '—'}</PlateVal></> : <><PlateLab>RETURNED BATTERY</PlateLab><PlateVal>{it.code || '—'}</PlateVal></>}</Plate>
          <KV pairs={[['Model', it.model], ['Mfg month', monthShort(it.mfg)], ['Quantity', '1'], [rep ? 'Cover ends' : 'Reason', rep ? (cover ? dLong(cover.expiry) : 'Set by head office') : (it.remarks || '—')], ['Photos', `${photoCount(e, i)} attached`], ['Signature', e.signature ? 'Captured' : 'Not captured']]} />
        </Card>
        {cover && cover.status !== 'Expired' && <Banner tone="warn" icon="shield" style={{ marginTop: 12 }}><B>Warranty carried over, not restarted.</B> This battery is covered until {dLong(cover.expiry)} — the date the first battery in the chain got. {spanLong(cover.leftSpan)} remain. No new {cover.months}-month period is created.</Banner>}
      </React.Fragment>;
    })}
    <Card style={{ backgroundColor: T.ink, borderColor: '#000', marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <X s={13} c="#9BA9BB">Total batteries</X><X s={19} w={7} c={T.white}>{e.items.length}</X></Card>
    <Btn kind="primary" big icon="check" label={state.offline ? 'Save and send later' : 'Send entry'} style={{ marginTop: 13 }} onPress={send} />
    <Hint icon="lock" center style={{ marginTop: 9 }}>{rep ? 'The customer takes the battery today. Head office confirms the claim afterwards.' : 'Head office confirms the return afterwards.'}</Hint>
  </Screen>;
}

/* d17 · recorded and sent */
export function D17({ p }: { p?: string }) {
  const d = useD(); const { state } = useStore();
  const e = state.entries.find(x => x.id === p);
  if (!e) return <Screen top={<AppBar title="Entry" back="d07" />}><X c={T.slate}>This entry could not be found.</X></Screen>;
  const rep = e.type === 'Replacement', queued = e.status === 'Pending sync';
  const cover = rep ? coverOf(findBattery(state, e.items[0]?.oldSerial || ''), state) : null;
  const list = (k: 'oldSerial' | 'code') => e.items.map(it => it[k]).filter(Boolean).join(', ') || '—';
  return <Screen top={<View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingHorizontal: 15, paddingBottom: 13, backgroundColor: T.zinc, borderBottomWidth: 1, borderBottomColor: T.zinc2 }}>
    <View style={{ flex: 1 }} /><IconBtn n="x" label="Close" onPress={() => d.tab('d07')} /></View>}>
    <BigOk n={queued ? 'cloud' : 'check'} bg={queued ? T.volt : T.live} />
    <X s={22} w={7} f="c" style={{ textAlign: 'center', marginBottom: 5 }}>{queued ? 'Saved on this phone' : 'Recorded and sent'}</X>
    <X s={15} c={T.slate} style={{ textAlign: 'center', marginBottom: 16 }}>{rep ? (queued ? 'It sends by itself when signal returns. Give the new battery to the customer now.' : 'Give the new battery to the customer now. Head office confirms the claim afterwards — the customer does not wait.') : (queued ? 'It sends by itself when signal returns.' : 'Head office confirms the return afterwards.')}</X>
    <Plate><PlateLab center>REQUEST NUMBER</PlateLab><PlateVal size={22} center>{e.id}</PlateVal></Plate>
    <Card style={{ marginTop: 12 }}><KV pairs={rep
      ? [['Old battery', list('oldSerial'), 'mono'], ['New battery', list('code'), 'mono'], ['Cover ends', cover ? dLong(cover.expiry) : 'Set by head office'], ['Remaining', cover ? spanShort(cover.leftSpan) : '—'], [queued ? 'Saved' : 'Sent', tShort(e.createdAt)], ['Claim decided', 'After the battery is checked']]
      : [['Returned battery', list('code'), 'mono'], ['Model', e.items.map(it => it.model).join(', ')], [queued ? 'Saved' : 'Sent', tShort(e.createdAt)], ['Decision', 'By head office']]} /></Card>
    {rep && <Banner tone="warn" icon="shop" style={{ marginTop: 12 }}><B>Keep the old battery in your shop.</B> Hand it over at the next pickup — the claim cannot be settled until the company has checked it.</Banner>}
    <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}>
      <View style={{ flex: 1 }}><Btn kind="ghost" label="Back to home" onPress={() => d.tab('d07')} /></View>
      <View style={{ flex: 1 }}><Btn kind="blue" icon="check" label="Decision" onPress={() => d.go('d32', e.id)} /></View>
    </View>
    <Btn kind="primary" icon="plus" label="Record another" style={{ marginTop: 9 }} onPress={() => { d.setFlow(null); d.go('d10'); }} />
  </Screen>;
}
