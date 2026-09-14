import React, { useState } from 'react';
import { View, Image, Pressable } from 'react-native';
import { useStore } from '../store';
import { Entry, Item, approveEntry, deriveCode, filterEntries, newEntry, newItem, normalize, uid, validateEntry, warranty } from '../domain';
import { exportReport, printEntry } from '../reports';
import { T } from '../dealer/theme';
import { X, B, Mono, Ic, Btn, Card, CardH, Chip, StatusChip, Field, Hint, Banner, Steps, KV, SecT, Line, Avatar, Plate, PlateLab, PlateVal, CapBtn, BigOk } from '../dealer/kit';
import { CREDIT_VALUE, coverChip, coverOf, dLong, dShort, findBattery, nextEntryId, personOf, rupees, tShort, monthShort } from '../dealer/data';
import { Photo, SignaturePad, locate, parseGps, takePhoto } from '../dealer/media';
import { Page, Box, Cols, Stack, Table, Pills, SearchBox, FilterPick, DatePick, Dialog, ReasonDialog, Select, EntryTable, ScanDialog, Diff, Empty, fmtAt, useA } from './ui';

const PENDING = ['Submitted', 'Under Review', 'Conflict'];
const creditOf = (e: Entry) => e.type === 'Replacement' ? e.items.reduce((t, i) => t + (CREDIT_VALUE[i.model] || 0), 0) : 0;
const APPROVE_REASONS = ['Warranty checked against the first sale', 'Battery checked — manufacturing defect', 'Photos and serials match the label'];
const REJECT_REASONS = ['Outside warranty cover', 'Physical damage — not covered', 'Serial does not match the label photo'];

/** Every head office decision on an entry, with the same checks wherever it is taken. */
export function useDecisions() {
  const { state, setState, audit, canEdit } = useStore(); const a = useA();
  const guard = () => {
    if (!canEdit) { a.toast('Read-only access — records cannot be changed.'); return false; }
    if (state.offline) { a.toast('Go online before making a head office decision.'); return false; }
    return true;
  };
  const notice = (dealerId: string, title: string, body: string) => ({ id: uid('N'), title, body, route: 'activity', read: false, dealerId });
  const status = (e: Entry, next: Entry['status'], action: string, reason: string, msg: string) => {
    if (!guard()) return false;
    setState(s => audit({ ...s, entries: s.entries.map(x => x.id === e.id ? { ...x, status: next } : x), notices: [notice(e.dealerId, `${e.id}: ${next === 'Rejected' ? 'refused' : next.toLowerCase()}`, reason), ...s.notices] }, action, e.id, reason, e.status, next));
    a.toast(msg);
  };
  return {
    guard,
    approve: (e: Entry, reason: string) => {
      if (!guard()) return false;
      const errs = validateEntry(e, state);
      if (Object.keys(errs).length) { a.toast(`Cannot approve yet — ${Object.values(errs)[0]}`); return false; }
      setState(s => { const n = approveEntry(s, e); return audit({ ...n, notices: [notice(e.dealerId, `${e.id} approved`, reason), ...n.notices] }, 'Entry approved', e.id, reason, e.status, 'Approved'); });
      a.toast(e.type === 'Replacement' ? `Approved. Stock, warranty history and a ${rupees(creditOf(e))} dealer credit are updated.` : 'Approved. Stock and battery history are updated.');
    },
    reject: (e: Entry, reason: string) => status(e, 'Rejected', 'Reject entry', reason, 'Refused. The dealer sees the reason in their app.'),
    review: (e: Entry, reason: string) => status(e, 'Under Review', 'Start review', reason, 'Marked as under review.'),
    voidEntry: (e: Entry, reason: string) => status(e, 'Cancelled', 'Void / archive entry', reason, 'Voided. It stays searchable and in the audit log.'),
    requestCorrection: (e: Entry, value: string, reason: string) => {
      if (!guard()) return false;
      setState(s => audit({ ...s, entries: s.entries.map(x => x.id === e.id ? { ...x, correction: { reason, value, status: 'Pending' } } : x) }, 'Correction requested', e.id, reason, e.remarks, value));
      a.toast('Correction request added to the queue.');
    },
    declineCorrection: (e: Entry, reason: string) => {
      if (!guard()) return false;
      setState(s => audit({ ...s, entries: s.entries.map(x => x.id === e.id ? { ...x, correction: { ...x.correction!, status: 'Rejected' } } : x), notices: [notice(e.dealerId, `Correction on ${e.id} declined`, reason), ...s.notices] }, 'Reject correction', e.id, reason));
      a.toast('Declined. The dealer is told why.');
    },
    applyCorrection: (e: Entry, ch: { customer: string; remarks: string; items: { code: string; oldSerial: string }[] }, reason: string) => {
      if (!guard()) return false;
      const n = state.entries.filter(x => x.linkedTo === e.id).length + 1;
      const items: Item[] = e.items.map((it, i) => { const code = normalize(ch.items[i]?.code ?? it.code), d = deriveCode(code); return { ...it, id: uid('ITEM'), code, ...(d.mfg ? d : {}), oldSerial: normalize(ch.items[i]?.oldSerial ?? it.oldSerial), wr: ch.items[i]?.oldSerial || it.wr }; });
      const changes: [string, string][] = [];
      if (ch.customer !== e.customer) changes.push([`Customer ${e.customer || '—'}`, `Customer ${ch.customer || '—'}`]);
      if (ch.remarks !== e.remarks) changes.push([`Remarks ${e.remarks || '—'}`, `Remarks ${ch.remarks || '—'}`]);
      items.forEach((it, i) => { if (it.code !== e.items[i].code) changes.push([`Serial ${e.items[i].code}`, `Serial ${it.code}`]); if (it.oldSerial !== e.items[i].oldSerial) changes.push([`Old serial ${e.items[i].oldSerial || '—'}`, `Old serial ${it.oldSerial || '—'}`]); });
      if (!changes.length) { a.toast('Nothing was changed. Edit a value, or decline the request.'); return false; }
      const next: Entry = { ...e, id: `${e.id}-C${n}`, linkedTo: e.id, status: e.status === 'Approved' ? 'Corrected' : 'Submitted', customer: ch.customer, remarks: ch.remarks, items, correction: undefined, createdAt: new Date().toISOString() };
      setState(s => audit({ ...s, entries: [next, ...s.entries.map(x => x.id === e.id ? { ...x, status: 'Corrected' as const, correction: x.correction ? { ...x.correction, status: 'Approved' } : undefined } : x)], notices: [notice(e.dealerId, `Correction on ${e.id} approved`, `Corrected entry ${next.id}. ${reason}`), ...s.notices] }, 'Correction approved', e.id, reason, changes.map(c => c[0]).join('; '), changes.map(c => c[1]).join('; ')));
      a.toast(`Correction applied as ${next.id}. The original stays readable.`);
      return true;
    },
  };
}

/* ---------- requests to approve ---------- */
export function Approvals({ id }: { id?: string }) {
  const a = useA(); const { state, canEdit } = useStore(); const dec = useDecisions();
  const [f, setF] = useState(id === 'conflict' ? 'conflict' : 'waiting'), [q, setQ] = useState(''), [act, setAct] = useState<{ kind: 'approve' | 'reject'; e: Entry } | null>(null);
  const dealer = (id: string) => state.dealers.find(d => d.id === id);
  const pending = state.entries.filter(e => PENDING.includes(e.status));
  const groups: Record<string, (e: Entry) => boolean> = { waiting: e => e.status === 'Submitted', review: e => e.status === 'Under Review', conflict: e => e.status === 'Conflict', all: () => true };
  const n = q.trim().toLowerCase();
  const rows = pending.filter(groups[f]).filter(e => !n || [e.id, e.customer, dealer(e.dealerId)?.name || '', ...e.items.flatMap(i => [i.code, i.oldSerial])].some(v => v.toLowerCase().includes(n)));
  return <Page title="Requests to approve" sub={`${pending.length} waiting · the battery is already with the customer`}>
    <Banner tone="info" icon="shield" style={{ marginBottom: 14 }}><B>What approving does.</B> It accepts the claim, moves the new battery into the register with the original cover dates, marks the old one returned and credits the dealer. A serial exception cannot be approved until it is fixed.</Banner>
    <Box filters={<><Pills value={f} onChange={setF} items={[['waiting', `Waiting ${pending.filter(groups.waiting).length}`], ['conflict', `Serial exceptions ${pending.filter(groups.conflict).length}`], ['review', `Under review ${pending.filter(groups.review).length}`], ['all', `All ${pending.length}`]]} /><SearchBox value={q} onChange={setQ} ph="Dealer, serial or request" /></>}>
      <Table rows={rows} keyOf={e => e.id} onRow={e => a.go('entry', e.id)} empty={f === 'conflict' ? 'No serial exceptions.' : 'Nothing waiting here.'}
        cols={[
          { h: 'Request', w: 1.25, cell: e => <View><X s={12.5} f="m" w={6}>{e.id}</X><X s={12} c={T.slate}>{e.type}</X></View> },
          { h: 'Dealer', w: 1.3, cell: e => <View><X s={13.5} w={6}>{dealer(e.dealerId)?.name}</X><X s={12} c={T.slate}>{dealer(e.dealerId)?.city}</X></View> },
          { h: 'Old → new battery', w: 1.6, cell: e => <View>{e.items.map(i => <X key={i.id} s={12.5} f="m" w={5}>{i.oldSerial ? <X s={12.5} f="m" w={5} c={T.steel}>{i.oldSerial} → </X> : null}{i.code}</X>)}</View> },
          { h: 'Customer', w: 1.1, cell: e => e.customer || '—' },
          { h: 'Raised', w: 0.7, cell: e => dShort(e.createdAt) },
          { h: 'Credit', w: 0.7, cell: e => creditOf(e) ? rupees(creditOf(e)) : '—' },
          { h: 'Decision', w: 1.6, cell: e => e.status === 'Conflict' ? <View style={{ gap: 5 }}><StatusChip status="Conflict" /><Btn kind="ghost" sm label="Open to fix" onPress={() => a.go('entry', e.id)} /></View>
            : canEdit ? <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}><Btn kind="ghost" sm label="Refuse" color={T.terminal} borderColor="#F0C7BC" onPress={() => setAct({ kind: 'reject', e })} /><Btn kind="blue" sm label="Approve" onPress={() => setAct({ kind: 'approve', e })} /></View> : <StatusChip status={e.status} /> },
        ]}
        mobile={{ title: e => dealer(e.dealerId)?.name, sub: e => <><Mono>{e.id}</Mono> · {e.type} · {dShort(e.createdAt)}</>, right: e => <StatusChip status={e.status} /> }} />
    </Box>
    <ReasonDialog open={act?.kind === 'approve'} title={`Approve ${act?.e.id || ''}`} confirm="Approve claim" kind="blue" suggestions={APPROVE_REASONS} onClose={() => setAct(null)} onConfirm={r => act ? dec.approve(act.e, r) : false}
      intro={act ? <>{state.dealers.find(d => d.id === act.e.dealerId)?.name} · {act.e.items.length} {act.e.items.length === 1 ? 'battery' : 'batteries'}{creditOf(act.e) ? ` · ${rupees(creditOf(act.e))} credit to the dealer` : ''}. Cover dates carry over from the first sale — nothing restarts.</> : undefined} />
    <ReasonDialog open={act?.kind === 'reject'} title={`Refuse ${act?.e.id || ''}`} confirm="Refuse claim" kind="danger" suggestions={REJECT_REASONS} onClose={() => setAct(null)} onConfirm={r => act ? dec.reject(act.e, r) : false}
      intro="The dealer sees this reason in their app. The customer keeps the battery already given; head office settles it with the dealer." />
  </Page>;
}

/* ---------- all entries ---------- */
export function Entries() {
  const a = useA(); const { state, setState, audit, canEdit } = useStore();
  const [q, setQ] = useState(''), [dealer, setDealer] = useState('All'), [type, setType] = useState('All'), [status, setStatus] = useState('All'), [model, setModel] = useState('All'), [from, setFrom] = useState(''), [to, setTo] = useState(''), [busy, setBusy] = useState(false);
  const dealerId = state.dealers.find(d => d.name === dealer)?.id;
  const rows = filterEntries(state.entries, q, type, status, model, from, to).filter(e => !dealerId || e.dealerId === dealerId);
  const any = q || dealer !== 'All' || type !== 'All' || status !== 'All' || model !== 'All' || from || to;
  const exportNow = async () => {
    if (state.offline) { a.toast('Exports need online mode.'); return; }
    setBusy(true);
    try { const count = await exportReport(rows, state, 'Excel'); setState(s => audit({ ...s, exports: [{ id: uid('EXP'), name: 'Entry register · Excel', rows: count, date: new Date().toISOString() }, ...s.exports] }, 'Report exported', 'REPORT', `${count} items; ${[dealer, type, status, model, from, to].filter(v => v && v !== 'All').join('; ') || 'no filters'}`)); a.toast(`${count} battery lines exported to Excel.`); }
    catch { a.toast('The export could not finish. Try again.'); } finally { setBusy(false); }
  };
  return <Page title="All entries" sub={`Every entry, every battery line — ${state.entries.length} records`}
    actions={<>{canEdit && <Btn kind="primary" sm icon="plus" label="Record an entry" onPress={() => a.go('new')} />}<Btn kind="ghost" sm icon="excel" label={busy ? 'Preparing…' : `Export ${rows.length} to Excel`} disabled={busy || !rows.length} onPress={exportNow} /><Btn kind="ghost" sm icon="chart" label="More report options" onPress={() => a.go('reports')} /></>}>
    <Box filters={<>
      <SearchBox value={q} onChange={setQ} ph="Reference, serial, model or customer" />
      <FilterPick label="Dealer" value={dealer} options={state.dealers.map(d => d.name)} onChange={setDealer} />
      <FilterPick label="Type" value={type} options={state.entryTypes} onChange={setType} />
      <FilterPick label="Status" value={status} options={['Draft', 'Pending sync', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Corrected', 'Conflict', 'Cancelled']} onChange={setStatus} />
      <FilterPick label="Model" value={model} options={state.models.map(m => m.id)} onChange={setModel} />
      <DatePick label="From" value={from} onChange={setFrom} /><DatePick label="To" value={to} onChange={setTo} />
      {any ? <Pressable accessibilityRole="button" onPress={() => { setQ(''); setDealer('All'); setType('All'); setStatus('All'); setModel('All'); setFrom(''); setTo(''); }}><X s={12.5} w={6} c={T.steel}>Clear all</X></Pressable> : null}
    </>}>
      <EntryTable entries={rows} onOpen={e => a.go(e.status === 'Draft' ? 'new' : 'entry', e.id)} />
    </Box>
    <Hint icon="excel" style={{ marginTop: 11 }}>{`Showing ${rows.length} of ${state.entries.length}. The Excel file keeps your column order and writes serials as text, so 0047 stays 0047.`}</Hint>
  </Page>;
}

/* ---------- correction requests ---------- */
export function Corrections() {
  const a = useA(); const { state, canEdit } = useStore(); const dec = useDecisions();
  const [apply, setApply] = useState<Entry | null>(null), [decline, setDecline] = useState<Entry | null>(null);
  const rows = state.entries.filter(e => e.correction?.status === 'Pending');
  const done = state.audits.filter(x => ['Correction approved', 'Reject correction'].includes(x.action)).slice(0, 8);
  return <Page title="Correction requests" sub={`${rows.length} waiting · sent entries are never edited in place`}>
    <Banner tone="info" icon="lock" style={{ marginBottom: 14 }}><B>How a correction works.</B> Approving creates a linked, corrected copy and marks the original “Corrected”. The first version is never rewritten or deleted.</Banner>
    <Cols weights={[1.55, 1]}>
      <Stack>{rows.length ? rows.map(e => {
        const raised = state.audits.find(x => x.ref === e.id && x.action === 'Correction requested');
        const d = state.dealers.find(x => x.id === e.dealerId);
        return <Card key={e.id}>
          <CardH mono title={e.id} right={<StatusChip status="Under Review" label="Waiting" />} />
          <KV cols={a.wide ? 3 : 2} pairs={[['Dealer', d?.name || e.dealerId], ['Asked by', personOf(raised?.actor)], ['Asked on', raised ? `${dShort(raised.at)}, ${tShort(raised.at)}` : '—'], ['Entry status', e.status === 'Conflict' ? 'Serial exception' : e.status], ['Batteries', e.items.map(i => i.code).join(', '), 'mono'], ['Customer', e.customer || '—']]} />
          <View style={{ backgroundColor: '#FAFBFD', borderWidth: 1, borderColor: T.zinc2, borderRadius: 9, padding: 12, marginTop: 12 }}>
            <X s={12} w={6} c={T.slate}>What should change</X><X s={14} w={6} style={{ marginTop: 2 }}>{e.correction!.value}</X>
            <X s={12} w={6} c={T.slate} style={{ marginTop: 8 }}>Why</X><X s={13.5}>{e.correction!.reason}</X></View>
          <View style={{ flexDirection: 'row', gap: 9, marginTop: 12, flexWrap: 'wrap' }}>
            <Btn kind="ghost" sm label="Open entry" onPress={() => a.go('entry', e.id)} />
            {canEdit && <Btn kind="ghost" sm label="Decline" color={T.terminal} borderColor="#F0C7BC" onPress={() => setDecline(e)} />}
            {canEdit && <Btn kind="blue" sm icon="pen" label="Make the change" onPress={() => setApply(e)} />}
          </View>
        </Card>;
      }) : <Box><Empty icon="check" title="No correction requests" text="When a dealer or admin asks for a sent entry to be changed, it waits here." /></Box>}</Stack>
      <Box title="Recently decided">{done.length ? <View style={{ paddingHorizontal: 14 }}>{done.map((x, i) => <Line key={x.id} last={i === done.length - 1} onPress={() => a.go('entry', x.ref)} av={<Avatar n={x.action === 'Correction approved' ? 'check' : 'x'} tone={x.action === 'Correction approved' ? 'green' : 'red'} />} title={<Mono>{x.ref}</Mono>} sub={`${x.action === 'Correction approved' ? 'Applied' : 'Declined'} · ${personOf(x.actor)} · ${dShort(x.at)}`} />)}</View> : <X s={13.5} c={T.slate} style={{ padding: 14 }}>Nothing decided yet.</X>}</Box>
    </Cols>
    {apply && <ApplyCorrection e={apply} onClose={() => setApply(null)} />}
    <ReasonDialog open={!!decline} title={`Decline correction on ${decline?.id || ''}`} confirm="Decline request" kind="danger" onClose={() => setDecline(null)} onConfirm={r => decline ? dec.declineCorrection(decline, r) : false} intro="The entry stays as it is. The dealer sees this reason." />
  </Page>;
}
function ApplyCorrection({ e, onClose }: { e: Entry; onClose: () => void }) {
  const dec = useDecisions();
  const [customer, setCustomer] = useState(e.customer), [remarks, setRemarks] = useState(e.remarks), [items, setItems] = useState(e.items.map(i => ({ code: i.code, oldSerial: i.oldSerial }))), [reason, setReason] = useState(e.correction?.reason || ''), [err, setErr] = useState('');
  return <Dialog open title={`Correct ${e.id}`} sub="Change only what is wrong — a linked copy is created" onClose={onClose} width={620}>
    {e.correction && <Banner tone="warn" icon="pen" style={{ marginBottom: 14 }}><B>Asked for:</B> {e.correction.value}</Banner>}
    {e.items.map((it, i) => <View key={it.id} style={{ flexDirection: 'row', gap: 9 }}>
      <Field style={{ flex: 1 }} label={`Battery ${i + 1} serial`} mono numeric maxLength={8} value={items[i].code} onChange={v => setItems(x => x.map((y, j) => j === i ? { ...y, code: v.replace(/\D/g, '') } : y))} hint={items[i].code !== it.code ? `was ${it.code}` : undefined} hintIcon="pen" />
      <Field style={{ flex: 1 }} label="Old serial" mono numeric maxLength={8} value={items[i].oldSerial} onChange={v => setItems(x => x.map((y, j) => j === i ? { ...y, oldSerial: v.replace(/\D/g, '') } : y))} hint={items[i].oldSerial !== it.oldSerial ? `was ${it.oldSerial || '—'}` : undefined} hintIcon="pen" />
    </View>)}
    <Field label="Customer" value={customer} onChange={setCustomer} />
    <Field label="Remarks" value={remarks} onChange={setRemarks} multiline />
    <Field label="Reason for the change" req value={reason} onChange={v => { setReason(v); setErr(''); }} multiline error={err} />
    <Btn kind="blue" icon="check" label="Apply correction" onPress={() => { if (reason.trim().length < 5) { setErr('Write at least a few words (5 characters).'); return; } if (dec.applyCorrection(e, { customer, remarks, items }, reason.trim())) onClose(); }} />
  </Dialog>;
}

/* ---------- entry detail ---------- */
export function EntryDetail({ id }: { id?: string }) {
  const a = useA(); const { state, canEdit } = useStore(); const dec = useDecisions();
  const [act, setAct] = useState(''), [askFix, setAskFix] = useState(false), [fixValue, setFixValue] = useState(''), [apply, setApply] = useState(false);
  const e = state.entries.find(x => x.id === id);
  if (!e) return <Page title="Entry" back><Empty icon="alert" title="Entry not found" text="It may have been opened from an old link." /></Page>;
  if (e.status === 'Draft') return <NewEntry id={e.id} />;
  const dealer = state.dealers.find(d => d.id === e.dealerId);
  const problems = Object.values(validateEntry(e, state));
  const pending = PENDING.includes(e.status);
  const history = state.audits.filter(x => x.ref === e.id || x.ref === e.linkedTo || state.challans.some(c => c.no === x.ref && c.entryIds.includes(e.id))).sort((x, y) => y.at.localeCompare(x.at));
  const linked = state.entries.filter(x => x.linkedTo === e.id || x.id === e.linkedTo);
  const tags = e.evidenceTags && e.evidenceTags.length === e.evidence.length ? e.evidenceTags : e.evidence.map((_, i) => `Photo ${i + 1}`);
  const g = parseGps(e.gps);
  const banner = e.status === 'Conflict' ? <Banner tone="bad" icon="alert"><B>Serial exception — this cannot be approved yet.</B> {problems[0] || 'A serial needs checking.'} Ask the dealer for a correction, or correct it yourself.</Banner>
    : e.status === 'Submitted' ? <Banner tone="warn" icon="clock"><B>Waiting for your decision.</B> {e.type === 'Replacement' ? `The customer already has the new battery. Approving credits the dealer ${rupees(creditOf(e))}.` : 'Approving updates stock and battery history.'}</Banner>
    : e.status === 'Under Review' ? <Banner tone="info" icon="eye"><B>Under review.</B> Approve or refuse once the check is done.</Banner>
    : e.status === 'Approved' ? <Banner tone="ok" icon="check"><B>Approved.</B> Stock, warranty history and the replacement chain are updated.</Banner>
    : e.status === 'Rejected' ? <Banner tone="bad" icon="x"><B>Refused.</B> {state.audits.find(x => x.ref === e.id && x.action === 'Reject entry')?.reason || ''}</Banner>
    : e.status === 'Pending sync' ? <Banner tone="warn" icon="sync"><B>Still on the dealer’s phone.</B> It reaches head office when their phone is back online.</Banner>
    : e.status === 'Corrected' ? <Banner tone="info" icon="pen"><B>Corrected.</B> See the linked entry for the current values. This version stays readable.</Banner>
    : <Banner tone="info" icon="x"><B>Voided.</B> Removed from live totals, kept in search and the audit log.</Banner>;
  return <Page back title={e.id} sub={`${dealer?.name || e.dealerId} · ${e.type} · ${dLong(e.date)}`}
    actions={<>
      {canEdit && pending && e.status !== 'Conflict' && <Btn kind="blue" sm icon="check" label="Approve" onPress={() => setAct('approve')} />}
      {canEdit && pending && e.status !== 'Under Review' && <Btn kind="ghost" sm icon="eye" label="Start review" onPress={() => setAct('review')} />}
      {canEdit && pending && <Btn kind="ghost" sm icon="x" label="Refuse" color={T.terminal} borderColor="#F0C7BC" onPress={() => setAct('reject')} />}
      {canEdit && !['Cancelled', 'Corrected'].includes(e.status) && <Btn kind="ghost" sm icon="pen" label="Correct it" onPress={() => setApply(true)} />}
      <Btn kind="ghost" sm icon="down" label="Print acknowledgement" onPress={() => { if (dealer) printEntry(e, dealer).catch(() => a.toast('Printing is not available on this device.')); }} />
    </>}>
    <View style={{ marginBottom: 14 }}>{banner}</View>
    <Cols weights={[1.55, 1]}>
      <Stack>
        {e.items.map((it, i) => {
          const old = it.oldSerial ? findBattery(state, it.oldSerial) : undefined, cover = coverOf(old || findBattery(state, it.code), state);
          const [cl, ct] = coverChip(cover?.status || '');
          return <Card key={it.id}>
            <CardH title={`Battery ${i + 1} · ${it.model}`} right={<Chip tone={ct} icon="shield" label={cl} />} />
            <Plate style={{ marginBottom: 11 }}>{it.oldSerial ? <><PlateLab>OLD BATTERY OUT</PlateLab><PlateVal>{it.oldSerial}</PlateVal><X s={19} c={T.volt} style={{ textAlign: 'center', marginVertical: 4 }}>↓</X><PlateLab>NEW BATTERY IN</PlateLab><PlateVal color="#7FD3A9">{it.code}</PlateVal></> : <><PlateLab>BATTERY</PlateLab><PlateVal>{it.code}</PlateVal></>}</Plate>
            <KV cols={a.wide ? 3 : 2} pairs={[['Short serial', it.serial, 'mono'], ['Made', monthShort(it.mfg)], ['Cover ends', cover ? dLong(cover.expiry) : 'Not on record'], ['Replacement month', it.rpl || '—'], ['Return month', it.rtn || '—'], ['WR reference', it.wr || '—', 'mono'], ['Reported fault', it.fault || '—'], ['Remarks', it.remarks || '—']]} />
            {it.oldSerial && !old && <Banner tone="warn" icon="eye" style={{ marginTop: 11 }}>Old serial {it.oldSerial} is not on record — check it against the paper register. No cover dates are guessed.</Banner>}
            <View style={{ flexDirection: 'row', gap: 9, marginTop: 11, flexWrap: 'wrap' }}>
              <Btn kind="ghost" sm icon="link" label="Battery & chain" onPress={() => a.go('battery', it.code)} />
              {it.oldSerial && old && <Btn kind="ghost" sm icon="batt" label="Old battery" onPress={() => a.go('battery', it.oldSerial)} />}
            </View>
          </Card>;
        })}
        <Box title="Photos and proof" pad>
          {e.evidence.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>{e.evidence.map((uri, i) => <View key={i} style={{ width: 150 }}><Image source={{ uri }} style={{ width: 150, height: 112, borderRadius: 9, backgroundColor: T.zinc2 }} /><X s={12} w={6} c={T.slate} style={{ marginTop: 4 }}>{tags[i]}</X></View>)}</View> : <X s={13.5} c={T.slate}>No photos attached.</X>}
          <View style={{ height: 12 }} />
          <KV pairs={[['Location', g ? `${g.place || g.coords} · ±${g.accuracy}` : 'Not added'], ['Customer signature', e.signature ? 'Captured' : 'Not captured'], ['Customer told cover end', e.coverTold ? `${dShort(e.coverTold)}, ${tShort(e.coverTold)}` : '—'], ['Handover', e.handover || '—']]} />
        </Box>
        <Box title="Everything that happened" right={<Chip tone="mute" label={`${history.length} events · nothing deleted`} />}>
          {history.length ? <View style={{ paddingHorizontal: 14 }}>{history.map((h, i) => <View key={h.id} style={{ flexDirection: a.wide ? 'row' : 'column', gap: a.wide ? 11 : 2, paddingVertical: 11, borderBottomWidth: i < history.length - 1 ? 1 : 0, borderBottomColor: T.zinc2 }}>
            <X s={11.5} f="m" w={5} c={T.slate} style={a.wide ? { width: 118, paddingTop: 2 } : undefined}>{fmtAt(h.at)}</X>
            <View style={{ flex: 1 }}><X s={13.5} w={6}>{h.action}{h.ref !== e.id ? <X s={12} c={T.slate}> · {h.ref}</X> : null}</X><X s={12.5} c={T.slate}>{h.actor}{h.reason ? ` — ${h.reason}` : ''}</X><Diff was={h.before} now={h.after} /></View></View>)}</View>
            : <X s={13.5} c={T.slate} style={{ padding: 14 }}>No events recorded for this entry yet.</X>}
        </Box>
      </Stack>
      <Stack>
        <Card><CardH title="Entry" right={<StatusChip status={e.status} />} />
          <KV pairs={[['Dealer', dealer?.name || e.dealerId], ['City · place', `${dealer?.city || '—'} · ${e.place}`], ['Customer', e.customer || '—'], ['Reference', e.order || '—'], ['Date', dLong(e.date)], ['Sent', `${dShort(e.createdAt)}, ${tShort(e.createdAt)}`], ['Batteries', String(e.items.length)], ['Dealer credit', creditOf(e) ? rupees(creditOf(e)) : '—']]} />
          {e.remarks ? <X s={13.5} c={T.ink3} style={{ marginTop: 11 }}>“{e.remarks}”</X> : null}
          {dealer && <Btn kind="ghost" sm icon="shop" label="Open dealer" style={{ marginTop: 11 }} onPress={() => a.go('dealer', dealer.id)} />}
        </Card>
        {e.type === 'Replacement' && <Card><CardH title="Old battery return" right={<StatusChip status={e.returnState === 'In transit' ? 'In transit' : e.returnState === 'Closed' ? 'Closed' : e.returnState && e.returnState !== 'At dealer' ? 'Received' : 'Pending Approval'} label={e.returnState || 'At dealer'} />} />
          <X s={13.5} c={T.slate}>{e.returnNote || 'Still in the dealer’s shop until the next pickup.'}</X>
          <Btn kind="ghost" sm icon="truck" label="Open returns" style={{ marginTop: 11 }} onPress={() => a.go('returns')} /></Card>}
        {e.correction && <Card><CardH title="Correction request" right={<StatusChip status={e.correction.status === 'Pending' ? 'Under Review' : e.correction.status} label={e.correction.status} />} />
          <X s={14} w={6}>{e.correction.value}</X><X s={13} c={T.slate} style={{ marginTop: 4 }}>{e.correction.reason}</X>
          {canEdit && e.correction.status === 'Pending' && <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}><Btn kind="ghost" sm label="Decline" color={T.terminal} borderColor="#F0C7BC" onPress={() => setAct('decline')} /><Btn kind="blue" sm label="Make the change" onPress={() => setApply(true)} /></View>}</Card>}
        {linked.length > 0 && <Box title="Linked entries">{<View style={{ paddingHorizontal: 14 }}>{linked.map((x, i) => <Line key={x.id} last={i === linked.length - 1} onPress={() => a.go('entry', x.id)} av={<Avatar n="link" tone="vio" />} title={<Mono>{x.id}</Mono>} sub={x.id === e.linkedTo ? 'Original entry' : 'Corrected copy'} right={<StatusChip status={x.status} />} />)}</View>}</Box>}
        {canEdit && <Card><CardH title="Other actions" />
          {!e.correction || e.correction.status !== 'Pending' ? <Btn kind="ghost" sm icon="pen" label="Ask the dealer for a correction" style={{ alignSelf: 'stretch' }} onPress={() => { setFixValue(''); setAskFix(true); }} /> : null}
          {e.status !== 'Cancelled' && <Btn kind="ghost" sm icon="alert" label="Void / archive this entry" color={T.terminal} borderColor="#F0C7BC" style={{ alignSelf: 'stretch', marginTop: 9 }} onPress={() => setAct('void')} />}
          <Hint icon="lock" style={{ marginTop: 10 }}>Nobody can permanently delete an entry, a battery or an audit event — including the Main Admin.</Hint>
        </Card>}
      </Stack>
    </Cols>
    <ReasonDialog open={act === 'approve'} title={`Approve ${e.id}`} confirm="Approve" suggestions={APPROVE_REASONS} onClose={() => setAct('')} onConfirm={r => dec.approve(e, r)} intro={creditOf(e) ? `The dealer is credited ${rupees(creditOf(e))}. Cover dates carry over from the first sale.` : 'Stock and battery history are updated.'} />
    <ReasonDialog open={act === 'review'} title="Start a review" confirm="Mark under review" suggestions={['Waiting for the old battery to arrive', 'Checking the label photo', 'Calling the dealer']} onClose={() => setAct('')} onConfirm={r => dec.review(e, r)} />
    <ReasonDialog open={act === 'reject'} title={`Refuse ${e.id}`} confirm="Refuse" kind="danger" suggestions={REJECT_REASONS} onClose={() => setAct('')} onConfirm={r => dec.reject(e, r)} intro="The dealer sees this reason in their app." />
    <ReasonDialog open={act === 'void'} title="Void / archive this entry" confirm="Void entry" kind="danger" onClose={() => setAct('')} onConfirm={r => dec.voidEntry(e, r)} intro="It leaves live totals and reports, but stays fully readable in search, history and the audit log." />
    <ReasonDialog open={act === 'decline'} title="Decline the correction" confirm="Decline" kind="danger" onClose={() => setAct('')} onConfirm={r => dec.declineCorrection(e, r)} />
    <ReasonDialog open={askFix} title="Ask for a correction" confirm="Add to correction queue" onClose={() => setAskFix(false)} onConfirm={r => { if (fixValue.trim().length < 3) { a.toast('Say what should change.'); return false; } return dec.requestCorrection(e, fixValue.trim(), r); }}>
      <Field label="What should change?" req value={fixValue} onChange={setFixValue} ph="e.g. Serial 26080319 should be 26080318" multiline />
    </ReasonDialog>
    {apply && <ApplyCorrection e={e} onClose={() => setApply(false)} />}
  </Page>;
}

/* ---------- record an entry for a dealer ---------- */
export function NewEntry({ id }: { id?: string }) {
  const a = useA(); const { state, setState, audit, canEdit } = useStore();
  const active = state.dealers.filter(d => d.status === 'Active');
  const [entry, setEntry] = useState<Entry>(() => {
    const draft = state.entries.find(e => e.id === id && e.status === 'Draft');
    if (draft) return draft;
    if (id?.startsWith('claim:')) { const b = findBattery(state, id.slice(6)); const e = { ...newEntry(b?.dealerId || active[0]?.id || '', 'Replacement'), id: nextEntryId(state), customer: b?.customer || '' }; e.items[0] = { ...e.items[0], oldSerial: id.slice(6), model: b?.model || 'M5' }; return e; }
    return { ...newEntry(active[0]?.id || '', 'Replacement'), id: nextEntryId(state), place: active[0]?.place || '' };
  });
  const [step, setStep] = useState(1), [errors, setErrors] = useState<Record<string, string>>({}), [scan, setScan] = useState<number | null>(null), [done, setDone] = useState<Entry | null>(null);
  const dealer = state.dealers.find(d => d.id === entry.dealerId);
  const upd = (v: Partial<Entry>) => setEntry(e => ({ ...e, ...v }));
  const item = (i: number, v: Partial<Item>) => setEntry(e => ({ ...e, items: e.items.map((it, j) => j === i ? { ...it, ...v } : it) }));
  const save = (status: Entry['status']) => {
    const data = { ...entry, status, createdAt: status === 'Draft' ? entry.createdAt : new Date().toISOString() };
    setState(s => audit({ ...s, entries: [data, ...s.entries.filter(e => e.id !== data.id)] }, status === 'Draft' ? 'Draft saved' : 'Entry submitted', data.id, status === 'Pending sync' ? 'Saved locally for sync' : `Recorded by head office for ${dealer?.name || data.dealerId}`));
    return data;
  };
  const next = () => {
    const all = validateEntry(entry, state);
    const relevant = Object.fromEntries(Object.entries(all).filter(([k]) => step === 1 ? !k.startsWith('items') : k.startsWith('items')));
    setErrors(relevant); if (!Object.keys(relevant).length) setStep(step + 1);
  };
  if (!canEdit) return <Page title="Record an entry"><Empty icon="lock" title="Read-only access" text="You can look at every entry, but recording one needs an admin role." /></Page>;
  if (done) return <Page title="Record an entry"><Card style={{ maxWidth: 560, alignSelf: 'center', width: '100%' }}>
    <BigOk n={done.status === 'Pending sync' ? 'cloud' : 'check'} bg={done.status === 'Pending sync' ? T.volt : T.live} />
    <X s={22} w={7} f="c" style={{ textAlign: 'center' }}>{done.status === 'Pending sync' ? 'Saved to send later' : 'Recorded and waiting for approval'}</X>
    <X s={14.5} c={T.slate} style={{ textAlign: 'center', marginTop: 6, marginBottom: 16 }}>{done.items.length} {done.items.length === 1 ? 'battery' : 'batteries'} for {dealer?.name}. Approve it from the queue when it has been checked.</X>
    <Plate><PlateLab center>REFERENCE</PlateLab><PlateVal center size={22}>{done.id}</PlateVal></Plate>
    <View style={{ flexDirection: 'row', gap: 9, marginTop: 14 }}><View style={{ flex: 1 }}><Btn kind="ghost" label="Record another" onPress={() => a.root('new')} /></View><View style={{ flex: 1 }}><Btn kind="blue" label="Open entry" onPress={() => a.go('entry', done.id)} /></View></View>
  </Card></Page>;

  const rep = entry.type === 'Replacement';
  const footer = <View style={{ flexDirection: 'row', gap: 9, marginTop: 16, flexWrap: 'wrap' }}>
    <Btn kind="ghost" icon="back" label="Back" disabled={step === 1} onPress={() => setStep(step - 1)} />
    <Btn kind="ghost" label="Save draft" onPress={() => { save('Draft'); a.toast('Draft saved. Find it under All entries.'); }} />
    <View style={{ flex: 1 }} />
    {step < 4 ? <Btn kind="primary" iconAfter="chev" label="Continue" onPress={step === 3 ? () => setStep(4) : next} />
      : <Btn kind="primary" icon="check" label={state.offline ? 'Save and send later' : 'Send for approval'} onPress={() => {
        const all = validateEntry(entry, state); setErrors(all); if (Object.keys(all).length) { a.toast('Some details need fixing — see the list above.'); return; }
        if (dealer?.status !== 'Active') { a.toast('This dealer is not active. Save a draft until the account is restored.'); return; }
        setDone(save(state.offline ? 'Pending sync' : 'Submitted'));
      }} />}
  </View>;
  return <Page back title="Record an entry" sub="For a dealer — the same checks as the dealer app">
    <View style={{ maxWidth: 900, width: '100%', alignSelf: 'center' }}>
      <Steps labels={['1 · Details', '2 · Batteries', '3 · Photos & proof', '4 · Check']} now={step} />
      <View style={{ height: 14 }} />
      {step === 1 && <Card>
        <Cols><Select label="Dealer" req value={dealer?.name || ''} options={active.map(d => ({ v: d.name, sub: `${d.id} · ${d.city}` }))} onChange={v => { const d = active.find(x => x.name === v)!; upd({ dealerId: d.id, place: d.place || entry.place }); }} />
          <Select label="Entry type" req value={entry.type} options={state.entryTypes} onChange={type => upd({ type })} /></Cols>
        <Cols><Field label="Date" req mono value={entry.date} onChange={date => upd({ date })} ph="YYYY-MM-DD" error={errors.date} hint="Within the last 30 days." hintIcon="clock" />
          <Field label="Place / area" req value={entry.place} onChange={place => upd({ place })} error={errors.place} /></Cols>
        <Cols><Field label="Customer or sub-dealer" value={entry.customer} onChange={customer => upd({ customer })} ph="Customer or business name" />
          <Field label="Reference / order number" value={entry.order} onChange={order => upd({ order })} ph="Optional" /></Cols>
        <Field label="Remarks" req={entry.type === 'Other'} value={entry.remarks} onChange={remarks => upd({ remarks })} multiline error={errors.remarks} />
      </Card>}
      {step === 2 && <Stack>
        {errors.items && <Banner tone="bad" icon="alert">{errors.items}</Banner>}
        {entry.items.map((it, i) => {
          const old = it.oldSerial.length === 8 ? findBattery(state, it.oldSerial) : undefined, cover = coverOf(old, state);
          const k = (f: string) => errors[`items.${i}.${f}`];
          return <Card key={it.id}>
            <CardH title={`Battery ${i + 1}`} right={<View style={{ flexDirection: 'row', gap: 6 }}>
              {i > 0 && <Btn kind="ghost" sm icon="up" label="Move up" onPress={() => { const items = [...entry.items]; [items[i - 1], items[i]] = [items[i], items[i - 1]]; upd({ items }); }} />}
              {entry.items.length > 1 && <Btn kind="ghost" sm icon="x" label="Remove" color={T.terminal} borderColor="#F0C7BC" onPress={() => upd({ items: entry.items.filter((_, j) => j !== i) })} />}</View>} />
            <Cols>
              <Field label="Serial number (8-digit code)" req mono numeric maxLength={8} value={it.code} onChange={v => { const code = v.replace(/\D/g, ''); const b = code.length === 8 ? findBattery(state, code) : undefined; item(i, { code, ...deriveCode(code), ...(b ? { model: b.model } : {}) }); }} error={k('code')} ph="e.g. 26080311"
                tail={<CapBtn n="scan" tone="alt" label={`Scan battery ${i + 1}`} onPress={() => setScan(i)} />} hint="Leading zeros are kept exactly as printed." hintIcon="lock" />
              <Select label="Model" req value={it.model} options={state.models.filter(m => m.active).map(m => ({ v: m.id, sub: `${m.type} · ${m.capacity}` }))} onChange={model => item(i, { model })} />
            </Cols>
            <Cols>
              <Field label="Short serial" req mono numeric maxLength={4} value={it.serial} onChange={serial => item(i, { serial })} error={k('serial')} hint="Filled from the code." hintIcon="lock" />
              <Field label="Manufacturing month" mono value={it.mfg} onChange={mfg => item(i, { mfg })} ph="YYYY-MM" error={k('mfg')} />
            </Cols>
            <Field label={rep ? 'Old battery serial' : 'Old battery serial (optional)'} req={rep} mono numeric maxLength={8} value={it.oldSerial} onChange={v => item(i, { oldSerial: v.replace(/\D/g, '') })} error={k('oldSerial')} ph="The battery that came back" />
            {it.oldSerial.length === 8 && (old ? <Banner tone={cover?.status === 'Expired' ? 'bad' : 'ok'} icon="shield" style={{ marginBottom: 13 }}><B>{old.model} · on record.</B> {cover ? `Cover ${dLong(cover.start)} → ${dLong(cover.expiry)}. The replacement inherits these dates.` : 'No cover dates on record.'}</Banner>
              : <Banner tone="warn" icon="eye" style={{ marginBottom: 13 }}>Not on record. It will be flagged for checking — no cover dates are invented.</Banner>)}
            <Cols>
              <Field label="WR reference" mono value={it.wr} onChange={wr => item(i, { wr })} />
              <Field label="Replacement month" mono value={it.rpl} onChange={rpl => item(i, { rpl })} ph="YYYY-MM" error={k('rpl')} />
              <Field label="Return month" mono value={it.rtn} onChange={rtn => item(i, { rtn })} ph="YYYY-MM" error={k('rtn')} />
            </Cols>
            <Field label="Remarks for this battery" value={it.remarks} onChange={remarks => item(i, { remarks })} />
          </Card>;
        })}
        <Btn kind="ghost" icon="plus" label="Add another battery" onPress={() => upd({ items: [...entry.items, newItem()] })} />
        <Hint icon="batt">Total quantity: {entry.items.length}. Each battery is its own line — the total is never typed.</Hint>
      </Stack>}
      {step === 3 && <Card>
        <CardH title="Photos" right={<Chip tone="mute" label="Optional" />} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
          {entry.evidence.map((uri, i) => <View key={i} style={{ width: 140 }}><Photo label={`Photo ${i + 1} ✓`} uri={uri} height={100} /><Pressable accessibilityRole="button" onPress={() => upd({ evidence: entry.evidence.filter((_, j) => j !== i), evidenceTags: entry.evidenceTags?.filter((_, j) => j !== i) })}><X s={12.5} w={6} c={T.terminal} style={{ marginTop: 4 }}>Remove</X></Pressable></View>)}
          <View style={{ width: 140 }}><Photo label="Take a photo" height={100} onPress={async () => { const u = await takePhoto(a.toast); if (u) upd({ evidence: [...entry.evidence, u], evidenceTags: [...(entry.evidenceTags || entry.evidence.map((_, j) => `Photo ${j + 1}`)), `Photo ${entry.evidence.length + 1}`] }); }} /></View>
          <View style={{ width: 140 }}><Photo label="Choose a photo" icon="upload" height={100} onPress={async () => { const u = await takePhoto(a.toast, true); if (u) upd({ evidence: [...entry.evidence, u], evidenceTags: [...(entry.evidenceTags || entry.evidence.map((_, j) => `Photo ${j + 1}`)), `Photo ${entry.evidence.length + 1}`] }); }} /></View>
        </View>
        <SecT title="Location" />
        <Line last onPress={async () => { const r = await locate(); if (r.gps) upd({ gps: r.gps }); else a.toast(r.error === 'declined' ? 'Location declined. The entry still saves.' : 'Location is not available right now.'); }} av={<Avatar n="pin" tone={entry.gps ? 'green' : 'mute'} />} title={entry.gps ? parseGps(entry.gps)?.place || parseGps(entry.gps)?.coords : 'Add location'} sub={entry.gps ? `±${parseGps(entry.gps)?.accuracy}` : 'Optional — tap to attach'} right={<Chip tone={entry.gps ? 'live' : 'mute'} label={entry.gps ? 'On' : 'Off'} />} />
        <SecT title="Customer signature" />
        <SignaturePad value={entry.signature} onChange={v => upd({ signature: v || undefined })} />
        <Hint icon="pen">Records handover. It is not a legal e-signature.</Hint>
      </Card>}
      {step === 4 && <Stack>
        {Object.keys(errors).length > 0 && <Banner tone="bad" icon="alert"><B>Fix before sending:</B> {Object.values(errors).join(' ')}</Banner>}
        <Card><CardH title="Entry" right={<Chip tone="mute" mono label={entry.id} />} />
          <KV cols={a.wide ? 3 : 2} pairs={[['Dealer', dealer?.name || '—'], ['Type', entry.type], ['Date', dLong(entry.date)], ['Place', entry.place], ['Customer', entry.customer || '—'], ['Batteries', String(entry.items.length)], ['Photos', String(entry.evidence.length)], ['Location', entry.gps ? 'Added' : 'Not added'], ['Signature', entry.signature ? 'Captured' : 'Not captured']]} /></Card>
        {entry.items.map((it, i) => <Card key={it.id}><Line last title={<>{i + 1}. {it.model} · <Mono>{it.code || '—'}</Mono></>} sub={<>{it.oldSerial ? <>replaces <Mono>{it.oldSerial}</Mono> · </> : null}serial {it.serial || '—'} · made {monthShort(it.mfg)}</>} right={<Btn kind="ghost" sm label="Edit" onPress={() => setStep(2)} />} /></Card>)}
        <Banner tone={state.offline ? 'warn' : 'info'} icon={state.offline ? 'cloud' : 'shield'}>{state.offline ? 'You are offline. It is saved on this device and sent when you reconnect.' : 'It goes into “Requests to approve”. Stock and warranty change only when it is approved.'}</Banner>
      </Stack>}
      {footer}
    </View>
    <ScanDialog open={scan !== null} onClose={() => setScan(null)} onCode={code => { if (scan === null) return; const b = findBattery(state, code); item(scan, { code, ...deriveCode(code), ...(b ? { model: b.model } : {}) }); }} />
  </Page>;
}
