import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/models/*.model.ts',
  out: './src/database/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://felix:felix@localhost:5432/felix',
  },
  strict: true,
  verbose: true,
});
