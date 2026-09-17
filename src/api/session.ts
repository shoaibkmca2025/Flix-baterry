import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import type { Dealer } from '../domain';

const ACCESS_KEY = 'felix-access-token';
const REFRESH_KEY = 'felix-refresh-token';
const SESSION_KEY = 'felix-session';

export type SessionUser = { id: string; name: string; scope: 'dealer' | 'admin'; role: string };
/** Who is signed in. `dealer` is the dealer mapped into the local store's shape (bridge until screens read the API). */
export type Session = { user: SessionUser; dealer?: Dealer };

// Minimal bridge until a real session layer (refresh rotation, SecureStore) lands —
// architecture.md §20 notes tokens belong in expo-secure-store on native eventually.
export async function saveSession(tokens: { accessToken: string; refreshToken: string }, session: Session) {
  await AsyncStorage.multiSet([
    [ACCESS_KEY, tokens.accessToken],
    [REFRESH_KEY, tokens.refreshToken],
    [SESSION_KEY, JSON.stringify(session)],
  ]).catch(() => {});
}

/** The signed-in session, or null. A session only counts while its access token exists and has not expired. */
export async function loadSession(): Promise<Session | null> {
  const pairs = await AsyncStorage.multiGet([ACCESS_KEY, SESSION_KEY]).catch(() => null);
  const access = pairs?.[0]?.[1];
  const raw = pairs?.[1]?.[1];
  if (!access || !raw) return null;
  const exp = tokenExpiresAt(access);
  if (!exp || exp <= Date.now()) {
    await clearSession();
    return null;
  }
  try {
    const session = JSON.parse(raw) as Session;
    return session?.user?.scope ? session : null;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY, SESSION_KEY]).catch(() => {});
}

export async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(ACCESS_KEY).catch(() => null);
}

/** Reads the JWT `exp` claim (ms). The signature is checked by the server; this only decides whether to ask for sign-in. */
export function tokenExpiresAt(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(globalThis.atob(base64));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function useAccessToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => { getAccessToken().then(setToken); }, []);
  return token;
}

// backend enums are snake_case (architecture.md §8.3); the app's local demo store uses
// Title Case labels (memory.md §7). Bridges a real API dealer into the existing shape
// until the rest of the app reads from the API directly instead of this local store.
export function dealerStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending_approval: 'Pending Approval',
    active: 'Active',
    rejected: 'Rejected',
    suspended: 'Suspended',
  };
  return map[status] ?? status;
}

/** Backend admin role → the console's role labels. Unknown head-office roles get Co-Admin rights, never Main Admin. */
export function adminRoleLabel(role: string): 'Main Admin' | 'Co-Admin' | 'Read-only' {
  if (role === 'main_admin') return 'Main Admin';
  if (role === 'read_only') return 'Read-only';
  return 'Co-Admin';
}
