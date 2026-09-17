import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, Modal, StyleSheet, Switch, TextInput, Platform, KeyboardAvoidingView, useWindowDimensions, StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useStore } from '../store';
import { Entry } from '../domain';
import { T, family } from '../dealer/theme';
import { X, Ic, IconName, Btn, Field, Chip, StatusChip, Mono, IconBtn, Line, Avatar, AvTone, ChipRow, Hint } from '../dealer/kit';
import { PickList } from '../dealer/shell';
import { dShort, avatarTone } from '../dealer/data';

/* ---------- navigation context ---------- */
export type ARoute = { r: string; id?: string };
export type AdminCtx = { route: ARoute; go: (r: string, id?: string) => void; root: (r: string) => void; back: () => void; canBack: boolean; toast: (m: string) => void; wide: boolean; openMenu: () => void; openSwitcher: () => void; signOut: () => void; user: { name: string; role: string } };
export const ACtx = createContext<AdminCtx>(null!);
export const useA = () => useContext(ACtx);
export const useWide = () => useWindowDimensions().width >= 1000;
const noOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null;

/* ---------- page frame ---------- */
export function Page({ title, sub, children, tabs, actions, back, pad = true }: { title: string; sub?: string; children: React.ReactNode; tabs?: React.ReactNode; actions?: React.ReactNode; back?: boolean; pad?: boolean }) {
  const a = useA(); const { state, role } = useStore();
  const [q, setQ] = useState('');
  const unread = state.notices.filter(n => !n.read).length;
  const bell = <View><IconBtn n="bell" label="Notifications" onPress={() => a.go('notifications')} />{unread > 0 && <View pointerEvents="none" style={{ position: 'absolute', top: 6, right: 7, width: 8, height: 8, borderRadius: 4, backgroundColor: T.terminal }} />}</View>;
  const banners = <>
    {state.offline && <Strip tone="warn" icon="cloud" text="Working offline. Decisions that change stock or warranty wait until you are back online." />}
    {role === 'Read-only' && <Strip tone="info" icon="eye" text="Read-only access. You can look at everything, but you cannot approve or change records." />}
  </>;
  return <View style={{ flex: 1, backgroundColor: T.zinc }}>
    {a.wide ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 20, backgroundColor: T.white, borderBottomWidth: 1, borderBottomColor: T.zinc2 }}>
      {back && a.canBack && <IconBtn n="back" label="Back" onPress={a.back} />}
      <View style={{ flexShrink: 1 }}><X s={19} w={7} f="c" numberOfLines={1}>{title}</X>{sub ? <X s={12.5} c={T.slate} numberOfLines={1}>{sub}</X> : null}</View>
      <View style={{ marginLeft: 'auto', width: 320, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: T.zinc, borderWidth: 1, borderColor: T.zinc2, borderRadius: 8, paddingHorizontal: 12, height: 38 }}>
        <Ic n="search" size={17} color={T.slate} />
        <TextInput value={q} onChangeText={setQ} onSubmitEditing={() => { if (q.trim()) { a.go('search', q.trim()); setQ(''); } }} placeholder="Search a serial, dealer, entry or customer" placeholderTextColor={T.slate} returnKeyType="search" accessibilityLabel="Search everything"
          style={[{ flex: 1, fontFamily: family('b', 4), fontSize: 13.5, color: T.ink, padding: 0 }, noOutline]} />
      </View>
      {bell}
    </View>
      : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 8, paddingHorizontal: 15, paddingBottom: 13, backgroundColor: T.zinc, borderBottomWidth: 1, borderBottomColor: T.zinc2 }}>
        {back && a.canBack ? <IconBtn n="back" label="Back" onPress={a.back} /> : <IconBtn n="menu" label="Menu" onPress={a.openMenu} />}
        <X s={19} w={7} f="c" numberOfLines={1} style={{ flex: 1 }}>{title}</X>
        {bell}
      </View>}
    {banners}
    {tabs}
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={pad ? { padding: a.wide ? 20 : 15, paddingTop: a.wide ? 18 : 14, paddingBottom: 40 } : undefined}>
      {!a.wide && sub ? <X s={13.5} c={T.slate} style={{ marginBottom: 12 }}>{sub}</X> : null}
      {actions ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 14 }}>{actions}</View> : null}
      {children}
    </ScrollView>
  </View>;
}
function Strip({ tone, icon, text }: { tone: 'warn' | 'info'; icon: IconName; text: string }) {
  const [bg, fg] = tone === 'warn' ? [T.voltSoft, '#7A5406'] : [T.steelSoft, '#1E3F7E'];
  return <View style={{ flexDirection: 'row', gap: 9, alignItems: 'center', backgroundColor: bg, paddingVertical: 8, paddingHorizontal: 20 }}><Ic n={icon} size={16} color={fg} /><X s={12.5} w={6} c={fg} style={{ flex: 1 }}>{text}</X></View>;
}

/* ---------- layout ---------- */
export function Cols({ children, weights, gap = 14, style }: { children: React.ReactNode; weights?: number[]; gap?: number; style?: StyleProp<ViewStyle> }) {
  const wide = useWide(); const kids = React.Children.toArray(children).filter(Boolean);
  if (!wide) return <View style={[{ gap }, style]}>{kids}</View>;
  return <View style={[{ flexDirection: 'row', gap, alignItems: 'flex-start' }, style]}>{kids.map((k, i) => <View key={i} style={{ flex: weights?.[i] ?? 1, minWidth: 0, gap }}>{k}</View>)}</View>;
}
export const Stack = ({ children, gap = 14 }: { children: React.ReactNode; gap?: number }) => <View style={{ gap }}>{children}</View>;

/** White bordered box with an optional header row — the prototype's .tbl */
export function Box({ title, right, children, filters, style, pad }: { title?: string; right?: React.ReactNode; children: React.ReactNode; filters?: React.ReactNode; style?: StyleProp<ViewStyle>; pad?: boolean }) {
  return <View style={[{ backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2, borderRadius: 10, overflow: 'hidden' }, style]}>
    {(title || right) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: T.zinc2, flexWrap: 'wrap' }}>
      {title ? <X s={15} w={7} f="c" style={{ flex: 1, minWidth: 140 }}>{title}</X> : <View style={{ flex: 1 }} />}{right}</View>}
    {filters && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: '#FAFBFD', borderBottomWidth: 1, borderBottomColor: T.zinc2, alignItems: 'center' }}>{filters}</View>}
    {pad ? <View style={{ padding: 14 }}>{children}</View> : children}
  </View>;
}

export type Col<R> = { h: string; w?: number; cell: (r: R) => React.ReactNode };
/** Table on desktop, tappable rows on phones. */
export function Table<R>({ cols, rows, keyOf, onRow, empty = 'Nothing to show.', mobile, compact }: { cols: Col<R>[]; rows: R[]; keyOf: (r: R) => string; onRow?: (r: R) => void; empty?: string; compact?: boolean; mobile: { title: (r: R) => React.ReactNode; sub?: (r: R) => React.ReactNode; right?: (r: R) => React.ReactNode; av?: (r: R) => React.ReactNode } }) {
  const wide = useWide();
  if (!rows.length) return <X s={13.5} c={T.slate} style={{ padding: 14 }}>{empty}</X>;
  const text = (v: React.ReactNode) => typeof v === 'string' || typeof v === 'number' ? <X s={13.5}>{v}</X> : v;
  if (!wide || compact) return <View style={{ paddingHorizontal: 14 }}>{rows.map((r, i) => <Line key={keyOf(r)} last={i === rows.length - 1} onPress={onRow ? () => onRow(r) : undefined} av={mobile.av?.(r)} title={mobile.title(r)} sub={mobile.sub?.(r)} right={mobile.right?.(r)} chev={!!onRow && !mobile.right} />)}</View>;
  return <View>
    <View style={{ flexDirection: 'row', backgroundColor: T.zinc, borderBottomWidth: 1, borderBottomColor: T.zinc2 }}>{cols.map(c => <View key={c.h} style={{ flex: c.w ?? 1, paddingVertical: 9, paddingHorizontal: 10 }}><X s={11} w={7} c={T.slate} style={{ letterSpacing: 0.66 }} numberOfLines={1}>{c.h.toUpperCase()}</X></View>)}</View>
    {rows.map((r, i) => {
      const body = cols.map(c => <View key={c.h} style={{ flex: c.w ?? 1, paddingVertical: 10, paddingHorizontal: 10, minWidth: 0, justifyContent: 'center' }}>{text(c.cell(r))}</View>);
      const st: ViewStyle = { flexDirection: 'row', alignItems: 'center', borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: T.zinc2 };
      return onRow ? <Pressable key={keyOf(r)} accessibilityRole="button" onPress={() => onRow(r)} style={({ hovered, pressed }: any) => [st, (hovered || pressed) && { backgroundColor: '#FAFBFD' }]}>{body}</Pressable> : <View key={keyOf(r)} style={st}>{body}</View>;
    })}
  </View>;
}

export function Tabs({ items, value, onChange }: { items: [string, string][]; value: string; onChange: (k: string) => void }) {
  return <View style={{ backgroundColor: T.white, borderBottomWidth: 1, borderBottomColor: T.zinc2 }}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 2 }}>
    {items.map(([k, l]) => { const on = k === value; return <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(k)} style={{ paddingVertical: 10, paddingHorizontal: 13, borderBottomWidth: 2.5, borderBottomColor: on ? T.steel : 'transparent' }}><X s={13.5} w={6} c={on ? T.steel : T.slate}>{l}</X></Pressable>; })}
  </ScrollView></View>;
}
export function Pills({ items, value, onChange }: { items: [string, string][]; value: string; onChange: (k: string) => void }) {
  return <>{items.map(([k, l]) => { const on = k === value; return <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(k)} style={{ backgroundColor: on ? T.steelSoft : T.white, borderWidth: 1, borderColor: on ? '#A9C4EE' : T.zinc3, borderRadius: 7, paddingVertical: 5, paddingHorizontal: 10 }}><X s={12.5} w={on ? 6 : 4} c={on ? '#22468A' : T.ink}>{l}</X></Pressable>; })}</>;
}
/** Compact filter pill — "Type: Replacement ▾" — that opens a picker. */
export function FilterPick({ label, value, options, onChange, all = 'All' }: { label: string; value: string; options: string[]; onChange: (v: string) => void; all?: string }) {
  const [open, setOpen] = useState(false); const on = value !== all;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={() => setOpen(true)} style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: on ? T.steelSoft : T.white, borderWidth: 1, borderColor: on ? '#A9C4EE' : T.zinc3, borderRadius: 7, paddingVertical: 5, paddingLeft: 10, paddingRight: on ? 6 : 8 }}>
      <X s={12.5} c={on ? '#22468A' : T.ink}>{label}: <X s={12.5} w={6} c={on ? '#22468A' : T.ink}>{value}</X></X>
      {on ? <Pressable accessibilityLabel={`Clear ${label}`} onPress={() => onChange(all)} hitSlop={8}><Ic n="x" size={13} color={T.slate} /></Pressable> : <Ic n="chev" size={13} color={T.slate} style={{ transform: [{ rotate: '90deg' }] }} />}
    </Pressable>
    <Dialog open={open} title={label} onClose={() => setOpen(false)} width={460}><PickList options={[all, ...options].map(v => ({ v }))} value={value} onPick={v => { onChange(v); setOpen(false); }} /></Dialog>
  </>;
}
export function DatePick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(value), [err, setErr] = useState('');
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} date`} onPress={() => { setDraft(value); setErr(''); setOpen(true); }} style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: value ? T.steelSoft : T.white, borderWidth: 1, borderColor: value ? '#A9C4EE' : T.zinc3, borderRadius: 7, paddingVertical: 5, paddingHorizontal: 10 }}>
      <Ic n="clock" size={13} color={value ? '#22468A' : T.slate} /><X s={12.5} c={value ? '#22468A' : T.ink}>{label}: <X s={12.5} w={6} c={value ? '#22468A' : T.ink}>{value ? dShort(value) : 'any'}</X></X></Pressable>
    <Dialog open={open} title={`${label} date`} onClose={() => setOpen(false)} width={420}>
      <Field label="Date" mono value={draft} onChange={v => { setDraft(v); setErr(''); }} ph="YYYY-MM-DD" error={err} maxLength={10} />
      <View style={{ flexDirection: 'row', gap: 9 }}>
        <View style={{ flex: 1 }}><Btn kind="ghost" label="Clear" onPress={() => { onChange(''); setOpen(false); }} /></View>
        <View style={{ flex: 1 }}><Btn kind="blue" label="Apply" onPress={() => { if (draft && (!/^\d{4}-\d{2}-\d{2}$/.test(draft) || !Number.isFinite(Date.parse(draft)))) { setErr('Use YYYY-MM-DD, for example 2026-09-01.'); return; } onChange(draft); setOpen(false); }} /></View>
      </View>
    </Dialog>
  </>;
}
export function SearchBox({ value, onChange, ph, style }: { value: string; onChange: (v: string) => void; ph: string; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc3, borderRadius: 7, paddingHorizontal: 10, minHeight: 32, minWidth: 200, flexGrow: 1 }, style]}>
    <Ic n="search" size={15} color={T.slate} />
    <TextInput value={value} onChangeText={onChange} placeholder={ph} placeholderTextColor={T.slate} accessibilityLabel={ph} autoCorrect={false} autoCapitalize="none" style={[{ flex: 1, fontFamily: family('b', 4), fontSize: 13, color: T.ink, paddingVertical: 6 }, noOutline]} />
    {!!value && <Pressable accessibilityLabel="Clear" onPress={() => onChange('')}><Ic n="x" size={15} color={T.slate} /></Pressable>}
  </View>;
}

/* ---------- dialogs ---------- */
export function Dialog({ open, title, sub, onClose, children, width = 560 }: { open: boolean; title: string; sub?: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  const wide = useWide(), inset = useSafeAreaInsets();
  return <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: 'rgba(20,26,35,0.55)', justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? 24 : 0 }}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={{ width: '100%', maxWidth: wide ? width : undefined, maxHeight: '92%', backgroundColor: T.zinc, borderRadius: wide ? 14 : 0, borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden', paddingBottom: wide ? 0 : inset.bottom }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 13, paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: T.zinc2, backgroundColor: T.white }}>
          <View style={{ flex: 1 }}><X s={19} w={7} f="c">{title}</X>{sub ? <X s={12.5} c={T.slate}>{sub}</X> : null}</View><IconBtn n="x" label="Close" onPress={onClose} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingBottom: 24 }}>{children}</ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
/** Every decision asks for a reason — suggestions keep it one tap for common cases. */
export function ReasonDialog({ open, title, intro, confirm = 'Confirm', kind = 'blue', suggestions = [], onClose, onConfirm, children, disabled }: { open: boolean; title: string; intro?: React.ReactNode; confirm?: string; kind?: 'blue' | 'danger' | 'primary'; suggestions?: string[]; onClose: () => void; onConfirm: (reason: string) => boolean | void; children?: React.ReactNode; disabled?: boolean }) {
  const [reason, setReason] = useState(''), [err, setErr] = useState('');
  useEffect(() => { if (open) { setReason(''); setErr(''); } }, [open]);
  return <Dialog open={open} title={title} onClose={onClose}>
    {intro ? <X s={14} c={T.slate} style={{ marginBottom: 14 }}>{intro}</X> : null}
    {children}
    {suggestions.length > 0 && <View style={{ marginBottom: 4 }}><X s={13} w={6} c={T.ink3} style={{ marginBottom: 10 }}>Common reasons</X><ChipRow options={suggestions} value={reason} onChange={v => { setReason(v); setErr(''); }} /></View>}
    <Field label="Reason" req value={reason} onChange={v => { setReason(v); setErr(''); }} ph="Written into the audit log with your name" multiline error={err} />
    <Hint icon="lock" style={{ marginTop: -6, marginBottom: 14 }}>Your name, the time and this reason are recorded permanently.</Hint>
    <Btn kind={kind} icon="check" label={confirm} disabled={disabled} onPress={() => { if (reason.trim().length < 5) { setErr('Write at least a few words (5 characters).'); return; } if (onConfirm(reason.trim()) !== false) onClose(); }} />
  </Dialog>;
}
export function Select({ label, value, options, onChange, req, hint, ph = 'Choose', style }: { label?: string; value: string; options: (string | { v: string; sub?: string })[]; onChange: (v: string) => void; req?: boolean; hint?: string; ph?: string; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  const list = options.map(o => typeof o === 'string' ? { v: o } : o);
  return <View style={style}><Field label={label} req={req} value={value} ph={ph} onPress={() => setOpen(true)} tail={<Ic n="chev" color={T.slate} />} hint={hint} />
    <Dialog open={open} title={label || 'Choose'} onClose={() => setOpen(false)} width={460}><PickList options={list} value={value} onPick={v => { onChange(v); setOpen(false); }} /></Dialog></View>;
}
export function ToggleRow({ label, sub, value, onChange, disabled, last }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; last?: boolean }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderBottomColor: T.zinc2 }}>
    <View style={{ flex: 1 }}><X s={14.5} w={6}>{label}</X>{sub ? <X s={12.5} c={T.slate}>{sub}</X> : null}</View>
    <Switch value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: T.live, false: T.zinc3 }} thumbColor={T.white} {...(Platform.OS === 'web' ? { activeThumbColor: T.white } as any : {})} />
  </View>;
}
export const Empty = ({ icon = 'box', title, text, action }: { icon?: IconName; title: string; text?: string; action?: React.ReactNode }) =>
  <View style={{ alignItems: 'center', paddingVertical: 34, paddingHorizontal: 20, gap: 8 }}><Avatar n={icon} tone="mute" size={52} /><X s={17} w={7} f="c">{title}</X>{text ? <X s={13.5} c={T.slate} style={{ textAlign: 'center', maxWidth: 380 }}>{text}</X> : null}{action}</View>;

/* ---------- small data displays ---------- */
export function Bars({ rows, danger }: { rows: [string, number][]; danger?: number }) {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return <View>{rows.map(([n, v]) => <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
    <X s={13} w={6} style={{ width: 46 }}>{n}</X>
    <View style={{ flex: 1, height: 9, backgroundColor: T.zinc, borderRadius: 5, overflow: 'hidden' }}><View style={{ width: `${(v / max) * 100}%`, height: '100%', borderRadius: 5, backgroundColor: danger !== undefined && v >= danger && v > 0 ? T.terminal : T.steel }} /></View>
    <X s={13} w={6} c={T.slate} style={{ width: 38, textAlign: 'right' }}>{v}</X></View>)}</View>;
}
export function Spark({ values, labels, hi = 2 }: { values: number[]; labels: [string, string]; hi?: number }) {
  const max = Math.max(1, ...values);
  return <View><View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 64 }}>{values.map((v, i) => <View key={i} style={{ flex: 1, height: `${Math.max(4, (v / max) * 100)}%`, backgroundColor: i >= values.length - hi ? T.steel : T.steelSoft, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />)}</View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }}><X s={11.5} c={T.slate}>{labels[0]}</X><X s={11.5} c={T.slate}>{labels[1]}</X></View></View>;
}
export function Diff({ was, now }: { was?: string; now?: string }) {
  if (!was && !now) return null;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 4 }}>
    {was ? <View style={{ backgroundColor: T.terminalSoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}><X s={12} f="m" w={5} c="#992A15" style={{ textDecorationLine: 'line-through' }}>{was}</X></View> : null}
    {was && now ? <X s={12} c={T.slate}>→</X> : null}
    {now ? <View style={{ backgroundColor: T.liveSoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}><X s={12} f="m" w={5} c="#12603C">{now}</X></View> : null}
  </View>;
}
export const fmtAt = (iso: string) => { const d = new Date(iso); return `${dShort(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** Entries as a table (desktop) or rows (phone). */
export function EntryTable({ entries, onOpen, empty, showDealer = true, compact }: { entries: Entry[]; onOpen: (e: Entry) => void; empty?: string; showDealer?: boolean; compact?: boolean }) {
  const { state } = useStore();
  const dealerName = (id: string) => state.dealers.find(d => d.id === id)?.name || id;
  return <Table compact={compact} rows={entries} keyOf={e => e.id} onRow={onOpen} empty={empty || 'No entries match.'}
    cols={[
      { h: 'Reference', w: 1.3, cell: e => <X s={13} f="m" w={6}>{e.id}</X> },
      { h: 'Type', w: 1.1, cell: e => e.type },
      { h: 'Model', w: 0.6, cell: e => <X s={13.5} w={7}>{e.items.map(i => i.model).join(', ')}</X> },
      { h: 'Serial', w: 1, cell: e => <X s={13} f="m" w={6}>{e.items[0]?.code || '—'}{e.items.length > 1 ? ` +${e.items.length - 1}` : ''}</X> },
      { h: 'Old serial', w: 1, cell: e => e.items[0]?.oldSerial ? <X s={13} f="m" w={6} c={T.steel}>{e.items[0].oldSerial}</X> : <X s={13.5} c={T.zinc3}>—</X> },
      ...(showDealer ? [{ h: 'Dealer', w: 1.3, cell: (e: Entry) => dealerName(e.dealerId) }] : []),
      { h: 'Date', w: 0.7, cell: e => dShort(e.date) },
      { h: 'Status', w: 1.1, cell: e => <StatusChip status={e.status} /> },
    ]}
    mobile={{ av: e => <Avatar n="batt" tone={avatarTone(e.status) as AvTone} />, title: e => <>{e.items[0]?.model} · <Mono>{e.items[0]?.code || '—'}</Mono></>, sub: e => <><Mono>{e.id}</Mono>{showDealer ? ` · ${dealerName(e.dealerId)}` : ''} · {dShort(e.date)}</>, right: e => <StatusChip status={e.status} /> }} />;
}

/* ---------- scanner ---------- */
export function ScanDialog({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const [perm, request] = useCameraPermissions(); const [active, setActive] = useState(false), [manual, setManual] = useState(''), [msg, setMsg] = useState('');
  const fired = useRef(false);
  const start = async () => { try { const ok = perm?.granted || (await request()).granted; if (!ok) { setMsg('Camera access declined. Type the number instead.'); return; } fired.current = false; setActive(true); } catch { setMsg('The camera is not available here. Type the number instead.'); } };
  useEffect(() => { if (open) { setManual(''); setMsg(''); start(); } else setActive(false); }, [open]);
  const use = (code: string) => { setActive(false); onCode(code); onClose(); };
  return <Dialog open={open} title="Scan a battery" onClose={onClose} width={460}>
    <View style={{ backgroundColor: T.ink, borderRadius: 12, height: 212, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {active && <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc_a', 'datamatrix'] }} onBarcodeScanned={({ data }) => { if (fired.current) return; fired.current = true; use(data.match(/\d{8}/)?.[0] || data.replace(/\D/g, '').slice(0, 8)); }} />}
      <View style={{ width: 196, height: 118, borderWidth: 3, borderColor: T.volt, borderRadius: 8 }}><View style={{ position: 'absolute', left: 8, right: 8, top: '50%', height: 2, backgroundColor: T.terminal }} /></View>
      <X s={12.5} c="#A8B6C7" style={{ position: 'absolute', bottom: 12 }}>Hold the label inside the box</X>
    </View>
    {msg ? <Hint tone="err">{msg}</Hint> : null}
    <Btn kind="blue" sm icon="scan" label={active ? 'Stop camera' : 'Start camera'} style={{ alignSelf: 'stretch', marginTop: 12 }} onPress={() => active ? setActive(false) : start()} />
    <View style={{ height: 14 }} />
    <Field label="Or type the number on the label" mono numeric maxLength={8} value={manual} onChange={v => setManual(v.replace(/\D/g, ''))} ph="8 digits" />
    <Btn kind="primary" icon="check" label="Use this number" disabled={!manual} onPress={() => use(manual)} />
  </Dialog>;
}
export { Chip };
