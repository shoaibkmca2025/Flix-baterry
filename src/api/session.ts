import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCESS_KEY = 'felix-access-token';
const REFRESH_KEY = 'felix-refresh-token';

// Minimal bridge until a real session layer (refresh rotation, SecureStore) lands —
// architecture.md §20 notes tokens belong in expo-secure-store on native eventually.
export async function saveTokens(accessToken: string, refreshToken: string) {
  await AsyncStorage.multiSet([[ACCESS_KEY, accessToken], [REFRESH_KEY, refreshToken]]).catch(() => {});
}

export async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(ACCESS_KEY).catch(() => null);
}

export async function clearTokens() {
  await AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY]).catch(() => {});
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
