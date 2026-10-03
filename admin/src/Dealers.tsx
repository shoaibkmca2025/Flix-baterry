import React, { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { useStore } from '@felix/shared/store';
import { Dealer, uid } from '@felix/shared/domain';
import { T } from '@felix/shared/ui/theme';
import { X, B, Mono, Btn, Card, CardH, Chip, StatusChip, Field, Hint, Banner, KV, Kpis, Line, Avatar } from '@felix/shared/ui/kit';
import { refunds, dLong, dShort, personOf, toSendBack } from '@felix/shared/data';
import { Page, Box, Cols, Stack, Table, Pills, SearchBox, FilterPick, Tabs, ReasonDialog, Select, EntryTable, Empty, fmtAt, useA } from './ui';
import { StaffManager } from './Governance';
import { getAccessToken } from '@felix/shared/api/session';
import { activateDealer, approveDealer, assignDistributor, createDealerForDistributor, rejectDealer, suspendDealer } from '@felix/shared/api/dealers';
import { errorMessage } from '@felix/shared/api/client';
import { useSync } from '@felix/shared/api/sync';

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
  return <Page title="New distributors" sub={`${pending.length} ${pending.length === 1 ? 'shop' : 'shops'} waiting · approving lets them record entries`}>
    {!d ? <Box><Empty icon="people" title="No shops waiting" text="Shops that register from the dealer app appear here for approval." action={<Btn kind="ghost" sm label="Open dealer directory" onPress={() => a.go('dealers')} />} /></Box> :
      <Cols weights={[1.55, 1]}>
        <Card>
          <CardH title={d.name} right={<StatusChip status={d.status} />} />
          <KV cols={a.wide ? 3 : 2} pairs={[['Contact', d.contact], ['Mobile', `+91 ${d.mobile}`, 'mono'], ['Email', d.email || '—'], ['City', d.city], ['Place', d.place || '—'], ['Address', d.address], ['Applied', applied ? dLong(applied) : '—'], ['State', d.state]]} />
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
  const a = useA(); const { state, canEdit } = useStore();
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [city, setCity] = useState('All'), [kind, setKind] = useState('All');
  const statusMap: Record<string, string> = { active: 'Active', pending: 'Pending Approval', suspended: 'Suspended', rejected: 'Rejected' };
  // head office → distributor → dealer (client, 2 Oct 2026); a shop with no kind is a distributor
  const isDealer = (d: { kind?: string }) => d.kind === 'Dealer';
  const nameOf = (id?: string) => state.dealers.find(x => x.id === id)?.name || '—';
  // A dealer a distributor added is the distributor's own business, and head office reads the
  // chain one step at a time: it sees distributors, and the dealers it added itself (client,
  // 3 Oct 2026). The rest are still one tap away, on their distributor's Dealers tab.
  const ours = state.dealers.filter(d => d.addedBy !== 'distributor');
  const hidden = state.dealers.length - ours.length;
  const rows = ours.filter(d => (status === 'all' || d.status === statusMap[status]) && (city === 'All' || d.city === city) && (kind === 'All' || (kind === 'Dealers') === isDealer(d))
    && [d.name, d.city, d.id, d.contact, d.mobile, isDealer(d) ? nameOf(d.distributorId) : ''].some(v => v.toLowerCase().includes(q.toLowerCase())));
  const count = (s: string) => ours.filter(d => d.status === s).length;
  const distributors = ours.filter(d => !isDealer(d)).length;
  return <Page title="Distributors & dealers" sub={`${distributors} distributors · ${ours.length - distributors} dealers added here · ${count('Active')} active`}
    actions={canEdit ? <Btn kind="primary" sm icon="plus" label="Add a dealer" onPress={() => a.go('newdealer')} /> : undefined}>
    {hidden > 0 && <Hint icon="people" style={{ marginBottom: 12 }}>{hidden} more {hidden === 1 ? 'dealer was' : 'dealers were'} added by their own distributor. Open a distributor to see its dealers.</Hint>}
    <Box filters={<><SearchBox value={q} onChange={setQ} ph="Name, city, code, mobile or distributor" /><Pills value={status} onChange={setStatus} items={[['all', 'All'], ['active', `Active ${count('Active')}`], ['pending', `Waiting ${count('Pending Approval')}`], ['suspended', `Suspended ${count('Suspended')}`], ['rejected', `Refused ${count('Rejected')}`]]} /><FilterPick label="Type" value={kind} options={['Distributors', 'Dealers']} onChange={setKind} /><FilterPick label="City" value={city} options={state.cities} onChange={setCity} /></>}>
      <Table rows={rows} keyOf={d => d.id} onRow={d => a.go('dealer', d.id)} empty="No dealers match."
        cols={[
          { h: 'Shop', w: 1.6, cell: d => <View><X s={13.5} w={7}>{d.name}</X><X s={12} c={T.slate}>{d.contact}</X></View> },
          { h: 'Type', w: 1.2, cell: d => isDealer(d) ? <View><Chip tone="info" label="Dealer" /><X s={12} c={T.slate} style={{ marginTop: 3 }}>under {nameOf(d.distributorId)}</X></View> : <View><Chip tone="vio" label="Distributor" /><X s={12} c={T.slate} style={{ marginTop: 3 }}>{state.dealers.filter(x => x.distributorId === d.id).length} dealers</X></View> },
          { h: 'City', w: 0.9, cell: d => d.city },
          { h: 'Code', w: 1, cell: d => <X s={12.5} f="m" w={6}>{dealerCode(d)}</X> },
          { h: 'Status', w: 1.2, cell: d => <StatusChip status={d.status} /> },
          { h: 'Batteries', w: 0.7, cell: d => String(state.batteries.filter(b => b.dealerId === d.id).length) },
          { h: 'Replacements', w: 0.8, cell: d => String(state.entries.filter(e => e.dealerId === d.id && e.type === 'Replacement' && e.status !== 'Draft').length) },
          { h: 'Waiting', w: 0.6, cell: d => { const n = state.entries.filter(e => e.dealerId === d.id && ['Submitted', 'Under Review', 'Conflict'].includes(e.status)).length; return n ? <Chip tone="warn" label={String(n)} /> : '—'; } },
        ]}
        mobile={{ av: d => <Avatar n="shop" tone={d.status === 'Active' ? 'blue' : d.status === 'Suspended' || d.status === 'Rejected' ? 'red' : 'amber'} />, title: d => d.name, sub: d => <>{isDealer(d) ? `Dealer under ${nameOf(d.distributorId)}` : 'Distributor'} · {d.city}</>, right: d => <StatusChip status={d.status} /> }} />
    </Box>
  </Page>;
}

/* ---------- head office adds a dealer (client, 3 Oct 2026) ---------- */
/**
 * The same form a distributor fills in from the app, plus the one thing only head office has to
 * say: which distributor the dealer belongs under. A dealer added here is active at once and
 * signs in with its mobile number and the SMS code — there is no password and no approval step,
 * exactly as when a distributor adds one himself.
 */
export function NewDealer() {
  const a = useA(); const { state, canEdit } = useStore(); const { sync } = useSync();
  const [f, setF] = useState({ name: '', contact: '', mobile: '', email: '', distributor: '', city: '', state: 'Maharashtra', place: '', address: '' });
  const [err, setErr] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => { setF(x => ({ ...x, [k]: v })); setErr(e => ({ ...e, [k]: '' })); };
  // only an active distributor can take a dealer — the server checks this too
  const distributors = state.dealers.filter(d => d.kind !== 'Dealer' && d.status === 'Active');

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Enter the shop name.';
    if (!f.contact.trim()) e.contact = 'Enter the owner or manager.';
    if (!/^\d{10}$/.test(f.mobile)) e.mobile = 'Enter the 10-digit mobile number.';
    if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'Check the email address.';
    if (!f.distributor) e.distributor = 'Choose the distributor this dealer belongs to.';
    if (!f.city) e.city = 'Choose the city.';
    if (!f.state.trim()) e.state = 'Enter the state.';
    if (!f.address.trim()) e.address = 'Enter the full shop address.';
    setErr(e); if (Object.values(e).some(Boolean)) { a.toast('Some details need a look — they are marked in red.'); return; }

    const parent = distributors.find(d => d.name === f.distributor);
    if (!parent) { setErr(x => ({ ...x, distributor: 'Choose the distributor this dealer belongs to.' })); return; }
    const token = await getAccessToken();
    if (!token) { a.toast('Sign in again to add a dealer.'); return; }
    setBusy(true);
    try {
      const made = await createDealerForDistributor({
        name: f.name.trim(), contactPerson: f.contact.trim(), mobile: f.mobile, email: f.email.trim() || undefined,
        city: f.city, state: f.state.trim(), place: f.place.trim() || undefined, address: f.address.trim(),
        distributorId: parent.id,
      }, token);
      a.toast(`${made.name} is added under ${parent.name}. They sign in with +91 ${f.mobile} and the SMS code.`);
      a.go('dealers');
    } catch (ex) {
      const field = (ex as { field?: string }).field;
      if (field) setErr(x => ({ ...x, [field === 'distributorId' ? 'distributor' : field]: errorMessage(ex) }));
      a.toast(errorMessage(ex));
    } finally { setBusy(false); sync(true); }
  };

  if (!canEdit) return <Page back title="Add a dealer"><Empty icon="lock" title="Read-only access" text="You can look at the dealer list, but not add to it." /></Page>;
  // Every dealer sits under a distributor, so with none active there is nothing to add it to.
  if (!distributors.length) return <Page back title="Add a dealer">
    <Empty icon="people" title="No active distributor yet" text="A dealer always sits under a distributor. Approve or re-activate one first, then come back." />
  </Page>;
  return <Page back title="Add a dealer" sub="Head office → distributor → dealer">
    <Cols weights={[1.4, 1]}>
      <Card><CardH title="Shop details" right={<Chip tone="info" label="Active at once" />} />
        <Field label="Dealer shop name" req value={f.name} onChange={set('name')} ph="Shop name on the board" error={err.name} />
        <Field label="Contact person" req value={f.contact} onChange={set('contact')} ph="Owner or manager" error={err.contact} />
        <Field label="Mobile number" req mono numeric maxLength={10} value={f.mobile} onChange={v => set('mobile')(digits(v).slice(0, 10))} ph="9876543210" error={err.mobile}
          hint="They sign in with this number and the SMS code." hintIcon="phone" />
        <Field label="Email" value={f.email} onChange={set('email')} ph="name@shop.in (optional)" error={err.email} />
        <Select label="Distributor" req value={f.distributor} ph={distributors.length ? `Choose from ${distributors.length} distributor${distributors.length === 1 ? '' : 's'}` : 'No distributor to choose'}
          options={distributors.map(d => ({ v: d.name, sub: `${d.city} · ${state.dealers.filter(x => x.distributorId === d.id).length} dealers` }))}
          onChange={set('distributor')} error={err.distributor} hintIcon="people"
          hint="This dealer's requests go to this distributor first, and its old batteries go to him." />
        <Select label="City" req value={f.city} ph={`Choose from ${state.cities.length} cities`} options={state.cities} onChange={set('city')} error={err.city} hintIcon="pin" hint="Chosen from the company city list — not typed." />
        <Field label="State" req value={f.state} onChange={set('state')} error={err.state} />
        <Field label="Place / area" value={f.place} onChange={set('place')} ph="Road or area" />
        <Field label="Full address" req value={f.address} onChange={set('address')} ph="Shop number, building, road" error={err.address} />
        <Btn kind="primary" icon="check" label={busy ? 'Adding…' : 'Add dealer'} disabled={busy} onPress={submit} style={{ marginTop: 4 }} />
      </Card>
      <Stack>
        <Card><CardH title="What happens next" />
          <Line av={<Avatar n="phone" tone="blue" />} title="They sign in by mobile" sub="The number above, and the code sent to it. No password is set here." />
          <Line av={<Avatar n="people" tone="vio" />} title="Their requests reach the distributor first" sub="The distributor checks each one and sends it on to head office." />
          <Line last av={<Avatar n="truck" tone="green" />} title="Old batteries go to the distributor" sub="He collects them and dispatches them on a challan." />
        </Card>
        <Hint icon="shield">No approval step: a dealer added here can use the app straight away. Suspend them later from their profile if you need to.</Hint>
      </Stack>
    </Cols>
  </Page>;
}

/* ---------- dealer profile ---------- */
export function DealerProfile({ id }: { id?: string }) {
  const a = useA(); const { state, canEdit } = useStore(); const decide = useDealerDecision(); const { sync } = useSync();
  const [tab, setTab] = useState('profile'), [act, setAct] = useState<'Approve' | 'Reject' | 'Suspend' | 'Activate' | ''>('');
  // Head office can move a dealer to another distributor — an area changes hands, a distributor
  // closes (client, 3 Oct 2026). The dealer's requests and history follow it; nothing is rewritten.
  const [moving, setMoving] = useState(false), [moveTo, setMoveTo] = useState('');
  const d = state.dealers.find(x => x.id === id);
  if (!d) return <Page back title="Dealer"><Empty icon="alert" title="Dealer not found" /></Page>;
  const entries = state.entries.filter(e => e.dealerId === d.id);
  const history = state.audits.filter(x => x.ref === d.id).sort((x, y) => y.at.localeCompare(x.at));
  const actions: ('Approve' | 'Reject' | 'Suspend' | 'Activate')[] = d.status === 'Pending Approval' ? ['Reject', 'Approve'] : d.status === 'Active' ? ['Suspend'] : ['Activate'];
  // head office → distributor → dealer (client, 2 Oct 2026)
  const isDealer = d.kind === 'Dealer', parent = state.dealers.find(x => x.id === d.distributorId);
  const children = state.dealers.filter(x => x.distributorId === d.id);
  const tabItems: [string, string][] = [['profile', 'Profile'], ...(isDealer ? [] : [['dealers', `Dealers ${children.length}`] as [string, string]]), ['entries', `Entries ${entries.length}`], ['staff', 'Staff'], ['history', 'Status history']];
  return <Page back title={d.name} sub={`${isDealer ? `Dealer under ${parent?.name || 'a distributor'}` : 'Distributor'} · ${d.city} · ${dealerCode(d)} · ${d.status.toLowerCase()}`}
    tabs={<Tabs value={tab} onChange={setTab} items={tabItems} />}>
    {isDealer && <Banner tone="info" icon="people" style={{ marginBottom: 14 }}><B>Dealer under {parent?.name || 'no distributor yet'}.</B> {parent ? 'The distributor approves this dealer’s requests first and sends its old batteries to head office. ' : 'Nobody checks this dealer’s requests until a distributor is set. '}
      {parent && <B u onPress={() => a.go('dealer', parent.id)}>Open distributor</B>}{canEdit && parent ? ' · ' : ''}{canEdit && <B u onPress={() => { setMoveTo(''); setMoving(true); }}>Move to another distributor</B>}</Banner>}
    {tab === 'dealers' && <Box title={`Dealers under ${d.name}`} right={<Chip tone="mute" label="Added by the distributor in the app" />}>
      {children.length ? <View style={{ paddingHorizontal: 14 }}>{children.map((c, i) => <Line key={c.id} last={i === children.length - 1} onPress={() => a.go('dealer', c.id)} av={<Avatar n="shop" tone={c.status === 'Active' ? 'green' : 'mute'} />}
        title={c.name} sub={`${c.contact} · +91 ${c.mobile} · ${c.city}`} right={<StatusChip status={c.status} />} />)}</View>
        : <X s={13.5} c={T.slate} style={{ padding: 14 }}>No dealers yet. The distributor adds them from the app (Profile → My dealers).</X>}</Box>}
    {tab === 'profile' && <Cols weights={[1.55, 1]}>
      <Card><CardH title="Business details" right={<StatusChip status={d.status} />} />
        <KV cols={a.wide ? 3 : 2} pairs={[['Contact person', d.contact], ['Mobile', `+91 ${d.mobile}`, 'mono'], ['Email', d.email || '—'], ['City · place', `${d.city} · ${d.place || '—'}`], ['Dealer code', d.id, 'mono'], ['Address', d.address], ['State', d.state], ['Documents', d.documents?.join(', ') || 'None uploaded']]} />
        {d.reason && <Banner tone={d.status === 'Active' ? 'info' : 'warn'} icon="alert" style={{ marginTop: 12 }}><B>Last decision:</B> {d.reason}</Banner>}
        {canEdit && <View style={{ flexDirection: 'row', gap: 9, marginTop: 13, flexWrap: 'wrap' }}>
          {actions.map(x => <Btn key={x} sm kind={x === 'Approve' || x === 'Activate' ? 'blue' : 'ghost'} color={x === 'Suspend' || x === 'Reject' ? T.terminal : undefined} borderColor={x === 'Suspend' || x === 'Reject' ? '#F0C7BC' : undefined} label={`${x === 'Reject' ? 'Refuse' : x} ${isDealer ? 'dealer' : 'distributor'}`} onPress={() => setAct(x)} />)}
          {/* which distributor a dealer sits under is head office's to set, so it is an action
              here and not only a line in the banner above (client, 3 Oct 2026) */}
          {isDealer && <Btn sm kind="ghost" icon="people" label={parent ? 'Move to another distributor' : 'Assign a distributor'} onPress={() => { setMoveTo(''); setMoving(true); }} />}
        </View>}
        <Hint icon="shield" style={{ marginTop: 10 }}>Suspending stops new entries at once. It never removes anything the dealer already recorded.</Hint>
      </Card>
      <Stack>
        <Kpis items={[{ v: String(state.batteries.filter(b => b.dealerId === d.id).length), l: 'Batteries' }, { v: String(entries.filter(e => e.type === 'Replacement' && e.status !== 'Draft').length), l: 'Replacements' }, { v: String(toSendBack(state, d.id).length), l: 'Old batteries at shop', tone: toSendBack(state, d.id).length ? 'flag' : undefined, onPress: () => a.go('returns') }, { v: String(refunds(state, d.id).approved.length), l: 'Approved for refund' }]} />
        <Box title="Waiting for a decision">{<EntryTable compact showDealer={false} entries={entries.filter(e => ['Submitted', 'Under Review', 'Conflict'].includes(e.status))} onOpen={e => a.go('entry', e.id)} empty="Nothing waiting from this dealer." />}</Box>
      </Stack>
    </Cols>}
    {tab === 'entries' && <Box><EntryTable showDealer={false} entries={entries} onOpen={e => a.go(e.status === 'Draft' ? 'new' : 'entry', e.id)} empty="No entries from this dealer yet." /></Box>}
    {tab === 'staff' && <StaffManager dealerId={d.id} />}
    {tab === 'history' && <Box title="Status history">{history.length ? <View style={{ paddingHorizontal: 14 }}>{history.map((h, i) => <Line key={h.id} last={i === history.length - 1} av={<Avatar n={/Approve|Activate/.test(h.action) ? 'check' : /Reject|Suspend/.test(h.action) ? 'x' : 'doc'} tone={/Approve|Activate/.test(h.action) ? 'green' : /Reject|Suspend/.test(h.action) ? 'red' : 'mute'} />} title={h.action} sub={`${fmtAt(h.at)} · ${personOf(h.actor)}${h.reason ? ` — ${h.reason}` : ''}`} right={h.before ? <Chip tone="mute" label={`${h.before} → ${h.after}`} /> : undefined} />)}</View> : <X s={13.5} c={T.slate} style={{ padding: 14 }}>No status changes yet.</X>}</Box>}
    {moving && <ReasonDialog open title={`Move ${d.name}`} confirm="Move this dealer" onClose={() => setMoving(false)}
      disabled={!moveTo}
      intro="The dealer's requests, batteries and history stay exactly as they are. From now on the new distributor checks its requests and collects its old batteries."
      onConfirm={r => {
        const to = state.dealers.find(x => x.name === moveTo && x.kind !== 'Dealer');
        if (!to) { a.toast('Choose the distributor to move this dealer to.'); return false; }
        void (async () => {
          const token = await getAccessToken();
          if (!token) { a.toast('Sign in again to move a dealer.'); return; }
          try { await assignDistributor(d.id, to.id, r, token); a.toast(`${d.name} is now under ${to.name}.`); }
          catch (err) { a.toast(errorMessage(err)); }
          finally { sync(true); }
        })();
        setMoving(false);
      }}>
      <Select label="New distributor" req value={moveTo} onChange={setMoveTo}
        options={state.dealers.filter(x => x.kind !== 'Dealer' && x.status === 'Active' && x.id !== d.distributorId).map(x => ({ v: x.name, sub: `${x.city} · ${state.dealers.filter(y => y.distributorId === x.id).length} dealers` }))} />
    </ReasonDialog>}
    {act && <ReasonDialog open title={`${act === 'Reject' ? 'Refuse' : act} ${d.name}`} confirm={`${act === 'Reject' ? 'Refuse' : act} ${isDealer ? 'dealer' : 'distributor'}`} kind={act === 'Approve' || act === 'Activate' ? 'blue' : 'danger'} onClose={() => setAct('')} onConfirm={r => decide(d, act, r)}
      intro={act === 'Suspend' ? 'New entries stop straight away. Their records, stock and history stay exactly as they are.' : act === 'Activate' ? 'The dealer can sign in and record entries again.' : undefined} />}
  </Page>;
}
