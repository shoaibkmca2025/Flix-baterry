import { defineConfig } from "@neon/config/v1";

// The Felix backend (backend/) deployed as a Neon Function next to the database.
// Deploy with:  neon deploy --env backend/.env
// DATABASE_URL is injected by Neon at runtime; everything else comes from backend/.env.
export default defineConfig({
  // The dealers' photos (memory.md D-10, 2 Oct 2026). Private: head office reads them through
  // signed links from the API. Declaring it makes Neon inject the AWS_* storage variables into
  // the function below (backend/src/utils/storage.ts).
  buckets: {
    evidence: {},
  },
  functions: {
    api: {
      name: "Felix API",
      source: "backend/src/function.ts",
      env: {
        // "staging", not "production": the demo OTP code is refused in production (backend/src/config/env.ts)
        // and no SMS provider is wired yet, so 123456 is the only way to sign in on a test build.
        NODE_ENV: "staging",
        LOG_LEVEL: "info",
        TZ: "Asia/Kolkata",
        DATABASE_POOL_MAX: "5", // each isolate keeps its own pool — keep it small
        JWT_SECRET: process.env.JWT_SECRET!,
        // Fixed demo code for this test deployment, independent of the local .env (where it may be
        // commented out so the local backend prints real random codes). Remove once SMS is wired.
        OTP_DEMO_CODE: process.env.OTP_DEMO_CODE ?? "123456",
        // TEMPORARY: the app shows the OTP in a popup until SMS is wired — remove this line then.
        OTP_SHOW_IN_APP: "true",
        // The only web addresses allowed to call this API from a browser (backend/src/app.ts). Left
        // empty, every browser call is refused and both apps show "could not reach the server"
        // (6 Oct 2026). Add a domain here when the apps move to one.
        APP_ORIGINS: process.env.APP_ORIGINS ?? "https://felix-admin.shoaibk-mca2024.workers.dev,https://felix-dealer.shoaibk-mca2024.workers.dev",
        ACCESS_TOKEN_TTL_MIN: process.env.ACCESS_TOKEN_TTL_MIN!,
        REFRESH_TOKEN_TTL_DAYS: process.env.REFRESH_TOKEN_TTL_DAYS!,
      },
    },
  },
});
