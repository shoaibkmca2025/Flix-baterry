import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useStore } from '@felix/shared/store';
import { Entry, Item, State, DEFAULT_DIGIT_LENGTHS, FAULTS, NEW_BATTERY_DIGIT_LENGTHS, anyDigitLengths, deriveCode, digitsOf, expiryFrom, fullCode, isValidDigits, lengthsLabel, newEntry, newItem, normalize, sameBattery, splitLabel, today, validateEntry, ReturnKind, RETURN_KINDS, RETURN_KIND_HELP } from '@felix/shared/domain';
import { T } from '@felix/shared/ui/theme';
import { X, B, Ic, Btn, Card, CardH, Chip, StatusChip, Field, Label, Hint, Banner, Steps, KV, SecT, Line, Avatar, BigOk, BigTile, ChipRow, CapBtn, IconBtn, Plate, PlateLab, PlateVal, Meter, Gap } from '@felix/shared/ui/kit';
import { Screen, AppBar, Sheet, useD, useAbove } from './shell';
import { PickList } from '@felix/shared/ui/pick';
import { Photo, SignaturePad, locate, parseGps, takePhoto } from '@felix/shared/ui/media';
import { coverChip, dLong, entryErrors, findBattery, monYear, monthLong, monthShort, needsNewBatteryPhoto, newPhotoTag, nextEntryId, roleOf, span, spanLong, spanShort, tShort, salesReturnsOf, dShort, placeOf } from '@felix/shared/data';
import { useAccessToken } from '@felix/shared/api/session';
import { lookupBattery, type BatteryLookupResult } from '@felix/shared/api/batteries';
import { createEntry } from '@felix/shared/api/entries';
import { buildEntryBody } from '@felix/shared/api/entry-body';
import { uploadEntryPhotos } from '@felix/shared/api/photos';
import { ApiError } from '@felix/shared/api/client';
import { useSync } from '@felix/shared/api/sync';

const REP_STEPS = ['1 · Old battery', '2 · New battery', '3 · Check'];
const RET_STEPS = ['1 · Battery', '2 · Photos', '3 · Check'];
// FAULTS now comes from shared/domain, beside the code it is stored as — see the note there.
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

/**
 * The shared checks (shared/data.ts entryErrors — head office's "Record an entry" runs the same
 * ones) plus the one that is the dealer app's alone: a replacement cannot go ahead without a
 * photo of the new battery, which only exists on this device until the request is sent.
 */
function dealerErrors(e: Entry, state: State): Record<string, string> {
  const errs = entryErrors(e, state);
  if (e.type === 'Replacement') {
    e.items.forEach((_, i) => {
      if (needsNewBatteryPhoto(e, i)) errs[`items.${i}.newPhoto`] = 'Take a photo of the new battery. The replacement cannot go ahead without it.';
    });
  }
  return errs;
}
const itemErrors = (errs: Record<string, string>, i: number, fields: string[]) => Object.fromEntries(fields.filter(f => errs[`items.${i}.${f}`]).map(f => [f, errs[`items.${i}.${f}`]]));

function dealerWarnings(e: Entry, state: State): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const lengths = anyDigitLengths(state.serialDigitLengths ?? DEFAULT_DIGIT_LENGTHS); // any form we have issued
  const month = today().slice(0, 7);
  // the dealer's other batteries this month, as digits under their own model
  const recent = state.entries.filter(x => x.id !== e.id && x.status !== 'Draft' && x.date.startsWith(month)).flatMap(x => x.items.map(y => ({ model: y.model, digits: digitsOf(y.code, y.model) })));
  e.items.forEach((it, i) => {
    if (isValidDigits(it.code, lengths)) { const near = recent.find(c => c.model === it.model && c.digits.length === it.code.length && Math.abs(Number(c.digits) - Number(it.code)) === 1); if (near) out.push({ key: `items.${i}.code`, text: `Serial ${it.code} is close to ${it.model} ${near.digits} already recorded this month.` }); }
    // No "old battery not on record" warning: most old batteries were sold before this system,
    // so being off record is normal — the cover is read from the label (D-11; client, 2 Oct 2026).
    // No "no photo of the old battery" warning either: only the NEW battery's photo is required
    // (client, 2 Oct 2026). The old battery goes back to head office to be opened and checked, so
    // a photo of it proves nothing a dealer should be chased for — the tile is still there for
    // anyone who wants to attach one.
  });
  if (e.type !== 'Replacement' && !e.customer.trim()) out.push({ key: 'items.0.customer', text: 'No customer name is on this entry.' });
  return out;
}

// Local numbers of drafts sent successfully — or deleted — this session. The leave-screen safety
// net below must never bring one back: a sent draft's server copy replaced it under a new number,
// so looking the draft up by its old number finds nothing and would re-save it as a Draft; a
// deleted one is simply gone.
const SENT = new Set<string>();

/** Only what head office has never seen can be deleted: a draft, or an entry saved on the phone and not yet sent. */
export const NOT_SENT: Entry['status'][] = ['Draft', 'Pending sync'];

/**
 * "Delete this entry" and its confirmation sheet. The entry only ever lived on this phone, so
 * deleting it touches nothing on the server. `then` is where the dealer lands afterwards.
 */
export function useDeleteEntry(e: Entry | undefined, then: 'd07' | 'd18') {
  const d = useD(); const { setState } = useStore();
  const { above, Above } = useAbove();
  const [ask, setAsk] = useState(false);
  if (!e) return { button: null, sheet: null };
  const remove = () => {
    SENT.add(e.id);
    setState(s => ({ ...s, entries: s.entries.filter(x => !(x.id === e.id && NOT_SENT.includes(x.status))) }));
    setAsk(false); d.tab(then); d.setFlow(null);
    d.toast(`${e.id} deleted. It was never sent to ${above}.`);
  };
  return {
    // Throwing the request away sat directly under "Next", one mis-tap apart. HIG puts roughly
    // 12pt of padding around a bezelled control and warns that spacing matters as much as size;
    // a destructive action next to the primary one needs more than that, so it gets a rule above
    // it and clear air (client, 3 Oct 2026).
    button: <View style={{ marginTop: 22, paddingTop: 16, borderTopWidth: 1, borderTopColor: T.zinc2 }}>
      <Btn kind="ghost" icon="x" label="Delete this entry" color={T.terminal} borderColor="#F0C7BC" onPress={() => setAsk(true)} />
    </View>,
    sheet: <Sheet open={ask} title="Delete this entry?" onClose={() => setAsk(false)}>
      <X s={14} c={T.slate} style={{ marginBottom: 14 }}><B>{e.id}</B> was never sent to {above}, so nothing else changes. This cannot be undone.</X>
      <Btn kind="danger" icon="x" label="Delete entry" onPress={remove} />
      <Btn kind="ghost" label="Keep it" style={{ marginTop: 9 }} onPress={() => setAsk(false)} />
    </Sheet>,
  };
}

function useFlow() {
  const d = useD(); const { setState } = useStore();
  const f = d.flow;
  useEffect(() => { if (!f) d.tab('d10'); }, [f]);
  const upd = (v: Partial<Entry>) => d.setFlow(x => x && { ...x, entry: { ...x.entry, ...v } });
  const item = (v: Partial<Item>, i?: number) => d.setFlow(x => x && { ...x, entry: { ...x.entry, items: x.entry.items.map((it, j) => j === (i ?? x.cur) ? { ...it, ...v } : it) } });
  const saveDraft = () => { if (f) setState(s => ({ ...s, entries: [{ ...f.entry, status: 'Draft' }, ...s.entries.filter(e => e.id !== f.entry.id)] })); };

  /**
   * Whatever is on screen is kept as a draft the moment the dealer leaves it — Back, a bottom
   * tab, or the phone going away mid-sentence. Nobody should have to finish an entry in one
   * sitting just because a serial is wrong (the client's own instruction, 25 Sep 2026): a
   * half-finished request waits in My requests instead of trapping them on the page.
   * An entry that has already been sent is never pulled back to Draft.
   */
  const latest = useRef(f);
  latest.current = f;
  useEffect(() => () => {
    const cur = latest.current;
    if (!cur || SENT.has(cur.entry.id)) return;
    setState(s => {
      const already = s.entries.find(e => e.id === cur.entry.id);
      if (already && already.status !== 'Draft') return s;
      return { ...s, entries: [{ ...cur.entry, status: 'Draft' as const }, ...s.entries.filter(e => e.id !== cur.entry.id)] };
    });
  }, []);

  return { f, d, upd, item, saveDraft };
}

/** Live warranty/custody check against the real backend (architecture.md §9.9), replacing
 * the local demo store's `findBattery`/`coverOf` wherever a dealer needs the truth about a
 * battery that might have been sold/replaced by anyone, not just recorded on this phone. */
function useLiveLookup(code: string, token: string | null, modelId?: string, lengths: readonly number[] = anyDigitLengths()) {
  const [result, setResult] = useState<BatteryLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!token || !isValidDigits(code, lengths)) { setResult(null); return; }
    let alive = true;
    setLoading(true);
    lookupBattery(code, token, modelId || undefined)
      .then(r => { if (alive) setResult(r); })
      .catch(() => { if (alive) setResult(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code, token, modelId, lengths.join()]);
  return { lookup: result, looking: loading };
}
/** status label matching data.ts's warranty() shape, but from live backend cover fields. */
function coverStatus(cover: { inWarranty: boolean; daysRemaining: number }): 'Active' | 'Expiring soon' | 'Expired' {
  return !cover.inWarranty ? 'Expired' : cover.daysRemaining <= 30 ? 'Expiring soon' : 'Active';
}

/** The battery's full number as printed on its label: code (plates) + model + its digits,
 * e.g. "M 1000 2609 0676" or "GP M 1000 2609 0676" (D-13 — the digits alone are not unique). */
function printedNumber(m: { plate?: string; modelNo?: string; brand?: string; id: string } | undefined, digits: string): string {
  // YYMM, a space, then the serial — the way it is printed, at whatever length (7, 8 or 9)
  const d = digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
  if (!m) return d;
  const head = m.plate && m.modelNo ? `${m.brand === 'gold_power' ? 'GP ' : ''}${m.plate} ${m.modelNo}` : m.id;
  return `${head} ${d}`.trim();
}

/* ---------- model → code picker (D-12: the label reads code + model, e.g. "M 1000") ----------
 * The model number first, then only the codes (plates) that model is made in, so a dealer never
 * scrolls the whole catalogue and cannot pick a pair Felix does not make. The full number is still
 * printed code first, exactly as on the label ("M 1000 2609 0676"). */
type Mdl = State['models'][number];
const printedPlate = (m: Mdl) => `${m.brand === 'gold_power' ? 'GP ' : ''}${m.plate}`; // 'M', or 'GP M' for the Gold Power (red) case
const modelOrder = (a: Mdl, b: Mdl) => (Number(a.modelNo) || 9e9) - (Number(b.modelNo) || 9e9) || (a.modelNo ?? '').localeCompare(b.modelNo ?? '');
function PlateModelPicker({ value, onChange, error, label = 'Battery' }: { value: string; onChange: (id: string) => void; error?: string; label?: string }) {
  const { state } = useStore();
  const { above, Above } = useAbove();
  const [open, setOpen] = useState<'model' | 'code' | null>(null);
  const active = state.models.filter(m => m.active && m.plate && m.modelNo);
  const cur = state.models.find(m => m.id === value);
  const [modelNo, setModelNo] = useState(cur?.modelNo ?? '');
  // a scanned label (or a battery found on record) sets the model directly — follow it
  useEffect(() => { if (cur?.modelNo) setModelNo(cur.modelNo); }, [value]);

  const rank = new Map((state.plateTypes ?? []).map((p, k) => [p.code, k]));
  const codeOrder = (a: Mdl, b: Mdl) => (rank.get(a.plate!) ?? 999) - (rank.get(b.plate!) ?? 999) || a.plate!.localeCompare(b.plate!) || Number(a.brand === 'gold_power') - Number(b.brand === 'gold_power');
  const modelNos = [...new Set([...active].sort(modelOrder).map(m => m.modelNo!))];
  const codesOf = (n: string) => active.filter(m => m.modelNo === n).sort(codeOrder);
  const forModel = codesOf(modelNo);
  const modelSub = (n: string) => { const cs = codesOf(n); return cs.length === 1 ? `code ${printedPlate(cs[0]!)} · ${cs[0]!.months} months cover` : `${cs.length} codes · ${cs.map(printedPlate).join(', ')}`; };
  const codeSub = (m: Mdl) => `${m.plateCount ? `${m.plateCount} plates` : 'Tubular series'}${m.brand === 'gold_power' ? ' · Gold Power' : ''} · ${m.months} months cover${m.capacity ? ` · ${m.capacity}` : ''}`;
  const pickModel = (n: string) => {
    setModelNo(n);
    const cs = codesOf(n);
    if (cs.length === 1) { onChange(cs[0]!.id); setOpen(null); return; }   // only one code: nothing to ask
    if (!cur || cur.modelNo !== n) onChange('');                             // the old code is not made in this model
    setOpen('code');
  };

  if (!active.length) return <Banner tone="bad" icon="alert" style={{ marginBottom: 13 }}>
    The models and codes list has not loaded yet. Go back and tap Sync now. If it stays empty, the server needs updating — call {above}.
  </Banner>;

  const chosenCode = cur && cur.modelNo === modelNo ? printedPlate(cur) : '';
  return <>
    <Sheet open={open === 'model'} title="Model" onClose={() => setOpen(null)}>
      <PickList search="Search models — 1000, DIN, 60L…" options={modelNos.map(n => ({ v: n, sub: modelSub(n) }))} value={modelNo} onPick={pickModel} /></Sheet>
    <Sheet open={open === 'code'} title={modelNo ? `Codes for model ${modelNo}` : 'Code'} onClose={() => setOpen(null)}>
      <PickList search={forModel.length > 4 ? 'Search codes' : undefined} options={forModel.map(m => ({ v: printedPlate(m), sub: codeSub(m) }))} value={chosenCode}
        onPick={v => { const picked = forModel.find(m => printedPlate(m) === v); if (picked) onChange(picked.id); setOpen(null); }} /></Sheet>
    <Field select label={`${label} model`} req mr="मॉडेल" value={modelNo} ph="Choose the model (1000, 1500…)" onPress={() => setOpen('model')} error={modelNo ? undefined : error} />
    <Field select label={`${label} code`} req mr="कोड" value={chosenCode} ph={modelNo ? `Choose from ${forModel.length} code${forModel.length === 1 ? '' : 's'}` : 'Choose the model first'}
      readonly={!modelNo} onPress={modelNo ? () => setOpen('code') : undefined} error={modelNo ? error : undefined}
      hint={chosenCode && !error ? codeSub(cur!) : undefined} hintIcon="batt" />
    {cur && !error && <Hint icon="shield" tone="ok" style={{ marginTop: -9, marginBottom: 13 }}>{printedPlate(cur)} {cur.modelNo} · {cur.months} months cover{state.graceMonths ? ` + ${state.graceMonths} grace` : ''}</Hint>}
  </>;
}

/**
 * The number as it is printed on the battery — the plates and model the dealer picked, joined
 * to the digits they typed. Shown so they can read it back against the sticker before sending,
 * because this combination IS the battery's identity (memory.md D-13): the digits repeat
 * across products, so the same four digits under the wrong model is a different battery.
 */
function FullCodeLine({ modelId, code, lengths }: { modelId?: string; code: string; lengths: readonly number[] }) {
  const { state } = useStore();
  const model = state.models.find(m => m.id === modelId);
  if (!model || !isValidDigits(code, lengths)) return null;
  const printed = `${printedPlate(model)} ${model.modelNo} ${code.slice(0, 4)} ${code.slice(4)}`;
  return <View accessible accessibilityLabel={`Full number on the battery: ${printed}. Check it reads the same as the label.`}>
    <Plate style={{ marginBottom: 13 }}>
      <PlateLab>Full number on the battery · पूर्ण नंबर</PlateLab>
      <PlateVal size={21}>{printed}</PlateVal>
      <X s={12} c={T.deepText} style={{ marginTop: 5 }}>Check this reads the same as the label before you send it.</X>
    </Plate>
  </View>;
}

/* ---------- scanner ---------- */
/** A dark pill behind text that sits on a photo, so a bright label does not swallow it. */
const OnPhoto = ({ children, top, bottom }: { children: React.ReactNode; top?: number; bottom?: number }) =>
  <View style={{ position: 'absolute', top, bottom, maxWidth: '88%', backgroundColor: 'rgba(12,16,22,0.72)', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 }}>{children}</View>;

function ScanBox({ code, active, onCode, photo, photoLabel = 'Photo you took', height = 212, label = 'Hold the label inside the box' }: { code?: string; active: boolean; onCode: (c: string) => void; photo?: string; photoLabel?: string; height?: number; label?: string }) {
  const fired = useRef(false);
  useEffect(() => { if (active) fired.current = false; }, [active]);
  // Once the photo is taken it fills this box whenever the camera is not running. It is the proof
  // the dealer is about to send, and the number below is meant to be checked against it — so it
  // belongs on screen next to that number, not behind a button. The scanner frame and its laser
  // are hidden while it shows: there is nothing to line up, and leaving them on top reads as a
  // live camera. Starting the camera again puts the scanner back (CameraView covers the photo).
  const showPhoto = !!photo && !active;
  // "contain", not "cover": the dealer is checking the serial in this photo against the number
  // they typed below, so the whole label has to be visible — a crop can cut the serial off the
  // top or bottom. Letterboxing is invisible anyway, the box behind it is already this dark.
  // It also gets a taller box, because a portrait photo shown whole is narrow.
  const boxHeight = showPhoto ? Math.max(height, 270) : height;
  return <View style={{ backgroundColor: T.ink, borderRadius: 12, height: boxHeight, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {showPhoto && <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="contain" accessible accessibilityLabel={photoLabel} />}
    {active && <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc_a', 'datamatrix'] }}
      onBarcodeScanned={({ data }) => { if (fired.current) return; fired.current = true; onCode(data); }} />}
    {!!code && (showPhoto
      ? <OnPhoto top={12}><X s={13} f="m" w={5} c={T.white} numberOfLines={1}>{code}</X></OnPhoto>
      : <X s={13} f="m" w={5} c={T.white} style={{ position: 'absolute', top: 14 }}>{code}</X>)}
    {!showPhoto && <View style={{ width: 196, height: height < 180 ? 84 : 118, borderWidth: 3, borderColor: T.volt, borderRadius: 8 }}>
      <View style={{ position: 'absolute', left: 8, right: 8, top: '50%', height: 2, backgroundColor: T.terminal, shadowColor: T.terminal, shadowOpacity: 1, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } }} /></View>}
    {showPhoto
      ? <OnPhoto bottom={10}><X s={12.5} w={6} c={T.white} numberOfLines={1}>{photoLabel}</X></OnPhoto>
      : <X s={12.5} c="#A8B6C7" style={{ position: 'absolute', bottom: 12 }}>{label}</X>}
  </View>;
}
function useScanner(onCode: (code: string) => void) {
  const d = useD(); const [perm, request] = useCameraPermissions(); const [active, setActive] = useState(false);
  const start = async () => {
    if (active) { setActive(false); return; }
    try { const ok = perm?.granted || (await request()).granted; if (!ok) { d.toast('Camera access declined. Type the serial instead — that is always allowed.'); return; } setActive(true); }
    catch { d.toast('The camera is not available here. Type the serial instead.'); }
  };
  // the label is handed over exactly as printed — "M 1000 2609 0676" — and read by readLabel,
  // which knows every plate prefix and every length. Nothing is trimmed on the way (client, 4 Oct 2026).
  const handle = (data: string) => { setActive(false); onCode(data); };
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
    <Field label="Or type what is on the label" mono value={manual} onChange={setManual} ph="M 1000 2609 0676, or just the digits" caps />
    <Btn kind="primary" icon="check" label="Use this number" disabled={!manual.trim()} onPress={() => { onCode(manual.trim()); onClose(); }} />
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
  // A sales return says which kind it is before anything else is asked: the answer changes
  // nothing else on the form, but head office and the distributor sort by it (client, 3 Oct 2026).
  const [kind, setKind] = useState(false);
  const start = (type: string, returnKind?: ReturnKind) => {
    d.setFlow({ entry: { ...newEntry(dealerId, type), id: nextEntryId(state, type), place: placeOf(dealer), returnKind }, cur: 0, scanned: {} });
    d.go(type === 'Replacement' ? 'd11' : 'd13');
  };
  return <Screen top={<AppBar title="What are you recording?" back="d07" />} overlay={
    <Sheet open={kind} title="Why is it coming back?" onClose={() => setKind(false)}>
      <X s={14} c={T.slate} style={{ marginBottom: 13 }}>Both go back to the company and come home working, with the same serial number. This only says which it is.</X>
      {RETURN_KINDS.map((k, i) => <BigTile key={k} icon={k === 'Unsold' ? 'box' : 'alert'} title={k} sub={k === 'Unsold' ? 'न विकलेली' : 'बिघडलेली'}
        desc={RETURN_KIND_HELP[k]} hot={i === 0} onPress={() => { setKind(false); start('Sales Return', k); }} />)}
    </Sheet>}>
    <Banner tone="info" icon="alert" style={{ marginBottom: 15 }}>Choose one. The next screen then asks only for what that choice needs — nothing extra.</Banner>
    {TYPES.map(t => <BigTile key={t[0]} icon={t[2]} title={t[0]} sub={t[1]} desc={t[4]} hot={t[3]}
      onPress={() => (t[0] === 'Sales Return' ? setKind(true) : start(t[0]))} />)}
    <Hint icon="lock" style={{ marginTop: 4 }}>These are the only two. Head office records the same two, so what you send and what they see are the same thing.</Hint>
  </Screen>;
}

/** Everything the dealer should know about the old battery once its serial is typed or scanned
 * (memory.md D-03): manufacture month from the code's YYMM, model/type/capacity, when it was
 * bought (the chain's original sale), when it was itself installed as a replacement, how many
 * replacements the chain has had, its current state, and the cover dates. */
const STATE_LABEL: Record<string, string> = { available: 'In stock', allocated: 'Allocated', sold: 'With customer', returned: 'Returned', replacement: 'Given as replacement', repair: 'Under repair', damaged: 'Damaged', scrap: 'Scrapped' };
const DEFAULT_TERM = 24, DEFAULT_GRACE = 2; // the server's defaults (backend domain/warranty.ts) when no model is chosen yet
const leftText = (expiry: string) => { const days = Math.ceil((Date.parse(expiry) - Date.parse(today())) / 86_400_000); return days >= 0 ? `${spanLong(span(today(), expiry))} left` : `Expired ${-days} day${days === -1 ? '' : 's'} ago`; };
/**
 * A battery past its term makes the request a SPECIAL one (client, 3 Oct 2026): the customer still
 * gets the new battery at the counter, but the distributor and then head office must approve it,
 * and the old battery waits until head office has. A battery that was itself given with no
 * warranty cannot be replaced at all.
 */
function SpecialNotice({ cover, style }: { cover: BatteryLookupResult['cover']; style?: object }) {
  const { isDealer } = useAbove();
  // kept to a headline and one line — a long warning is not read at the counter (client, 3 Oct 2026)
  if (cover.noWarranty) return <Banner tone="bad" icon="lock" style={style}><B>No warranty on this battery.</B> It cannot be replaced.</Banner>;
  if (!cover.coverCase || cover.coverCase === 'normal') return null;
  const over = cover.daysOver ?? 0, ext = cover.coverCase === 'extension';
  return <Banner tone="warn" icon="alert" style={style}>
    <B>Warranty exceeded by {over} {over === 1 ? 'day' : 'days'}.</B> Special request — {isDealer ? 'distributor and head office' : 'head office'} must approve. {ext ? `New battery keeps the old end date (${dLong(cover.expiryDate)}).` : 'New battery gets NO warranty.'}
  </Banner>;
}
/** "Warranty left" headline + meter: start → expiry, with how much of the term is used. */
function WarrantyLeft({ start, expiry, from, months = DEFAULT_TERM, grace = DEFAULT_GRACE }: { start: string; expiry: string; from: string; months?: number; grace?: number }) {
  const total = Math.max(1, Date.parse(expiry) - Date.parse(start)), used = (Date.parse(today()) - Date.parse(start)) / total;
  const ok = Date.parse(expiry) >= Date.parse(today());
  return <View style={{ marginTop: 12 }}>
    <X s={11.5} w={6} c={T.slate}>Warranty left · {from}</X>
    <X s={19} w={7} c={ok ? '#12603C' : '#992A15'} style={{ marginTop: 2, marginBottom: 8 }}>{leftText(expiry)}</X>
    <Meter used={used} labels={[dLong(start), grace ? `${months} + ${grace} months` : `${months} months`, dLong(expiry)]} />
  </View>;
}
function OldBatteryInfo({ code, lookup, looking, token, fallbackModel }: { code: string; lookup: BatteryLookupResult | null; looking: boolean; token: string | null; fallbackModel?: string }) {
  const { state } = useStore();
  const { above } = useAbove();
  if (!isValidDigits(code, anyDigitLengths(state.serialDigitLengths ?? DEFAULT_DIGIT_LENGTHS))) return null;
  const local = deriveCode(code, [], anyDigitLengths(state.serialDigitLengths ?? DEFAULT_DIGIT_LENGTHS));
  const mfg = (lookup?.mfgMonth) || local.mfg;
  // The rule (memory.md D-11): cover runs from the first day of the manufacture month for the
  // (plate, model)'s term plus the grace months — the same maths as the server's checkWarranty.
  const chosen = state.models.find(m => m.id === fallbackModel);
  const term = chosen?.months ?? DEFAULT_TERM, grace = state.graceMonths ?? DEFAULT_GRACE;
  // The battery's identity is its whole printed number (D-13) — shown once, full width, never split into a separate serial.
  const ident: [string, React.ReactNode, ('mono' | '')?][] = [['Manufactured', mfg ? monthLong(mfg) : 'Not a valid YYMM'], ['Model · code', chosen ? `${chosen.id} · ${chosen.months} months` : fallbackModel || 'Choose above'], ['Cover rule', `${term} + ${grace} months from manufacture`]];
  const fromMfg = mfg ? { start: `${mfg}-01`, expiry: expiryFrom(`${mfg}-01`, term + grace) } : null;

  if (!token || looking || !lookup) return <Card style={{ marginBottom: 14 }}>
    <CardH title="Checking the record…" right={<Chip tone="mute" icon="clock" label="Please wait" />} />
    <KV pairs={ident} />
    {fromMfg && <WarrantyLeft start={fromMfg.start} expiry={fromMfg.expiry} from="manufacture date" months={term} grace={grace} />}</Card>;

  if (!lookup.found) return <Card style={{ borderColor: '#EBD49C', backgroundColor: '#FFFBF1', marginBottom: 14 }}>
    <CardH title="Cover from the label" right={<Chip tone="mute" icon="batt" label="Sold before the app" />} />
    <KV pairs={[ident[0], ['Model · code', lookup.model ? `${lookup.model.id} · ${lookup.model.warrantyMonths} months` : lookup.labelModelId || fallbackModel || 'Choose above'], ['Cover rule', `${lookup.cover.termMonths} + ${lookup.cover.graceMonths} months from manufacture`], ['Cover ends', dLong(lookup.cover.expiryDate)]]} />
    {mfg && <WarrantyLeft start={lookup.cover.startDate} expiry={lookup.cover.expiryDate} from="manufacture date" months={lookup.cover.termMonths} grace={lookup.cover.graceMonths} />}
    <SpecialNotice cover={lookup.cover} style={{ marginTop: 10 }} />
    {lookup.labelModelId && lookup.labelModelId !== fallbackModel && <Hint tone="err" style={{ marginTop: 10 }}>The label says {lookup.labelModelId}, but {fallbackModel || 'nothing'} is chosen above. Check the plates and model.</Hint>}
    <Gap h={8} /><X s={13} c={T.slate}>Not sold through the app yet. Its cover is worked out from the manufacture month on the label and the model and code you chose — head office puts it on record when it approves the replacement.</X></Card>;

  const { battery, model, chain, cover, custody } = lookup;
  const status = coverStatus(cover), [chipLabel, chipTone] = coverChip(cover.noWarranty ? 'No warranty' : status);
  const modelText = fallbackModel || '—';
  const pairs: [string, React.ReactNode, ('mono' | '')?][] = [
    ident[0],
    ['Model · code', model ? `${model.id}${model.plate ? ` (${model.plate} plates, ${model.modelNo})` : ''}` : modelText],
    ['Cover rule', `${cover.termMonths} + ${cover.graceMonths} months from manufacture`],
    ['Cover', `${dLong(cover.startDate)} → ${dLong(cover.expiryDate)}`],
    ['Status', STATE_LABEL[battery.state] || battery.state],
  ];
  if (chain) pairs.push(['Replacements on this chain', chain.replacementCount === 0 ? 'None yet' : String(chain.replacementCount)]);
  if (chain && battery.isReplacement) pairs.push(['This battery installed on', chain.installedOn ? dLong(chain.installedOn) : '—']);

  if (custody === 'other') return <Card style={{ borderColor: '#F0C7BC', backgroundColor: '#FFF8F6', marginBottom: 14 }}>
    <CardH title="Held by another shop" right={<Chip tone="bad" icon="lock" label="Not yours" />} />
    <KV pairs={ident} />
    <Gap h={8} /><X s={13.5} c={T.slate}>This serial is recorded against a different shop. Check the label again, or call {above}.</X></Card>;

  const blocked = battery.alreadyReplaced ? 'This battery has already been replaced once — its replacement carries the cover now. Check the label again.' : null;
  const bad = !!blocked || !!cover.noWarranty;
  return <Card style={{ borderColor: bad ? '#F0C7BC' : '#B8DFCB', backgroundColor: bad ? '#FFF8F6' : '#F7FCF9', marginBottom: 14 }}>
    <CardH title="Found on record" right={<Chip tone={battery.alreadyReplaced ? 'bad' : chipTone} icon={battery.alreadyReplaced ? 'lock' : status === 'Active' ? 'shield' : 'clock'} label={battery.alreadyReplaced ? 'Already replaced' : chipLabel} />} />
    <KV pairs={pairs} />
    <WarrantyLeft start={cover.startDate} expiry={cover.expiryDate} from={chain && !chain.isOriginal ? "first battery's manufacture date" : 'manufacture date'} months={cover.termMonths} grace={cover.graceMonths} />
    {chain && !chain.isOriginal && <Hint icon="link" style={{ marginTop: 10 }}>This is a replacement battery. Its cover runs from the FIRST battery in the chain ({dLong(cover.startDate)}), not from its own manufacture month.</Hint>}
    {blocked && <Hint tone="err" style={{ marginTop: 10 }}>{blocked}</Hint>}
    {!blocked && <SpecialNotice cover={cover} style={{ marginTop: 10 }} />}
  </Card>;
}

/* d11 · old battery */
export function D11() {
  const { f, d, upd, item, saveDraft } = useFlow(); const { state } = useStore();
  const { above, Above } = useAbove();
  const token = useAccessToken();
  const [errs, setErrs] = useState<Record<string, string>>({});
  const del = useDeleteEntry(f?.entry, 'd07');
  if (!f) return null;
  const e = f.entry, i = f.cur, it = e.items[i];
  const modelIds = state.models.map(m => m.id);
  const lengths = anyDigitLengths(state.serialDigitLengths ?? DEFAULT_DIGIT_LENGTHS); // any form we have issued
  const maxLen = Math.max(...lengths);
  const { lookup, looking } = useLiveLookup(it.oldSerial, token, it.oldModel, lengths);
  useEffect(() => {
    // a battery on record knows its own plate + model — show it, and start the NEW battery
    // as the same model (a replacement is like-for-like unless the dealer changes it)
    if (lookup?.found && lookup.model) { if (it.oldModel !== lookup.model.id) item({ oldModel: lookup.model.id }); if (!it.model || it.model === newItem().model) item({ model: lookup.model.id }); }
  }, [lookup]);
  const setOld = (v: string) => {
    const { code: digits, modelId } = splitLabel(v, modelIds);
    const code = digits.replace(/\D/g, '').slice(0, maxLen);
    item({ oldSerial: code, ...(modelId ? { oldModel: modelId, ...(it.model === newItem().model ? { model: modelId } : {}) } : {}) });
    setErrs(x => ({ ...x, oldSerial: '' }));
  };
  const next = () => {
    const all = dealerErrors(e, state), mine = itemErrors(all, i, ['oldSerial', 'fault']);
    if (!it.oldModel) mine.oldModel = 'Choose the model and code printed on the old battery.';
    if (lookup?.cover.noWarranty) mine.oldSerial = 'This battery has no warranty — it cannot be replaced under warranty.';
    if (all['items.0.customer']) mine.customer = all['items.0.customer'];
    setErrs(mine);
    if (Object.keys(mine).length) { saveDraft(); d.toast('Saved as a draft. Fix the marked field now, or come back to it from My requests.'); return; }
    saveDraft(); d.go('d13');
  };
  const oldChosen = state.models.find(m => m.id === it.oldModel);
  // This battery has been back to the company before and came home with the same serial. Say so,
  // with what was found — the same battery must not go round twice unnoticed (client, 3 Oct 2026).
  const wentBack = salesReturnsOf(state, it.oldSerial, it.oldModel);
  return <Screen top={<AppBar title="Old battery" back="d10" right={<Chip tone="mute" mono label={e.id} />} />}
    overlay={del.sheet}>
    <Steps labels={REP_STEPS} now={1} />
    <Gap h={14} />
    <Banner tone="info" icon="batt" style={{ marginBottom: 14 }}>Start with the battery the customer brought back: choose its model, then its code, then type the number on the label.</Banner>
    {wentBack.length > 0 && <Banner tone="warn" icon="truck" style={{ marginBottom: 14 }}>
      <B>This battery has been sent back before.</B> {wentBack[0]!.id} · {wentBack[0]!.returnKind === 'Unsold' ? 'unsold stock' : 'faulty'}{wentBack[0]!.decidedAt ? `, ${dShort(wentBack[0]!.decidedAt!)}` : ''}. It came home with this same serial. Record the replacement if that is right — {above} sees this too.
    </Banner>}
    <PlateModelPicker value={it.oldModel || ''} error={errs.oldModel} label="Old battery"
      onChange={v => { item({ oldModel: v, ...(it.model === newItem().model || it.model === it.oldModel ? { model: v } : {}) }); setErrs(x => ({ ...x, oldModel: '' })); }} />
    <Field label={`Old battery serial number (${lengthsLabel(lengths)})`} req mr="जुनी बॅटरी" mono numeric maxLength={maxLen} value={it.oldSerial} onChange={setOld}
      readonly={!oldChosen} ph={oldChosen ? 'Digits on the label' : 'Choose the model and code first'} error={errs.oldSerial}
      hint={looking ? 'Checking warranty…' : undefined} hintIcon="clock"
        /* No scan and no photo for the old battery (client, 2 Oct 2026): it is typed from the label.
         The battery itself goes back to head office to be opened and checked, so neither a scan
         nor a photo of it decides anything here. The NEW battery keeps both. */ />
    <FullCodeLine modelId={it.oldModel} code={it.oldSerial} lengths={lengths} />
    <OldBatteryInfo code={it.oldSerial} lookup={lookup} looking={looking} token={token} fallbackModel={it.oldModel} />
    <View style={{ marginBottom: 13 }}><Label text="What is the problem?" req mr="काय बिघडले" /></View>
    <ChipRow options={FAULTS} value={it.fault || ''} onChange={v => { item({ fault: v }); setErrs(x => ({ ...x, fault: '' })); }} />
    {errs.fault && <Hint tone="err" style={{ marginTop: -9, marginBottom: 13 }}>{errs.fault}</Hint>}
    <Field label="Customer name" req mr="ग्राहकाचे नाव" value={e.customer} onChange={v => { upd({ customer: v }); setErrs(x => ({ ...x, customer: '' })); }} ph="Name of the customer" error={errs.customer} />
    <Field label="Remarks" mr="शेरा" multiline value={it.remarks} onChange={v => item({ remarks: v })} ph={`Anything ${above} should know`} />
    <Btn kind="primary" big iconAfter="chev" label="Next: the new battery" style={{ marginTop: 4 }} onPress={next} />
    {del.button}
    <Hint icon="lock" center style={{ marginTop: 10 }}>Your shop, city and code are added automatically.</Hint>
  </Screen>;
}

/* d13 · new (or returned) battery */
export function D13() {
  const { f, d, upd, item, saveDraft } = useFlow(); const { state } = useStore();
  const { above, Above } = useAbove();
  const token = useAccessToken();
  const [errs, setErrs] = useState<Record<string, string>>({});
  const del = useDeleteEntry(f?.entry, 'd07');
  const modelIds = state.models.map(m => m.id);
  // a new battery may be 7, 8 or 9 digits (client, 2 Oct 2026); a sales return brings back one
  // already in the field, so it accepts every form we have ever issued
  const lengths = f?.entry.type === 'Sales Return' ? anyDigitLengths(state.serialDigitLengths ?? DEFAULT_DIGIT_LENGTHS) : NEW_BATTERY_DIGIT_LENGTHS;
  const maxLen = Math.max(...lengths);
  const setCode = (v: string, scanned = false) => {
    // the lengths this field accepts, not the default: without them a 9-digit code splits wrong
    // and "Made in" comes out blank, because deriveCode would not count 9 as a length at all
    const { code: digits, modelId } = splitLabel(v, modelIds, lengths);
    const code = digits.replace(/\D/g, '').slice(0, maxLen);
    const { serial, mfg } = deriveCode(code, modelIds, lengths);
    item({ code, serial, mfg, ...(modelId ? { model: modelId } : {}) }); // a prefixed label names the product too
    d.setFlow(x => x && { ...x, scanned: { ...x.scanned, [`new-${x.cur}`]: scanned } });
    setErrs(x => ({ ...x, code: '', serial: '', model: '' }));
  };
  const sc = useScanner(c => { setCode(c, true); d.toast('Scanned. Check each line below.'); });
  if (!f) return null;
  const e = f.entry, i = f.cur, it = e.items[i], rep = e.type === 'Replacement';
  const { lookup, looking } = useLiveLookup(it.code, token, it.model, lengths);
  const labelTag = rep ? newPhotoTag(i) : tagFor('Label', i);
  const photoMissing = rep && !photoOf(e, labelTag);
  const takeLabelPhoto = async () => {
    const u = await takePhoto(d.toast);
    if (!u) return;
    upd(withPhoto(e, labelTag, u)); setErrs(x => ({ ...x, newPhoto: '' }));
    d.toast(rep ? 'Photo of the new battery saved. Check the serial below matches it.' : 'Label photo saved. Check the values below match it.');
  };
  const check = () => {
    const mineErrs = itemErrors(dealerErrors(e, state), i, ['code', 'serial', 'model', 'newPhoto']);
    setErrs(mineErrs);
    if (Object.keys(mineErrs).length) {
      // Everything typed so far — both serial numbers included — waits in the draft.
      saveDraft();
      d.toast(Object.keys(mineErrs).length === 1 && mineErrs.newPhoto
        ? 'Saved as a draft with both serial numbers. Take a photo of the new battery to go ahead.'
        : 'Saved as a draft. Fix the marked field now, or come back to it from My requests.');
      return false;
    }
    return true;
  };
  // A replacement's NEW battery must be a fresh code (the server rejects a duplicate); a sales
  // return's code is the opposite — it SHOULD already be this dealer's own battery coming back.
  const serialHint = !token || !isValidDigits(it.code, lengths) || errs.code ? { t: 'Stored exactly as printed — leading zeros are kept.', ok: false, bad: false }
    : looking ? { t: 'Checking…', ok: false, bad: false }
    : rep
      ? (lookup?.found ? { t: 'This code is already registered — check it, or use a different one.', ok: false, bad: true } : { t: 'Not yet registered — this will be recorded as a new battery.', ok: true, bad: false })
      : (lookup?.found && lookup.custody === 'yours' ? { t: 'In your stock, being returned.', ok: true, bad: false }
        : lookup?.found && lookup.custody === 'other' ? { t: 'This battery belongs to another shop — check the label again.', ok: false, bad: true }
        : { t: `Not on record — ${above} will check it.`, ok: false, bad: false });
  return <Screen top={<AppBar title={rep ? 'New battery' : 'Returned battery'} back={rep ? 'd11' : 'd10'} right={<Chip tone="mute" mono label={e.id} />} />}
    overlay={del.sheet}>
    <Steps labels={rep ? REP_STEPS : RET_STEPS} now={rep ? 2 : 1} />
    <Gap h={14} />
    <ScanBox code={it.code} active={sc.active} onCode={sc.handle} photo={photoOf(e, labelTag)}
      photoLabel={rep ? 'Photo of the new battery' : 'Photo of the label'} />
    <View style={{ flexDirection: 'row', gap: 9, marginTop: 12 }}>
      <Btn kind="blue" sm icon="scan" label={sc.active ? 'Stop camera' : 'Scan code'} style={{ flex: 1, alignSelf: 'stretch' }} onPress={sc.start} />
      <Btn kind={photoMissing ? 'primary' : 'ghost'} sm icon="cam" label={rep ? (photoMissing ? 'Photo of new battery' : 'Retake photo') : 'Photo of label'} style={{ flex: 1, alignSelf: 'stretch' }} onPress={takeLabelPhoto} />
    </View>
    {photoMissing && <Banner tone={errs.newPhoto ? 'bad' : 'warn'} icon="cam" style={{ marginTop: 14 }}><B>Photo of the new battery is required.</B> Photograph the new battery with its serial label showing. You cannot go ahead without it — if you leave now, both serial numbers wait in the draft. <B u onPress={takeLabelPhoto}>Take the photo</B></Banner>}
    {rep && !photoMissing && <Banner tone="ok" icon="check" style={{ marginTop: 14 }}><B>Photo of the new battery added.</B></Banner>}
    {f.scanned[`new-${i}`] ? <Banner tone="ok" icon="check" style={{ marginVertical: 14 }}><B>Read from the label.</B> Check each line. You can change any of them, and typing it all by hand is always allowed.</Banner>
      : <Banner tone="info" icon="scan" style={{ marginVertical: 14 }}><B>Scan the code on the label.</B> Or type the serial below — typing it all by hand is always allowed.</Banner>}
    <PlateModelPicker value={it.model} onChange={v => { item({ model: v }); setErrs(x => ({ ...x, model: '' })); }} error={errs.model} />
    <Field label={`Serial number (${lengthsLabel(lengths)})`} req mr="सिरीयल" mono numeric maxLength={maxLen} value={it.code} onChange={v => setCode(v)} ph={`${lengthsLabel(lengths)} on the label`} error={errs.code || errs.serial}
      tail={<CapBtn n="cam" tone={photoOf(e, labelTag) ? 'done' : 'dark'} label={rep ? 'Photograph the new battery' : 'Photograph the serial'} onPress={takeLabelPhoto} />}
      hint={serialHint.t} hintTone={serialHint.ok ? 'ok' : serialHint.bad ? 'err' : undefined} hintIcon={serialHint.ok ? 'check' : serialHint.bad ? 'alert' : undefined} />
    <Field label="Made in" value={it.mfg ? monthLong(it.mfg) : ''} ph="Worked out from the serial" readonly hint="Worked out from the serial. Nothing to fill in." hintIcon="lock" />
    <FullCodeLine modelId={it.model} code={it.code} lengths={lengths} />
    {/* On a sales return the fault is offered, not demanded: unsold stock has nothing wrong with
        it to name, and a faulty one is easier to check if the dealer says what he saw
        (client, 3 Oct 2026). On a replacement it stays required, on the old-battery screen. */}
    {!rep && <>
      <Label text="What is wrong with it?" mr="काय बिघडले" />
      <ChipRow options={FAULTS} value={it.fault || ''} onChange={v => item({ fault: it.fault === v ? '' : v })} />
      <Hint icon={e.returnKind === 'Unsold' ? 'box' : 'alert'} style={{ marginTop: -7, marginBottom: 12 }}>
        {e.returnKind === 'Unsold' ? 'Unsold stock — leave this empty unless you saw something.' : 'Optional. Tap one if you know what it is; tap it again to clear it.'}
      </Hint>
    </>}
    <Btn kind="primary" big iconAfter="chev" label={rep ? 'Next: check the warranty' : 'Next: photos and proof'} style={{ marginTop: 14 }} onPress={() => { if (!check()) return; saveDraft(); d.go(rep ? 'd31' : 'd15'); }} />
    {/* a replacement offers another battery only after its warranty check (d31) — client, 29 Sep 2026 */}
    {/* One request, one battery (client, 3 Oct 2026). Adding several to a request meant head
        office opened one page and found four decisions waiting, and a dealer who mis-typed one
        held up the rest — a request per battery keeps each one moving on its own. */}
    {del.button}
  </Screen>;
}

/* d31 · warranty carry-over */
export function D31() {
  const { f, d, upd, saveDraft } = useFlow(); const { state } = useStore();
  const token = useAccessToken();
  if (!f) return null;
  const e = f.entry, it = e.items[f.cur];
  const { lookup } = useLiveLookup(it.oldSerial, token, it.oldModel, anyDigitLengths(state.serialDigitLengths ?? DEFAULT_DIGIT_LENGTHS)); // any form we have issued, 9 digits included
  // not sold through the app: its cover is worked out from the label (D-11) — normal, not a problem
  const labelCover = lookup && !(lookup.found && lookup.cover.warrantyStart) ? lookup.cover : null;
  // memory.md D-03: a replacement only ever inherits dates from a real chain, so a battery
  // found but never sold through the system (no warrantyStart) is treated as "not on record",
  // same as one the lookup never found at all — the safe default either way.
  const cover = lookup?.found && lookup.cover.warrantyStart ? {
    start: lookup.cover.warrantyStart,
    expiry: lookup.cover.expiryDate,
    status: coverStatus(lookup.cover),
    months: lookup.model?.warrantyMonths ?? 24,
    used: Math.max(0, Math.min(1, (Date.parse(today()) - Date.parse(lookup.cover.warrantyStart)) / Math.max(1, Date.parse(lookup.cover.expiryDate) - Date.parse(lookup.cover.warrantyStart)))),
    usedSpan: span(lookup.cover.warrantyStart, today()),
    leftSpan: span(today(), lookup.cover.expiryDate),
  } : null;
  const fresh = cover ? monYear(expiryFrom(today(), cover.months)) : '';
  return <Screen top={<AppBar title="Warranty carried over" back="d13" right={cover ? <Chip tone="live" icon="shield" label="Checked" /> : <Chip tone="mute" icon="shield" label="Cover from the label" />} />}>
    <Plate style={{ marginBottom: 13 }}>
      <PlateLab>{cover ? `OLD BATTERY · COVER STARTED ${dLong(cover.start).toUpperCase()}` : 'OLD BATTERY · COVER FROM THE LABEL'}</PlateLab><PlateVal>{it.oldSerial || '—'}</PlateVal>
      <X s={12} w={6} c={T.volt} style={{ textAlign: 'center', letterSpacing: 0.96, marginTop: 9, marginBottom: 7 }}>SAME COVER MOVES ACROSS</X>
      <PlateLab>{cover ? (cover.status === 'Expired' ? 'NEW BATTERY · NO WARRANTY' : `NEW BATTERY · COVER STILL ENDS ${dLong(cover.expiry).toUpperCase()}`) : 'NEW BATTERY · COVER SET ON APPROVAL'}</PlateLab><PlateVal color="#7FD3A9">{it.code || '—'}</PlateVal>
    </Plate>
    {cover ? <>
      <Card><CardH title="Cover remaining" right={<Chip tone={cover.status === 'Expired' ? 'bad' : 'live'} icon="clock" label={cover.status === 'Expired' ? 'Cover ended' : `${spanShort(cover.leftSpan)} left`} />} />
        <Meter used={cover.used} labels={[`${dLong(cover.start)} · sold`, 'Today', `${dLong(cover.expiry)} · ends`]} />
        <Gap h={12} />
        <KV pairs={[['Cover started', dLong(cover.start)], ['Cover ends', dLong(cover.expiry)], ['Already used', spanLong(cover.usedSpan)], ['Still remaining', cover.status === 'Expired' ? 'None' : spanLong(cover.leftSpan)], ['Policy', `Standard · ${cover.months} months`]]} />
      </Card>
      {cover.status !== 'Expired' && <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}>
        <View style={{ flex: 1, borderRadius: 9, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: T.terminalSoft, borderWidth: 1, borderColor: '#F0C7BC' }}>
          <Ic n="x" color="#8C2612" /><X s={12} w={7} c="#8C2612" style={{ marginBottom: 5 }}>Not what happens</X><X s={13} lh={1.35} c="#8C2612">New battery gets a fresh {cover.months} months from today, ending {fresh}.</X></View>
        <View style={{ flex: 1, borderRadius: 9, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: T.liveSoft, borderWidth: 1, borderColor: '#B8DFCB' }}>
          <Ic n="check" color="#0F5537" /><X s={12} w={7} c="#0F5537" style={{ marginBottom: 5 }}>What happens</X><X s={13} lh={1.35} c="#0F5537">New battery keeps the original dates. Cover ends {dLong(cover.expiry)}, as it always would have.</X></View>
      </View>}
      {cover.status === 'Expired' ? null
        : <Banner tone="warn" icon="shield" style={{ marginTop: 13 }}><B>A replacement never extends cover.</B> The end date belongs to the first sale in the chain, not to the battery in your hand. It is the same for the second replacement and the tenth.</Banner>}
      <SecT title="Before you continue" />
      <Card style={{ flexDirection: 'row', gap: 11, alignItems: 'center', borderColor: '#B8DFCB' }} label="Record that the customer was told" onPress={() => { upd({ coverTold: new Date().toISOString() }); d.toast(`Noted on the entry: customer told the cover ends ${dLong(cover.expiry)}.`); }}>
        <Avatar n="check" tone={e.coverTold ? 'green' : 'mute'} />
        <View style={{ flex: 1 }}><X s={14.5} w={6}>{cover.status === 'Expired' ? 'I told the customer the new battery has no warranty' : `I told the customer cover ends ${dLong(cover.expiry)}`}</X>
          <X s={12.5} c={T.slate} style={{ marginTop: 2 }}>{e.coverTold ? `Recorded at ${tShort(e.coverTold)} — this line goes on the entry` : 'Tap to record it — this line goes on the entry and settles arguments later'}</X></View></Card>
    </> : labelCover ? <Banner tone={labelCover.inWarranty ? 'info' : 'bad'} icon="shield"><B>{labelCover.inWarranty ? `In cover until ${dLong(labelCover.expiryDate)}.` : `Cover ended on ${dLong(labelCover.expiryDate)}.`}</B> This battery was sold before the app, so its cover is worked out from the manufacture month on its label ({labelCover.termMonths} + {labelCover.graceMonths} months). A replacement never starts a new term.</Banner>
      : <Banner tone="info" icon="clock"><B>Working out the cover…</B> It comes from the manufacture month on the old battery’s label.</Banner>}
    {lookup && <SpecialNotice cover={lookup.cover} style={{ marginTop: 13 }} />}
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
  // No 'Old battery' tile on a replacement (client, 2 Oct 2026) — the old battery is neither
  // scanned nor photographed anywhere in the app now; head office opens and checks it instead.
  const tiles = rep ? ['New label', 'New battery', 'Fitted in vehicle'] : ['Returned battery', 'Label', 'Condition', 'Other'];
  const g = parseGps(e.gps);
  return <Screen top={<AppBar title="Photos and proof" back={rep ? 'd31' : 'd13'} right={<Chip tone="mute" label="Step 3 of 3" />} />}>
    <Banner tone="info" icon="cam" style={{ marginBottom: 13 }}>{rep ? 'Only the photo of the new battery (its label) is required. The rest are optional — add them if they help settle a warranty argument later.' : 'Photos settle arguments later. Add the returned battery and its label.'}</Banner>
    {[0, 2].map(r => tiles.slice(r, r + 2).length === 0 ? null : <View key={r} style={{ flexDirection: 'row', gap: 9, marginTop: r ? 9 : 0 }}>{tiles.slice(r, r + 2).map(t => {
      const tag = tagFor(t, i), uri = photoOf(e, tag);
      return <Photo key={t} label={uri ? `${t} ✓` : t} uri={uri} onPress={async () => { const u = await takePhoto(d.toast); if (u) upd(withPhoto(e, tag, u)); }} />;
    })}
    {/* an odd number of tiles: keep the last one half-width instead of letting it stretch */}
    {tiles.slice(r, r + 2).length === 1 && <View style={{ flex: 1 }} />}</View>)}
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

/** One item's review card on d16 — its own component so the live warranty lookup (a hook)
 * runs once per item, not once for the whole screen. */
function ReviewItem({ it, i, e, rep, token }: { it: Item; i: number; e: Entry; rep: boolean; token: string | null }) {
  const { state } = useStore();
  // the old battery's own model and the accepted lengths, as on its own screen (d11)
  const { lookup } = useLiveLookup(rep ? it.oldSerial : '', token, it.oldModel, anyDigitLengths(state.serialDigitLengths ?? DEFAULT_DIGIT_LENGTHS));
  // On record or not, the lookup knows the cover: from the first sale in its chain, or else
  // from the label's manufacture month + the model's term (D-11). Only a chain carries over.
  const cover = rep && lookup ? lookup.cover : null, chained = !!(lookup?.found && lookup.cover.warrantyStart);
  return <React.Fragment>
    <Card style={{ marginTop: 11 }}>
      <CardH title={`Item ${i + 1}`} right={!rep ? <Chip tone="info" icon="truck" label="Returned" /> : !cover ? null : cover.noWarranty ? <Chip tone="bad" icon="lock" label="No warranty" /> : cover.coverCase && cover.coverCase !== 'normal' ? <Chip tone="warn" icon="alert" label="Special request" /> : !cover.inWarranty ? <Chip tone="bad" icon="clock" label="Cover ended" /> : <StatusChip status="Active" label={chained ? 'Warranty continues' : 'In cover'} />} />
      <Plate style={{ marginBottom: 11 }}>{rep ? <>
        <PlateLab>OLD BATTERY OUT</PlateLab><PlateVal>{it.oldSerial || '—'}</PlateVal>
        <X s={19} c={T.volt} style={{ textAlign: 'center', marginVertical: 5 }}>↓</X>
        <PlateLab>NEW BATTERY IN</PlateLab><PlateVal color="#7FD3A9">{it.code || '—'}</PlateVal></> : <><PlateLab>RETURNED BATTERY</PlateLab><PlateVal>{it.code || '—'}</PlateVal></>}</Plate>
      <KV pairs={[['Model', it.model], ['Mfg month', monthShort(it.mfg)], ['Quantity', '1'], [rep ? 'Cover ends' : 'Reason', rep ? (cover ? dLong(cover.expiryDate) : 'Set on approval') : (it.remarks || '—')], ['Photos', `${photoCount(e, i)} attached`], ['Signature', e.signature ? 'Captured' : 'Not captured']]} />
    </Card>
    {cover && <SpecialNotice cover={cover} style={{ marginTop: 12 }} />}
    {cover && chained && cover.inWarranty && <Banner tone="warn" icon="shield" style={{ marginTop: 12 }}><B>Warranty carried over, not restarted.</B> This battery is covered until {dLong(cover.expiryDate)} — the date the first battery in the chain got. {spanLong(span(today(), cover.expiryDate))} remain. No new period is created.</Banner>}
  </React.Fragment>;
}

/* d16 · review & send */
export function D16() {
  const { f, d } = useFlow(); const { state, setState, audit, dealerId } = useStore(); const { sync } = useSync();
  const { above, Above } = useAbove();
  const token = useAccessToken();
  const [busy, setBusy] = useState(false), [phase, setPhase] = useState('');
  const del = useDeleteEntry(f?.entry, 'd07');
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
  // Real submission (architecture.md §19 POST /entries) whenever this is a genuine signed-in
  // dealer session and the device isn't marked offline; otherwise falls back to the original
  // local-only demo/preview behaviour unchanged, so that path still works exactly as before.
  const send = async () => {
    if (errList.length) { jump(errList[0][0]); return; }
    if (!token || state.offline) {
      const now = new Date().toISOString();
      const data: Entry = { ...e, status: state.offline ? 'Pending sync' : 'Submitted', createdAt: now, date: today(), items: e.items.map(it => ({ ...it, wr: it.oldSerial || it.wr })),
        handover: rep ? `Given to ${e.customer || 'the customer'} at the counter · ${dLong(now)}, ${tShort(now)}` : e.handover };
      SENT.add(e.id);
      setState(s => audit({ ...s, entries: [data, ...s.entries.filter(x => x.id !== data.id)] }, 'Entry submitted', data.id, state.offline ? 'Saved on the phone to send later' : 'Sent from the app (preview)'));
      d.setFlow(null); d.go('d17', data.id);
      return;
    }
    setBusy(true);
    try {
      const result = await createEntry(buildEntryBody(e), token);
      SENT.add(e.id); // sent: from here on this draft only exists as the server's request
      // then its photos, so head office can review the batteries from them (D-10)
      let photosFailed = 0;
      if (e.evidence.length) { setPhase(`Sending ${e.evidence.length} ${e.evidence.length === 1 ? 'photo' : 'photos'}…`); photosFailed = (await uploadEntryPhotos(e, result.id, token)).failed; }
      const data: Entry = { ...e, id: result.ref, apiId: result.id, status: result.status === 'approved' ? 'Approved' : result.status === 'with_distributor' ? 'With distributor' : 'Submitted', createdAt: result.createdAt, date: result.entryDate,
        special: result.specialStatus === 'pending' ? 'Pending' : undefined,
        items: e.items.map(it => ({ ...it, wr: it.oldSerial || it.wr })),
        handover: rep ? `Given to ${e.customer || 'the customer'} at the counter · ${dLong(result.createdAt)}, ${tShort(result.createdAt)}` : e.handover };
      setState(s => audit({ ...s, entries: [data, ...s.entries.filter(x => x.id !== e.id)] }, 'Entry submitted', data.id, 'Sent from the app'));
      d.setFlow(null); d.go('d17', data.id);
      if (photosFailed) d.toast(`${photosFailed} ${photosFailed === 1 ? 'photo' : 'photos'} could not be sent. The request reached ${above} — tell them, or send the photos on WhatsApp.`);
      sync(true); // the server's copy (with its items and claim) replaces the bridged one
    } catch (err) {
      // Head office refused it (an expired chain, a duplicate serial) or the shop lost signal.
      // Either way the request is kept as a draft with the reason on it, so the dealer can
      // serve the next customer and come back to this one — never stranded on this screen.
      const why = err instanceof ApiError ? err.message : 'Could not reach the server.';
      setState(s => ({ ...s, entries: [{ ...e, status: 'Draft' as const, remarks: e.remarks, items: e.items.map((it, n) => n === 0 ? { ...it, exception: why } : it) }, ...s.entries.filter(x => x.id !== e.id)] }));
      d.toast(`${why} Saved as a draft — find it under My requests.`);
    } finally { setBusy(false); setPhase(''); }
  };
  return <Screen top={<AppBar title="Check before sending" back={rep ? 'd31' : 'd15'} />} overlay={del.sheet}>
    <Steps labels={rep ? REP_STEPS : RET_STEPS} now={3} />
    <Gap h={13} />
    {errList.length > 0 && <Banner tone="bad" icon="alert" style={{ marginBottom: 12 }}><B>{errList.length === 1 ? 'One thing must be fixed.' : `${errList.length} things must be fixed.`}</B> {errList[0][1]} <B u onPress={() => jump(errList[0][0])}>Go to the field</B></Banner>}
    {warns.length > 0 && <Banner tone="warn" icon="alert" style={{ marginBottom: 12 }}><B>{warns.length === 1 ? 'One thing to look at.' : `${warns.length} things to look at.`}</B> {warns[0].text} Not blocked — confirm it is correct. <B u onPress={() => jump(warns[0].key)}>Go to the field</B></Banner>}
    <Card><CardH title="Entry" right={<Chip tone="mute" mono label={e.id} />} />
      <KV pairs={[['Type', e.type], ['Date', dLong(today())], [roleOf(dealer), dealer.name], ['City / place', `${dealer.city} · ${e.place}`], ['Customer', e.customer || '—'], ['Items', `${e.items.length} ${e.items.length === 1 ? 'battery' : 'batteries'}`]]} /></Card>
    {e.items.map((it, i) => <ReviewItem key={it.id} it={it} i={i} e={e} rep={rep} token={token} />)}
    <Card style={{ backgroundColor: T.deep, borderColor: '#082A13', marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <X s={13} c="#9BA9BB">Total batteries</X><X s={19} w={7} c={T.white}>{e.items.length}</X></Card>
    <Btn kind="primary" big icon="check" label={busy ? (phase || 'Sending…') : state.offline ? 'Save and send later' : 'Send entry'} style={{ marginTop: 13 }} onPress={send} disabled={busy} />
    <Hint icon="lock" center style={{ marginTop: 9 }}>{rep ? `The customer takes the battery today. ${Above} confirms the claim afterwards.` : `${Above} confirms the return afterwards.`}</Hint>
    {!busy && del.button}
  </Screen>;
}

/* d17 · recorded and sent */
export function D17({ p }: { p?: string }) {
  const d = useD(); const { state } = useStore();
  const token = useAccessToken();
  const e = state.entries.find(x => x.id === p);
  const { lookup } = useLiveLookup(e?.type === 'Replacement' ? (e.items[0]?.oldSerial || '') : '', token);
  if (!e) return <Screen top={<AppBar title="Entry" back="d07" />}><X c={T.slate}>This entry could not be found.</X></Screen>;
  const rep = e.type === 'Replacement', queued = e.status === 'Pending sync';
  // a dealer's request goes to its distributor first (client, 2 Oct 2026)
  const shop = state.dealers.find(x => x.id === e.dealerId), viaDistributor = shop?.kind === 'Dealer';
  const approver = viaDistributor ? (shop?.distributor?.name ? `Your distributor (${shop.distributor.name})` : 'Your distributor') : 'Head office';
  const cover = rep && lookup?.found && lookup.cover.warrantyStart ? lookup.cover : null;
  const list = (k: 'oldSerial' | 'code') => e.items.map(it => it[k]).filter(Boolean).join(', ') || '—';
  // One way out, within thumb reach: Done → Home. The request and its decision stay in My requests.
  const done = () => { d.setFlow(null); d.tab('d07'); };
  return <Screen footer={<Btn kind="primary" big icon="check" label="Done" onPress={done} />}>
    <BigOk n={queued ? 'cloud' : 'check'} bg={queued ? T.amber : T.live} />
    <X s={22} w={7} f="c" accessibilityRole="header" style={{ textAlign: 'center', marginBottom: 5 }}>{queued ? 'Saved on this phone' : 'Recorded and sent'}</X>
    <X s={15} c={T.slate} style={{ textAlign: 'center', marginBottom: 16 }}>{rep ? (queued ? 'It sends by itself when signal returns. Give the new battery to the customer now.' : `Give the new battery to the customer now. ${approver} confirms it afterwards — the customer does not wait.${viaDistributor ? ' Hand the old battery to your distributor.' : ''}`) : (queued ? 'It sends by itself when signal returns.' : `${approver} confirms the return afterwards.`)}</X>
    <Plate><PlateLab center>REQUEST NUMBER</PlateLab><PlateVal size={22} center>{e.id}</PlateVal></Plate>
    <Card style={{ marginTop: 12 }}><KV pairs={rep
      ? [['Old battery', list('oldSerial'), 'mono'], ['New battery', list('code'), 'mono'], ['Cover ends', cover ? dLong(cover.expiryDate) : 'Set on approval'], ['Remaining', cover ? spanShort(span(today(), cover.expiryDate)) : '—'], [queued ? 'Saved' : 'Sent', tShort(e.createdAt)], ['Claim decided', 'After the battery is checked']]
      : [['Returned battery', list('code'), 'mono'], ['Model', e.items.map(it => it.model).join(', ')], [queued ? 'Saved' : 'Sent', tShort(e.createdAt)], ['Decision', 'By head office']]} /></Card>
    {e.special && <Banner tone="warn" icon="alert" style={{ marginTop: 12 }}><B>Sent as a special request.</B> {viaDistributor ? 'Hand the old battery to your distributor.' : 'Keep the old battery until head office approves.'}</Banner>}
    {rep && !e.special && <Banner tone="warn" icon="shop" style={{ marginTop: 12 }}><B>Keep the old battery in your shop.</B> Hand it over at the next pickup — the claim cannot be settled until the company has checked it.</Banner>}
  </Screen>;
}
