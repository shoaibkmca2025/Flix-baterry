import React from 'react';
import { View, Pressable } from 'react-native';
import { useStore } from '@felix/shared/store';
import { getAccessToken } from '@felix/shared/api/session';
import { createEntry } from '@felix/shared/api/entries';
import { errorMessage } from '@felix/shared/api/client';
import { useSync } from '@felix/shared/api/sync';
import { buildEntryBody } from '@felix/shared/api/entry-body';
import { Entry, today, validateEntry } from '@felix/shared/domain';
import { T } from '@felix/shared/ui/theme';
import { X, Mono, Btn, BtnRow, Card, Chip, StatusChip, Kpis, SecT, Line, Avatar, Gap, AvTone } from '@felix/shared/ui/kit';
import { Screen, AppBar, useD, useTr } from './shell';
import { attention, avatarTone, creditNotes, dealerEntries, dShort, rupees, toSendBack, ageDays } from '@felix/shared/data';

/** Sends everything saved on this phone; invalid entries come back as serial exceptions. */
export function useSyncNow() {
  const { state, setState, dealerId, audit } = useStore(); const d = useD(); const { sync } = useSync();
  const sendLive = async (rows: Entry[], token: string) => {
    let sent = 0, bad = 0;
    for (const e of rows) {
      try {
        await createEntry(buildEntryBody(e), token);
        sent++;
        setState(s => ({ ...s, entries: s.entries.filter(x => x.id !== e.id) })); // the server's copy replaces it on refresh
      } catch (err) {
        bad++;
        setState(s => ({ ...s, entries: s.entries.map(x => x.id === e.id ? { ...x, status: 'Conflict', retries: x.retries + 1, remarks: x.remarks, items: x.items.map((it, i) => i === 0 ? { ...it, exception: errorMessage(err) } : it) } : x) }));
      }
    }
    await sync(true);
    d.toast(bad ? `${sent} sent. ${bad} need a fix — see My requests.` : `${sent} ${sent === 1 ? 'entry' : 'entries'} sent to head office.`);
  };
  return async () => {
    const rows = state.entries.filter(e => e.dealerId === dealerId && e.status === 'Pending sync');
    const token = await getAccessToken();
    if (token) {
      // signed in for real: send what is waiting, then pull the latest from head office
      if (rows.length) { await sendLive(rows, token); return; }
      const ok = await sync();
      d.toast(ok ? 'Up to date with head office.' : 'Nothing waiting to send.');
      return;
    }
    if (!rows.length) { d.toast('Nothing waiting to send.'); return; }
    const verdict = new Map(rows.map(e => [e.id, Object.keys(validateEntry(e, state)).length === 0]));
    setState(s => audit({ ...s, lastSync: new Date().toISOString(), entries: s.entries.map(e => verdict.has(e.id) ? { ...e, status: verdict.get(e.id) ? 'Submitted' : 'Conflict', retries: e.retries + 1 } : e) }, 'Entries sent from the dealer app', 'SYNC', `${rows.length} saved entries sent`));
    const bad = [...verdict.values()].filter(v => !v).length;
    d.toast(bad ? `${rows.length - bad} sent. ${bad} need a fix — see My requests.` : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} sent to head office.`);
  };
}

export const EntryLine = ({ e, last, onPress, showType }: { e: Entry; last?: boolean; onPress: () => void; showType?: boolean }) => {
  const it = e.items[0];
  return <Line last={last} onPress={onPress} label={`Open ${e.id}`} av={<Avatar n="batt" tone={avatarTone(e.status) as AvTone} />}
    title={<>{it?.model || '—'} · <Mono>{it?.serial || it?.oldSerial?.slice(-4) || '····'}</Mono>{showType && <X s={12.5} w={5} c={T.slate}>{'  '}{e.type}</X>}</>}
    sub={<Mono>{e.id} · {dShort(e.date)}{showType ? ` · qty ${e.items.length}` : ''}</Mono>} right={<StatusChip status={e.status} />} />;
};
export const openEntry = (d: ReturnType<typeof useD>, setFlow: ReturnType<typeof useD>['setFlow'], e: Entry) => {
  if (e.status === 'Draft') { setFlow({ entry: e, cur: 0, scanned: {} }); d.go(e.type === 'Replacement' ? 'd11' : 'd13'); }
  else d.go('d19', e.id);
};

/* d07 · dealer home */
export function D07() {
  const d = useD(), tr = useTr(); const { state, setState, dealerId } = useStore(); const sync = useSyncNow();
  const dealer = state.dealers.find(x => x.id === dealerId)!;
  const all = dealerEntries(state, dealerId), sent = all.filter(e => e.status !== 'Draft');
  const month = today().slice(0, 7);
  const needs = attention(all);
  const problems = all.filter(e => ['Conflict', 'Rejected'].includes(e.status));
  const queued = all.filter(e => e.status === 'Pending sync'), drafts = all.filter(e => e.status === 'Draft');
  const back = toSendBack(state, dealerId), cn = creditNotes(state, dealerId);
  const alerts: { av: [any, AvTone]; title: string; sub: string; go: () => void }[] = [];
  if (problems.length) alerts.push({ av: ['alert', 'red'], title: `${problems.length} ${problems.length === 1 ? 'request needs' : 'requests need'} your attention`, sub: problems.length === 1 ? `${problems[0].id} · ${problems[0].status === 'Conflict' ? 'head office has asked about the serial' : 'head office refused it — see why'}` : 'Tap to see what to fix', go: () => problems.length === 1 ? d.go('d19', problems[0].id) : d.go('d18', 'fix') });
  if (queued.length) alerts.push({ av: ['sync', 'amber'], title: `${queued.length} ${queued.length === 1 ? 'entry' : 'entries'} waiting to send`, sub: state.offline ? 'Saved on this phone · sends when signal returns' : 'Saved on this phone · tap to send now', go: sync });
  if (drafts.length) alerts.push({ av: ['pen', 'mute'], title: `${drafts.length} ${drafts.length === 1 ? 'entry' : 'entries'} not finished`, sub: 'Continue where you left off', go: () => d.go('d18', 'notsent') });
  if (back.length) alerts.push({ av: ['truck', 'amber'], title: `${back.length} old ${back.length === 1 ? 'battery' : 'batteries'} to send back`, sub: `Oldest has been in your shop ${ageDays(back[back.length - 1].date)} days`, go: () => d.tab('d33') });
  alerts.push({ av: ['check', 'green'], title: `${rupees(cn.monthTotal)} credited this month`, sub: `${cn.monthCount} ${cn.monthCount === 1 ? 'claim' : 'claims'} approved · ${cn.checking.length} still being checked`, go: () => d.go('d37') });
  return <Screen tab="home" top={<AppBar dark left={<View style={{ flex: 1 }}><X s={12} c="#8C9BAE">Welcome back</X><X s={20} w={7} f="c" c={T.white} numberOfLines={1}>{dealer.name}</X></View>} />}>
    <Kpis items={[
      { v: String(sent.reduce((t, e) => t + e.items.length, 0)), l: 'Batteries recorded' },
      { v: String(sent.filter(e => e.type === 'Replacement').reduce((t, e) => t + e.items.length, 0)), l: 'Replacements' },
      { v: String(sent.filter(e => e.date.startsWith(month)).length), l: 'This month' },
      { v: String(needs.length), l: 'Needs your attention', tone: 'flag', onPress: () => d.go('d18', 'fix') },
    ]} />
    <Gap h={13} />
    <Btn kind="primary" big icon="plus" label={tr('New replacement')} onPress={() => { d.setFlow(null); d.go('d10'); }} />
    <BtnRow><Btn icon="scan" label={tr('Scan')} onPress={() => d.tab('d23')} /><Btn kind="ghost" icon="search" label={tr('Find serial')} onPress={() => d.tab('d23')} /></BtnRow>
    <SecT title="Recent entries" />
    <Card>{all.length ? all.slice(0, 4).map((e, i, a) => <EntryLine key={e.id} e={e} last={i === a.length - 1} onPress={() => openEntry(d, d.setFlow, e)} />)
      : <X s={13.5} c={T.slate} style={{ paddingVertical: 8 }}>No entries yet. Tap “New replacement” to record the first one.</X>}</Card>
    <SecT title="Alerts" />
    <Card>{alerts.map((a, i) => <Line key={a.title} last={i === alerts.length - 1} onPress={a.go} av={<Avatar n={a.av[0]} tone={a.av[1]} />} title={a.title} sub={a.sub} chev />)}</Card>
  </Screen>;
}

/* d09 · profile & settings */
export function D09() {
  const d = useD(); const { state, setState, dealerId } = useStore();
  const dealer = state.dealers.find(x => x.id === dealerId)!;
  return <Screen tab="user" top={<AppBar title="Profile & settings" />}>
    <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <View style={{ width: 52, height: 52, borderRadius: 9, backgroundColor: T.steelSoft, alignItems: 'center', justifyContent: 'center' }}><Avatar n="shop" /></View>
      <View style={{ flex: 1 }}><X s={17} w={7}>{dealer.name}</X><X s={12.5} c={T.slate}>{dealer.code || dealer.id} · {dealer.city}</X></View>
      <StatusChip status={dealer.status} /></Card>
    <SecT title="Account" />
    <Card>{([['Shop profile & documents', 'shop', 'd06'], ['Credit notes', 'check', 'd37'], ['Change password', 'lock', 'd03']] as const).map((r, i) =>
      <Line key={r[0]} last={i === 2} onPress={() => d.go(r[2])} av={<Avatar n={r[1]} tone="mute" />} title={r[0]} chev />)}</Card>
    <SecT title="App" />
    <Card>
      <Line onPress={() => setState(s => ({ ...s, language: s.language === 'English' ? 'मराठी' : 'English' }))} av={<Avatar n="doc" tone="mute" />} title="Language" sub="English · मराठी" right={<Chip tone="info" label={state.language} />} />
      <Line last onPress={() => setState(s => ({ ...s, smsAlerts: !(s.smsAlerts ?? true) }))} av={<Avatar n="bell" tone="mute" />} title="Alerts by SMS" sub="Status changes and warranty reminders" right={state.smsAlerts ?? true ? <Chip tone="live" label="On" /> : <Chip tone="mute" label="Off" />} />
    </Card>
    <Btn kind="ghost" label="Sign out" color={T.terminal} borderColor="#F0C7BC" style={{ marginTop: 13 }} onPress={d.signOut} />
    <X s={12} c={T.slate} style={{ textAlign: 'center', marginTop: 14 }}>Felix Dealer App v1.0 · built by 4AM Global Media</X>
  </Screen>;
}
