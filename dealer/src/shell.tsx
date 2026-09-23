import React, { createContext, useContext, useEffect, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Entry } from '@felix/shared/domain';
import type { Session } from '@felix/shared/api/session';
import { useStore } from '@felix/shared/store';
import { T } from '@felix/shared/ui/theme';
import { X, Ic, IconBtn, IconName } from '@felix/shared/ui/kit';

export type Route = { id: string; p?: string };
export type Flow = { entry: Entry; cur: number; scanned: Record<string, boolean> };
export type DealerCtx = {
  route: Route; framed: boolean;
  go: (id: string, p?: string) => void; back: (to: string, p?: string) => void; tab: (id: string) => void;
  toast: (m: string) => void;
  flow: Flow | null; setFlow: React.Dispatch<React.SetStateAction<Flow | null>>;
  signIn: (session: Session) => void; signOut: () => void;
  recent: string[]; addRecent: (code: string) => void;
};
export const DCtx = createContext<DealerCtx>(null!);
export const useD = () => useContext(DCtx);

const TR: Record<string, string> = { Home: 'होम', 'Send back': 'परत पाठवा', 'My requests': 'माझ्या नोंदी', Search: 'शोधा', Profile: 'प्रोफाइल', 'New replacement': 'नवीन बदली', Scan: 'स्कॅन', 'Find serial': 'सिरीयल शोधा' };
export function useTr() { const { state } = useStore(); return (s: string) => state.language === 'मराठी' ? (TR[s] || s) : s; }

/* ---------- chrome ---------- */
function MockStatus() {
  const { state, dealerId } = useStore();
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  const city = state.dealers.find(d => d.id === dealerId)?.city || 'Dhule';
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, paddingHorizontal: 20, paddingBottom: 6, backgroundColor: T.zinc }}>
    <X s={12.5} w={6}>{`${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`}</X>
    <X s={12.5} w={6}>{city} · {state.offline ? 'Offline' : '4G'}</X></View>;
}
export function AppBar({ title, back, backP, right, dark, left, titleSize = 19 }: { title?: string; back?: string; backP?: string; right?: React.ReactNode; dark?: boolean; left?: React.ReactNode; titleSize?: number }) {
  const d = useD();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 8, paddingHorizontal: 15, paddingBottom: 13, backgroundColor: dark ? T.ink : T.zinc, borderBottomWidth: 1, borderBottomColor: dark ? '#000' : T.zinc2 }}>
    {back && <IconBtn n="back" label="Back" dark={dark} onPress={() => d.back(back, backP)} />}
    {left}
    {title != null && <X s={titleSize} w={7} f="c" c={dark ? T.white : T.ink} numberOfLines={1} style={{ flex: 1 }}>{title}</X>}
    {right}
  </View>;
}
const TABS: [IconName, string, string][] = [['home', 'Home', 'd07'], ['truck', 'Send back', 'd33'], ['list', 'My requests', 'd18'], ['search', 'Search', 'd23'], ['user', 'Profile', 'd09']];
export type TabKey = 'home' | 'truck' | 'list' | 'search' | 'user';
function TabBar({ cur }: { cur: TabKey }) {
  const d = useD(), tr = useTr(), inset = useSafeAreaInsets();
  return <View style={{ flexDirection: 'row', backgroundColor: T.white, borderTopWidth: 1, borderTopColor: T.zinc2, paddingTop: 6, paddingHorizontal: 4, paddingBottom: 12 + (d.framed ? 0 : inset.bottom) }}>
    {TABS.map(([icon, label, id]) => {
      const on = cur === icon;
      return <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={() => d.tab(id)} style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 6, paddingHorizontal: 2, borderRadius: 9 }}>
        <Ic n={icon} size={23} color={on ? T.steel : T.slate} /><X s={11} w={6} c={on ? T.steel : T.slate} numberOfLines={1}>{tr(label)}</X></Pressable>;
    })}</View>;
}

/** One phone screen: status bar, app bar, scrolling body, optional sticky footer and tab bar. */
export function Screen({ top, children, tab, footer, overlay, bg, center, contentStyle }: { top?: React.ReactNode; children: React.ReactNode; tab?: TabKey; footer?: React.ReactNode; overlay?: React.ReactNode; bg?: string; center?: boolean; contentStyle?: StyleProp<ViewStyle> }) {
  const d = useD(), inset = useSafeAreaInsets();
  const bottomPad = !tab && !footer && !d.framed ? inset.bottom : 0;
  return <View style={{ flex: 1, backgroundColor: T.zinc }}>
    {d.framed && <MockStatus />}
    {top}
    <ScrollView style={{ flex: 1, backgroundColor: bg || T.zinc }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
      contentContainerStyle={[{ paddingTop: 14, paddingHorizontal: 15, paddingBottom: 24 + bottomPad }, center && { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 14 }, contentStyle]}>{children}</ScrollView>
    {footer && <View style={{ backgroundColor: T.white, borderTopWidth: 1, borderTopColor: T.zinc2, paddingVertical: 13, paddingHorizontal: 15, shadowColor: T.ink, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: -6 }, elevation: 8 }}>{footer}</View>}
    {tab && <TabBar cur={tab} />}
    {overlay}
  </View>;
}
/** Bottom sheet that stays inside the phone screen. */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const inset = useSafeAreaInsets(), d = useD();
  if (!open) return null;
  return <View style={[StyleSheet.absoluteFill, { zIndex: 60 }]}>
    <Pressable accessibilityLabel="Close" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,26,35,0.55)' }]} />
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%', backgroundColor: T.zinc, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: d.framed ? 0 : inset.bottom, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 13, paddingHorizontal: 15, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: T.zinc2 }}>
        <X s={19} w={7} f="c" style={{ flex: 1 }}>{title}</X><IconBtn n="x" label="Close" onPress={onClose} /></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 15, paddingBottom: 22 }}>{children}</ScrollView>
    </View>
  </View>;
}
