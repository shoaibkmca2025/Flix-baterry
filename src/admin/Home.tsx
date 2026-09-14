import React, { useState } from 'react';
import { View } from 'react-native';
import { useStore } from '../store';
import { today, warranty } from '../domain';
import { T } from '../dealer/theme';
import { X, Btn, Chip, Kpis, Mono, KV, Tone, IconName } from '../dealer/kit';
import { ageDays, dShort, firstProblem, monYear } from '../dealer/data';
import { Page, Box, Cols, Stack, Table, Bars, Spark, ScanDialog, useA } from './ui';

type Decision = { key: string; what: string; detail: string; ref: string; dealer: string; raised: string; chip: [string, Tone, IconName]; go: () => void };

export function Home() {
  const a = useA(); const { state, canEdit } = useStore();
  const [scan, setScan] = useState(false);
  const dealerName = (id: string) => state.dealers.find(d => d.id === id)?.name || id;
  const live = state.entries.filter(e => e.status !== 'Draft');
  const waiting = live.filter(e => ['Submitted', 'Under Review'].includes(e.status));
  const conflicts = live.filter(e => e.status === 'Conflict');
  const corrections = live.filter(e => e.correction?.status === 'Pending');
  const newDealers = state.dealers.filter(d => d.status === 'Pending Approval');
  const overrides = state.overrides.filter(o => o.status === 'Pending');
  const reps = live.filter(e => e.type === 'Replacement' && !['Rejected', 'Cancelled', 'Pending sync'].includes(e.status));
  const atDealer = reps.filter(e => !e.returnState || e.returnState === 'At dealer');
  const onWay = reps.filter(e => e.returnState === 'In transit');
  const atCompany = reps.filter(e => ['Received', 'Testing', 'Repaired', 'Scrapped'].includes(e.returnState || ''));
  const month = today().slice(0, 7);

  const decisions: Decision[] = [
    ...conflicts.map(e => ({ key: e.id, what: 'Serial exception', detail: firstProblem(e, state) || 'A serial needs a look', ref: e.id, dealer: dealerName(e.dealerId), raised: dShort(e.createdAt), chip: ['Blocking', 'bad', 'alert'] as Decision['chip'], go: () => a.go('entry', e.id) })),
    ...waiting.map(e => ({ key: e.id, what: e.status === 'Under Review' ? 'Under review' : `${e.type} request`, detail: e.items.map(i => i.oldSerial ? `${i.oldSerial} → ${i.code}` : i.code).join(', '), ref: e.id, dealer: dealerName(e.dealerId), raised: dShort(e.createdAt), chip: [e.status === 'Under Review' ? 'Review' : 'Waiting', e.status === 'Under Review' ? 'vio' : 'warn', e.status === 'Under Review' ? 'eye' : 'clock'] as Decision['chip'], go: () => a.go('entry', e.id) })),
    ...corrections.map(e => ({ key: `c-${e.id}`, what: 'Correction asked for', detail: e.correction!.value, ref: e.id, dealer: dealerName(e.dealerId), raised: dShort(e.createdAt), chip: ['Review', 'vio', 'pen'] as Decision['chip'], go: () => a.go('corrections') })),
    ...newDealers.map(d => ({ key: d.id, what: 'New dealer', detail: d.name, ref: d.id, dealer: d.city, raised: dShort(state.audits.find(x => x.ref === d.id && x.action === 'Dealer registered')?.at), chip: ['Pending', 'warn', 'clock'] as Decision['chip'], go: () => a.go('registrations') })),
    ...overrides.map(o => ({ key: o.id, what: 'Warranty override asked', detail: `${o.days} extra days`, ref: o.code, dealer: dealerName(state.batteries.find(b => b.code === o.code)?.dealerId || ''), raised: '—', chip: ['Approval', 'vio', 'flag'] as Decision['chip'], go: () => a.go('warranty', 'overrides') })),
    ...state.challans.filter(c => c.entryIds.some(id => state.entries.find(e => e.id === id)?.returnState === 'In transit')).map(c => ({ key: c.no, what: 'Old batteries on the way', detail: `${c.rows.length} on challan`, ref: c.no, dealer: dealerName(c.dealerId), raised: dShort(c.at), chip: ['Receive', 'info', 'truck'] as Decision['chip'], go: () => a.go('returns') })),
  ];

  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 11 + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const byMonth = months.map(m => reps.filter(e => e.date.startsWith(m)).reduce((t, e) => t + e.items.length, 0));
  const byModel = state.models.map(m => [m.id, reps.flatMap(e => e.items).filter(i => i.model === m.id).length] as [string, number]).sort((x, y) => y[1] - x[1]);

  return <Page title="Dashboard" sub={`${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · work queue first, volume second`}
    actions={<>
      {canEdit && <Btn kind="primary" sm icon="check" label={`Review requests (${waiting.length + conflicts.length})`} onPress={() => a.go('approvals')} />}
      {canEdit && <Btn kind="ghost" sm icon="plus" label="Record an entry" onPress={() => a.go('new')} />}
      <Btn kind="ghost" sm icon="scan" label="Scan a battery" onPress={() => setScan(true)} />
    </>}>
    <Kpis cols={a.wide ? 4 : 2} items={[
      { v: String(waiting.length), l: 'Requests waiting for a decision', tone: 'flag', onPress: () => a.go('approvals') },
      { v: String(conflicts.length), l: 'Serial exceptions to resolve', tone: 'bad', onPress: () => a.go('approvals', 'conflict') },
      { v: String(corrections.length), l: 'Correction requests', tone: 'flag', onPress: () => a.go('corrections') },
      { v: String(newDealers.length), l: 'Dealers waiting for approval', tone: 'flag', onPress: () => a.go('registrations') },
    ]} />
    <View style={{ height: 14 }} />
    <Kpis cols={a.wide ? 4 : 2} items={[
      { v: String(state.dealers.filter(d => d.status === 'Active').length), l: 'Active dealers', onPress: () => a.go('dealers') },
      { v: String(state.batteries.length), l: 'Batteries on record', onPress: () => a.go('stock') },
      { v: String(reps.reduce((t, e) => t + e.items.length, 0)), l: 'Replacements', onPress: () => a.go('entries') },
      { v: String(live.filter(e => e.date.startsWith(month)).length), l: 'Entries this month', onPress: () => a.go('entries') },
    ]} />
    <View style={{ height: 14 }} />
    <Cols weights={[1.55, 1]}>
      <Box title="Needs a decision today" right={<Btn kind="ghost" sm label="Open queue" onPress={() => a.go('approvals')} />}>
        <Table rows={decisions.slice(0, 10)} keyOf={d => d.key} onRow={d => d.go()} empty="Nothing is waiting. Every request has a decision."
          cols={[
            { h: 'What', w: 1.7, cell: d => <View><X s={13.5} w={7}>{d.what}</X><X s={12} c={T.slate} numberOfLines={1}>{d.detail}</X></View> },
            { h: 'Reference', w: 1.2, cell: d => <X s={12.5} f="m" w={6}>{d.ref}</X> },
            { h: 'Dealer', w: 1.2, cell: d => d.dealer },
            { h: 'Raised', w: 0.6, cell: d => d.raised },
            { h: 'Action', w: 0.9, cell: d => <Chip tone={d.chip[1]} icon={d.chip[2]} label={d.chip[0]} /> },
          ]}
          mobile={{ title: d => d.what, sub: d => <><Mono>{d.ref}</Mono> · {d.dealer}</>, right: d => <Chip tone={d.chip[1]} icon={d.chip[2]} label={d.chip[0]} /> }} />
        {decisions.length > 10 && <X s={12.5} c={T.slate} style={{ padding: 12, textAlign: 'center' }}>{decisions.length - 10} more in the queues</X>}
      </Box>
      <Stack>
      <Box title="Replacements by month" right={<Chip tone="mute" label="12 months" />} pad><Spark values={byMonth} labels={[monYear(months[0] + '-01'), monYear(months[11] + '-01')]} /></Box>
      <Box title="By model" pad>{byModel.some(m => m[1]) ? <Bars rows={byModel} /> : <X s={13.5} c={T.slate}>No replacements recorded yet.</X>}</Box>
      <Box title="Old batteries" right={<Btn kind="ghost" sm label="Open returns" onPress={() => a.go('returns')} />} pad>
        <KV pairs={[['Still at dealers', String(atDealer.length)], ['On the way', String(onWay.length)], ['At the company', String(atCompany.length)], ['Waiting over 30 days', String(atDealer.filter(e => ageDays(e.date) > 30).length)]]} />
      </Box>
      <Box title="Warranty" right={<Btn kind="ghost" sm label="Open" onPress={() => a.go('warranty')} />} pad>
        <KV pairs={[['In cover', String(state.batteries.filter(b => warranty(b).status === 'Active').length)], ['Ending within 30 days', String(state.batteries.filter(b => warranty(b).status === 'Expiring soon').length)], ['Overrides waiting', String(overrides.length)], ['Not on record', String(state.batteries.filter(b => !b.expiry).length)]]} />
      </Box>
      </Stack>
    </Cols>
    <ScanDialog open={scan} onClose={() => setScan(false)} onCode={code => a.go('search', code)} />
  </Page>;
}
