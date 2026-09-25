import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useStore } from '@felix/shared/store';
import { Entry, Item, State, deriveCode, digitsOf, expiryFrom, fullCode, newEntry, newItem, normalize, splitLabel, today, validateEntry } from '@felix/shared/domain';
import { T } from '@felix/shared/ui/theme';
import { X, B, Ic, Btn, Card, CardH, Chip, StatusChip, Field, Label, Hint, Banner, Steps, KV, SecT, Line, Avatar, BigOk, BigTile, ChipRow, CapBtn, IconBtn, Plate, PlateLab, PlateVal, Meter, Gap } from '@felix/shared/ui/kit';
import { Screen, AppBar, Sheet, useD } from './shell';
import { PickList } from '@felix/shared/ui/pick';
import { Photo, SignaturePad, locate, parseGps, takePhoto } from '@felix/shared/ui/media';
import { coverChip, dLong, findBattery, monYear, monthLong, monthShort, nextEntryId, span, spanLong, spanShort, tShort } from '@felix/shared/data';
import { useAccessToken } from '@felix/shared/api/session';
import { lookupBattery, type BatteryLookupResult } from '@felix/shared/api/batteries';
import { createEntry } from '@felix/shared/api/entries';
import { buildEntryBody } from '@felix/shared/api/entry-body';
import { ApiError } from '@felix/shared/api/client';
import { useSync } from '@felix/shared/api/sync';

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
const codeFrom = (data: string) => (data.match(/[A-Za-z]\d{3,4}-?\d{8}/)?.[0]) || (data.match(/\d{8}/)?.[0]) || data.replace(/\D/g, '').slice(0, 8);

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

/** Live warranty/custody check against the real backend (architecture.md §9.9), replacing
 * the local demo store's `findBattery`/`coverOf` wherever a dealer needs the truth about a
 * battery that might have been sold/replaced by anyone, not just recorded on this phone. */
function useLiveLookup(code: string, token: string | null, modelId?: string) {
  const [result, setResult] = useState<BatteryLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!token || !/^\d{8}$/.test(code)) { setResult(null); return; }
    let alive = true;
    setLoading(true);
    lookupBattery(code, token, modelId || undefined)
      .then(r => { if (alive) setResult(r); })
      .catch(() => { if (alive) setResult(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code, token, modelId]);
  return { lookup: result, looking: loading };
}
/** status label matching data.ts's warranty() shape, but from live backend cover fields. */
function coverStatus(cover: { inWarranty: boolean; daysRemaining: number }): 'Active' | 'Expiring soon' | 'Expired' {
  return !cover.inWarranty ? 'Expired' : cover.daysRemaining <= 30 ? 'Expiring soon' : 'Active';
}

/** The battery's full number as printed on its label: plates + model + the 8 digits,
 * e.g. "M 1000 2609 0676" or "GP M 1000 2609 0676" (D-13 — the digits alone are not unique). */
function printedNumber(m: { plate?: string; modelNo?: string; brand?: string; id: string } | undefined, digits: string): string {
  const d = digits.length === 8 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
  if (!m) return d;
  const head = m.plate && m.modelNo ? `${m.brand === 'gold_power' ? 'GP ' : ''}${m.plate} ${m.modelNo}` : m.id;
  return `${head} ${d}`.trim();
}

/* ---------- plates → model picker (D-12: the label reads plates + model, e.g. "M 1000") ----------
 * Plates first, then only the models made with those plates, so a dealer never scrolls the whole
 * catalogue and cannot pick a plate/model pair Felix does not make. */
type Mdl = State['models'][number];
const printedPlate = (m: Mdl) => `${m.brand === 'gold_power' ? 'GP ' : ''}${m.plate}`; // 'M', or 'GP M' for the Gold Power (red) case
const modelOrder = (a: Mdl, b: Mdl) => (Number(a.modelNo) || 9e9) - (Number(b.modelNo) || 9e9) || (a.modelNo ?? '').localeCompare(b.modelNo ?? '');
function PlateModelPicker({ value, onChange, error, label = 'Battery' }: { value: string; onChange: (id: string) => void; error?: string; label?: string }) {
  const { state } = useStore();
  const [open, setOpen] = useState<'plate' | 'model' | null>(null);
  const active = state.models.filter(m => m.active && m.plate && m.modelNo);
  const cur = state.models.find(m => m.id === value);
  const [plate, setPlate] = useState(cur?.plate ? printedPlate(cur) : '');
  // a scanned label (or a battery found on record) sets the model directly — follow it
  useEffect(() => { if (cur?.plate) setPlate(printedPlate(cur)); }, [value]);

  const rank = new Map((state.plateTypes ?? []).map((p, k) => [p.code, k]));
  const plates = [...new Set(active.map(printedPlate))].sort((a, b) => {
    const pa = a.replace(/^GP /, ''), pb = b.replace(/^GP /, '');
    return (rank.get(pa) ?? 999) - (rank.get(pb) ?? 999) || pa.localeCompare(pb) || Number(a.startsWith('GP ')) - Number(b.startsWith('GP '));
  });
  const modelsOf = (p: string) => active.filter(m => printedPlate(m) === p).sort(modelOrder);
  const forPlate = modelsOf(plate);
  const plateSub = (p: string) => {
    const ms = modelsOf(p), first = ms[0];
    const kind = first?.plateCount ? `${first.plateCount} plates` : 'Tubular series';
    return `${kind}${p.startsWith('GP ') ? ' · Gold Power' : ''} · ${ms.length === 1 ? `model ${first!.modelNo}` : `${ms.length} models`}`;
  };
  const pickPlate = (p: string) => {
    setPlate(p);
    const ms = modelsOf(p);
    if (ms.length === 1) { onChange(ms[0]!.id); setOpen(null); return; }        // only one model: nothing to ask
    if (!cur || printedPlate(cur) !== p) onChange('');                              // old model does not exist on these plates
    setOpen('model');
  };

  if (!active.length) return <Banner tone="bad" icon="alert" style={{ marginBottom: 13 }}>
    The plates and models list has not loaded from head office yet. Go back and tap Sync now. If it stays empty, the server needs updating — call head office.
  </Banner>;

  return <>
    <Sheet open={open === 'plate'} title="Plates" onClose={() => setOpen(null)}>
      <PickList search="Search plates — M, 13, tubular…" options={plates.map(p => ({ v: p, sub: plateSub(p) }))} value={plate} onPick={pickPlate} /></Sheet>
    <Sheet open={open === 'model'} title={plate ? `Models with ${plate} plates` : 'Model'} onClose={() => setOpen(null)}>
      <PickList search={forPlate.length > 4 ? 'Search models' : undefined} options={forPlate.map(m => ({ v: m.modelNo!, sub: `${m.months} months cover${m.capacity ? ` · ${m.capacity}` : ''}` }))} value={cur && printedPlate(cur) === plate ? cur.modelNo! : ''}
        onPick={v => { const picked = forPlate.find(m => m.modelNo === v); if (picked) onChange(picked.id); setOpen(null); }} /></Sheet>
    <Field label={`${label} plates`} req mr="प्लेट्स" value={plate} ph="Choose plates (G, M, S…)" onPress={() => setOpen('plate')} tail={<Ic n="chev" color={T.slate} />}
      hint={plate && !error ? plateSub(plate) : undefined} />
    <Field label={`${label} model`} req mr="मॉडेल" value={cur && printedPlate(cur) === plate ? cur.modelNo! : ''} ph={plate ? `Choose from ${forPlate.length} model${forPlate.length === 1 ? '' : 's'}` : 'Choose the plates first'}
      readonly={!plate} onPress={plate ? () => setOpen('model') : undefined} tail={<Ic n="chev" color={T.slate} />} error={error} />
    {cur && !error && <Hint icon="shield" tone="ok" style={{ marginTop: -9, marginBottom: 13 }}>{printedPlate(cur)} {cur.modelNo} · {cur.months} months cover{state.graceMonths ? ` + ${state.graceMonths} grace` : ''}</Hint>}
  </>;
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

/** Everything the dealer should know about the old battery once its serial is typed or scanned
 * (memory.md D-03): manufacture month from the code's YYMM, model/type/capacity, when it was
 * bought (the chain's original sale), when it was itself installed as a replacement, how many
 * replacements the chain has had, its current state, and the cover dates. */
const STATE_LABEL: Record<string, string> = { available: 'In stock', allocated: 'Allocated', sold: 'With customer', returned: 'Returned', replacement: 'Given as replacement', repair: 'Under repair', damaged: 'Damaged', scrap: 'Scrapped' };
const DEFAULT_TERM = 24, DEFAULT_GRACE = 2; // the server's defaults (backend domain/warranty.ts) when no model is chosen yet
const leftText = (expiry: string) => { const days = Math.ceil((Date.parse(expiry) - Date.parse(today())) / 86_400_000); return days >= 0 ? `${spanLong(span(today(), expiry))} left` : `Expired ${-days} day${days === -1 ? '' : 's'} ago`; };
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
  if (code.length !== 8) return null;
  const local = deriveCode(code);
  const mfg = (lookup?.mfgMonth) || local.mfg;
  // The rule (memory.md D-11): cover runs from the first day of the manufacture month for the
  // (plate, model)'s term plus the grace months — the same maths as the server's checkWarranty.
  const chosen = state.models.find(m => m.id === fallbackModel);
  const term = chosen?.months ?? DEFAULT_TERM, grace = state.graceMonths ?? DEFAULT_GRACE;
  const ident: [string, React.ReactNode, ('mono' | '')?][] = [['Full battery number', printedNumber(chosen, code), 'mono'], ['Serial number', code, 'mono'], ['Manufactured', mfg ? monthLong(mfg) : 'Not a valid YYMM'], ['Plates · model', chosen ? `${chosen.id} · ${chosen.months} months` : fallbackModel || 'Choose above'], ['Cover rule', `${term} + ${grace} months from manufacture`]];
  const fromMfg = mfg ? { start: `${mfg}-01`, expiry: expiryFrom(`${mfg}-01`, term + grace) } : null;

  if (!token) return <Card style={{ borderColor: '#EBD49C', backgroundColor: '#FFFBF1', marginBottom: 14 }}>
    <CardH title="From the label" right={<Chip tone="warn" icon="alert" label="Preview mode" />} />
    <KV pairs={ident} />
    {fromMfg && <WarrantyLeft start={fromMfg.start} expiry={fromMfg.expiry} from="manufacture date" months={term} grace={grace} />}
    <Gap h={8} /><X s={13} c={T.slate}>Not signed in to the real server, so the purchase date, model and any recorded cover cannot be checked live — this is from the label alone.</X></Card>;

  if (looking || !lookup) return <Card style={{ marginBottom: 14 }}>
    <CardH title="Checking with head office…" right={<Chip tone="mute" icon="clock" label="Please wait" />} />
    <KV pairs={ident} />
    {fromMfg && <WarrantyLeft start={fromMfg.start} expiry={fromMfg.expiry} from="manufacture date" months={term} grace={grace} />}</Card>;

  if (!lookup.found) return <Card style={{ borderColor: '#EBD49C', backgroundColor: '#FFFBF1', marginBottom: 14 }}>
    <CardH title="Not on record" right={<Chip tone="warn" icon="eye" label="Head office will check" />} />
    <KV pairs={[ident[0], ident[1], ['Plates · model', lookup.model ? `${lookup.model.id} · ${lookup.model.warrantyMonths} months` : lookup.labelModelId || fallbackModel || 'Choose above'], ['Cover rule', `${lookup.cover.termMonths} + ${lookup.cover.graceMonths} months from manufacture`], ['Cover ends', dLong(lookup.cover.expiryDate)]]} />
    {mfg && <WarrantyLeft start={lookup.cover.startDate} expiry={lookup.cover.expiryDate} from="manufacture date" months={lookup.cover.termMonths} grace={lookup.cover.graceMonths} />}
    {lookup.labelModelId && lookup.labelModelId !== fallbackModel && <Hint tone="err" style={{ marginTop: 10 }}>The label says {lookup.labelModelId}, but {fallbackModel || 'nothing'} is chosen above. Check the plates and model.</Hint>}
    {!!lookup.otherProductsWithTheseDigits?.length && <Hint tone="err" style={{ marginTop: 10 }}>These same digits belong to a {lookup.otherProductsWithTheseDigits.join(', ')} on record. Serial numbers repeat across models — check the plates and model on the label.</Hint>}
    <Gap h={8} /><X s={13} c={T.slate}>Not sold through the app yet. Its cover is worked out from the manufacture month on the label and the plates + model you chose — head office puts it on record when it approves the replacement.</X></Card>;

  const { battery, model, chain, cover, custody } = lookup;
  const status = coverStatus(cover), [chipLabel, chipTone] = coverChip(status);
  const modelText = fallbackModel || '—';
  const pairs: [string, React.ReactNode, ('mono' | '')?][] = [
    ident[0], ident[1],
    ['Plates · model', model ? `${model.id}${model.plate ? ` (${model.plate} plates, ${model.modelNo})` : ''}` : modelText],
    ['Cover rule', `${cover.termMonths} + ${cover.graceMonths} months from manufacture`],
    ['Cover', `${dLong(cover.startDate)} → ${dLong(cover.expiryDate)}`],
    ['Status', STATE_LABEL[battery.state] || battery.state],
  ];
  if (chain) pairs.push(['Replacements on this chain', chain.replacementCount === 0 ? 'None yet' : String(chain.replacementCount)]);
  if (chain && battery.isReplacement) pairs.push(['This battery installed on', chain.installedOn ? dLong(chain.installedOn) : '—']);

  if (custody === 'other') return <Card style={{ borderColor: '#F0C7BC', backgroundColor: '#FFF8F6', marginBottom: 14 }}>
    <CardH title="Held by another shop" right={<Chip tone="bad" icon="lock" label="Not yours" />} />
    <KV pairs={ident} />
    <Gap h={8} /><X s={13.5} c={T.slate}>This serial is recorded against a different dealer. Check the label again, or call head office.</X></Card>;

  const blocked = battery.alreadyReplaced ? 'This battery has already been replaced once — its replacement carries the cover now. Check the label again.'
    : !cover.inWarranty ? 'Cover has ended for this chain. Head office will not accept a warranty replacement for it.' : null;
  return <Card style={{ borderColor: blocked ? '#F0C7BC' : '#B8DFCB', backgroundColor: blocked ? '#FFF8F6' : '#F7FCF9', marginBottom: 14 }}>
    <CardH title="Found on record" right={<Chip tone={battery.alreadyReplaced ? 'bad' : chipTone} icon={battery.alreadyReplaced ? 'lock' : status === 'Active' ? 'shield' : 'clock'} label={battery.alreadyReplaced ? 'Already replaced' : chipLabel} />} />
    <KV pairs={pairs} />
    <WarrantyLeft start={cover.startDate} expiry={cover.expiryDate} from={chain && !chain.isOriginal ? "first battery's manufacture date" : 'manufacture date'} months={cover.termMonths} grace={cover.graceMonths} />
    {chain && !chain.isOriginal && <Hint icon="link" style={{ marginTop: 10 }}>This is a replacement battery. Its cover runs from the FIRST battery in the chain ({dLong(cover.startDate)}), not from its own manufacture month.</Hint>}
    {blocked && <Hint tone="err" style={{ marginTop: 10 }}>{blocked}</Hint>}
  </Card>;
}

/* d11 · old battery */
export function D11() {
  const { f, d, upd, item, saveDraft } = useFlow(); const { state } = useStore();
  const token = useAccessToken();
  const [scan, setScan] = useState(false), [errs, setErrs] = useState<Record<string, string>>({});
  if (!f) return null;
  const e = f.entry, i = f.cur, it = e.items[i];
  const modelIds = state.models.map(m => m.id);
  const { lookup, looking } = useLiveLookup(it.oldSerial, token, it.oldModel);
  useEffect(() => {
    // a battery on record knows its own plate + model — show it, and start the NEW battery
    // as the same model (a replacement is like-for-like unless the dealer changes it)
    if (lookup?.found && lookup.model) { if (it.oldModel !== lookup.model.id) item({ oldModel: lookup.model.id }); if (!it.model || it.model === newItem().model) item({ model: lookup.model.id }); }
  }, [lookup]);
  const setOld = (v: string) => {
    const { code: digits, modelId } = splitLabel(v, modelIds);
    const code = digits.replace(/\D/g, '').slice(0, 8);
    item({ oldSerial: code, ...(modelId ? { oldModel: modelId, ...(it.model === newItem().model ? { model: modelId } : {}) } : {}) });
    setErrs(x => ({ ...x, oldSerial: '' }));
  };
  const next = () => {
    const all = dealerErrors(e, state), mine = itemErrors(all, i, ['oldSerial', 'fault']);
    if (!it.oldModel) mine.oldModel = 'Choose the plates and model printed on the old battery.';
    setErrs(mine); if (Object.keys(mine).length) return;
    saveDraft(); d.go('d13');
  };
  const oldPhoto = photoOf(e, tagFor('Old battery', i));
  const oldChosen = state.models.find(m => m.id === it.oldModel);
  return <Screen top={<AppBar title="Old battery" back={i > 0 ? 'd12' : 'd10'} right={<Chip tone="mute" mono label={e.id} />} />}
    overlay={<ScanSheet open={scan} title="Scan the old battery" onClose={() => setScan(false)} onCode={c => { setOld(c); d.setFlow(x => x && { ...x, scanned: { ...x.scanned, [`old-${i}`]: true } }); d.toast('Scanned. Check the number matches the label.'); }} />}>
    <Steps labels={REP_STEPS} now={1} />
    <Gap h={14} />
    <Banner tone="info" icon="batt" style={{ marginBottom: 14 }}>Start with the battery the customer brought back: choose its plates, then its model, then type the 8 digits — or scan the label to fill all three.</Banner>
    <PlateModelPicker value={it.oldModel || ''} error={errs.oldModel} label="Old battery"
      onChange={v => { item({ oldModel: v, ...(it.model === newItem().model || it.model === it.oldModel ? { model: v } : {}) }); setErrs(x => ({ ...x, oldModel: '' })); }} />
    <Field label="Old battery serial number (8 digits)" req mr="जुनी बॅटरी" mono numeric maxLength={8} value={it.oldSerial} onChange={setOld}
      readonly={!oldChosen} ph={oldChosen ? '8 digits on the label' : 'Choose the plates and model first'} error={errs.oldSerial}
      hint={looking ? 'Checking warranty…' : undefined}
      tail={<><CapBtn n="scan" tone="alt" label="Scan old battery" onPress={() => setScan(true)} /><CapBtn n="cam" tone={oldPhoto ? 'done' : 'dark'} label="Photograph old battery label" onPress={async () => { const u = await takePhoto(d.toast); if (u) { upd(withPhoto(e, tagFor('Old battery', i), u)); d.toast('Photo saved. Check the number above matches it.'); } }} /></>} />
    {oldChosen && it.oldSerial.length === 8 && <Card style={{ marginBottom: 14, backgroundColor: T.ink, borderColor: T.ink }}>
      <X s={11.5} w={6} c="#A8B6C7">Full battery number · पूर्ण नंबर</X>
      <X s={22} w={7} f="m" c={T.white} style={{ marginTop: 4 }}>{printedNumber(oldChosen, it.oldSerial)}</X>
      <X s={12} c="#A8B6C7" style={{ marginTop: 4 }}>{oldChosen.plateCount ? `${oldChosen.plateCount} plates` : `${oldChosen.plate ?? ''} series`} · model {oldChosen.modelNo ?? oldChosen.id} · serial {it.oldSerial.slice(-4)}</X>
    </Card>}
    <OldBatteryInfo code={it.oldSerial} lookup={lookup} looking={looking} token={token} fallbackModel={it.oldModel} />
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
  const { f, d, upd, item, saveDraft } = useFlow(); const { state } = useStore();
  const token = useAccessToken();
  const [errs, setErrs] = useState<Record<string, string>>({});
  const modelIds = state.models.map(m => m.id);
  const setCode = (v: string, scanned = false) => {
    const { code: digits, modelId } = splitLabel(v, modelIds);
    const code = digits.replace(/\D/g, '').slice(0, 8);
    const { serial, mfg } = deriveCode(code);
    item({ code, serial, mfg, ...(modelId ? { model: modelId } : {}) }); // a prefixed label names the product too
    d.setFlow(x => x && { ...x, scanned: { ...x.scanned, [`new-${x.cur}`]: scanned } });
    setErrs(x => ({ ...x, code: '', serial: '', model: '' }));
  };
  const sc = useScanner(c => { setCode(c, true); d.toast('Scanned. Check each line below.'); });
  if (!f) return null;
  const e = f.entry, i = f.cur, it = e.items[i], rep = e.type === 'Replacement';
  const { lookup, looking } = useLiveLookup(it.code, token);
  const labelTag = tagFor(rep ? 'New label' : 'Label', i);
  const check = () => { const mineErrs = itemErrors(dealerErrors(e, state), i, ['code', 'serial', 'model']); setErrs(mineErrs); return !Object.keys(mineErrs).length; };
  // A replacement's NEW battery must be a fresh code (the server rejects a duplicate); a sales
  // return's code is the opposite — it SHOULD already be this dealer's own battery coming back.
  const serialHint = !token || it.code.length !== 8 || errs.code ? { t: 'Stored exactly as printed — leading zeros are kept.', ok: false, bad: false }
    : looking ? { t: 'Checking…', ok: false, bad: false }
    : rep
      ? (lookup?.found ? { t: 'This code is already registered — check it, or use a different one.', ok: false, bad: true } : { t: 'Not yet registered — this will be recorded as a new battery.', ok: true, bad: false })
      : (lookup?.found && lookup.custody === 'yours' ? { t: 'In your stock, being returned.', ok: true, bad: false }
        : lookup?.found && lookup.custody === 'other' ? { t: 'This battery belongs to another shop — check the label again.', ok: false, bad: true }
        : { t: 'Not on record — head office will check it.', ok: false, bad: false });
  return <Screen top={<AppBar title={rep ? 'New battery' : 'Returned battery'} back={rep ? 'd11' : 'd10'} right={<Chip tone="mute" mono label={e.id} />} />}
>
    <Steps labels={rep ? REP_STEPS : RET_STEPS} now={rep ? 2 : 1} />
    <Gap h={14} />
    <ScanBox code={it.code} active={sc.active} onCode={sc.handle} />
    <View style={{ flexDirection: 'row', gap: 9, marginTop: 12 }}>
      <Btn kind="blue" sm icon="scan" label={sc.active ? 'Stop camera' : 'Scan code'} style={{ flex: 1, alignSelf: 'stretch' }} onPress={sc.start} />
      <Btn kind="ghost" sm icon="cam" label="Photo of label" style={{ flex: 1, alignSelf: 'stretch' }} onPress={async () => { const u = await takePhoto(d.toast); if (u) { upd(withPhoto(e, labelTag, u)); d.toast('Label photo saved. Check the values below match it.'); } }} />
    </View>
    {f.scanned[`new-${i}`] ? <Banner tone="ok" icon="check" style={{ marginVertical: 14 }}><B>Read from the label.</B> Check each line. You can change any of them, and typing it all by hand is always allowed.</Banner>
      : <Banner tone="info" icon="scan" style={{ marginVertical: 14 }}><B>Scan the code on the label.</B> Or type the serial below — typing it all by hand is always allowed.</Banner>}
    <PlateModelPicker value={it.model} onChange={v => { item({ model: v }); setErrs(x => ({ ...x, model: '' })); }} error={errs.model} />
    <Field label="Serial number" req mr="सिरीयल" mono numeric maxLength={8} value={it.code} onChange={v => setCode(v)} ph="8 digits on the label" error={errs.code || errs.serial}
      tail={<CapBtn n="cam" tone={photoOf(e, labelTag) ? 'done' : 'dark'} label="Photograph the serial" onPress={async () => { const u = await takePhoto(d.toast); if (u) { upd(withPhoto(e, labelTag, u)); d.toast('Photo of the serial saved.'); } }} />}
      hint={serialHint.t} hintTone={serialHint.ok ? 'ok' : serialHint.bad ? 'err' : undefined} hintIcon={serialHint.ok ? 'check' : serialHint.bad ? 'alert' : undefined} />
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
  const { f, d, upd } = useFlow();
  const token = useAccessToken();
  if (!f) return null;
  const e = f.entry, it = e.items[f.cur];
  const { lookup } = useLiveLookup(it.oldSerial, token);
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
        <KV pairs={[['Cover started', dLong(cover.start)], ['Cover ends', dLong(cover.expiry)], ['Already used', spanLong(cover.usedSpan)], ['Still remaining', cover.status === 'Expired' ? 'None' : spanLong(cover.leftSpan)], ['Policy', `Standard · ${cover.months} months`]]} />
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

/** One item's review card on d16 — its own component so the live warranty lookup (a hook)
 * runs once per item, not once for the whole screen. */
function ReviewItem({ it, i, e, rep, token }: { it: Item; i: number; e: Entry; rep: boolean; token: string | null }) {
  const { lookup } = useLiveLookup(rep ? it.oldSerial : '', token);
  const cover = rep && lookup?.found && lookup.cover.warrantyStart ? lookup.cover : null;
  return <React.Fragment>
    <Card style={{ marginTop: 11 }}>
      <CardH title={`Item ${i + 1}`} right={!rep ? <Chip tone="info" icon="truck" label="Returned" /> : !cover ? <Chip tone="warn" icon="eye" label="Not on record" /> : !cover.inWarranty ? <Chip tone="bad" icon="clock" label="Cover ended" /> : <StatusChip status="Active" label="Warranty continues" />} />
      <Plate style={{ marginBottom: 11 }}>{rep ? <>
        <PlateLab>OLD BATTERY OUT</PlateLab><PlateVal>{it.oldSerial || '—'}</PlateVal>
        <X s={19} c={T.volt} style={{ textAlign: 'center', marginVertical: 5 }}>↓</X>
        <PlateLab>NEW BATTERY IN</PlateLab><PlateVal color="#7FD3A9">{it.code || '—'}</PlateVal></> : <><PlateLab>RETURNED BATTERY</PlateLab><PlateVal>{it.code || '—'}</PlateVal></>}</Plate>
      <KV pairs={[['Model', it.model], ['Mfg month', monthShort(it.mfg)], ['Quantity', '1'], [rep ? 'Cover ends' : 'Reason', rep ? (cover ? dLong(cover.expiryDate) : 'Set by head office') : (it.remarks || '—')], ['Photos', `${photoCount(e, i)} attached`], ['Signature', e.signature ? 'Captured' : 'Not captured']]} />
    </Card>
    {cover && cover.inWarranty && <Banner tone="warn" icon="shield" style={{ marginTop: 12 }}><B>Warranty carried over, not restarted.</B> This battery is covered until {dLong(cover.expiryDate)} — the date the first battery in the chain got. {spanLong(span(today(), cover.expiryDate))} remain. No new period is created.</Banner>}
  </React.Fragment>;
}

/* d16 · review & send */
export function D16() {
  const { f, d } = useFlow(); const { state, setState, audit, dealerId } = useStore(); const { sync } = useSync();
  const token = useAccessToken();
  const [busy, setBusy] = useState(false);
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
      setState(s => audit({ ...s, entries: [data, ...s.entries.filter(x => x.id !== data.id)] }, 'Entry submitted', data.id, state.offline ? 'Saved on the dealer phone to send later' : 'Sent from the dealer app (preview)'));
      d.setFlow(null); d.go('d17', data.id);
      return;
    }
    setBusy(true);
    try {
      const result = await createEntry(buildEntryBody(e), token);
      const data: Entry = { ...e, id: result.ref, apiId: result.id, status: result.status === 'approved' ? 'Approved' : 'Submitted', createdAt: result.createdAt, date: result.entryDate,
        items: e.items.map(it => ({ ...it, wr: it.oldSerial || it.wr })),
        handover: rep ? `Given to ${e.customer || 'the customer'} at the counter · ${dLong(result.createdAt)}, ${tShort(result.createdAt)}` : e.handover };
      setState(s => audit({ ...s, entries: [data, ...s.entries.filter(x => x.id !== e.id)] }, 'Entry submitted', data.id, 'Sent from the dealer app'));
      d.setFlow(null); d.go('d17', data.id);
      sync(true); // the server's copy (with its items and claim) replaces the bridged one
    } catch (err) {
      d.toast(err instanceof ApiError ? err.message : 'Could not reach the server. Try again.');
    } finally { setBusy(false); }
  };
  return <Screen top={<AppBar title="Check before sending" back="d12" />}>
    <Steps labels={rep ? REP_STEPS : RET_STEPS} now={3} />
    <Gap h={13} />
    {errList.length > 0 && <Banner tone="bad" icon="alert" style={{ marginBottom: 12 }}><B>{errList.length === 1 ? 'One thing must be fixed.' : `${errList.length} things must be fixed.`}</B> {errList[0][1]} <B u onPress={() => jump(errList[0][0])}>Go to the field</B></Banner>}
    {warns.length > 0 && <Banner tone="warn" icon="alert" style={{ marginBottom: 12 }}><B>{warns.length === 1 ? 'One thing to look at.' : `${warns.length} things to look at.`}</B> {warns[0].text} Not blocked — confirm it is correct. <B u onPress={() => jump(warns[0].key)}>Go to the field</B></Banner>}
    <Card><CardH title="Entry" right={<Chip tone="mute" mono label={e.id} />} />
      <KV pairs={[['Type', e.type], ['Date', dLong(today())], ['Shop', dealer.name], ['City / place', `${dealer.city} · ${e.place}`], ['Customer', e.customer || '—'], ['Items', `${e.items.length} ${e.items.length === 1 ? 'battery' : 'batteries'}`]]} /></Card>
    {e.items.map((it, i) => <ReviewItem key={it.id} it={it} i={i} e={e} rep={rep} token={token} />)}
    <Card style={{ backgroundColor: T.ink, borderColor: '#000', marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <X s={13} c="#9BA9BB">Total batteries</X><X s={19} w={7} c={T.white}>{e.items.length}</X></Card>
    <Btn kind="primary" big icon="check" label={busy ? 'Sending…' : state.offline ? 'Save and send later' : 'Send entry'} style={{ marginTop: 13 }} onPress={send} disabled={busy} />
    <Hint icon="lock" center style={{ marginTop: 9 }}>{rep ? 'The customer takes the battery today. Head office confirms the claim afterwards.' : 'Head office confirms the return afterwards.'}</Hint>
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
  const cover = rep && lookup?.found && lookup.cover.warrantyStart ? lookup.cover : null;
  const list = (k: 'oldSerial' | 'code') => e.items.map(it => it[k]).filter(Boolean).join(', ') || '—';
  return <Screen top={<View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingHorizontal: 15, paddingBottom: 13, backgroundColor: T.zinc, borderBottomWidth: 1, borderBottomColor: T.zinc2 }}>
    <View style={{ flex: 1 }} /><IconBtn n="x" label="Close" onPress={() => d.tab('d07')} /></View>}>
    <BigOk n={queued ? 'cloud' : 'check'} bg={queued ? T.volt : T.live} />
    <X s={22} w={7} f="c" style={{ textAlign: 'center', marginBottom: 5 }}>{queued ? 'Saved on this phone' : 'Recorded and sent'}</X>
    <X s={15} c={T.slate} style={{ textAlign: 'center', marginBottom: 16 }}>{rep ? (queued ? 'It sends by itself when signal returns. Give the new battery to the customer now.' : 'Give the new battery to the customer now. Head office confirms the claim afterwards — the customer does not wait.') : (queued ? 'It sends by itself when signal returns.' : 'Head office confirms the return afterwards.')}</X>
    <Plate><PlateLab center>REQUEST NUMBER</PlateLab><PlateVal size={22} center>{e.id}</PlateVal></Plate>
    <Card style={{ marginTop: 12 }}><KV pairs={rep
      ? [['Old battery', list('oldSerial'), 'mono'], ['New battery', list('code'), 'mono'], ['Cover ends', cover ? dLong(cover.expiryDate) : 'Set by head office'], ['Remaining', cover ? spanShort(span(today(), cover.expiryDate)) : '—'], [queued ? 'Saved' : 'Sent', tShort(e.createdAt)], ['Claim decided', 'After the battery is checked']]
      : [['Returned battery', list('code'), 'mono'], ['Model', e.items.map(it => it.model).join(', ')], [queued ? 'Saved' : 'Sent', tShort(e.createdAt)], ['Decision', 'By head office']]} /></Card>
    {rep && <Banner tone="warn" icon="shop" style={{ marginTop: 12 }}><B>Keep the old battery in your shop.</B> Hand it over at the next pickup — the claim cannot be settled until the company has checked it.</Banner>}
    <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}>
      <View style={{ flex: 1 }}><Btn kind="ghost" label="Back to home" onPress={() => d.tab('d07')} /></View>
      <View style={{ flex: 1 }}><Btn kind="blue" icon="check" label="Decision" onPress={() => d.go('d32', e.id)} /></View>
    </View>
    <Btn kind="primary" icon="plus" label="Record another" style={{ marginTop: 9 }} onPress={() => { d.setFlow(null); d.go('d10'); }} />
  </Screen>;
}
