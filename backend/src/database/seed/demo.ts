// memory.md §10 — reproduces the app's demo data exactly so the demo mode and a real
// backend tell the same story. NEVER run in production (guarded in run() below).
import { env } from '../../config/env';
import { hashPassword } from '../../utils/crypto';
import { db } from '../client';
import { dealers, users } from '../../models/identity.model';
import { cities } from '../../models/masters.model';
import { seedMasters } from './masters';

const DEMO_PASSWORD = 'Password123'; // memory.md said "any password >= 8 chars" for the old demo; a real backend needs one fixed value.

export async function seedDemo() {
  await seedMasters();

  const allCities = await db.select().from(cities);
  const byName = (name: string) => allCities.find((c) => c.name === name)?.id;

  const dhule = byName('Dhule');
  const nashik = byName('Nashik');
  if (!dhule || !nashik) throw new Error('seedDemo: run seedMasters first (cities missing)');

  const [fpp] = await db
    .insert(dealers)
    .values({
      dealerCode: 'FPP-014',
      name: 'Felix Power Point',
      contactPerson: 'Suresh Patil',
      mobile: '9876543210',
      cityId: dhule,
      state: 'Maharashtra',
      pin: '424001',
      place: 'Sakri Road',
      address: 'Shop 4, Sakri Road, Dhule',
      status: 'active',
      registeredVia: 'admin',
    })
    .onConflictDoNothing({ target: dealers.mobile })
    .returning();

  const [nbh] = await db
    .insert(dealers)
    .values({
      dealerCode: 'NBH-007',
      name: 'Nashik Battery House',
      contactPerson: 'Ganesh More',
      mobile: '9876543213',
      cityId: nashik,
      state: 'Maharashtra',
      pin: '422001',
      address: 'MG Road, Nashik',
      status: 'suspended',
      statusReason: 'Demo suspended dealer',
      registeredVia: 'admin',
    })
    .onConflictDoNothing({ target: dealers.mobile })
    .returning();

  await db
    .insert(dealers)
    .values({
      name: 'Vidyut Power Centre',
      contactPerson: 'Anita Sharma',
      mobile: '9876543214',
      cityId: nashik,
      state: 'Maharashtra',
      pin: '422002',
      address: 'College Road, Nashik',
      status: 'pending_approval',
      registeredVia: 'self',
    })
    .onConflictDoNothing({ target: dealers.mobile });

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const [dealer, name, mobile] of [
    [fpp, 'Suresh Patil', '9876543210'],
    [nbh, 'Ganesh More', '9876543213'],
  ] as const) {
    if (!dealer) continue;
    await db
      .insert(users)
      .values({ scope: 'dealer', dealerId: dealer.id, name, mobile, passwordHash, role: 'dealer_manager' })
      .onConflictDoNothing({ target: users.mobile });
  }

  await db
    .insert(users)
    .values({ scope: 'admin', name: 'S. Deshpande', email: 'admin@example.com', passwordHash, role: 'main_admin' })
    .onConflictDoNothing({ target: users.email });
  await db
    .insert(users)
    .values({ scope: 'admin', name: 'A. Kulkarni', email: 'operations@example.com', passwordHash, role: 'operations' })
    .onConflictDoNothing({ target: users.email });

  console.log(`Seeded demo data. Admin password / dealer password for all demo accounts: ${DEMO_PASSWORD}`);
}

async function run() {
  if (env.NODE_ENV === 'production') {
    throw new Error('seedDemo must never run in production (memory.md §9 D-06, architecture.md rules.md §8)');
  }
  await seedDemo();
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
