import React, { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { useStore } from '../store';
import { Customer, Dealer, uid } from '../domain';
import { T } from '../dealer/theme';
import { X, B, Mono, Btn, Card, CardH, Chip, StatusChip, Field, Hint, Banner, KV, Kpis, Line, Avatar } from '../dealer/kit';
import { creditNotes, dLong, dShort, personOf, rupees, toSendBack } from '../dealer/data';
import { Page, Box, Cols, Stack, Table, Pills, SearchBox, FilterPick, Tabs, Dialog, ReasonDialog, Select, ToggleRow, EntryTable, Empty, fmtAt, useA } from './ui';
import { StaffManager } from './Governance';
import { getAccessToken } from '../api/session';
import { activateDealer, approveDealer, rejectDealer, suspendDealer } from '../api/dealers';
import { errorMessage } from '../api/client';
import { useSync } from '../api/sync';

// A dealer that came from the server has a uuid id (and its code in `code`); demo dealers use the code as id.
const isLive = (d: Dealer) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(d.id);
export const dealerCode = (d: Dealer) => d.code || d.id;

const digits = (v: string) => v.replace(/\D/g, '');
function suggestCode(d: Dealer, dealers: Dealer[]) {
  const letters = d.name.split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0].toUpperCase()).join('').padEnd(3, 'X');
  let n = dealers.length + 1, code = '';
  do { code = `${letters}-${String(n).padStart(3, '0')}`; n++; } while (dealers.some(x => x.id === code || x.code === code));
  return code;
}

/** Approve, refuse, suspend or reactivate a dealer — with a reason and a message to the dealer. */
function useDealerDecision() {
  const { state, setState, audit, canEdit } = useStore(); const a = useA(); const { sync } = useSync();
  const liveDecision = async (d: Dealer, action: 'Approve' | 'Reject' | 'Suspend' | 'Activate', reason: string, newCode?: string) => {
    const token = await getAccessToken();
    if (!token) { a.toast('Sign in again to change a dealer.'); return; }
    try {
      if (action === 'Approve') await approveDealer(d.id, newCode || dealerCode(d), reason, token);
      else if (action === 'Reject') await rejectDealer(d.id, reason, token);
      else if (action === 'Suspend') await suspendDealer(d.id, reason, token);
      else await activateDealer(d.id, reason, token);
      a.toast(action === 'Approve' ? `${d.name} approved as ${newCode || dealerCode(d)}. They can sign in now.` : `${d.name} is now ${action === 'Activate' ? 'active' : action === 'Reject' ? 'rejected' : 'suspended'}.`);
    } catch (err) { a.toast(errorMessage(err)); }
    finally { sync(true); }
  };
  return (d: Dealer, action: 'Approve' | 'Reject' | 'Suspend' | 'Activate', reason: string, newCode?: string) => {
    if (!canEdit) { a.toast('Read-only access — dealers cannot be changed.'); return false; }
    if (state.offline) { a.toast('Dealer decisions need online mode.'); return false; }
    if (newCode && newCode !== dealerCode(d) && (!/^[A-Z]{2,4}-\d{3}$/.test(newCode) || state.dealers.some(x => x.id === newCode || x.code === newCode))) { a.toast('Use a free dealer code like VPC-045.'); return false; }
    if (isLive(d)) { liveDecision(d, action, reason, newCode); return; }
    const next = action === 'Approve' || action === 'Activate' ? 'Active' : action === 'Reject' ? 'Rejected' : 'Suspended';
    const id = newCode || d.id;
    setState(s => audit({ ...s, dealers: s.dealers.map(x => x.id === d.id ? { ...x, id, status: next, reason } : x), notices: [{ id: uid('N'), title: `Dealer account ${next.toLowerCase()}`, body: reason, route: 'profile', read: false, dealerId: id }, ...s.notices] }, `${action} dealer`, id, id !== d.id ? `${reason} · dealer code ${id} assigned` : reason, d.status, next));
    a.toast(action === 'Approve' ? `${d.name} approved as ${id}. They can sign in now.` : `${d.name} is now ${next.toLowerCase()}.`);
  };
}

/* ---------- new dealer registrations ---------- */
export function Registrations() {
  const a = useA(); const { state, canEdit } = useStore(); const decide = useDealerDecision();
  const pending = state.dealers.filter(d => d.status === 'Pending Approval');
  const [sel, setSel] = useState(pending[0]?.id), [act, setAct] = useState<'Approve' | 'Reject' | ''>('');
  const d = pending.find(x => x.id === sel) || pending[0];
  const [code, setCode] = useState(d ? suggestCode(d, state.dealers) : '');
  useEffect(() => { if (d) setCode(suggestCode(d, state.dealers)); }, [d?.id]);
  const pick = (x: Dealer) => setSel(x.id);
  const dupes = d ? state.dealers.filter(x => x.id !== d.id && (digits(x.mobile) === digits(d.mobile) || (d.email && x.email.toLowerCase() === d.email.toLowerCase()))) : [];
  const applied = d && state.audits.find(x => x.ref === d.id && x.action === 'Dealer registered')?.at;
  return <Page title="New dealers" sub={`${pending.length} ${pending.length === 1 ? 'shop' : 'shops'} waiting · approving lets them record entries`}>
    {!d ? <Box><Empty icon="people" title="No shops waiting" text="Shops that register from the dealer app appear here for approval." action={<Btn kind="ghost" sm label="Open dealer directory" onPress={() => a.go('dealers')} />} /></Box> :
      <Cols weights={[1.55, 1]}>
        <Card>
          <CardH title={d.name} right={<StatusChip status={d.status} />} />
          <KV cols={a.wide ? 3 : 2} pairs={[['Contact', d.contact], ['Mobile', `+91 ${d.mobile}`, 'mono'], ['Email', d.email || '—'], ['City', d.city], ['PIN', d.pin, 'mono'], ['Place', d.place || '—'], ['Address', d.address], ['Applied', applied ? dLong(applied) : '—'], ['State', d.state]]} />
          {dupes.length > 0 && <Banner tone="warn" icon="alert" style={{ marginTop: 13 }}><B>Same mobile or email as an existing account.</B> {dupes.map(x => `${x.name} (${x.status.toLowerCase()})`).join(', ')}. Confirm this is a different business before approving.</Banner>}
          <X s={13} w={7} c={T.slate} style={{ marginTop: 16, marginBottom: 8 }}>Documents</X>
          {d.documents?.length ? d.documents.map(doc => <Line key={doc} av={<Avatar n="doc" />} title={doc.split(' · ')[0]} sub={doc.split(' · ')[1] || 'Uploaded'} />) : <X s={13.5} c={T.slate}>No documents uploaded. You can still approve.</X>}
          <View style={{ height: 12 }} />
          <Field label="Dealer code to assign" req mono value={code} onChange={v => setCode(v.toUpperCase())} hint="Suggested from the shop name. You can change it — it cannot be reused." hintIcon="lock" caps />
          {canEdit && <View style={{ flexDirection: 'row', gap: 9 }}>
            <View style={{ flex: 1 }}><Btn kind="danger" icon="x" label="Refuse with reason" onPress={() => setAct('Reject')} /></View>
            <View style={{ flex: 1 }}><Btn kind="blue" icon="check" label="Approve & activate" onPress={() => setAct('Approve')} /></View></View>}
          <Hint icon="lock" style={{ marginTop: 10 }}>Either decision is recorded with your name, the time and your reason, and the shop is told by SMS and in the app.</Hint>
        </Card>
        <Box title="All waiting">{pending.map((x, i) => <Pressable key={x.id} accessibilityRole="button" onPress={() => pick(x)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: i < pending.length - 1 ? 1 : 0, borderBottomColor: T.zinc2, backgroundColor: x.id === d.id ? T.steelSoft : T.white }}>
          <Avatar n="shop" tone={x.id === d.id ? 'blue' : 'mute'} /><View style={{ flex: 1 }}><X s={14.5} w={6}>{x.name}</X><X s={12.5} c={T.slate}>{x.city} · {x.contact}</X></View></Pressable>)}</Box>
      </Cols>}
    {d && <ReasonDialog open={act === 'Approve'} title={`Approve ${d.name}`} confirm={`Approve as ${code}`} suggestions={['Documents checked', 'Existing business, verified by phone']} onClose={() => setAct('')} onConfirm={r => decide(d, 'Approve', r, code)} intro="The shop can sign in and record entries straight away." />}
    {d && <ReasonDialog open={act === 'Reject'} title={`Refuse ${d.name}`} confirm="Refuse registration" kind="danger" suggestions={['Duplicate of an existing account', 'Documents could not be verified', 'Outside our dealer territory']} onClose={() => setAct('')} onConfirm={r => decide(d, 'Reject', r)} intro="The applicant sees this reason." />}
  </Page>;
}

/* ---------- dealer directory ---------- */
export function Dealers() {
  const a = useA(); const { state } = useStore();
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [city, setCity] = useState('All');
  const statusMap: Record<string, string> = { active: 'Active', pending: 'Pending Approval', suspended: 'Suspended', rejected: 'Rejected' };
  const rows = state.dealers.filter(d => (status === 'all' || d.status === statusMap[status]) && (city === 'All' || d.city === city) && [d.name, d.city, d.id, d.contact, d.mobile].some(v => v.toLowerCase().includes(q.toLowerCase())));
  const count = (s: string) => state.dealers.filter(d => d.status === s).length;
  return <Page title="Dealers" sub={`${state.dealers.length} dealers · ${count('Active')} active`}>
    <Box filters={<><SearchBox value={q} onChange={setQ} ph="Name, city, code or mobile" /><Pills value={status} onChange={setStatus} items={[['all', 'All'], ['active', `Active ${count('Active')}`], ['pending', `Waiting ${count('Pending Approval')}`], ['suspended', `Suspended ${count('Suspended')}`], ['rejected', `Refused ${count('Rejected')}`]]} /><FilterPick label="City" value={city} options={state.cities} onChange={setCity} /></>}>
      <Table rows={rows} keyOf={d => d.id} onRow={d => a.go('dealer', d.id)} empty="No dealers match."
        cols={[
          { h: 'Dealer', w: 1.6, cell: d => <View><X s={13.5} w={7}>{d.name}</X><X s={12} c={T.slate}>{d.contact}</X></View> },
          { h: 'City', w: 0.9, cell: d => d.city },
          { h: 'Code', w: 1, cell: d => <X s={12.5} f="m" w={6}>{dealerCode(d)}</X> },
          { h: 'Status', w: 1.2, cell: d => <StatusChip status={d.status} /> },
          { h: 'Batteries', w: 0.7, cell: d => String(state.batteries.filter(b => b.dealerId === d.id).length) },
          { h: 'Replacements', w: 0.8, cell: d => String(state.entries.filter(e => e.dealerId === d.id && e.type === 'Replacement' && e.status !== 'Draft').length) },
          { h: 'Waiting', w: 0.6, cell: d => { const n = state.entries.filter(e => e.dealerId === d.id && ['Submitted', 'Under Review', 'Conflict'].includes(e.status)).length; return n ? <Chip tone="warn" label={String(n)} /> : '—'; } },
        ]}
        mobile={{ av: d => <Avatar n="shop" tone={d.status === 'Active' ? 'blue' : d.status === 'Suspended' || d.status === 'Rejected' ? 'red' : 'amber'} />, title: d => d.name, sub: d => <><Mono>{d.id}</Mono> · {d.city}</>, right: d => <StatusChip status={d.status} /> }} />
    </Box>
  </Page>;
}

/* ---------- dealer profile ---------- */
export function DealerProfile({ id }: { id?: string }) {
  const a = useA(); const { state, canEdit } = useStore(); const decide = useDealerDecision();
  const [tab, setTab] = useState('profile'), [act, setAct] = useState<'Approve' | 'Reject' | 'Suspend' | 'Activate' | ''>('');
  const d = state.dealers.find(x => x.id === id);
  if (!d) return <Page back title="Dealer"><Empty icon="alert" title="Dealer not found" /></Page>;
  const entries = state.entries.filter(e => e.dealerId === d.id);
  const cn = creditNotes(state, d.id);
  const history = state.audits.filter(x => x.ref === d.id).sort((x, y) => y.at.localeCompare(x.at));
  const actions: ('Approve' | 'Reject' | 'Suspend' | 'Activate')[] = d.status === 'Pending Approval' ? ['Reject', 'Approve'] : d.status === 'Active' ? ['Suspend'] : ['Activate'];
  return <Page back title={d.name} sub={`${d.city} · ${dealerCode(d)} · ${d.status.toLowerCase()}`}
    tabs={<Tabs value={tab} onChange={setTab} items={[['profile', 'Profile'], ['entries', `Entries ${entries.length}`], ['staff', 'Staff'], ['history', 'Status history']]} />}>
    {tab === 'profile' && <Cols weights={[1.55, 1]}>
      <Card><CardH title="Business details" right={<StatusChip status={d.status} />} />
        <KV cols={a.wide ? 3 : 2} pairs={[['Contact person', d.contact], ['Mobile', `+91 ${d.mobile}`, 'mono'], ['Email', d.email || '—'], ['City · place', `${d.city} · ${d.place || '—'}`], ['PIN', d.pin, 'mono'], ['Dealer code', d.id, 'mono'], ['Address', d.address], ['State', d.state], ['Documents', d.documents?.join(', ') || 'None uploaded']]} />
        {d.reason && <Banner tone={d.status === 'Active' ? 'info' : 'warn'} icon="alert" style={{ marginTop: 12 }}><B>Last decision:</B> {d.reason}</Banner>}
        {canEdit && <View style={{ flexDirection: 'row', gap: 9, marginTop: 13, flexWrap: 'wrap' }}>{actions.map(x => <Btn key={x} sm kind={x === 'Approve' || x === 'Activate' ? 'blue' : 'ghost'} color={x === 'Suspend' || x === 'Reject' ? T.terminal : undefined} borderColor={x === 'Suspend' || x === 'Reject' ? '#F0C7BC' : undefined} label={`${x === 'Reject' ? 'Refuse' : x} dealer`} onPress={() => setAct(x)} />)}</View>}
        <Hint icon="shield" style={{ marginTop: 10 }}>Suspending stops new entries at once. It never removes anything the dealer already recorded.</Hint>
      </Card>
      <Stack>
        <Kpis items={[{ v: String(state.batteries.filter(b => b.dealerId === d.id).length), l: 'Batteries' }, { v: String(entries.filter(e => e.type === 'Replacement' && e.status !== 'Draft').length), l: 'Replacements' }, { v: String(toSendBack(state, d.id).length), l: 'Old batteries at shop', tone: toSendBack(state, d.id).length ? 'flag' : undefined, onPress: () => a.go('returns') }, { v: rupees(cn.monthTotal), l: 'Credited this month' }]} />
        <Box title="Waiting for a decision">{<EntryTable compact showDealer={false} entries={entries.filter(e => ['Submitted', 'Under Review', 'Conflict'].includes(e.status))} onOpen={e => a.go('entry', e.id)} empty="Nothing waiting from this dealer." />}</Box>
      </Stack>
    </Cols>}
    {tab === 'entries' && <Box><EntryTable showDealer={false} entries={entries} onOpen={e => a.go(e.status === 'Draft' ? 'new' : 'entry', e.id)} empty="No entries from this dealer yet." /></Box>}
    {tab === 'staff' && <StaffManager dealerId={d.id} />}
    {tab === 'history' && <Box title="Status history">{history.length ? <View style={{ paddingHorizontal: 14 }}>{history.map((h, i) => <Line key={h.id} last={i === history.length - 1} av={<Avatar n={/Approve|Activate/.test(h.action) ? 'check' : /Reject|Suspend/.test(h.action) ? 'x' : 'doc'} tone={/Approve|Activate/.test(h.action) ? 'green' : /Reject|Suspend/.test(h.action) ? 'red' : 'mute'} />} title={h.action} sub={`${fmtAt(h.at)} · ${personOf(h.actor)}${h.reason ? ` — ${h.reason}` : ''}`} right={h.before ? <Chip tone="mute" label={`${h.before} → ${h.after}`} /> : undefined} />)}</View> : <X s={13.5} c={T.slate} style={{ padding: 14 }}>No status changes yet.</X>}</Box>}
    {act && <ReasonDialog open title={`${act === 'Reject' ? 'Refuse' : act} ${d.name}`} confirm={`${act === 'Reject' ? 'Refuse' : act} dealer`} kind={act === 'Approve' || act === 'Activate' ? 'blue' : 'danger'} onClose={() => setAct('')} onConfirm={r => decide(d, act, r)}
      intro={act === 'Suspend' ? 'New entries stop straight away. Their records, stock and history stay exactly as they are.' : act === 'Activate' ? 'The dealer can sign in and record entries again.' : undefined} />}
  </Page>;
}

/* ---------- customers ---------- */
export function Customers() {
  const a = useA(); const { state, setState, audit, canEdit } = useStore();
  const [q, setQ] = useState(''), [dealer, setDealer] = useState('All'), [editing, setEditing] = useState<Customer | null>(null), [detail, setDetail] = useState<Customer | null>(null), [merge, setMerge] = useState(false), [target, setTarget] = useState('');
  const dealerName = (id: string) => state.dealers.find(d => d.id === id)?.name || id;
  const rows = state.customers.filter(c => !c.mergedInto && (dealer === 'All' || dealerName(c.dealerId) === dealer) && [c.name, c.mobile, c.equipment].some(v => v.toLowerCase().includes(q.toLowerCase())));
  const history = (c: Customer) => state.entries.filter(e => e.dealerId === c.dealerId && e.customer === c.name);
  const save = () => {
    if (!editing) return;
    if (!editing.name.trim() || !/^\d{10}$/.test(editing.mobile)) { a.toast('Enter a name and a 10-digit mobile number.'); return; }
    if (state.customers.some(c => !c.mergedInto && c.id !== editing.id && c.dealerId === editing.dealerId && c.mobile === editing.mobile)) { a.toast('This dealer already has a customer with that mobile. Open it, or link the duplicate.'); return; }
    setState(s => audit({ ...s, customers: [editing, ...s.customers.filter(c => c.id !== editing.id)] }, 'Customer saved', editing.id, 'Customer profile updated'));
    setEditing(null); a.toast('Customer saved.');
  };
  const others = state.customers.filter(c => c.id !== detail?.id && c.dealerId === detail?.dealerId && !c.mergedInto);
  return <Page title="Customers" sub="Battery history becomes service history"
    actions={canEdit ? <Btn kind="primary" sm icon="plus" label="Add customer" onPress={() => setEditing({ id: uid('CUS'), dealerId: state.dealers.find(d => d.status === 'Active')?.id || '', name: '', mobile: '', address: '', equipment: '', consent: false })} /> : undefined}>
    <Box filters={<><SearchBox value={q} onChange={setQ} ph="Name, mobile or equipment" /><FilterPick label="Dealer" value={dealer} options={state.dealers.map(d => d.name)} onChange={setDealer} /></>}>
      <Table rows={rows} keyOf={c => c.id} onRow={setDetail} empty="No customers match."
        cols={[
          { h: 'Customer', w: 1.4, cell: c => <X s={13.5} w={7}>{c.name}</X> },
          { h: 'Mobile', w: 1, cell: c => <X s={12.5} f="m" w={6}>{c.mobile}</X> },
          { h: 'Dealer', w: 1.3, cell: c => dealerName(c.dealerId) },
          { h: 'Equipment', w: 1.5, cell: c => c.equipment || '—' },
          { h: 'Messages', w: 0.9, cell: c => c.consent ? <Chip tone="live" icon="check" label="Allowed" /> : <Chip tone="mute" label="No consent" /> },
          { h: 'Entries', w: 0.6, cell: c => String(history(c).length) },
        ]}
        mobile={{ av: () => <Avatar n="user" tone="amber" />, title: c => c.name, sub: c => <><Mono>{c.mobile}</Mono> · {dealerName(c.dealerId)}</> }} />
    </Box>
    <Dialog open={!!editing} title={editing && state.customers.some(c => c.id === editing.id) ? 'Edit customer' : 'Add customer'} onClose={() => setEditing(null)}>{editing && <>
      <Select label="Dealer" req value={dealerName(editing.dealerId)} options={state.dealers.filter(d => d.status === 'Active').map(d => d.name)} onChange={v => setEditing({ ...editing, dealerId: state.dealers.find(d => d.name === v)!.id })} />
      <Field label="Name" req value={editing.name} onChange={name => setEditing({ ...editing, name })} />
      <Field label="Mobile" req mono numeric maxLength={10} value={editing.mobile} onChange={v => setEditing({ ...editing, mobile: digits(v) })} ph="10 digits" />
      <Field label="Address" value={editing.address} onChange={address => setEditing({ ...editing, address })} />
      <Field label="Vehicle or equipment" value={editing.equipment} onChange={equipment => setEditing({ ...editing, equipment })} ph="e.g. Tata 407 · MH18 AB 0421" />
      <Card style={{ paddingVertical: 0, marginBottom: 14 }}><ToggleRow last label="Customer agreed to service messages" sub="Needed before any SMS about their battery" value={editing.consent} onChange={consent => setEditing({ ...editing, consent })} /></Card>
      <Btn kind="blue" icon="check" label="Save customer" onPress={save} />
    </>}</Dialog>
    <Dialog open={!!detail && !merge} title={detail?.name || ''} sub={detail ? dealerName(detail.dealerId) : ''} onClose={() => setDetail(null)} width={680}>{detail && <>
      <Card><KV pairs={[['Mobile', detail.mobile, 'mono'], ['Address', detail.address || '—'], ['Equipment', detail.equipment || '—'], ['Service messages', detail.consent ? 'Allowed' : 'No consent recorded']]} /></Card>
      <X s={13} w={7} c={T.slate} style={{ marginTop: 16, marginBottom: 8 }}>Service history</X>
      <Box><EntryTable compact entries={history(detail)} showDealer={false} onOpen={e => { setDetail(null); a.go('entry', e.id); }} empty="No entries for this customer yet." /></Box>
      {canEdit && <View style={{ flexDirection: 'row', gap: 9, marginTop: 14, flexWrap: 'wrap' }}><Btn kind="blue" sm icon="pen" label="Edit customer" onPress={() => { setEditing(detail); setDetail(null); }} />
        <Btn kind="ghost" sm icon="link" label="This is a duplicate" disabled={!others.length} onPress={() => { setTarget(others[0]?.id || ''); setMerge(true); }} /></View>}
    </>}</Dialog>
    <ReasonDialog open={merge} title="Link a duplicate customer" confirm="Link duplicate" onClose={() => { setMerge(false); setDetail(null); }} intro="The duplicate is hidden from lists but its name and history stay readable."
      onConfirm={r => { if (!detail || !target) return false; const kept = state.customers.find(c => c.id === target)!; setState(s => audit({ ...s, customers: s.customers.map(c => c.id === detail.id ? { ...c, mergedInto: target } : c) }, 'Customer duplicate linked', detail.id, r, detail.name, kept.name)); a.toast('Duplicate linked. Nothing was deleted.'); }}>
      <Select label="Keep this record" req value={state.customers.find(c => c.id === target)?.name || ''} options={others.map(c => ({ v: c.name, sub: c.mobile }))} onChange={v => setTarget(others.find(c => c.name === v)?.id || '')} />
    </ReasonDialog>
  </Page>;
}
