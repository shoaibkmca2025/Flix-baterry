import React, { useEffect, useState } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { adminLogin, passwordForgot, passwordReset, verifyOtp } from '../api/auth';
import { ApiError } from '../api/client';
import { saveSession, type Session } from '../api/session';
import { useStore } from '../store';
import { getAccessToken } from '../api/session';
import { createAdmin, inviteStaff, listStaff, setAdminStatus, setStaffStatus, updateAdmin } from '../api/users';
import { errorMessage } from '../api/client';
import { useSync } from '../api/sync';
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
const ROLE_KEY: Record<string, string> = { 'Co-Admin': 'co_admin', 'Read-only': 'read_only', 'Operations': 'operations', 'Inventory Manager': 'inventory_manager', 'Inventory manager': 'inventory_manager', 'Dealer User': 'dealer_user', 'Dealer user': 'dealer_user', 'Dealer Manager': 'dealer_manager', 'Dealer manager': 'dealer_manager', 'Main Admin': 'main_admin' };
const STATUS_KEY: Record<string, 'active' | 'temporarily_blocked' | 'inactive' | 'soft_deleted'> = { Active: 'active', 'Temporarily Blocked': 'temporarily_blocked', Blocked: 'temporarily_blocked', Inactive: 'inactive', 'Soft Deleted': 'soft_deleted', Deleted: 'soft_deleted' };
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(id);

export function StaffManager({ dealerId }: { dealerId?: string }) {
  const a = useA(); const { state, setState, audit, canEdit } = useStore(); const { sync } = useSync();
  const [editing, setEditing] = useState<Staff | null>(null), [decision, setDecision] = useState<{ u: Staff; status: string } | null>(null), [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => { getAccessToken().then(setToken); }, []);
  // A dealer's staff is not part of the general sync; load it for the profile's Staff tab.
  useEffect(() => {
    if (!token || !dealerId || !isUuid(dealerId)) return;
    listStaff(dealerId, token).then(r => setState(s => ({ ...s, staff: [...s.staff.filter(u => u.dealerId !== dealerId), ...r.items.map(u => ({ id: u.id, name: u.name, email: u.mobile ?? u.email ?? '', role: u.role === 'dealer_manager' ? 'Dealer Manager' : 'Dealer User', roleKey: u.role, status: u.status === 'active' ? 'Active' : u.status === 'temporarily_blocked' ? 'Temporarily Blocked' : u.status === 'inactive' ? 'Inactive' : 'Soft Deleted', dealerId, permissions: [] }))] }))).catch(() => {});
  }, [token, dealerId]);
  const users = state.staff.filter(u => dealerId ? u.dealerId === dealerId : !u.dealerId);
  const roles = dealerId ? ['Dealer User', 'Dealer Manager'] : ['Co-Admin', 'Read-only', 'Operations', 'Inventory Manager'];
  const live = !!token && (!dealerId || isUuid(dealerId));
  const isNew = (u: Staff) => !state.staff.some(x => x.id === u.id);
  const saveLive = async (u: Staff) => {
    try {
      if (dealerId) {
        if (!isNew(u)) { a.toast('Editing a staff member is not available in this version. Block and re-add instead.'); return; }
        if (!/^[6-9]\d{9}$/.test(u.email)) { a.toast('Enter the staff member\'s 10-digit mobile number — they sign in with an OTP.'); return; }
        await inviteStaff(dealerId, { name: u.name.trim(), mobile: u.email, role: ROLE_KEY[u.role] === 'dealer_manager' ? 'dealer_manager' : 'dealer_user' }, token!);
      } else if (isNew(u)) {
        if (password.length < 8) { a.toast('Set an initial password of at least 8 characters to hand over.'); return; }
        await createAdmin({ name: u.name.trim(), email: u.email, role: ROLE_KEY[u.role] ?? u.role, password }, token!);
      } else {
        await updateAdmin(u.id, { name: u.name.trim(), role: ROLE_KEY[u.role] ?? u.roleKey ?? u.role }, token!);
      }
      setEditing(null); setPassword(''); a.toast('Account saved.');
    } catch (err) { a.toast(errorMessage(err)); }
    finally { sync(true); }
  };
  const save = () => {
    if (!editing) return;
    if (live) { if (!editing.name.trim()) { a.toast('A name is needed.'); return; } saveLive(editing); return; }
    if (!editing.name.trim() || !/^\S+@\S+\.\S+$/.test(editing.email)) { a.toast('A name and a valid email are needed.'); return; }
    setState(s => audit({ ...s, staff: [editing, ...s.staff.filter(u => u.id !== editing.id)] }, 'Account permissions saved', editing.id, `${editing.name}: ${editing.role} · ${editing.permissions.join(', ')}`));
    setEditing(null); a.toast('Account saved.');
  };
  const decideLive = async (u: Staff, status: string, reason: string) => {
    try {
      if (dealerId) await setStaffStatus(dealerId, u.id, STATUS_KEY[status] ?? 'inactive', reason, token!);
      else await setAdminStatus(u.id, STATUS_KEY[status] ?? 'inactive', reason, token!);
      a.toast(`${u.name} is now ${status.toLowerCase()}.`);
    } catch (err) { a.toast(errorMessage(err)); }
    finally { sync(true); }
  };
  const tone = (s: string) => s === 'Active' ? 'live' : s === 'Temporarily Blocked' || s === 'Blocked' ? 'warn' : s === 'Soft Deleted' || s === 'Deleted' ? 'bad' : 'mute';
  return <Stack>
    <Box title={`${users.length} ${users.length === 1 ? 'account' : 'accounts'}`} right={canEdit ? <Btn kind="ghost" sm icon="plus" label={dealerId ? 'Add staff member' : 'Add administrator'} onPress={() => { setPassword(''); setEditing({ id: uid('USR'), name: '', email: '', role: roles[0], status: 'Active', dealerId, permissions: ['Entries'] }); }} /> : undefined}>
      <Table rows={users} keyOf={u => u.id} onRow={canEdit ? u => u.role !== 'Main Admin' && setEditing({ ...u }) : undefined} empty="No accounts yet."
        cols={[{ h: 'Name', w: 1.4, cell: u => <View><X s={13.5} w={7}>{u.name}</X><X s={12} c={T.slate}>{u.email}</X></View> }, { h: 'Role', w: 1, cell: u => u.role }, { h: 'Can reach', w: 1.6, cell: u => <X s={12.5} c={T.slate}>{u.role === 'Main Admin' ? 'Everything, including this screen' : live ? 'As the role allows (enforced by the server)' : u.permissions.join(', ') || 'Nothing yet'}</X> }, { h: 'Status', w: 1, cell: u => <Chip tone={tone(u.status)} label={u.status} /> },
          { h: '', w: 1.2, cell: u => canEdit && u.role !== 'Main Admin' ? <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{u.status === 'Active' ? <Btn kind="ghost" sm label="Block" color={T.terminal} borderColor="#F0C7BC" onPress={() => setDecision({ u, status: 'Temporarily Blocked' })} /> : u.status !== 'Soft Deleted' && u.status !== 'Deleted' ? <Btn kind="ghost" sm label="Restore" onPress={() => setDecision({ u, status: 'Active' })} /> : null}</View> : null }]}
        mobile={{ av: u => <Avatar n="user" tone={u.status === 'Active' ? 'blue' : 'mute'} />, title: u => u.name, sub: u => `${u.role} · ${u.email}`, right: u => <Chip tone={tone(u.status)} label={u.status} /> }} />
    </Box>
    <Dialog open={!!editing} title={editing && !isNew(editing) ? `Edit ${editing.name}` : dealerId ? 'Add staff member' : 'Add administrator'} onClose={() => setEditing(null)}>{editing && <>
      <Field label="Full name" req value={editing.name} onChange={name => setEditing({ ...editing, name })} />
      {dealerId && live
        ? <Field label="Mobile number" req mono numeric maxLength={10} value={editing.email} onChange={email => setEditing({ ...editing, email: email.replace(/\D/g, '') })} ph="They sign in with an OTP on this number" />
        : <Field label="Email" req value={editing.email} onChange={email => setEditing({ ...editing, email: email.trim() })} ph="name@felixbatteries.in" />}
      <Select label="Role" req value={editing.role} options={roles} onChange={role => setEditing({ ...editing, role })} />
      {live && !dealerId && isNew(editing) && <Field label="Initial password" req value={password} onChange={setPassword} ph="At least 8 characters — hand it over in person" />}
      {!live && <><X s={13} w={6} c={T.ink3} style={{ marginBottom: 4 }}>What they can open</X>
      <Card style={{ paddingVertical: 0, marginBottom: 13 }}>{PERMS.map((p, i) => <ToggleRow key={p} last={i === PERMS.length - 1} label={p} value={editing.permissions.includes(p)} onChange={on => setEditing({ ...editing, permissions: on ? [...editing.permissions, p] : editing.permissions.filter(x => x !== p) })} />)}</Card></>}
      {!isNew(editing) && <><X s={13} w={6} c={T.ink3} style={{ marginBottom: 8 }}>Account state</X>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 13 }}>{STAFF_STATES.filter(s => s !== editing.status).map(s => <Btn key={s} kind="ghost" sm label={s === 'Active' ? 'Restore' : s} onPress={() => { setDecision({ u: editing, status: s }); setEditing(null); }} />)}</View></>}
      <Btn kind="blue" icon="check" label="Save account" onPress={save} />
      <Hint icon="shield">{live ? 'The server refuses any grant beyond what your own account holds, and keeps the last Main Admin.' : 'No account can give anyone more authority than it holds itself. Real invitations need the server.'}</Hint>
    </>}</Dialog>
    <ReasonDialog open={!!decision} title={`${decision?.status === 'Active' ? 'Restore' : decision?.status} · ${decision?.u.name || ''}`} confirm="Change account" kind={decision?.status === 'Active' ? 'blue' : 'danger'} onClose={() => setDecision(null)}
      intro={decision?.status === 'Soft Deleted' ? 'Hidden from lists; their past actions stay searchable for good.' : decision?.status === 'Active' ? 'They can sign in again.' : 'They cannot sign in until restored. Everything they did is kept.'}
      onConfirm={r => { if (!decision) return false; if (live) { decideLive(decision.u, decision.status, r); return; } setState(s => audit({ ...s, staff: s.staff.map(u => u.id === decision.u.id ? { ...u, status: decision.status } : u) }, 'Account status changed', decision.u.id, r, decision.u.status, decision.status)); a.toast(`${decision.u.name} is now ${decision.status.toLowerCase()}.`); }} />
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
  const { sync: refresh, syncing } = useSync();
  const sync = async () => {
    if (state.offline) { a.toast('Turn off offline mode first.'); return; }
    if (await getAccessToken()) { const ok = await refresh(); if (ok) a.toast('Up to date with the server.'); return; }
    const rows = state.entries.filter(e => e.status === 'Pending sync');
    setState(s => audit({ ...s, lastSync: new Date().toISOString(), entries: s.entries.map(e => { if (!rows.some(r => r.id === e.id)) return e; const ok = !Object.keys(validateEntry(e, s)).length && s.dealers.find(d => d.id === e.dealerId)?.status === 'Active'; return { ...e, status: ok ? 'Submitted' : 'Conflict', retries: e.retries + 1 }; }) }, 'Local queue reconciled', 'SYNC', `${rows.length} queued entries checked`));
    a.toast(rows.length ? `${rows.length} queued ${rows.length === 1 ? 'entry' : 'entries'} checked. Valid ones are in the approval queue.` : 'Nothing was waiting to sync.');
  };
  return <Page title="Settings & sync" sub="Your account, the lists that keep entries consistent, and system health">
    <Cols>
      <Stack>
        <Card><CardH title="Your account" right={<Chip tone="info" icon="shield" label={role} />} />
          <KV pairs={[['Name', a.user.name], ['Role', role], ['Sign-in', 'Email, password + two-step code'], ['Session', 'Ends after 15 minutes']]} />
          <View style={{ height: 12 }} />
          <Select label="Language for menus" value={state.language} options={['English', 'मराठी']} onChange={v => setState(s => ({ ...s, language: v as any }))} hint="Menu labels switch to Marathi. Record details stay in English." />
          <View style={{ flexDirection: 'row', gap: 9, flexWrap: 'wrap' }}><Btn kind="ghost" sm icon="logout" label="Sign out" onPress={a.signOut} /></View>
        </Card>
        <Card><CardH title="Sync & offline" right={state.offline ? <Chip tone="warn" icon="cloud" label="Offline" /> : <Chip tone="live" icon="wifi" label="Online" />} />
          <ToggleRow label="Work offline (practice)" sub="See how the app behaves without signal" value={state.offline} onChange={v => setState(s => ({ ...s, offline: v }))} />
          <KV pairs={[['Last sync', fmtAt(state.lastSync)], ['Waiting to sync', String(state.entries.filter(e => e.status === 'Pending sync').length)]]} />
          <Btn kind="blue" sm icon="sync" label={syncing ? 'Syncing…' : 'Sync now'} disabled={syncing} style={{ marginTop: 12 }} onPress={sync} />
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
export function SignIn({ onDone, onDealer }: { onDone: (session: Session) => void; onDealer: () => void }) {
  const inset = useSafeAreaInsets();
  const [mode, setMode] = useState<'in' | 'reset'>('in'), [email, setEmail] = useState(''), [pw, setPw] = useState(''), [code, setCode] = useState(''), [err, setErr] = useState(''), [done, setDone] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const fail = (e: unknown, fallback: string) => setErr(e instanceof ApiError ? e.message : fallback);
  const reset = (m: 'in' | 'reset') => { setMode(m); setChallenge(null); setCode(''); setPw(''); setErr(''); };
  const validEmail = () => { if (/^\S+@\S+\.\S+$/.test(email.trim())) return true; setErr('Enter your work email.'); return false; };

  // Step 1: email + password → the server sends a two-step code. Step 2: the code → a real session.
  const signIn = async () => {
    if (busy) return;
    if (!challenge) {
      if (!validEmail()) return;
      if (pw.length < 8) { setErr('The password has at least 8 characters.'); return; }
      setBusy(true);
      try { setChallenge((await adminLogin(email.trim(), pw)).challengeId); setDone(''); setErr(''); }
      catch (e) { fail(e, 'Could not reach the server. Try again.'); }
      finally { setBusy(false); }
      return;
    }
    if (code.length < 6) { setErr('Enter the 6-digit code.'); return; }
    setBusy(true);
    try {
      const result = await verifyOtp(challenge, code);
      if (!('accessToken' in result) || result.user.scope !== 'admin') { setErr('This account cannot open the head office console.'); return; }
      const session: Session = { user: result.user };
      await saveSession({ accessToken: result.accessToken, refreshToken: result.refreshToken }, session);
      onDone(session);
    } catch (e) { fail(e, 'That code is not right.'); }
    finally { setBusy(false); }
  };

  // Reset: email → code → verified token → new password.
  const resetPassword = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!challenge) {
        if (!validEmail()) return;
        setChallenge((await passwordForgot(email.trim())).challengeId); setErr('');
        return;
      }
      if (code.length < 6) { setErr('Enter the 6-digit code.'); return; }
      if (pw.length < 8) { setErr('Choose a password of at least 8 characters.'); return; }
      const result = await verifyOtp(challenge, code);
      if (!('verifiedToken' in result)) { setErr('That code cannot be used to reset a password.'); return; }
      await passwordReset(result.verifiedToken, pw);
      reset('in'); setDone('Password changed. Sign in with your new password.');
    } catch (e) { fail(e, 'Could not reach the server. Try again.'); }
    finally { setBusy(false); }
  };

  return <ScrollView style={{ flex: 1, backgroundColor: T.ink }} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20, paddingTop: 20 + inset.top }} keyboardShouldPersistTaps="handled">
    <View style={{ width: '100%', maxWidth: 400 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: T.volt, alignItems: 'center', justifyContent: 'center' }}><X s={18} w={7} f="c" c="#2A1F02">FB</X></View>
        <View><X s={17} w={7} c={T.white}>Felix Batteries</X><X s={12} c="#8C9BAE">Head office console</X></View></View>
      <View style={{ backgroundColor: T.white, borderRadius: 12, padding: 24 }}>
        {mode === 'in' ? <>
          <X s={19} w={7} f="c" style={{ marginBottom: 12 }}>Sign in</X>
          {!challenge ? <>
            <Field label="Work email" req value={email} onChange={v => { setEmail(v); setErr(''); }} ph="admin@example.com" />
            <Field label="Password" req secure value={pw} onChange={v => { setPw(v); setErr(''); }} ph="••••••••••" />
          </> : <Card style={{ backgroundColor: T.steelSoft, borderColor: '#C3D8F6' }}>
            <CardH title="Two-step code" size={14} />
            <X s={13} c={T.slate} style={{ marginBottom: 10 }}>We sent a 6-digit code for {email.trim()}.</X>
            <OtpBoxes value={code} onChange={v => { setCode(v); setErr(''); }} />
          </Card>}
          {err ? <Hint tone="err">{err}</Hint> : null}
          {done ? <Banner tone="ok" icon="check" style={{ marginTop: 12 }}>{done}</Banner> : null}
          <Btn kind="blue" icon="lock" label={busy ? 'Please wait…' : challenge ? 'Sign in' : 'Continue'} style={{ marginTop: 13 }} onPress={signIn} />
          {challenge
            ? <Pressable accessibilityRole="button" onPress={() => reset('in')} style={{ alignSelf: 'center', padding: 8, marginTop: 4 }}><X s={13} w={6} c={T.steel}>Use a different account</X></Pressable>
            : <Pressable accessibilityRole="button" onPress={() => { reset('reset'); setDone(''); }} style={{ alignSelf: 'center', padding: 8, marginTop: 4 }}><X s={13} w={6} c={T.steel}>Forgot password?</X></Pressable>}
          <Hint icon="shield" center>Every admin sign-in is recorded in the audit log.</Hint>
        </> : <>
          <X s={19} w={7} f="c" style={{ marginBottom: 6 }}>Reset your password</X>
          <X s={13.5} c={T.slate} style={{ marginBottom: 14 }}>We send a code to your work email, then you choose a new password.</X>
          {!challenge ? <Field label="Work email" req value={email} onChange={v => { setEmail(v); setErr(''); }} /> : <>
            <X s={13} w={6} c={T.ink3} style={{ marginBottom: 5 }}>Code sent to {email.trim()}</X><OtpBoxes value={code} onChange={v => { setCode(v); setErr(''); }} />
            <Field label="New password" req secure value={pw} onChange={v => { setPw(v); setErr(''); }} style={{ marginTop: 13 }} hint="At least 8 characters." hintIcon="shield" />
          </>}
          {err ? <Hint tone="err">{err}</Hint> : null}
          <Btn kind="blue" icon="check" label={busy ? 'Please wait…' : challenge ? 'Save new password' : 'Send code'} style={{ marginTop: 6 }} onPress={resetPassword} />
          <Pressable accessibilityRole="button" onPress={() => reset('in')} style={{ alignSelf: 'center', padding: 8, marginTop: 4 }}><X s={13} w={6} c={T.steel}>Back to sign in</X></Pressable>
        </>}
      </View>
      <Pressable accessibilityRole="button" onPress={onDealer} style={{ alignSelf: 'center', padding: 10, marginTop: 14 }}><X s={13} w={6} c="#AEBCCC" style={{ textDecorationLine: 'underline' }}>Dealer? Sign in to the dealer app</X></Pressable>
    </View>
  </ScrollView>;
}
