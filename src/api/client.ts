import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from './config';

// architecture.md §6.1 — the error envelope every backend route returns.
export class ApiError extends Error {
  code: string;
  status: number;
  field?: string;
  nextAction?: string;
  details?: unknown;

  constructor(status: number, body: { code: string; message: string; field?: string; nextAction?: string; details?: unknown }) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.field = body.field;
    this.nextAction = body.nextAction;
    this.details = body.details;
  }
}

const DEVICE_ID_KEY = 'felix-device-id';
let deviceIdCache: string | null = null;

// A stable per-install id, sent as X-Device-Id (architecture.md §6.1) — used for session
// tracking and, later, offline sync batches.
export async function getDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY).catch(() => null);
  if (stored) {
    deviceIdCache = stored;
    return stored;
  }
  const id = `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, id).catch(() => {});
  deviceIdCache = id;
  return id;
}

export type ApiOptions = { accessToken?: string };

// Set by the app root. Called when the server rejects a signed-in request (expired or revoked
// token), so the app returns to the sign-in screen instead of staying on a dashboard.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export async function apiPost<T>(path: string, body: unknown, options: ApiOptions = {}): Promise<T> {
  const deviceId = await getDeviceId();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Device-Id': deviceId };
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && options.accessToken) unauthorizedHandler?.();
  if (!res.ok) {
    throw new ApiError(res.status, json.error ?? { code: 'unknown_error', message: 'Something went wrong. Try again.' });
  }
  return json as T;
}

export async function apiGet<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const deviceId = await getDeviceId();
  const headers: Record<string, string> = { 'X-Device-Id': deviceId };
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { method: 'GET', headers });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && options.accessToken) unauthorizedHandler?.();
  if (!res.ok) {
    throw new ApiError(res.status, json.error ?? { code: 'unknown_error', message: 'Something went wrong. Try again.' });
  }
  return json as T;
}
