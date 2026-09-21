import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// The backend port (backend/.env PORT). 8080 is taken by Apache on the current dev machine.
const DEV_PORT = 4000;
const OVERRIDE_KEY = 'felix-api-base-url';

/**
 * On a phone, `localhost` is the phone itself, so the dev backend has to be reached at the
 * computer's LAN address. Expo already knows it — the dev server the app was loaded from —
 * so the host is reused here and only the port swapped. Set EXPO_PUBLIC_API_BASE_URL to
 * point somewhere else (a staging or production server).
 */
function devBaseUrl(): string {
  const hostUri = Constants.expoConfig?.hostUri || (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  const host = hostUri?.split('/')[0]?.split(':')[0];
  return `http://${host || 'localhost'}:${DEV_PORT}/api/v1`;
}

// Expo exposes env vars prefixed EXPO_PUBLIC_ at build time.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || devBaseUrl();

let override: string | null | undefined; // undefined = not read yet

/** Normalises what a person typed: trims, drops a trailing slash, adds http:// and /api/v1 when missing. */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/\/api\/v\d+$/.test(url)) url = `${url}/api/v1`;
  return url;
}

/** The base URL to call right now: a server address saved on this device wins over the built-in one. */
export async function getApiBaseUrl(): Promise<string> {
  if (override === undefined) override = await AsyncStorage.getItem(OVERRIDE_KEY).catch(() => null);
  return override || API_BASE_URL;
}

/** Saves a server address on this device (installed builds can't be re-pointed any other way). Empty clears it. */
export async function setApiBaseUrl(raw: string): Promise<string> {
  const url = normalizeBaseUrl(raw);
  override = url || null;
  if (url) await AsyncStorage.setItem(OVERRIDE_KEY, url).catch(() => {});
  else await AsyncStorage.removeItem(OVERRIDE_KEY).catch(() => {});
  return url || API_BASE_URL;
}
