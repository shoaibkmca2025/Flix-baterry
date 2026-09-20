import Constants from 'expo-constants';

// The backend's default port (backend/src/config/env.ts PORT, and backend/.env). On a machine
// where 8080 is taken (e.g. by Apache), run the backend on another port and point the app at it
// with EXPO_PUBLIC_API_BASE_URL — see devBaseUrl() below.
const DEV_PORT = 8080;

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
