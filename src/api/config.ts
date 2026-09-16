// Expo exposes env vars prefixed EXPO_PUBLIC_ at build time. Falls back to the local
// backend dev server (backend/src/server.ts, PORT=8080) so this works out of the box
// for `expo start --web` against `npm run dev` in backend/.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8080/api/v1';
