import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// The backend's default port is 8080 (backend/src/config/env.ts, backend/.env). One dev
// machine has Apache on 8080 and runs the backend on 4000 instead, so in development the app
// PROBES these ports on the dev host (first /health that answers wins) rather than assuming.
const DEV_PORTS = [8080, 4000];
const OVERRIDE_KEY = 'felix-api-base-url';

function devHost(): string {
  const hostUri = Constants.expoConfig?.hostUri || (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  return hostUri?.split('/')[0]?.split(':')[0] || 'localhost';
}

/**
 * On a phone, `localhost` is the phone itself, so the dev backend has to be reached at the
 * computer's LAN address. Expo already knows it — the dev server the app was loaded from —
 * so the host is reused here and only the port differs. Set EXPO_PUBLIC_API_BASE_URL to
 * point somewhere else (a staging or production server).
 */
function devBaseUrl(port = DEV_PORTS[0]): string {
  return `http://${devHost()}:${port}/api/v1`;
}

// Expo exposes env vars prefixed EXPO_PUBLIC_ at build time.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || devBaseUrl();

/** First candidate whose /health answers, else the first candidate (so an outage still reports against a real address). */
async function probe(candidates: string[]): Promise<string> {
  for (const base of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`${base}/health`, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (res.ok) return base;
    } catch { /* try the next one */ }
  }
  return candidates[0]!;
}
let probed: Promise<string> | null = null;

let override: string | null | undefined; // undefined = not read yet

/** Normalises what a person typed: trims, drops a trailing slash, adds http:// and /api/v1 when missing. */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/\/api\/v\d+$/.test(url)) url = `${url}/api/v1`;
  return url;
}

/**
 * The base URL to call right now: a server address saved on this device wins; then the
 * build-time EXPO_PUBLIC_API_BASE_URL; in development, whichever dev port answers.
 */
export async function getApiBaseUrl(): Promise<string> {
  if (override === undefined) override = await AsyncStorage.getItem(OVERRIDE_KEY).catch(() => null);
  if (override) return override;
  if (process.env.EXPO_PUBLIC_API_BASE_URL) return process.env.EXPO_PUBLIC_API_BASE_URL;
  if (!probed) probed = probe(DEV_PORTS.map((p) => devBaseUrl(p)));
  return probed;
}

/** Saves a server address on this device (installed builds can't be re-pointed any other way). Empty clears it. */
export async function setApiBaseUrl(raw: string): Promise<string> {
  const url = normalizeBaseUrl(raw);
  override = url || null;
  probed = null; // re-probe the dev ports if the saved address is cleared
  if (url) await AsyncStorage.setItem(OVERRIDE_KEY, url).catch(() => {});
  else await AsyncStorage.removeItem(OVERRIDE_KEY).catch(() => {});
  return url || API_BASE_URL;
}
