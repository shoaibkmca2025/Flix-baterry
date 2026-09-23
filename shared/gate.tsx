import { useCallback, useEffect, useState } from 'react';
import { useStore } from './store';
import { setUnauthorizedHandler } from './api/client';
import { Session, adminRoleLabel, clearSession, loadSession } from './api/session';
import { syncStore, useAutoSync } from './api/sync';

export type Auth = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; session: Session };

/**
 * The sign-in gate both products share: nothing but a sign-in screen until a real, unexpired
 * login exists. Each build serves one scope only (client decision 2026-09-21 — the console is
 * a desktop product, the dealer app a phone product), so a session for the other scope is
 * discarded rather than shown.
 */
export function useAuthGate(scope: 'dealer' | 'admin') {
  const { ready, setRole, setDealerId, setState } = useStore();
  const [auth, setAuth] = useState<Auth>({ status: 'loading' });

  const begin = useCallback((session: Session) => {
    if (session.user.scope !== scope) { clearSession(); setAuth({ status: 'signedOut' }); return; }
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
    // Pull the real records in behind the sign-in (api/sync.ts). Screens read the store, so this
    // is what replaces the demo data with the backend's. Failure is not fatal — every screen's
    // refresh retries.
    syncStore(setState).catch(() => {});
  }, [scope, setRole, setDealerId, setState]);

  const signOut = useCallback(() => {
    clearSession();
    setRole('Dealer');
    setAuth({ status: 'signedOut' });
  }, [setRole]);

  // Wait for the local store to load first, so restoring the session isn't overwritten by it.
  useEffect(() => {
    if (!ready) return;
    loadSession().then(session => (session ? begin(session) : setAuth({ status: 'signedOut' })));
  }, [ready, begin]);

  // A rejected token on any API call ends the session.
  useEffect(() => {
    setUnauthorizedHandler(() => setAuth(a => {
      if (a.status !== 'signedIn') return a;
      clearSession();
      return { status: 'signedOut' };
    }));
    return () => setUnauthorizedHandler(null);
  }, []);

  // one more sync each time the app comes back to the foreground while signed in
  useAutoSync(auth.status === 'signedIn');

  return { ready, auth, begin, signOut };
}
