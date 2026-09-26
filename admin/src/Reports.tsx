import React, { useState } from 'react';
import { View, Pressable } from 'react-native';
import { useStore } from '@felix/shared/store';
import { expiryFrom, filterEntries, today, uid, warranty } from '@felix/shared/domain';
import { columns, exportReport } from '@felix/shared/reports';
import { T } from '@felix/shared/ui/theme';
import { X, B, Ic, Btn, Card, CardH, Chip, StatusChip, Field, Hint, Banner, KV, Kpis, Line, Avatar } from '@felix/shared/ui/kit';
import { dLong, monYear } from '@felix/shared/data';
import { Page, Box, Cols, Stack, Table, Pills, FilterPick, DatePick, Tabs, Dialog, Select, EntryTable, Bars, Empty, fmtAt, useA } from './ui';

export function Reports() {
  const a = useA(); const { state, setState, audit, canEdit } = useStore();
  const [tab, setTab] = useState('build'), [type, setType] = useState('All'), [status, setStatus] = useState('All'), [model, setModel] = useState('All'), [dealer, setDealer] = useState('All'), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [format, setFormat] = useState('Excel'), [selected, setSelected] = useState<string[]>(columns), [busy, setBusy] = useState(false), [save, setSave] = useState(false), [name, setName] = useState(''), [schedule, setSchedule] = useState('Manual');
  const dealerId = state.dealers.find(d => d.name === dealer)?.id;
  const rows = filterEntries(state.entries, '', type, status, model, from, to).filter(e => !dealerId || e.dealerId === dealerId);
  const lines = rows.reduce((n, e) => n + e.items.length, 0);
  async function run() {
    if (state.offline) { a.toast('Exports need online mode.'); return; }
    if (!selected.length) { a.toast('Pick at least one column.'); return; }
    setBusy(true);
    try {
      const count = await exportReport(rows, state, format, selected);
      setState(s => audit({ ...s, exports: [{ id: uid('EXP'), name: `Battery register · ${format}`, rows: count, date: new Date().toISOString() }, ...s.exports] }, 'Report exported', 'REPORT', `${count} items; ${[dealer, type, model, status, from, to].filter(v => v && v !== 'All').join('; ') || 'no filters'}; ${selected.length} columns`));
      a.toast(`${count} battery lines exported as ${format}.`);
    } catch { a.toast('The export could not finish. Try again, or choose another format.'); } finally { setBusy(false); }
  }
  const reps = state.entries.filter(e => e.type === 'Replacement' && !['Draft', 'Cancelled'].includes(e.status));
  const soon = Array.from({ length: 5 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i); const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; const list = state.batteries.filter(b => b.expiry?.startsWith(m)); return { m, count: list.length, dealers: new Set(list.map(b => b.dealerId)).size }; });
  return <Page title="Reports & exports" sub="Pick the rows, check them, then export"
    tabs={<Tabs value={tab} onChange={setTab} items={[['build', 'Build a report'], ['saved', `Saved ${state.reports.length}`], ['history', 'Export history'], ['analytics', 'Analytics']]} />}>
    {tab === 'build' && <Stack>
      <Box title="1 · Which entries" filters={<>
        <FilterPick label="Dealer" value={dealer} options={state.dealers.map(d => d.name)} onChange={setDealer} />
        <FilterPick label="Type" value={type} options={state.entryTypes} onChange={setType} />
        <FilterPick label="Status" value={status} options={['Approved', 'Submitted', 'Under Review', 'Rejected', 'Conflict', 'Corrected', 'Cancelled']} onChange={setStatus} />
        <FilterPick label="Model" value={model} options={state.models.map(m => m.id)} onChange={setModel} />
        <DatePick label="From" value={from} onChange={setFrom} /><DatePick label="To" value={to} onChange={setTo} />
      </>}>
        <View style={{ padding: 14 }}><Banner tone="ok" icon="check"><B>Every filter applies at once.</B> {rows.length} entries · {lines} battery lines match.</Banner></View>
      </Box>
      <Box title="2 · Which columns, in which order" right={<Pressable accessibilityRole="button" onPress={() => setSelected(columns)}><X s={12.5} w={6} c={T.steel}>Reset to register order</X></Pressable>} pad>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>{selected.map((c, i) => <View key={c} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: T.steelSoft, borderWidth: 1, borderColor: '#6FAF7F', borderRadius: 7, paddingLeft: 4, paddingRight: 8, paddingVertical: 3 }}>
          {i > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`Move ${c} left`} onPress={() => { const x = [...selected]; [x[i - 1], x[i]] = [x[i], x[i - 1]]; setSelected(x); }} style={{ padding: 3 }}><Ic n="back" size={13} color={T.steel} /></Pressable> : <View style={{ width: 19 }} />}
          <X s={12.5} w={6} c={T.steel}>{c}</X>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${c}`} onPress={() => setSelected(selected.filter(x => x !== c))} style={{ padding: 3 }}><Ic n="x" size={13} color={T.steel} /></Pressable></View>)}</View>
        {columns.some(c => !selected.includes(c)) && <><X s={12.5} w={6} c={T.slate} style={{ marginTop: 12, marginBottom: 6 }}>Add back</X>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>{columns.filter(c => !selected.includes(c)).map(c => <Pressable key={c} accessibilityRole="button" onPress={() => setSelected([...selected, c])} style={{ flexDirection: 'row', gap: 5, alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: T.zinc3, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 4 }}><Ic n="plus" size={13} color={T.slate} /><X s={12.5} c={T.slate}>{c}</X></Pressable>)}</View></>}
      </Box>
      <Box title="3 · Export" pad>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>{([['Excel', 'Keeps your column order'], ['CSV', 'For other systems'], ['PDF', 'For printing and sharing']] as const).map(([f, sub]) =>
          <Pressable key={f} accessibilityRole="button" accessibilityState={{ selected: format === f }} onPress={() => setFormat(f)} style={{ flexGrow: 1, minWidth: 180, flexDirection: 'row', gap: 11, alignItems: 'center', borderWidth: 1.5, borderColor: format === f ? T.steel : T.zinc2, backgroundColor: format === f ? T.steelSoft : T.white, borderRadius: 10, padding: 12 }}>
            <Avatar n="excel" tone={format === f ? 'blue' : 'mute'} /><View><X s={14.5} w={7}>{f}</X><X s={12.5} c={T.slate}>{sub}</X></View></Pressable>)}</View>
        <Hint icon="shield" style={{ marginTop: 11 }}>{format === 'Excel' ? 'Serials and codes are written as text, so 0047 stays 0047 when the file opens.' : format === 'CSV' ? 'CSV is plain text — import serial columns as Text in Excel to keep leading zeros.' : 'PDF opens the print or share dialog.'}</Hint>
        <View style={{ flexDirection: 'row', gap: 9, marginTop: 13, flexWrap: 'wrap' }}>
          <Btn kind="primary" icon="down" label={busy ? 'Preparing…' : `Export ${lines} lines`} disabled={busy || !canEdit || !rows.length} onPress={run} />
          <Btn kind="ghost" icon="doc" label="Save this report" disabled={!canEdit} onPress={() => setSave(true)} />
        </View>
        {!canEdit && <Hint icon="lock">Read-only access can look at reports but not export them.</Hint>}
      </Box>
      <Box title={`Preview · ${rows.length} entries`}><EntryTable entries={rows.slice(0, 50)} onOpen={e => a.go('entry', e.id)} />{rows.length > 50 && <X s={12.5} c={T.slate} style={{ padding: 12, textAlign: 'center' }}>Showing the first 50 — the export includes all {rows.length}.</X>}</Box>
    </Stack>}
    {tab === 'saved' && <Stack>
      <Banner tone="info" icon="clock">Saved reports keep their filters. Automatic delivery on a schedule starts once the server is connected — until then, open one and export it.</Banner>
      <Box><Table rows={state.reports} keyOf={r => r.id} empty="No saved reports yet."
        cols={[{ h: 'Report', w: 1.6, cell: r => <X s={13.5} w={7}>{r.name}</X> }, { h: 'Filters', w: 1.6, cell: r => `${r.type} · ${r.model} · ${r.status}` }, { h: 'Runs', w: 1, cell: r => r.schedule }, { h: '', w: 0.8, cell: r => <Btn kind="ghost" sm label="Open" onPress={() => { setType(r.type); setModel(r.model); setStatus(r.status); setTab('build'); }} /> }]}
        mobile={{ av: () => <Avatar n="doc" tone="mute" />, title: r => r.name, sub: r => `${r.type} · ${r.schedule}`, right: r => <Btn kind="ghost" sm label="Open" onPress={() => { setType(r.type); setModel(r.model); setStatus(r.status); setTab('build'); }} /> }} /></Box>
    </Stack>}
    {tab === 'history' && <Stack>
      <Box title="Who took what data, and when"><Table rows={state.exports} keyOf={e => e.id} empty="No exports yet. Build a report to create one."
        cols={[{ h: 'When', w: 1, cell: e => fmtAt(e.date) }, { h: 'Report', w: 1.6, cell: e => e.name }, { h: 'Rows', w: 0.6, cell: e => String(e.rows) }, { h: 'Filters used', w: 2, cell: e => { const x = state.audits.find(q => q.action === 'Report exported' && Math.abs(Date.parse(q.at) - Date.parse(e.date)) < 5000); return <X s={12.5} c={T.slate}>{x ? `${x.reason} · ${x.actor.split(' · ')[0]}` : '—'}</X>; } }]}
        mobile={{ av: () => <Avatar n="down" tone="mute" />, title: e => e.name, sub: e => `${fmtAt(e.date)} · ${e.rows} rows` }} /></Box>
      <Banner tone="warn" icon="eye">Every export is recorded with its filters and the person who ran it, so any figure in circulation can be traced back.</Banner>
    </Stack>}
    {tab === 'analytics' && <Stack>
      <Kpis cols={a.wide ? 4 : 2} items={[{ v: String(state.batteries.length), l: 'Batteries on record' }, { v: String(reps.length), l: 'Replacement entries' }, { v: String(state.batteries.filter(b => warranty(b).status === 'Expiring soon').length), l: 'Cover ends within 30 days', tone: 'flag' }, { v: String(state.entries.filter(e => ['Submitted', 'Under Review'].includes(e.status)).length), l: 'Waiting for a decision', tone: 'flag' }]} />
      <Cols>
        <Box title="Replacements by model" pad><Bars rows={state.models.map(m => [m.id, reps.flatMap(e => e.items).filter(i => i.model === m.id).length] as [string, number]).sort((x, y) => y[1] - x[1])} /></Box>
        <Box title="Cover ending by month"><Table rows={soon} keyOf={r => r.m}
          cols={[{ h: 'Month', w: 1, cell: r => monYear(`${r.m}-01`) }, { h: 'Batteries', w: 0.8, cell: r => String(r.count) }, { h: 'Dealers affected', w: 1, cell: r => String(r.dealers) }]}
          mobile={{ title: r => monYear(`${r.m}-01`), sub: r => `${r.count} batteries · ${r.dealers} dealers` }} /></Box>
      </Cols>
      <Box title="Dealer performance"><Table rows={state.dealers} keyOf={d => d.id} onRow={d => a.go('dealer', d.id)}
        cols={[{ h: 'Dealer', w: 1.5, cell: d => <X s={13.5} w={7}>{d.name}</X> }, { h: 'City', w: 0.8, cell: d => d.city }, { h: 'Entries', w: 0.6, cell: d => String(state.entries.filter(e => e.dealerId === d.id && e.status !== 'Draft').length) }, { h: 'Replacements', w: 0.8, cell: d => String(reps.filter(e => e.dealerId === d.id).length) }, { h: 'Exceptions', w: 0.7, cell: d => { const n = state.entries.filter(e => e.dealerId === d.id && ['Conflict', 'Rejected'].includes(e.status)).length; return n ? <Chip tone="bad" label={String(n)} /> : '0'; } }, { h: 'Status', w: 1, cell: d => <StatusChip status={d.status} /> }]}
        mobile={{ title: d => d.name, sub: d => `${d.city} · ${state.entries.filter(e => e.dealerId === d.id && e.status !== 'Draft').length} entries`, right: d => <StatusChip status={d.status} /> }} /></Box>
      <Banner tone="info" icon="alert">Failure rates need complete sales numbers and checked failure reasons. Until those are connected, this shows replacement counts only — no rates are invented.</Banner>
    </Stack>}
    <Dialog open={save} title="Save this report" onClose={() => setSave(false)} width={460}>
      <Field label="Report name" req value={name} onChange={setName} ph="e.g. Dhule replacements this month" />
      <Select label="Run it" value={schedule} options={['Manual', 'Daily · 9:00', 'Weekly · Monday', 'Monthly · 1st']} onChange={setSchedule} />
      <Btn kind="blue" icon="check" label="Save report" onPress={() => { if (!name.trim()) { a.toast('Give the report a name.'); return; } setState(s => ({ ...s, reports: [{ id: uid('RPT'), name: name.trim(), type, model, status, schedule }, ...s.reports] })); setSave(false); setName(''); a.toast('Report saved.'); }} />
    </Dialog>
  </Page>;
}
