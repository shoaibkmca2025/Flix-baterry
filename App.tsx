import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider, useStore } from './src/store';
import { DealerApp } from './src/dealer/DealerApp';
import { AdminApp } from './src/admin/AdminApp';
import { Session, adminRoleLabel, clearSession, loadSession } from './src/api/session';
import { setUnauthorizedHandler } from './src/api/client';
import { syncStore, useAutoSync } from './src/api/sync';

type Surface = 'dealer' | 'admin';
// Client decision (2026-09-21): the head-office console is a desktop/web product, the dealer
// app a phone product. Each build serves exactly one, and a session for the other is not usable.
const SURFACE: Surface = Platform.OS === 'web' ? 'admin' : 'dealer';
type Auth = { status: 'loading' } | { status: 'signedOut'; surface: Surface } | { status: 'signedIn'; session: Session };

/** The sign-in gate: nothing but a sign-in screen is shown until a real, unexpired login exists. */
function Root() {
  const { ready, setRole, setDealerId, setState } = useStore();
  const [auth, setAuth] = useState<Auth>({ status: 'loading' });

  const begin = useCallback((session: Session) => {
    if (session.user.scope !== SURFACE) { clearSession(); setAuth({ status: 'signedOut', surface: SURFACE }); return; }
    if (session.user.scope === 'admin') {
      setRole(adminRoleLabel(session.user.role));
    } else {
      setRole('Dealer');
      const dealer = session.dealer;
      if (dealer) {
        setState(s => ({ ...s, dealers: [dealer, ...s.dealers.filter(x => x.id !== dealer.id)] }));
        setDealerId(dealer.id);
      }
    }
    setAuth({ status: 'signedIn', session });
    // Pull the real records in behind the sign-in (src/api/sync.ts). Screens read the store,
    // so this is what replaces the demo data with the backend's. Failure is not fatal here —
    // the app shows what it has and every screen's refresh retries.
    syncStore(setState).catch(() => {});
  }, [setRole, setDealerId, setState]);

  const signOut = useCallback((surface: Surface) => {
    clearSession();
    setRole('Dealer');
    setAuth({ status: 'signedOut', surface });
  }, [setRole]);

  // Wait for the local store to load first, so restoring the session isn't overwritten by it.
  useEffect(() => {
    if (!ready) return;
    loadSession().then(session => (session ? begin(session) : setAuth({ status: 'signedOut', surface: SURFACE })));
  }, [ready, begin]);

  // A rejected token on any API call ends the session.
  useEffect(() => {
    setUnauthorizedHandler(() => setAuth(a => {
      if (a.status !== 'signedIn') return a;
      clearSession();
      return { status: 'signedOut', surface: SURFACE };
    }));
    return () => setUnauthorizedHandler(null);
  }, []);

  // one more sync each time the app comes back to the foreground while signed in
  useAutoSync(auth.status === 'signedIn');

  if (!ready || auth.status === 'loading') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#141A23' }}><ActivityIndicator color="#E8A72C" /></View>;
  }

  if (auth.status === 'signedIn') {
    const { session } = auth;
    return SURFACE === 'admin'
      ? <AdminApp key="admin-in" session={session} onSignedIn={begin} onSignOut={() => signOut('admin')} />
      : <DealerApp key="dealer-in" signedIn onSignedIn={begin} onSignOut={() => signOut('dealer')} />;
  }

  return SURFACE === 'admin'
    ? <AdminApp key="admin-out" session={null} onSignedIn={begin} onSignOut={() => signOut('admin')} />
    : <DealerApp key="dealer-out" signedIn={false} onSignedIn={begin} onSignOut={() => signOut('dealer')} />;
}

export default function App() { return <SafeAreaProvider><Provider><Root /></Provider></SafeAreaProvider>; }
