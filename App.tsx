import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider, useStore } from './src/store';
import { DealerApp } from './src/dealer/DealerApp';
import { AdminApp } from './src/admin/AdminApp';
import { Session, adminRoleLabel, clearSession, loadSession } from './src/api/session';
import { setUnauthorizedHandler } from './src/api/client';

type Surface = 'dealer' | 'admin';
type Auth = { status: 'loading' } | { status: 'signedOut'; surface: Surface } | { status: 'signedIn'; session: Session };

/** The sign-in gate: nothing but a sign-in screen is shown until a real, unexpired login exists. */
function Root() {
  const { ready, setRole, setDealerId, setState } = useStore();
  const [auth, setAuth] = useState<Auth>({ status: 'loading' });

  const begin = useCallback((session: Session) => {
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
  }, [setRole, setDealerId, setState]);

  const signOut = useCallback((surface: Surface) => {
    clearSession();
    setRole('Dealer');
    setAuth({ status: 'signedOut', surface });
  }, [setRole]);

  // Wait for the local store to load first, so restoring the session isn't overwritten by it.
  useEffect(() => {
    if (!ready) return;
    loadSession().then(session => (session ? begin(session) : setAuth({ status: 'signedOut', surface: 'dealer' })));
  }, [ready, begin]);

  // A rejected token on any API call ends the session.
  useEffect(() => {
    setUnauthorizedHandler(() => setAuth(a => {
      if (a.status !== 'signedIn') return a;
      clearSession();
      return { status: 'signedOut', surface: a.session.user.scope };
    }));
    return () => setUnauthorizedHandler(null);
  }, []);

  if (!ready || auth.status === 'loading') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#141A23' }}><ActivityIndicator color="#E8A72C" /></View>;
  }

  if (auth.status === 'signedIn') {
    const { session } = auth;
    return session.user.scope === 'admin'
      ? <AdminApp key="admin-in" session={session} onSignedIn={begin} onSignOut={() => signOut('admin')} onDealerSignIn={() => signOut('dealer')} />
      : <DealerApp key="dealer-in" signedIn onSignedIn={begin} onSignOut={() => signOut('dealer')} onHeadOfficeSignIn={() => signOut('admin')} />;
  }

  return auth.surface === 'admin'
    ? <AdminApp key="admin-out" session={null} onSignedIn={begin} onSignOut={() => signOut('admin')} onDealerSignIn={() => setAuth({ status: 'signedOut', surface: 'dealer' })} />
    : <DealerApp key="dealer-out" signedIn={false} onSignedIn={begin} onSignOut={() => signOut('dealer')} onHeadOfficeSignIn={() => setAuth({ status: 'signedOut', surface: 'admin' })} />;
}

export default function App() { return <SafeAreaProvider><Provider><Root /></Provider></SafeAreaProvider>; }
