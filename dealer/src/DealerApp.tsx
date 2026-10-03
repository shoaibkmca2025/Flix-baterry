import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, Platform, BackHandler, KeyboardAvoidingView, StatusBar, useWindowDimensions, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useStore } from '@felix/shared/store';
import { T, useDealerFonts } from '@felix/shared/ui/theme';
import { X, Ic } from '@felix/shared/ui/kit';
import { DCtx, DealerCtx, Flow, Route } from './shell';
import type { Session } from '@felix/shared/api/session';
import { useSync } from '@felix/shared/api/sync';
import { D01, D02, D03, D04, D05, D06 } from './Access';
import { D07, D09 } from './Home';
import { D10, D11, D12, D13, D15, D16, D17, D31 } from './Capture';
import { D32, D33, D34, D35, D36, D37 } from './Claims';
import { D18, D19, D23, D24 } from './Records';
import { D40, D41, D42, D43, D44 } from './Network';

const SCREENS: Record<string, React.ComponentType<{ p?: string }>> = { d40: D40, d41: D41, d42: D42, d43: D43, d44: D44, d01: D01, d02: D02, d03: D03, d04: D04, d05: D05, d06: D06, d07: D07, d09: D09, d10: D10, d11: D11, d12: D12, d13: D13, d15: D15, d16: D16, d17: D17, d31: D31, d32: D32, d33: D33, d34: D34, d35: D35, d36: D36, d37: D37, d18: D18, d19: D19, d23: D23, d24: D24 };
const SIGNED_OUT = ['d01', 'd02', 'd03', 'd04', 'd05'];
const TAB_ROOTS = ['d07', 'd33', 'd18', 'd23', 'd09'];

/** Dealer mobile app — the client-approved dealer UI. Head office keeps its own workspace. */
export function DealerApp({ signedIn, onSignedIn, onSignOut }: { signedIn: boolean; onSignedIn: (session: Session) => void; onSignOut: () => void }) {
  const [fontsLoaded, fontError] = useDealerFonts();
  const { state, dealerId } = useStore();
  const { width } = useWindowDimensions();
  // Full screen on every device, including a desktop browser (the PWA): no mock phone frame.
  const framed = false;
  const [route, setRoute] = useState<Route>(signedIn ? { id: 'd07' } : { id: 'd01' });
  // Head office decisions land on the server; pull them in on home / My requests so statuses stay current.
  const { sync } = useSync();
  useEffect(() => { if (signedIn && ['d07', 'd18', 'd33', 'd35'].includes(route.id)) sync(true, 15_000); }, [route.id, signedIn, sync]);
  const [history, setHistory] = useState<Route[]>([]);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((m: string) => { setToastMsg(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToastMsg(''), 10_000); }, []); // 10s (client, 2 Oct 2026)
  const go = (id: string, p?: string) => { setHistory(h => [...h, route]); setRoute({ id, p }); setToastMsg(''); };
  /**
   * Back goes to the screen you came from — one step, every time.
   *
   * It used to jump to a screen named on each header (`back="d11"`), hunting for it in the history
   * and truncating everything after it. Reaching the new battery from the list of batteries on a
   * request then sent you back past the list to the old battery, and anything in between was
   * dropped (client, 3 Oct 2026). `to` is now only the fallback for when there is nothing to go
   * back to — opening a request straight from a notification, say. Same behaviour as the Android
   * hardware back below, so the two can no longer disagree.
   */
  const back = (to: string, p?: string) => {
    if (history.length) { setRoute(history[history.length - 1]); setHistory(history.slice(0, -1)); }
    else setRoute({ id: to, p });
    setToastMsg('');
  };
  const tab = (id: string) => { setHistory([]); setRoute({ id }); setToastMsg(''); };
  // The root owns the session: signing in or out remounts this app on the right side of the gate.
  const signIn = (session: Session) => onSignedIn(session);
  const signOut = () => onSignOut();
  const addRecent = useCallback((code: string) => setRecent(r => [code, ...r.filter(c => c !== code)].slice(0, 5)), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (history.length) { setRoute(history[history.length - 1]); setHistory(history.slice(0, -1)); return true; }
      if (TAB_ROOTS.includes(route.id) && route.id !== 'd07') { setRoute({ id: 'd07' }); return true; }
      return false;
    });
    return () => sub.remove();
  }, [route, history]);

  // No login, no dashboard: without a signed-in session only the access screens can render.
  const dealer = state.dealers.find(x => x.id === dealerId);
  const guarded: Route = !SIGNED_OUT.includes(route.id) && (!signedIn || dealer?.status !== 'Active') ? { id: 'd02' } : route;

  const ctx: DealerCtx = { route: guarded, framed, go, back, tab, toast, flow, setFlow, signIn, signOut, recent, addRecent };
  const ready = fontsLoaded || fontError;
  const Current = SCREENS[guarded.id] || D02;
  const phone = <View style={{ flex: 1, backgroundColor: T.zinc, overflow: 'hidden', borderRadius: framed ? 28 : 0 }}>
    {ready && Current ? <Current key={`${guarded!.id}:${guarded!.p || ''}`} p={guarded!.p} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.deep }}><ActivityIndicator color={T.white} /></View>}
    {/* 10s and dismissible, but it must not swallow taps: it sits over the fixed footer on
        Send back and Done, so making the whole card pressable stopped "Dispatch" working for ten
        seconds after any message (client, 3 Oct 2026). `box-none` lets every touch through except
        the close control, and it now rides above a footer as well as the tab bar. */}
    {!!toastMsg && <View pointerEvents="box-none" style={{ position: 'absolute', left: 15, right: 15, bottom: 150, zIndex: 50 }}>
      <View accessibilityRole="alert" pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.ink, paddingVertical: 13, paddingLeft: 15, paddingRight: 6, borderRadius: 11, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 12 }}>
        <View pointerEvents="none" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ic n="check" size={19} color="#5BD65B" /><X s={13.5} c={T.white} style={{ flex: 1 }}>{toastMsg}</X></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss this message" hitSlop={10} onPress={() => setToastMsg('')}
          style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}><Ic n="x" size={16} color="#8B97A6" /></Pressable>
      </View>
    </View>}
  </View>;

  return <DCtx.Provider value={ctx}>
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: guarded?.id === 'd07' || guarded?.id === 'd01' ? T.deep : T.zinc }}>
      <StatusBar barStyle={guarded?.id === 'd07' || guarded?.id === 'd01' ? 'light-content' : 'dark-content'} backgroundColor={guarded?.id === 'd07' || guarded?.id === 'd01' ? T.deep : T.zinc} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{phone}</KeyboardAvoidingView>
    </SafeAreaView>
  </DCtx.Provider>;
}

