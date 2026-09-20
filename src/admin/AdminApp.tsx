import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, BackHandler, StatusBar, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store';
import { State } from '../domain';
import { useAccessToken, type Session } from '../api/session';
import { useServerSync } from '../api/sync';
import { T, useDealerFonts } from '../dealer/theme';
import { X, Ic, IconName, Btn, Line, Avatar, Chip } from '../dealer/kit';
import { ACtx, AdminCtx, ARoute, Dialog, Page, useA, useWide } from './ui';
import { Home } from './Home';
import { Approvals, Corrections, EntryDetail, Entries, NewEntry } from './Entries';
import { Dealers, DealerProfile, Registrations, Customers } from './Dealers';
import { Search, BatteryDetail, Warranty, Catalogue } from './Batteries';
import { Stock, Returns } from './Stock';
import { Reports } from './Reports';
import { AuditLog, Team, Notifications, Settings, SignIn } from './Governance';

type NavItem = [route: string, label: string, icon: IconName, badge?: (s: State) => number];
export const NAV: [string, NavItem[]][] = [
  ['Daily work', [
    ['home', 'Dashboard', 'chart'],
    ['approvals', 'Requests to approve', 'check', s => s.entries.filter(e => ['Submitted', 'Under Review', 'Conflict'].includes(e.status)).length],
    ['corrections', 'Correction requests', 'pen', s => s.entries.filter(e => e.correction?.status === 'Pending').length],
    ['registrations', 'New dealers', 'people', s => s.dealers.filter(d => d.status === 'Pending Approval').length],
    ['returns', 'Old battery returns', 'truck', s => s.entries.filter(e => e.returnState === 'In transit').length],
  ]],
  ['Records', [['entries', 'All entries', 'list'], ['new', 'Record an entry', 'plus'], ['dealers', 'Dealers', 'shop'], ['customers', 'Customers', 'user'], ['search', 'Battery search', 'search']]],
  ['Warranty & stock', [['warranty', 'Warranty', 'shield', s => s.overrides.filter(o => o.status === 'Pending').length], ['stock', 'Stock', 'box'], ['catalogue', 'Models & serial rules', 'batt']]],
  ['Reports', [['reports', 'Reports & exports', 'excel']]],
  ['Governance', [['audit', 'Audit log', 'lock'], ['team', 'Admin users & roles', 'people'], ['notifications', 'Notifications', 'bell'], ['settings', 'Settings & sync', 'gear']]],
];
const MR: Record<string, string> = { Dashboard: 'डॅशबोर्ड', 'Requests to approve': 'मंजुरी', 'Old battery returns': 'जुन्या बॅटरी', 'All entries': 'सर्व नोंदी', 'Record an entry': 'नवीन नोंद', Dealers: 'डीलर', Customers: 'ग्राहक', 'Battery search': 'बॅटरी शोध', Warranty: 'हमी', Stock: 'साठा', 'Reports & exports': 'अहवाल', Notifications: 'सूचना', 'Settings & sync': 'सेटिंग्ज' };
const ROOTS = ['home', 'approvals', 'returns', 'search', 'more'];

const SCREENS: Record<string, React.ComponentType<{ id?: string }>> = {
  home: Home, approvals: Approvals, corrections: Corrections, registrations: Registrations, returns: Returns,
  entries: Entries, entry: EntryDetail, new: NewEntry, dealers: Dealers, dealer: DealerProfile, customers: Customers,
  search: Search, battery: BatteryDetail, warranty: Warranty, stock: Stock, catalogue: Catalogue,
  reports: Reports, audit: AuditLog, team: Team, notifications: Notifications, settings: Settings, more: More,
};

/** Head office workspace — same design language as the dealer app, every admin function kept. */
export function AdminApp({ session, onSignedIn, onSignOut, onDealerSignIn }: { session: Session | null; onSignedIn: (session: Session) => void; onSignOut: () => void; onDealerSignIn: () => void }) {
  const [fontsLoaded, fontError] = useDealerFonts();
  const { role } = useStore();
  const wide = useWide();
  const [route, setRoute] = useState<ARoute>({ r: 'home' }), [history, setHistory] = useState<ARoute[]>([]);
  const [account, setAccount] = useState(false), [toastMsg, setToastMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((m: string) => { setToastMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setToastMsg(''), 3400); }, []);
  const go = (r: string, id?: string) => { if (ROOTS.includes(r) && !id) { setHistory([]); } else setHistory(h => [...h, route]); setRoute({ r, id }); };
  const back = () => { if (!history.length) { setRoute({ r: 'home' }); return; } setRoute(history[history.length - 1]); setHistory(history.slice(0, -1)); };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (history.length) { back(); return true; } if (route.r !== 'home') { setRoute({ r: 'home' }); return true; } return false; });
    return () => sub.remove();
  }, [route, history]);

  // Real register: entries + dealers come from the server, re-pulled whenever the queue or home is opened.
  const token = useAccessToken();
  const refresh = useServerSync(session ? token : null, 'admin');
  useEffect(() => { if (session && ['home', 'requests', 'returns'].includes(route.r)) refresh().catch(() => {}); }, [route.r, session, refresh]);

  const user = { name: session?.user.name || '', role };
  const ctx: AdminCtx = { token: session ? token : null, refresh, route, go, root: (r: string) => { setHistory([]); setRoute({ r }); }, back, canBack: history.length > 0, toast, wide, openMenu: () => go('more'), openSwitcher: () => setAccount(true), signOut: () => { setAccount(false); onSignOut(); }, user };
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.ink }}><ActivityIndicator color={T.volt} /></View>;
  // No login, no console: until a head-office session exists only the sign-in screen renders.
  if (!session) return <ACtx.Provider value={ctx}><SignIn onDone={onSignedIn} onDealer={onDealerSignIn} /></ACtx.Provider>;

  const allowed = route.r !== 'team' || role === 'Main Admin';
  const Screen = allowed ? SCREENS[route.r] || Home : NoAccess;
  const body = <View style={{ flex: 1, minWidth: 0 }}><Screen key={`${route.r}:${route.id || ''}:${role}`} id={route.id} /></View>;
  return <ACtx.Provider value={ctx}>
    <SafeAreaView edges={wide ? [] : ['top']} style={{ flex: 1, backgroundColor: wide ? T.ink : T.zinc }}>
      <StatusBar barStyle="dark-content" backgroundColor={T.zinc} />
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {wide && <Sidebar />}
        <View style={{ flex: 1, minWidth: 0 }}>{body}{!wide && <TabBar />}</View>
      </View>
      {!!toastMsg && <View pointerEvents="none" accessibilityRole="alert" style={{ position: 'absolute', left: wide ? 250 : 15, right: 15, bottom: wide ? 24 : 84, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.ink, paddingVertical: 13, paddingHorizontal: 15, borderRadius: 11, maxWidth: 560, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12 }}>
          <Ic n="check" size={19} color={T.volt} /><X s={13.5} c={T.white} style={{ flexShrink: 1 }}>{toastMsg}</X></View></View>}
      <Dialog open={account} title="Your account" onClose={() => setAccount(false)} width={460}>
        <View style={{ flexDirection: 'row', gap: 11, alignItems: 'center', backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2, borderRadius: 10, padding: 13, marginBottom: 14 }}>
          <Avatar n="user" tone="amber" />
          <View style={{ flex: 1 }}><X s={15} w={7}>{user.name}</X><X s={12.5} c={T.slate}>{role}</X></View>
          <Chip tone="live" icon="check" label="Signed in" /></View>
        <X s={13} c={T.slate} style={{ marginBottom: 14 }}>Your role comes from your account and is checked by the server on every action. To work as someone else, sign out and sign in with their account.</X>
        <Btn kind="ghost" icon="logout" label="Sign out" color={T.terminal} borderColor="#F0C7BC" onPress={ctx.signOut} />
      </Dialog>
    </SafeAreaView>
  </ACtx.Provider>;

}

function Sidebar() {
    const a = useA(); const { state, role } = useStore(); const route = a.route;
    const lang = state.language === 'मराठी';
    return <View style={{ width: 236, backgroundColor: T.ink, paddingTop: 14, paddingHorizontal: 10 }}>
      <View style={{ flexDirection: 'row', gap: 9, alignItems: 'center', paddingHorizontal: 8, paddingTop: 5, paddingBottom: 15 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: T.volt, alignItems: 'center', justifyContent: 'center' }}><X s={15} w={7} f="c" c="#2A1F02">FB</X></View>
        <View><X s={14.5} w={7} c={T.white} lh={1.1}>Felix Batteries</X><X s={11} c="#8C9BAE">Head office console</X></View></View>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {NAV.map(([group, items]) => <View key={group}>
          <X s={10.5} w={6} c="#6D7D91" style={{ marginTop: 13, marginBottom: 5, marginHorizontal: 9, letterSpacing: 1.4 }}>{group.toUpperCase()}</X>
          {items.filter(i => i[0] !== 'team' || role === 'Main Admin').map(([r, label, icon, badge]) => {
            const on = route.r === r || (r === 'entries' && route.r === 'entry') || (r === 'dealers' && route.r === 'dealer') || (r === 'search' && route.r === 'battery');
            const n = badge?.(state) || 0;
            return <Pressable key={r} accessibilityRole="button" accessibilityLabel={label} onPress={() => a.root(r)} style={({ hovered }: any) => ({ flexDirection: 'row', gap: 9, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 9, borderRadius: 7, backgroundColor: on ? T.steel : hovered ? 'rgba(255,255,255,0.07)' : 'transparent' })}>
              <Ic n={icon} size={17} color={on ? T.white : '#AEBCCC'} />
              <X s={13.5} w={on ? 6 : 5} c={on ? T.white : '#AEBCCC'} style={{ flex: 1 }} numberOfLines={1}>{lang && MR[label] ? MR[label] : label}</X>
              {n > 0 && <View style={{ backgroundColor: T.terminal, borderRadius: 20, paddingHorizontal: 6, paddingVertical: 1 }}><X s={10.5} w={7} c={T.white}>{n}</X></View>}
            </Pressable>;
          })}
        </View>)}
        <View style={{ height: 12 }} />
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Your account" onPress={a.openSwitcher} style={{ marginTop: 'auto', paddingVertical: 12, paddingHorizontal: 9, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', gap: 9, alignItems: 'center' }}>
        <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: T.volt, alignItems: 'center', justifyContent: 'center' }}><Ic n="user" size={18} color="#2A1F02" /></View>
        <View style={{ flex: 1 }}><X s={12} w={7} c={T.white} lh={1.3} numberOfLines={1}>{a.user.name}</X><X s={12} c="#AEBCCC" lh={1.3}>{role} · {state.offline ? 'offline' : 'online'}</X></View>
        <Ic n="logout" size={16} color="#AEBCCC" />
      </Pressable>
    </View>;
  }
function TabBar() {
    const a = useA(); const { state } = useStore(); const route = a.route;
    const inset = useSafeAreaInsets();
    const pending = NAV[0][1][1][3]!(state);
    const tabs: [string, string, IconName][] = [['home', 'Home', 'home'], ['approvals', 'Requests', 'clock'], ['returns', 'Returns', 'truck'], ['search', 'Search', 'search'], ['more', 'More', 'menu']];
    return <View style={{ flexDirection: 'row', backgroundColor: T.white, borderTopWidth: 1, borderTopColor: T.zinc2, paddingTop: 6, paddingHorizontal: 4, paddingBottom: 12 + inset.bottom }}>
      {tabs.map(([r, label, icon]) => { const on = route.r === r; return <Pressable key={r} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => a.root(r)} style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 6 }}>
        <View><Ic n={icon} size={23} color={on ? T.steel : T.slate} />{r === 'approvals' && pending > 0 && <View style={{ position: 'absolute', top: -4, right: -10, backgroundColor: T.terminal, borderRadius: 10, paddingHorizontal: 5 }}><X s={10} w={7} c={T.white}>{pending}</X></View>}</View>
        <X s={11} w={6} c={on ? T.steel : T.slate}>{label}</X></Pressable>; })}
    </View>;
  }

/* phone "More" menu — every section in one list */
function More() {
  const { state, role } = useStore(); const a = useA();
  return <Page title="Everything">
    <Pressable accessibilityRole="button" onPress={a.openSwitcher} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2, borderRadius: 10, padding: 14 }}>
      <Avatar n="user" tone="amber" /><View style={{ flex: 1 }}><X s={17} w={7}>{a.user.name}</X><X s={12.5} c={T.slate}>{role} · account & sign out</X></View><Ic n="logout" color={T.slate} /></Pressable>
    {NAV.map(([group, items]) => <View key={group}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 9 }}><X s={13} w={7} c={T.slate}>{group}</X><View style={{ flex: 1, height: 1, backgroundColor: T.zinc2 }} /></View>
      <View style={{ backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2, borderRadius: 10, paddingHorizontal: 14 }}>
        {items.filter(i => i[0] !== 'team' || role === 'Main Admin').map(([r, label, icon, badge], i, arr) => { const n = badge?.(state) || 0;
          return <Line key={r} last={i === arr.length - 1} onPress={() => a.go(r)} av={<Avatar n={icon} tone="mute" />} title={label} right={n ? <Chip tone="bad" label={String(n)} /> : undefined} chev={!n} />; })}
      </View></View>)}
  </Page>;
}
function NoAccess() {
  return <Page title="Admin users & roles"><View style={{ alignItems: 'center', paddingVertical: 40, gap: 8 }}><Avatar n="lock" tone="red" size={52} /><X s={17} w={7} f="c">Main Admin only</X><X s={13.5} c={T.slate} style={{ textAlign: 'center', maxWidth: 360 }}>Managing admin accounts is limited to the Main Admin. The attempt is not recorded as a change.</X></View></Page>;
}
