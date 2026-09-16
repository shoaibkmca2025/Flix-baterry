import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { env } from '../config/env';

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './src/database/migrations' });
  await pool.end();
  console.log('Migrations applied.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
