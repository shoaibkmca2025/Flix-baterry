import React, { useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, Platform, StyleProp, ViewStyle, TextStyle, TextProps } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { T, family, Face, Weight } from './theme';

/* ---------- icons (same stroke paths as the prototype) ---------- */
export const P = {
  home: 'M3 11 12 3l9 8v10H3z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12M20 20l-4.6-4.6',
  list: 'M4 6h16M4 12h16M4 18h16',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  batt: 'M2 8h16v10H2zM19 11v4M6 8V5h3v3M12 8V5h3v3',
  scan: 'M3 8V4h4M21 8V4h-4M3 16v4h4M21 16v4h-4M3 12h18',
  check: 'M4 12.5 9 18 20 6',
  alert: 'M12 4 21 20H3zM12 10v4M12 17h.01',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M12 8v4.4l2.8 1.8',
  sync: 'M4 12a8 8 0 0 1 13.7-5.7L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.7L4 16M4 20v-4h4',
  box: 'M3 8l9-4 9 4v8l-9 4-9-4zM3 8l9 4 9-4M12 12v8',
  chart: 'M4 20V10M10 20V4M16 20v-7M2 20h20',
  shield: 'M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  bell: 'M6 9a6 6 0 1 1 12 0c0 4 2 5 2 5H4s2-1 2-5M10 19a2 2 0 0 0 4 0',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M12 2v3M12 19v3M2 12h3M19 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1',
  cam: 'M3 8h4l2-3h6l2 3h4v12H3zM12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  pin: 'M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
  pen: 'M4 20l4-1L19 8l-3-3L5 16z',
  link: 'M9.5 14.5l5-5M13 5l2-2a4 4 0 0 1 6 6l-2 2M11 19l-2 2a4 4 0 0 1-6-6l2-2',
  chev: 'M9 5l7 7-7 7',
  back: 'M15 5l-7 7 7 7',
  filter: 'M3 5h18l-7 8v6l-4-2v-4z',
  down: 'M12 4v11M7.5 11 12 15.5 16.5 11M4 20h16',
  shop: 'M4 9h16v11H4zM3 9l2-5h14l2 5M9 20v-6h6v6',
  phone: 'M8 2h8v20H8zM11 19h2',
  lock: 'M6 10h12v10H6zM9 10V7a3 3 0 0 1 6 0v3M12 14v2',
  flag: 'M6 3v18M6 4h12l-2.5 4L18 12H6',
  bolt: 'M13 3 5 13h6l-1 8 8-10h-6z',
  wrench: 'M15 3a6 6 0 0 0-5.2 9L3 18.8 5.2 21 12 14.2A6 6 0 0 0 21 9l-3.2 3.2-2.8-2.8L18.2 6A6 6 0 0 0 15 3',
  truck: 'M2 6h11v11H2zM13 10h4l4 4v3h-8zM6.5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M17.5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  x: 'M6 6l12 12M18 6L6 18',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
  wifi: 'M2 8.5C5 6 8.4 4.7 12 4.7S19 6 22 8.5M5.5 12.4A10 10 0 0 1 12 10c2.5 0 4.8.9 6.5 2.4M9 16.2a5 5 0 0 1 6 0M12 20h.01',
  cloud: 'M7 18a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.5 1.6A3.5 3.5 0 0 1 17.5 18z',
  excel: 'M5 3h9l5 5v13H5zM14 3v5h5M9 12l6 6M15 12l-6 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  people: 'M9 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M2 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5M17 5.5a3 3 0 0 1 0 6M18 14.6c2.4.7 4 2.6 4 6.4',
  upload: 'M12 16V5M7.5 9.5 12 5l4.5 4.5M4 20h16',
  up: 'M12 19V5M6 11l6-6 6 6',
  logout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  menu: 'M4 7h16M4 12h16M4 17h16',
  updown: 'M8 9.5 12 5.5l4 4M8 14.5l4 4 4-4', // a dropdown: opens a list of choices (› means "go to another screen")
};
export type IconName = keyof typeof P;
export const Ic = ({ n, size = 20, color = T.ink, sw = 1.9, style }: { n: IconName; size?: number; color?: string; sw?: number; style?: StyleProp<ViewStyle> }) =>
  <View style={[{ width: size, height: size }, style]} pointerEvents="none"><Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d={P[n]} stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" /></Svg></View>;

/* ---------- text ---------- */
type XProps = TextProps & { s?: number; w?: Weight; f?: Face; c?: string; lh?: number; style?: StyleProp<TextStyle>; children?: React.ReactNode };
export function X({ s = 15, w = 4, f = 'b', c = T.ink, lh = 1.45, style, children, ...rest }: XProps) {
  return <Text {...rest} style={[{ fontFamily: family(f, w), fontSize: s, lineHeight: Math.round(s * lh), color: c }, f === 'm' && { letterSpacing: s * 0.01 }, style]}>{children}</Text>;
}
/** Bold run inside a parent X — inherits size and colour. */
export const B = ({ children, onPress, u }: { children: React.ReactNode; onPress?: () => void; u?: boolean }) =>
  <Text onPress={onPress} style={{ fontFamily: family('b', 7), textDecorationLine: u ? 'underline' : 'none' }}>{children}</Text>;
/** Serial number run inside a parent X. */
export const Mono = ({ children }: { children: React.ReactNode }) => <Text style={{ fontFamily: family('m', 6) }}>{children}</Text>;

const WEB = Platform.OS === 'web';
const noOutline = WEB ? ({ outlineStyle: 'none' } as any) : null;
// Keyboard focus on the web (the head-office console is used with a keyboard): every focusable
// control gets a visible ring, but only for keyboard focus (:focus-visible), never on a mouse click.
// Text boxes draw their own focus border instead (see Field), since they sit inside a bordered box.
if (WEB && typeof document !== 'undefined' && !document.getElementById('felix-focus')) {
  const css = document.createElement('style'); css.id = 'felix-focus';
  css.textContent = '[tabindex]:not([tabindex="-1"]):focus-visible{outline:2px solid #0B6E26!important;outline-offset:2px;box-shadow:0 0 0 2px #FFFFFF}';
  document.head.appendChild(css);
}
type PState = { pressed: boolean; hovered?: boolean };
/** Press feedback everywhere, plus a hover state for the pointer on the web. */
const fx = ({ pressed, hovered }: PState, hoverBg?: string): ViewStyle | null =>
  pressed ? { opacity: 0.72 } : WEB && hovered ? (hoverBg ? { backgroundColor: hoverBg } : { opacity: 0.9 }) : null;

/* ---------- chips ---------- */
export type Tone = 'live' | 'warn' | 'bad' | 'info' | 'mute' | 'vio';
const CHIP: Record<Tone, [string, string]> = { live: [T.liveSoft, '#12603C'], warn: [T.voltSoft, '#8A6008'], bad: [T.terminalSoft, '#992A15'], info: [T.infoSoft, T.info], mute: [T.zinc, T.slate], vio: [T.violetSoft, '#4F3785'] };
export function Chip({ tone = 'mute', icon, label, mono, style }: { tone?: Tone; icon?: IconName; label: string; mono?: boolean; style?: StyleProp<ViewStyle> }) {
  const [bg, fg] = CHIP[tone];
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingLeft: icon ? 7 : 9, paddingRight: 9, borderRadius: 6, backgroundColor: bg, alignSelf: 'flex-start' }, style]}>
    {icon && <Ic n={icon} size={13} color={fg} />}<X s={12} w={6} f={mono ? 'm' : 'b'} c={fg} lh={1.45} numberOfLines={1}>{label}</X></View>;
}
export const ST: Record<string, [Tone, IconName]> = {
  Approved: ['live', 'check'], Submitted: ['info', 'clock'], 'Pending sync': ['warn', 'sync'], 'Serial exception': ['bad', 'alert'], Conflict: ['bad', 'alert'],
  'Under Review': ['vio', 'eye'], Rejected: ['bad', 'x'], Draft: ['mute', 'pen'], Corrected: ['info', 'pen'], Cancelled: ['mute', 'x'],
  Active: ['live', 'shield'], Expiring: ['warn', 'clock'], Expired: ['mute', 'clock'], 'Pending Approval': ['warn', 'clock'], Suspended: ['bad', 'lock'],
  'In transit': ['vio', 'truck'], Received: ['live', 'box'], Closed: ['live', 'check'], Refused: ['bad', 'x'], 'Not returned': ['bad', 'alert'],
};
export const StatusChip = ({ status, label }: { status: string; label?: string }) => {
  const [tone, icon] = ST[status] || ['mute', 'doc'];
  return <Chip tone={tone} icon={icon} label={label || (status === 'Conflict' ? 'Serial exception' : status)} />;
};

/* ---------- buttons ---------- */
export type BtnKind = 'dark' | 'primary' | 'blue' | 'ghost' | 'danger';
export function Btn({ label, icon, iconAfter, kind = 'dark', sm, onPress, disabled, style, big, color, borderColor }: { label: string; icon?: IconName; iconAfter?: IconName; kind?: BtnKind; sm?: boolean; onPress?: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; big?: boolean; color?: string; borderColor?: string }) {
  const bg = { dark: T.deep, primary: T.volt, blue: T.steel, ghost: T.white, danger: T.terminal }[kind];
  const fg = color || { dark: T.white, primary: T.white, blue: T.white, ghost: T.ink, danger: T.white }[kind];
  const pv = sm ? 10 : big ? 18 : 15;
  const inset = kind === 'primary' || kind === 'blue';
  const size = sm ? 14 : big ? 17 : 16;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed, hovered }: PState) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingTop: pv, paddingBottom: inset ? pv - 3 : pv, paddingHorizontal: sm ? 14 : 16, borderRadius: 10, backgroundColor: bg },
      sm && !WEB && { minHeight: 44 }, WEB && hovered && !disabled && !pressed && { opacity: 0.9 },
      inset && { borderBottomWidth: 3, borderBottomColor: kind === 'primary' ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.2)' },
      kind === 'ghost' && { borderWidth: 1.5, borderColor: borderColor || T.zinc3 },
      sm && { alignSelf: 'flex-start' }, pressed && { opacity: 0.85 }, disabled && { opacity: 0.45 }, style]}>
    {icon && <Ic n={icon} size={20} color={fg} />}<X s={size} w={7} c={fg} lh={1.45}>{label}</X>{iconAfter && <Ic n={iconAfter} size={20} color={fg} />}
  </Pressable>;
}
export const BtnRow = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) =>
  <View style={[{ flexDirection: 'row', gap: 9, marginTop: 11 }, style]}>{React.Children.map(children, c => c && <View style={{ flex: 1 }}>{c}</View>)}</View>;
export function IconBtn({ n, onPress, dark, label }: { n: IconName; onPress?: () => void; dark?: boolean; label: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={3} style={(st: PState) => [{ width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: dark ? 'rgba(255,255,255,0.1)' : T.white, borderWidth: 1, borderColor: dark ? 'rgba(255,255,255,0.16)' : T.zinc2 }, fx(st, dark ? 'rgba(255,255,255,0.18)' : T.zinc)]}>
    <Ic n={n} size={20} color={dark ? T.white : T.ink} /></Pressable>;
}
export function CapBtn({ n, tone = 'dark', onPress, label }: { n: IconName; tone?: 'dark' | 'alt' | 'done'; onPress?: () => void; label: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={1} style={({ pressed }) => [{ width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === 'alt' ? T.steel : tone === 'done' ? T.live : T.deep }, pressed && { opacity: 0.85 }]}>
    <Ic n={n} size={21} color={T.white} /></Pressable>;
}

/* ---------- surfaces ---------- */
export function Card({ children, style, onPress, label }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string }) {
  const base: ViewStyle = { backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2, borderRadius: 10, padding: 14 };
  if (onPress) return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={(st: PState) => [base, style, fx(st, '#FAFBFD')]}>{children}</Pressable>;
  return <View style={[base, style]}>{children}</View>;
}
export const CardH = ({ title, right, mono, size = 15.5 }: { title: string; right?: React.ReactNode; mono?: boolean; size?: number }) =>
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
    <X s={size} w={mono ? 6 : 7} f={mono ? 'm' : 'c'} style={{ flexShrink: 1 }}>{title}</X>{right}</View>;
export const SecT = ({ title, first }: { title: string; first?: boolean }) =>
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: first ? 2 : 20, marginBottom: 9 }}>
    <X s={13} w={7} c={T.slate}>{title}</X><View style={{ flex: 1, height: 1, backgroundColor: T.zinc2 }} /></View>;
export const Gap = ({ h }: { h: number }) => <View style={{ height: h }} />;

export function Kpis({ items, cols = 2 }: { items: { v: string; l: string; tone?: 'flag' | 'bad'; onPress?: () => void }[]; cols?: number }) {
  const rows: typeof items[] = []; for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return <View style={{ gap: 9 }}>{rows.map((r, i) => <View key={i} style={{ flexDirection: 'row', gap: 9 }}>{r.map(k => {
    const flag = k.tone === 'flag', bad = k.tone === 'bad';
    const body = <><X s={29} w={7} f="c" lh={1} c={flag ? '#8A6008' : bad ? '#992A15' : T.ink}>{k.v}</X><X s={11.5} w={6} c={T.slate} lh={1.25} style={{ marginTop: 4 }}>{k.l}</X></>;
    const st: ViewStyle = { flex: 1, backgroundColor: flag ? T.voltSoft : bad ? T.terminalSoft : T.white, borderWidth: 1, borderColor: flag ? '#EBD49C' : bad ? '#F0C7BC' : T.zinc2, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 13 };
    return k.onPress ? <Pressable key={k.l} accessibilityRole="button" accessibilityLabel={`${k.v} ${k.l}`} onPress={k.onPress} style={(ps: PState) => [st, fx(ps)]}>{body}</Pressable> : <View key={k.l} style={st}>{body}</View>;
  })}{Array.from({ length: cols - r.length }, (_, j) => <View key={`pad${j}`} style={{ flex: 1 }} />)}</View>)}</View>;
}

export type AvTone = 'blue' | 'amber' | 'red' | 'green' | 'mute' | 'vio';
const AV: Record<AvTone, [string, string]> = { blue: [T.infoSoft, T.info], amber: [T.voltSoft, '#8A6008'], red: [T.terminalSoft, '#992A15'], green: [T.liveSoft, '#12603C'], mute: [T.zinc, T.slate], vio: [T.violetSoft, T.violet] };
export const Avatar = ({ n, tone = 'blue', size = 40 }: { n: IconName; tone?: AvTone; size?: number }) =>
  <View style={{ width: size, height: size, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: AV[tone][0] }}><Ic n={n} size={21} color={AV[tone][1]} /></View>;

/** .row — avatar, title, subtitle and a trailing element, divided by a hairline. */
export function Line({ av, title, sub, sub2, right, chev, onPress, last, titleMono, titleSize = 14.5, children, label }: { av?: React.ReactNode; title?: React.ReactNode; sub?: React.ReactNode; sub2?: React.ReactNode; right?: React.ReactNode; chev?: boolean; onPress?: () => void; last?: boolean; titleMono?: boolean; titleSize?: number; children?: React.ReactNode; label?: string }) {
  const body = <>{av}<View style={{ flex: 1, minWidth: 0 }}>
    {title != null && <X s={titleSize} w={6} f={titleMono ? 'm' : 'b'}>{title}</X>}
    {sub != null && <X s={12.5} c={T.slate} style={{ marginTop: 2 }}>{sub}</X>}
    {sub2 != null && <X s={12.5} c={T.slate} style={{ marginTop: 2 }}>{sub2}</X>}{children}</View>
    {right}{chev && <Ic n="chev" size={22} color={T.zinc3} />}</>;
  const st: ViewStyle = { flexDirection: 'row', gap: 11, alignItems: 'center', paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderBottomColor: T.zinc2 };
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={(ps: PState) => [st, fx(ps, '#FAFBFD')]}>{body}</Pressable> : <View style={st}>{body}</View>;
}

/* ---------- form ---------- */
export function Hint({ icon = 'alert', tone, children, center, style }: { icon?: IconName; tone?: 'err' | 'ok'; children: React.ReactNode; center?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = tone === 'err' ? '#992A15' : tone === 'ok' ? '#12603C' : T.slate;
  return <View style={[{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 5, justifyContent: center ? 'center' : 'flex-start' }, style]}>
    <Ic n={icon} size={14} color={c} style={{ marginTop: 2 }} /><X s={12.5} c={c} w={tone ? 6 : 4} style={center ? { flexShrink: 1 } : { flex: 1 }}>{children}</X></View>;
}
export function Label({ text, req, mr }: { text: string; req?: boolean; mr?: string }) {
  return <X s={13} w={6} c={T.ink3} style={{ marginBottom: 5 }}>{text}{req && <Text style={{ color: T.terminal }}> *</Text>}{mr && <Text style={{ color: T.slate, fontFamily: family('b', 5) }}> · {mr}</Text>}</X>;
}
type FieldProps = { select?: boolean; label?: string; req?: boolean; mr?: string; value: string; onChange?: (v: string) => void; ph?: string; mono?: boolean; pre?: React.ReactNode; tail?: React.ReactNode; hint?: React.ReactNode; hintTone?: 'err' | 'ok'; hintIcon?: IconName; readonly?: boolean; error?: string; numeric?: boolean; phone?: boolean; maxLength?: number; secure?: boolean; multiline?: boolean; onPress?: () => void; style?: StyleProp<ViewStyle>; autoFocus?: boolean; caps?: boolean };
export function Field(p: FieldProps) {
  const filled = !!p.value;
  const [focus, setFocus] = useState(false);
  const box: StyleProp<ViewStyle> = [{ backgroundColor: T.white, borderWidth: 1.5, borderColor: T.line, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 13, minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 9 },
    filled && { borderColor: T.ink3 }, p.readonly && { backgroundColor: T.zinc, borderStyle: 'dashed', borderColor: T.zinc3 }, !!p.error && { borderColor: T.terminal, backgroundColor: '#FFF8F6' },
    focus && { borderColor: T.steel, backgroundColor: T.white }];
  const textStyle: TextStyle = { fontFamily: family(p.mono ? 'm' : 'b', p.mono ? 6 : 5), fontSize: 16, color: T.ink };
  const hint = p.error ? <Hint tone="err" icon="alert">{p.error}</Hint> : p.hint ? <Hint tone={p.hintTone} icon={p.hintIcon}>{p.hint}</Hint> : null;
  // A dropdown shows the up-down glyph; dimmed while it cannot be opened yet (e.g. Model before Plates).
  const tail = p.tail ?? (p.select ? <Ic n="updown" size={20} color={p.onPress ? T.slate : T.zinc3} /> : null);
  const tailWrap = tail ? <View style={{ marginLeft: 'auto', flexDirection: 'row', gap: 8, alignItems: 'center' }}>{tail}</View> : null;
  const inner = p.onPress || p.readonly || !p.onChange
    ? <X s={16} w={filled ? (p.mono ? 6 : 5) : 4} f={filled && p.mono ? 'm' : 'b'} c={filled ? T.ink : T.slate} style={{ flex: 1 }}>{p.value || p.ph}</X>
    : <TextInput accessibilityLabel={p.label || p.ph} value={p.value} onChangeText={p.onChange} placeholder={p.ph} placeholderTextColor={T.slate} autoFocus={p.autoFocus}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        keyboardType={p.phone ? 'phone-pad' : p.numeric ? 'number-pad' : 'default'} maxLength={p.maxLength} secureTextEntry={p.secure} autoCapitalize={p.caps ? 'characters' : p.secure || p.numeric ? 'none' : 'sentences'} autoCorrect={false} multiline={p.multiline}
        style={[textStyle, { flex: 1, padding: 0, margin: 0, minHeight: 23 }, p.multiline && { minHeight: 46, textAlignVertical: 'top' }, noOutline]} />;
  return <View style={[{ marginBottom: 13 }, p.style]}>
    {p.label && <Label text={p.label} req={p.req} mr={p.mr} />}
    {p.onPress ? <Pressable accessibilityRole="button" accessibilityLabel={p.label ? `${p.label}: ${p.value || p.ph || ''}` : undefined} accessibilityHint={p.select ? 'Opens a list of choices' : undefined} onPress={p.onPress} style={(st: PState) => [box, fx(st, T.zinc)]}>{p.pre}{inner}{tailWrap}</Pressable> : <View style={box}>{p.pre}{inner}{tailWrap}</View>}
    {hint}
  </View>;
}
export function OtpBoxes({ value, onChange, count = 6, autoFocus }: { value: string; onChange: (v: string) => void; count?: number; autoFocus?: boolean }) {
  const ref = useRef<TextInput>(null); const [focus, setFocus] = useState(false);
  const at = Math.min(value.length, count - 1);
  return <Pressable accessibilityLabel={`Enter the ${count}-digit code`} onPress={() => ref.current?.focus()} style={{ flexDirection: 'row', gap: 7 }}>
    {Array.from({ length: count }, (_, i) => <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, minHeight: 50, backgroundColor: T.white, borderWidth: 1.5, borderColor: focus && i === at ? T.steel : value[i] ? T.ink3 : T.line, borderRadius: 9 }}>
      <X s={16} f={value[i] ? 'm' : 'b'} w={value[i] ? 5 : 4} c={value[i] ? T.ink : '#93A0AF'}>{value[i] || '·'}</X></View>)}
    <TextInput ref={ref} value={value} autoFocus={autoFocus} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} accessibilityLabel={`${count}-digit code`} onChangeText={t => onChange(t.replace(/\D/g, '').slice(0, count))} keyboardType="number-pad" maxLength={count} textContentType="oneTimeCode" autoComplete="sms-otp" caretHidden
      style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.011, color: 'transparent' }, noOutline]} />
  </Pressable>;
}
export function ChipRow({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: -5, marginBottom: 14 }}>{options.map(o => {
    const on = o === value;
    return <Pressable key={o} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o)} style={(st: PState) => [{ backgroundColor: on ? T.steel : T.white, borderWidth: 1.5, borderColor: on ? T.steel : T.line, borderRadius: 22, paddingVertical: 9, paddingHorizontal: 15, justifyContent: 'center' }, !WEB && { minHeight: 44 }, fx(st, on ? undefined : T.zinc)]}>
      <X s={13.5} w={6} c={on ? T.white : T.ink}>{o}</X></Pressable>;
  })}</View>;
}
export const CheckBox = ({ on }: { on: boolean }) =>
  <View style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: on ? T.live : T.line, backgroundColor: on ? T.live : T.white, alignItems: 'center', justifyContent: 'center' }}>{on && <Ic n="check" size={17} color={T.white} />}</View>;

/* ---------- feedback ---------- */
const BANNER = { warn: [T.voltSoft, '#7A5406', '#EBD49C'], bad: [T.terminalSoft, '#8C2612', '#F0C7BC'], ok: [T.liveSoft, '#0F5537', '#B8DFCB'], info: [T.infoSoft, '#1E3F7E', '#C3D8F6'] } as const;
export function Banner({ tone, icon, children, style }: { tone: keyof typeof BANNER; icon: IconName; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const [bg, fg, bd] = BANNER[tone];
  return <View style={[{ borderRadius: 10, paddingVertical: 12, paddingHorizontal: 13, flexDirection: 'row', gap: 10, backgroundColor: bg, borderWidth: 1, borderColor: bd }, style]}>
    <Ic n={icon} size={19} color={fg} style={{ marginTop: 1 }} /><X s={13.5} lh={1.4} c={fg} style={{ flex: 1 }}>{children}</X></View>;
}
export function Steps({ labels, now }: { labels: string[]; now: number }) {
  return <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 11, paddingHorizontal: 15, backgroundColor: T.white, borderBottomWidth: 1, borderBottomColor: T.zinc2 }}>
    {labels.map((l, i) => { const done = i < now - 1, cur = i === now - 1;
      return <View key={l} style={{ flex: 1, gap: 5 }} accessible accessibilityLabel={`${l}, ${done ? 'done' : cur ? 'current step' : 'to do'}`}>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: done ? T.live : cur ? T.volt : T.zinc2 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>{done && <Ic n="check" size={12} color={T.live} sw={2.4} />}<X s={11.5} w={6} c={cur ? T.ink : T.slate} style={{ flexShrink: 1 }}>{l}</X></View></View>; })}
  </View>;
}
export function KV({ pairs, cols = 2 }: { pairs: [string, React.ReactNode, ('mono' | '')?][]; cols?: number }) {
  const rows: typeof pairs[] = []; for (let i = 0; i < pairs.length; i += cols) rows.push(pairs.slice(i, i + cols));
  return <View style={{ gap: 11 }}>{rows.map((r, i) => <View key={i} style={{ flexDirection: 'row', gap: 14 }}>{r.map(([k, v, m]) => <View key={k} style={{ flex: 1, minWidth: 0 }}>
    <X s={11.5} w={6} c={T.slate}>{k}</X><X s={14.5} w={6} f={m === 'mono' ? 'm' : 'b'} style={{ marginTop: 1 }}>{v}</X></View>)}{Array.from({ length: cols - r.length }, (_, j) => <View key={`pad${j}`} style={{ flex: 1 }} />)}</View>)}</View>;
}
export const Plate = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[{ backgroundColor: T.deep, borderRadius: 9, paddingVertical: 13, paddingHorizontal: 14 }, style]}>{children}</View>;
export const PlateLab = ({ children, center }: { children: React.ReactNode; center?: boolean }) => <X s={11} w={6} c={T.deepText} style={{ marginBottom: 3, textAlign: center ? 'center' : 'left' }}>{children}</X>;
export const PlateVal = ({ children, size = 20, color = '#EDF0F4', center }: { children: React.ReactNode; size?: number; color?: string; center?: boolean }) => <X s={size} w={6} f="m" c={color} style={{ textAlign: center ? 'center' : 'left' }}>{children}</X>;
export function Meter({ used, labels }: { used: number; labels: [string, string, string] }) {
  const u = Math.max(0, Math.min(1, used));
  return <View><View style={{ height: 14, borderRadius: 7, backgroundColor: T.zinc2, overflow: 'hidden', flexDirection: 'row' }}>
    <View style={{ width: `${u * 100}%`, backgroundColor: T.slate }} /><View style={{ width: `${(1 - u) * 100}%`, backgroundColor: T.live }} /></View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>{labels.map((l, i) => <X key={i} s={11.5} w={6} c={T.slate}>{l}</X>)}</View></View>;
}
export const BigOk = ({ n = 'check', bg = T.live }: { n?: IconName; bg?: string }) =>
  <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 26, marginBottom: 16 }}><Ic n={n} size={46} color={T.white} /></View>;
export function BigTile({ icon, title, sub, desc, hot, onPress }: { icon: IconName; title: string; sub: string; desc: string; hot?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${desc}`} onPress={onPress} style={({ pressed, hovered }: PState) => [{ flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: hot ? T.steelSoft : T.white, borderWidth: 1.5, borderColor: hot ? T.volt : T.zinc2, borderRadius: 13, paddingVertical: 19, paddingHorizontal: 16, marginBottom: 12 }, pressed && { opacity: 0.85 }, WEB && hovered && !pressed && { borderColor: hot ? T.steel : T.zinc3 }]}>
    <View style={{ width: 58, height: 58, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: hot ? T.volt : T.steelSoft }}><Ic n={icon} size={29} color={hot ? T.white : T.steel} /></View>
    <View style={{ flex: 1, minWidth: 0 }}><X s={23} w={7} f="c" lh={1.08}>{title}</X><X s={15} w={6} c={T.steel} style={{ marginTop: 1 }}>{sub}</X><X s={13} lh={1.3} c={T.slate} style={{ marginTop: 5 }}>{desc}</X></View>
    <Ic n="chev" size={22} color={T.zinc3} /></Pressable>;
}

/** TEMPORARY until SMS is connected: the one-time code shown on screen, with a button that fills it in. */
export function TestCode({ code, onUse, style }: { code: string; onUse: () => void; style?: StyleProp<ViewStyle> }) {
  return <View accessible accessibilityLabel={`Your code is ${code.split('').join(' ')}`} style={[{ backgroundColor: T.steelSoft, borderWidth: 1.5, borderColor: T.steel, borderStyle: 'dashed', borderRadius: 12, padding: 14, alignItems: 'center', gap: 6 }, style]}>
    <X s={12} w={6} c={T.steel}>Your code · SMS not connected yet</X>
    <X s={32} w={6} f="m" style={{ letterSpacing: 6 }} selectable>{code}</X>
    <Btn kind="blue" sm icon="check" label="Use this code" onPress={onUse} style={{ alignSelf: 'stretch' }} />
  </View>;
}
