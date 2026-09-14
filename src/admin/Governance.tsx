import React, { useState } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store';
import { Role, Staff, uid, validateEntry } from '../domain';
import { printHtml, escapeHtml } from '../reports';
import { T } from '../dealer/theme';
import { X, B, Mono, Ic, Btn, Card, CardH, Chip, StatusChip, Field, Hint, Banner, KV, Line, Avatar, OtpBoxes } from '../dealer/kit';
import { dShort, personOf } from '../dealer/data';
import { Page, Box, Cols, Stack, Table, SearchBox, FilterPick, Dialog, ReasonDialog, Select, ToggleRow, Diff, Empty, fmtAt, useA } from './ui';

/* ---------- audit log ---------- */
export function AuditLog() {
  const a = useA(); const { state } = useStore();
  const [q, setQ] = useState(''), [action, setAction] = useState('All'), [who, setWho] = useState('All');
  const actions = [...new Set(state.audits.map(x => x.action))].sort();
  const people = [...new Set(state.audits.map(x => personOf(x.actor)))].sort();
  const rows = state.audits.filter(x => (action === 'All' || x.action === action) && (who === 'All' || personOf(x.actor) === who) && [x.actor, x.action, x.ref, x.reason].some(v => (v || '').toLowerCase().includes(q.toLowerCase())));
  const open = (ref: string) => state.entries.some(e => e.id === ref) ? a.go('entry', ref) : state.dealers.some(d => d.id === ref) ? a.go('dealer', ref) : state.batteries.some(b => b.code === ref) ? a.go('battery', ref) : state.challans.some(c => c.no === ref) ? a.go('returns') : undefined;
  const exportLog = () => printHtml(`<h1>Felix Batteries · Audit log</h1><p>${rows.length} events · printed ${escapeHtml(new Date().toLocaleString('en-IN'))}</p><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Reason</th><th>Before</th><th>After</th></tr></thead><tbody>${rows.map(x => `<tr>${[new Date(x.at).toLocaleString('en-IN'), x.actor, x.action, x.ref, x.reason, x.before || '', x.after || ''].map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).catch(() => a.toast('Printing is not available on this device.'));
  return <Page title="Audit log" sub={`${state.audits.length} events · nothing can be removed from here`} actions={<Btn kind="ghost" sm icon="down" label="Print or save as PDF" onPress={exportLog} />}>
    <Box filters={<><SearchBox value={q} onChange={setQ} ph="Who, what, record or reason" /><FilterPick label="Action" value={action} options={actions} onChange={setAction} /><FilterPick label="Who" value={who} options={people} onChange={setWho} /></>}>
      {rows.length ? <View style={{ paddingHorizontal: 14 }}>{rows.slice(0, 200).map((x, i) => <Pressable key={x.id} accessibilityRole="button" onPress={() => open(x.ref)} style={{ flexDirection: a.wide ? 'row' : 'column', gap: a.wide ? 11 : 2, paddingVertical: 11, borderBottomWidth: i < Math.min(rows.length, 200) - 1 ? 1 : 0, borderBottomColor: T.zinc2 }}>
        <X s={11.5} f="m" w={5} c={T.slate} style={a.wide ? { width: 118, paddingTop: 2 } : undefined}>{fmtAt(x.at)}</X>
        <View style={{ flex: 1 }}><X s={13.5} w={6}>{x.action} <X s={12.5} f="m" w={5} c={T.steel}>{x.ref}</X></X><X s={12.5} c={T.slate}>{x.actor}{x.reason ? ` — ${x.reason}` : ''}</X><Diff was={x.before} now={x.after} /></View>
      </Pressable>)}</View> : <Empty icon="lock" title="No events match" />}
    </Box>
    <Banner tone="bad" icon="lock" style={{ marginTop: 14 }}>Every change is recorded with who made it, when and why. Permissions are meant to be enforced by the server once it is connected — this preview enforces them in the app.</Banner>
  </Page>;
}

/* ---------- staff & admin accounts ---------- */
const PERMS = ['Entries', 'Dealers', 'Inventory', 'Reports', 'Customers'];
const STAFF_STATES = ['Active', 'Temporarily Blocked', 'Inactive', 'Soft Deleted'];
export function StaffManager({ dealerId }: { dealerId?: string }) {
  const a = useA(); const { state, setState, audit, canEdit } = useStore();
  const [editing, setEditing] = useState<Staff | null>(null), [decision, setDecision] = useState<{ u: Staff; status: string } | null>(null);
  const users = state.staff.filter(u => dealerId ? u.dealerId === dealerId : !u.dealerId);
  const roles = dealerId ? ['Dealer User', 'Dealer Manager'] : ['Co-Admin', 'Read-only', 'Operations', 'Inventory Manager'];
  const save = () => {
    if (!editing) return;
    if (!editing.name.trim() || !/^\S+@\S+\.\S+$/.test(editing.email)) { a.toast('A name and a valid email are needed.'); return; }
    setState(s => audit({ ...s, staff: [editing, ...s.staff.filter(u => u.id !== editing.id)] }, 'Account permissions saved', editing.id, `${editing.name}: ${editing.role} · ${editing.permissions.join(', ')}`));
    setEditing(null); a.toast('Account saved.');
  };
  const tone = (s: string) => s === 'Active' ? 'live' : s === 'Temporarily Blocked' ? 'warn' : s === 'Soft Deleted' ? 'bad' : 'mute';
  return <Stack>
    <Box title={`${users.length} ${users.length === 1 ? 'account' : 'accounts'}`} right={canEdit ? <Btn kind="ghost" sm icon="plus" label={dealerId ? 'Add staff member' : 'Add administrator'} onPress={() => setEditing({ id: uid('USR'), name: '', email: '', role: roles[0], status: 'Active', dealerId, permissions: ['Entries'] })} /> : undefined}>
      <Table rows={users} keyOf={u => u.id} onRow={canEdit ? u => u.role !== 'Main Admin' && setEditing({ ...u }) : undefined} empty="No accounts yet."
        cols={[{ h: 'Name', w: 1.4, cell: u => <View><X s={13.5} w={7}>{u.name}</X><X s={12} c={T.slate}>{u.email}</X></View> }, { h: 'Role', w: 1, cell: u => u.role }, { h: 'Can reach', w: 1.6, cell: u => <X s={12.5} c={T.slate}>{u.role === 'Main Admin' ? 'Everything, including this screen' : u.permissions.join(', ') || 'Nothing yet'}</X> }, { h: 'Status', w: 1, cell: u => <Chip tone={tone(u.status)} label={u.status} /> },
          { h: '', w: 1.2, cell: u => canEdit && u.role !== 'Main Admin' ? <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{u.status === 'Active' ? <Btn kind="ghost" sm label="Block" color={T.terminal} borderColor="#F0C7BC" onPress={() => setDecision({ u, status: 'Temporarily Blocked' })} /> : <Btn kind="ghost" sm label="Restore" onPress={() => setDecision({ u, status: 'Active' })} />}</View> : null }]}
        mobile={{ av: u => <Avatar n="user" tone={u.status === 'Active' ? 'blue' : 'mute'} />, title: u => u.name, sub: u => `${u.role} · ${u.email}`, right: u => <Chip tone={tone(u.status)} label={u.status} /> }} />
    </Box>
    <Dialog open={!!editing} title={editing && state.staff.some(u => u.id === editing.id) ? `Edit ${editing.name}` : dealerId ? 'Add staff member' : 'Add administrator'} onClose={() => setEditing(null)}>{editing && <>
      <Field label="Full name" req value={editing.name} onChange={name => setEditing({ ...editing, name })} />
      <Field label="Email" req value={editing.email} onChange={email => setEditing({ ...editing, email: email.trim() })} ph="name@felixbatteries.in" />
      <Select label="Role" req value={editing.role} options={roles} onChange={role => setEditing({ ...editing, role })} />
      <X s={13} w={6} c={T.ink3} style={{ marginBottom: 4 }}>What they can open</X>
      <Card style={{ paddingVertical: 0, marginBottom: 13 }}>{PERMS.map((p, i) => <ToggleRow key={p} last={i === PERMS.length - 1} label={p} value={editing.permissions.includes(p)} onChange={on => setEditing({ ...editing, permissions: on ? [...editing.permissions, p] : editing.permissions.filter(x => x !== p) })} />)}</Card>
      {state.staff.some(u => u.id === editing.id) && <><X s={13} w={6} c={T.ink3} style={{ marginBottom: 8 }}>Account state</X>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 13 }}>{STAFF_STATES.filter(s => s !== editing.status).map(s => <Btn key={s} kind="ghost" sm label={s === 'Active' ? 'Restore' : s} onPress={() => { setDecision({ u: editing, status: s }); setEditing(null); }} />)}</View></>}
      <Btn kind="blue" icon="check" label="Save account" onPress={save} />
      <Hint icon="shield">No account can give anyone more authority than it holds itself. Real invitations need the server.</Hint>
    </>}</Dialog>
    <ReasonDialog open={!!decision} title={`${decision?.status === 'Active' ? 'Restore' : decision?.status} · ${decision?.u.name || ''}`} confirm="Change account" kind={decision?.status === 'Active' ? 'blue' : 'danger'} onClose={() => setDecision(null)}
      intro={decision?.status === 'Soft Deleted' ? 'Hidden from lists; their past actions stay searchable for good.' : decision?.status === 'Active' ? 'They can sign in again.' : 'They cannot sign in until restored. Everything they did is kept.'}
      onConfirm={r => { if (!decision) return false; setState(s => audit({ ...s, staff: s.staff.map(u => u.id === decision.u.id ? { ...u, status: decision.status } : u) }, 'Account status changed', decision.u.id, r, decision.u.status, decision.status)); a.toast(`${decision.u.name} is now ${decision.status.toLowerCase()}.`); }} />
  </Stack>;
}
export function Team() {
  const a = useA();
  const matrix: [string, string, string, string, string][] = [['Record an entry', 'Own shop', 'Any dealer', 'Any dealer', '—'], ['Approve or refuse a claim', '—', 'Yes, recorded', 'Yes, recorded', '—'], ['Correct a sent entry', 'Ask only', 'Yes, linked copy', 'Yes, linked copy', '—'], ['Approve or suspend dealers', '—', 'Yes', 'Yes', '—'], ['Publish warranty policy', '—', 'No', 'Yes', '—'], ['Manage administrators', '—', 'No', 'Yes', '—'], ['Delete history permanently', 'Never', 'Never', 'Never', 'Never']];
  return <Page title="Admin users & roles" sub="Who can do what at head office">
    <StaffManager />
    <View style={{ height: 14 }} />
    <Cols weights={[1.55, 1]}>
      <Box title="Who can do what"><Table rows={matrix} keyOf={r => r[0]}
        cols={[{ h: 'Action', w: 1.6, cell: r => <X s={13.5} w={6}>{r[0]}</X> }, ...['Dealer', 'Co-Admin', 'Main Admin', 'Read-only'].map((h, i) => ({ h, w: 1, cell: (r: typeof matrix[number]) => <X s={13} w={r[i + 1] === 'Never' || r[i + 1] === 'No' ? 7 : 4} c={r[i + 1] === 'Never' || r[i + 1] === 'No' ? T.terminal : r[i + 1] === '—' ? T.zinc3 : T.ink}>{r[i + 1]}</X> }))]}
        mobile={{ title: r => r[0], sub: r => `Co-Admin: ${r[2]} · Main Admin: ${r[3]}` }} /></Box>
      <Box title="Account states" pad>{[['Active', 'Can sign in and use their permissions', 'live'], ['Temporarily Blocked', 'Cannot sign in until restored; everything is kept', 'warn'], ['Inactive', 'Cannot sign in; kept for reactivation and audit', 'mute'], ['Soft Deleted', 'Hidden from lists; past actions stay searchable', 'bad']].map((s, i, arr) =>
        <Line key={s[0]} last={i === arr.length - 1} title={<Chip tone={s[2] as any} label={s[0]} />} sub={s[1]} />)}</Box>
    </Cols>
  </Page>;
}

/* ---------- notifications ---------- */
const ROUTE_MAP: Record<string, string> = { activity: 'entries', returns: 'returns', stock: 'stock', warranty: 'warranty', profile: 'dealers', notifications: 'notifications' };
export function Notifications() {
  const a = useA(); const { state, setState, audit, canEdit } = useStore();
  const [audience, setAudience] = useState('All dealers'), [title, setTitle] = useState(''), [body, setBody] = useState('');
  const dealerName = (id?: string) => id ? state.dealers.find(d => d.id === id)?.name || id : 'All dealers';
  const unread = state.notices.filter(n => !n.read).length;
  const send = () => {
    if (!title.trim() || !body.trim()) { a.toast('Add a subject and a message.'); return; }
    const dealerId = state.dealers.find(d => d.name === audience)?.id;
    setState(s => audit({ ...s, notices: [{ id: uid('N'), title: title.trim(), body: body.trim(), route: 'notifications', read: false, dealerId }, ...s.notices] }, 'In-app announcement', 'NOTICES', `${title.trim()} → ${audience}`));
    setTitle(''); setBody(''); a.toast(`Sent in the app to ${audience.toLowerCase() === 'all dealers' ? 'every dealer' : audience}.`);
  };
  return <Page title="Notifications" sub="What goes out, to whom, and what is waiting for you">
    <Cols weights={[1, 1.3]}>
      {canEdit ? <Card><CardH title="New announcement" />
        <Select label="Send to" req value={audience} options={['All dealers', ...state.dealers.filter(d => d.status === 'Active').map(d => d.name)]} onChange={setAudience} />
        <Field label="Subject" req value={title} onChange={setTitle} ph="e.g. Model I700 is now available" />
        <Field label="Message" req value={body} onChange={setBody} multiline ph="Plain words, one idea" />
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 13, flexWrap: 'wrap' }}><Chip tone="live" icon="bell" label="In-app" /><Chip tone="mute" icon="phone" label="SMS · needs server" /><Chip tone="mute" label="Email · needs server" /></View>
        <Btn kind="blue" icon="bell" label="Send now" onPress={send} />
        <Hint icon="shield">A message never carries a serial or customer detail the dealer is not allowed to see.</Hint>
      </Card> : <Card><Empty icon="lock" title="Read-only access" text="You can read notifications but not send announcements." /></Card>}
      <Box title={`Inbox${unread ? ` · ${unread} unread` : ''}`} right={unread ? <Btn kind="ghost" sm icon="check" label="Mark all read" onPress={() => setState(s => ({ ...s, notices: s.notices.map(n => ({ ...n, read: true })) }))} /> : undefined}>
        {state.notices.length ? <View style={{ paddingHorizontal: 14 }}>{state.notices.map((n, i) => <Line key={n.id} last={i === state.notices.length - 1}
          onPress={() => { setState(s => ({ ...s, notices: s.notices.map(x => x.id === n.id ? { ...x, read: true } : x) })); const r = ROUTE_MAP[n.route]; if (r && r !== 'notifications') a.go(r); }}
          av={<Avatar n="bell" tone={n.read ? 'mute' : 'blue'} />} title={<>{n.title}{!n.read ? <X s={12} w={7} c={T.terminal}>  ● new</X> : null}</>} sub={`${dealerName(n.dealerId)} · ${n.body}`} />)}</View>
          : <Empty icon="bell" title="No notifications" />}
      </Box>
    </Cols>
  </Page>;
}

/* ---------- settings, reference data, sync, health ---------- */
export function Settings() {
  const a = useA(); const { state, setState, audit, role, canEdit } = useStore();
  const [city, setCity] = useState(''), [type, setType] = useState('');
  const queue = state.entries.filter(e => ['Pending sync', 'Conflict'].includes(e.status));
  const sync = () => {
    if (state.offline) { a.toast('Turn off offline mode first.'); return; }
    const rows = state.entries.filter(e => e.status === 'Pending sync');
    setState(s => audit({ ...s, lastSync: new Date().toISOString(), entries: s.entries.map(e => { if (!rows.some(r => r.id === e.id)) return e; const ok = !Object.keys(validateEntry(e, s)).length && s.dealers.find(d => d.id === e.dealerId)?.status === 'Active'; return { ...e, status: ok ? 'Submitted' : 'Conflict', retries: e.retries + 1 }; }) }, 'Local queue reconciled', 'SYNC', `${rows.length} queued entries checked`));
    a.toast(rows.length ? `${rows.length} queued ${rows.length === 1 ? 'entry' : 'entries'} checked. Valid ones are in the approval queue.` : 'Nothing was waiting to sync.');
  };
  return <Page title="Settings & sync" sub="Your account, the lists that keep entries consistent, and system health">
    <Cols>
      <Stack>
        <Card><CardH title="Your account" right={<Chip tone="info" icon="shield" label={role} />} />
          <KV pairs={[['Name', 'S. Deshpande'], ['Role', role], ['Sign-in', 'Preview session'], ['Two-step code', 'Needs server']]} />
          <View style={{ height: 12 }} />
          <Select label="Language for menus" value={state.language} options={['English', 'मराठी']} onChange={v => setState(s => ({ ...s, language: v as any }))} hint="Menu labels switch to Marathi. Record details stay in English." />
          <View style={{ flexDirection: 'row', gap: 9, flexWrap: 'wrap' }}><Btn kind="ghost" sm icon="swap" label="Switch workspace" onPress={a.openSwitcher} /><Btn kind="ghost" sm icon="logout" label="Sign out" onPress={a.signOut} /></View>
        </Card>
        <Card><CardH title="Sync & offline" right={state.offline ? <Chip tone="warn" icon="cloud" label="Offline" /> : <Chip tone="live" icon="wifi" label="Online" />} />
          <ToggleRow label="Work offline (practice)" sub="See how the app behaves without signal" value={state.offline} onChange={v => setState(s => ({ ...s, offline: v }))} />
          <KV pairs={[['Last sync', fmtAt(state.lastSync)], ['Waiting to sync', String(state.entries.filter(e => e.status === 'Pending sync').length)]]} />
          <Btn kind="blue" sm icon="sync" label="Sync now" style={{ marginTop: 12 }} onPress={sync} />
          {queue.length > 0 && <View style={{ marginTop: 12 }}>{queue.map((e, i) => <Line key={e.id} last={i === queue.length - 1} onPress={() => a.go('entry', e.id)} av={<Avatar n={e.status === 'Conflict' ? 'alert' : 'sync'} tone={e.status === 'Conflict' ? 'red' : 'amber'} />} title={<Mono>{e.id}</Mono>} sub={`${state.dealers.find(d => d.id === e.dealerId)?.name} · ${e.retries} ${e.retries === 1 ? 'try' : 'tries'}${e.status === 'Conflict' ? ` · ${Object.values(validateEntry(e, state))[0] || 'needs review'}` : ''}`} right={<StatusChip status={e.status} />} />)}</View>}
          <Hint icon="shield">Queued entries stay on the device until they are sent. Nothing is lost while offline.</Hint>
        </Card>
      </Stack>
      <Stack>
        <Card><CardH title="Reference lists" right={role !== 'Main Admin' ? <Chip tone="mute" icon="lock" label="Main Admin edits" /> : undefined} />
          <X s={13} w={7} c={T.slate} style={{ marginBottom: 8 }}>Cities ({state.cities.length})</X>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>{state.cities.map(c => <Chip key={c} tone="info" icon="pin" label={c} />)}</View>
          {role === 'Main Admin' && canEdit && <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}><Field style={{ flex: 1 }} value={city} onChange={setCity} ph="Add a city" /><Btn kind="ghost" label="Add" onPress={() => { const c = city.trim(); if (!c || state.cities.includes(c)) { a.toast(c ? 'That city is already listed.' : 'Type a city name.'); return; } setState(s => audit({ ...s, cities: [...s.cities, c] }, 'City added', 'MASTER', c)); setCity(''); }} /></View>}
          <X s={13} w={7} c={T.slate} style={{ marginBottom: 8, marginTop: 6 }}>Entry types ({state.entryTypes.length})</X>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>{state.entryTypes.map(t => <Chip key={t} tone="mute" label={t} />)}</View>
          {role === 'Main Admin' && canEdit && <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}><Field style={{ flex: 1 }} value={type} onChange={setType} ph="Add an entry type" /><Btn kind="ghost" label="Add" onPress={() => { const t = type.trim(); if (!t || state.entryTypes.includes(t)) { a.toast(t ? 'That type already exists.' : 'Type a name.'); return; } setState(s => audit({ ...s, entryTypes: [...s.entryTypes, t] }, 'Entry type added', 'MASTER', t)); setType(''); }} /></View>}
          <Hint icon="lock">Dealers see only Replacement and Sales Return. Other types are for head office entries.</Hint>
        </Card>
        <Card><CardH title="System health" />
          {[['App', 'Expo · React Native · running', 'live'], ['Data on this device', `${state.entries.length} entries · ${state.batteries.length} batteries · ${state.audits.length} audit events`, 'live'], ['Server / API', 'Not connected — preview works on this device', 'warn'], ['SMS & email', 'Not connected', 'warn'], ['Label reading (OCR)', 'Not connected — serials are scanned or typed', 'warn']].map((r, i, arr) =>
            <Line key={r[0]} last={i === arr.length - 1} title={r[0]} titleSize={14} sub={r[1]} right={<Chip tone={r[2] as any} icon={r[2] === 'live' ? 'check' : 'alert'} label={r[2] === 'live' ? 'OK' : 'Later'} />} />)}
        </Card>
      </Stack>
    </Cols>
  </Page>;
}

/* ---------- admin sign-in ---------- */
export function SignIn({ onDone, onDealer }: { onDone: (r: Role) => void; onDealer: () => void }) {
  const { state, setState, audit } = useStore(); const inset = useSafeAreaInsets();
  const [mode, setMode] = useState<'in' | 'reset'>('in'), [role, setRole] = useState<Role>('Main Admin'), [email, setEmail] = useState(''), [pw, setPw] = useState(''), [code, setCode] = useState(''), [err, setErr] = useState(''), [done, setDone] = useState('');
  const submit = () => {
    const staff = state.staff.find(u => u.email.toLowerCase() === email.trim().toLowerCase() && !u.dealerId);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Enter your work email.'); return; }
    if (pw.length < 8) { setErr('The password has at least 8 characters.'); return; }
    if (code !== '123456') { setErr('That two-step code is not right. In this preview it is 123456.'); return; }
    if (staff && staff.status !== 'Active') { setErr(`This account is ${staff.status.toLowerCase()}. Ask the Main Admin.`); return; }
    const r = (staff && ['Main Admin', 'Co-Admin', 'Read-only'].includes(staff.role) ? staff.role : role) as Role;
    setState(s => audit(s, 'Admin signed in', staff?.id || 'SESSION', `${email.trim()} as ${r}`));
    onDone(r);
  };
  return <ScrollView style={{ flex: 1, backgroundColor: T.ink }} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20, paddingTop: 20 + inset.top }} keyboardShouldPersistTaps="handled">
    <View style={{ width: '100%', maxWidth: 400 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: T.volt, alignItems: 'center', justifyContent: 'center' }}><X s={18} w={7} f="c" c="#2A1F02">FB</X></View>
        <View><X s={17} w={7} c={T.white}>Felix Batteries</X><X s={12} c="#8C9BAE">Head office console</X></View></View>
      <View style={{ backgroundColor: T.white, borderRadius: 12, padding: 24 }}>
        {mode === 'in' ? <>
          <Select label="Sign in as (preview)" value={role} options={[{ v: 'Main Admin', sub: 'Everything' }, { v: 'Co-Admin', sub: 'Dealers, entries, stock, reports' }, { v: 'Read-only', sub: 'Look, not change' }]} onChange={v => setRole(v as Role)} />
          <Field label="Work email" req value={email} onChange={v => { setEmail(v); setErr(''); }} ph="admin@example.com" />
          <Field label="Password" req secure value={pw} onChange={v => { setPw(v); setErr(''); }} ph="••••••••••" />
          <Card style={{ backgroundColor: T.steelSoft, borderColor: '#C3D8F6' }}><CardH title="Two-step code" size={14} right={<Chip tone="mute" icon="lock" label="Preview: 123456" />} /><OtpBoxes value={code} onChange={v => { setCode(v); setErr(''); }} /></Card>
          {err ? <Hint tone="err">{err}</Hint> : null}
          {done ? <Banner tone="ok" icon="check" style={{ marginTop: 12 }}>{done}</Banner> : null}
          <Btn kind="blue" icon="lock" label="Sign in" style={{ marginTop: 13 }} onPress={submit} />
          <Pressable accessibilityRole="button" onPress={() => { setMode('reset'); setErr(''); setCode(''); }} style={{ alignSelf: 'center', padding: 8, marginTop: 4 }}><X s={13} w={6} c={T.steel}>Forgot password?</X></Pressable>
          <Hint icon="shield" center>Every admin sign-in is recorded in the audit log.</Hint>
        </> : <>
          <X s={19} w={7} f="c" style={{ marginBottom: 6 }}>Reset your password</X>
          <X s={13.5} c={T.slate} style={{ marginBottom: 14 }}>We send a code to your work email, then you choose a new password. In this preview nothing is sent and the code is 123456.</X>
          <Field label="Work email" req value={email} onChange={setEmail} />
          <X s={13} w={6} c={T.ink3} style={{ marginBottom: 5 }}>Code</X><OtpBoxes value={code} onChange={setCode} />
          <Field label="New password" req secure value={pw} onChange={setPw} style={{ marginTop: 13 }} hint="At least 8 characters." hintIcon="shield" />
          {err ? <Hint tone="err">{err}</Hint> : null}
          <Btn kind="blue" icon="check" label="Save new password" style={{ marginTop: 6 }} onPress={() => { if (!/^\S+@\S+\.\S+$/.test(email.trim()) || code !== '123456' || pw.length < 8) { setErr('Use your email, code 123456 and a password of 8 or more characters.'); return; } setMode('in'); setCode(''); setPw(''); setErr(''); setDone('Password changed (preview — no real account was touched). Sign in with it now.'); }} />
          <Pressable accessibilityRole="button" onPress={() => { setMode('in'); setErr(''); }} style={{ alignSelf: 'center', padding: 8, marginTop: 4 }}><X s={13} w={6} c={T.steel}>Back to sign in</X></Pressable>
        </>}
      </View>
      <Pressable accessibilityRole="button" onPress={onDealer} style={{ alignSelf: 'center', padding: 10, marginTop: 14 }}><X s={13} w={6} c="#AEBCCC" style={{ textDecorationLine: 'underline' }}>Dealer? Open the dealer app</X></Pressable>
    </View>
  </ScrollView>;
}
