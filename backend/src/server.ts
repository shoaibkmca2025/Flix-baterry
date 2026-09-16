import { buildApp } from './app';
import { env } from './config/env';

async function main() {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
