import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useStore } from '../store';
import type { State } from '../domain';
import { fetchHydrated, type Hydrated } from './mapping';
import { getAccessToken, loadSession, useAccessToken } from './session';

// The hooks half of the bridge — the mapping itself is in mapping.ts (pure, testable in Node).
export { entryStatusOf, fetchHydrated, returnStageOf, toBattery, toDealer, toEntry, type Hydrated } from './mapping';

let inflight: Promise<Hydrated | null> | null = null;

/** Pull the backend into the store. Safe to call often — concurrent calls share one request. */
export async function syncStore(setState: (fn: (s: State) => State) => void): Promise<Hydrated | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    const [session, token] = await Promise.all([loadSession(), getAccessToken()]);
    if (!session || !token) return null;
    const data = await fetchHydrated(session, token);
    setState((s) => ({ ...s, ...data }));
    return data;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** `sync()` for screens: re-hydrate after a write, report failures as a toast, never throw. */
export function useSync() {
  const { setState, notify } = useStore();
  const [syncing, setSyncing] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const sync = useCallback(async (quiet = false) => {
    setSyncing(true);
    try {
      const r = await syncStore(setState);
      return r !== null;
    } catch {
      if (!quiet) notify('Could not refresh from the server. Showing the last data received.');
      return false;
    } finally {
      if (alive.current) setSyncing(false);
    }
  }, [setState, notify]);
  return { sync, syncing };
}

/** Keeps a signed-in app current: one sync at mount and one every time it returns to the foreground. */
export function useAutoSync(enabled: boolean) {
  const { sync } = useSync();
  useEffect(() => {
    if (!enabled) return;
    sync(true);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') sync(true); });
    return () => sub.remove();
  }, [enabled, sync]);
}

/**
 * Whether this session is a real sign-in (the store is the server's data). Screens use it to
 * refuse local-only edits that the server does not support yet — otherwise the next sync would
 * silently undo them.
 */
export function useLive(): boolean {
  return useAccessToken() !== null;
}
