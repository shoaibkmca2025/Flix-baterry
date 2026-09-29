import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';

async function main() {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  // A restart or a deploy sends SIGTERM/SIGINT. Without this the process dies mid-request and
  // the dealer sees "could not reach the server" on a request that was half-written. close()
  // stops taking new ones, lets the ones in flight finish, then runs the onClose hooks.
  // (The Neon Function entry — src/function.ts — is not a long-lived process and has none of
  // this; the runtime evicts the isolate and Neon's pooler reclaims the connections.)
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (closing) return; // a second Ctrl-C should not race the first
      closing = true;
      logger.info({ signal }, 'shutting down — finishing the requests already in flight');
      app.close().then(
        () => process.exit(0),
        (err) => { logger.error({ err }, 'shutdown failed'); process.exit(1); },
      );
    });
  }
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
