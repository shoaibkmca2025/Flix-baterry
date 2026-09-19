import { db } from '../client';
import { batteryModels, cities } from '../../models/masters.model';
import { roles } from '../../models/identity.model';

// Matches src/seed.ts's demo `cities` list exactly so the app's demo mode and the real
// backend tell the same story (memory.md §10). Idempotent — safe to run repeatedly.
const CITIES = [
  { name: 'Dhule', state: 'Maharashtra' },
  { name: 'Nashik', state: 'Maharashtra' },
  { name: 'Jalgaon', state: 'Maharashtra' },
  { name: 'Malegaon', state: 'Maharashtra' },
];

// architecture.md §7.3 role templates. Wildcards: '*' = everything (main_admin),
// 'domain.*' = every action on a domain, '*.read' = read access everywhere (read_only).
// Not yet a full match to every permission string in §7.3 — filled in as each module
// that owns those permissions gets built, per middleware/rbac.ts's matching rules.
const ROLES = [
  {
    key: 'dealer_user',
    label: 'Dealer user',
    scope: 'dealer' as const,
    templatePermissions: [
      'entries.read', 'entries.create', 'entries.submit', 'corrections.request',
      'batteries.read', 'warranty.read', 'claims.read', 'credits.read', 'returns.dispatch', 'stock.read',
      'customers.read', 'customers.write', 'evidence.upload', 'evidence.read',
      'reports.run', 'reports.export', 'notifications.read',
    ],
    system: true,
  },
  {
    key: 'dealer_manager',
    label: 'Dealer manager',
    scope: 'dealer' as const,
    templatePermissions: [
      'entries.read', 'entries.create', 'entries.submit', 'corrections.request',
      'batteries.read', 'warranty.read', 'claims.read', 'credits.read', 'returns.dispatch', 'stock.read',
      'customers.read', 'customers.write', 'evidence.upload', 'evidence.read',
      'reports.run', 'reports.export', 'notifications.read', 'dealers.staff.manage',
    ],
    system: true,
  },
  { key: 'main_admin', label: 'Main Admin', scope: 'admin' as const, templatePermissions: ['*'], system: true },
  {
    key: 'co_admin',
    label: 'Co-Admin',
    scope: 'admin' as const,
    templatePermissions: [
      'entries.*', 'corrections.*', 'dealers.*', 'masters.*', 'batteries.*', 'warranty.read', 'warranty.override.*',
      'claims.*', 'credits.*', 'returns.*', 'stock.*', 'customers.*', 'evidence.*', 'reports.*',
      'notifications.*', 'audit.read', 'sync.reconcile',
    ],
    system: true,
  },
  {
    key: 'operations',
    label: 'Operations',
    scope: 'admin' as const,
    templatePermissions: ['entries.*', 'corrections.decide', 'claims.*', 'returns.*', 'evidence.read', 'reports.run', 'notifications.read'],
    system: true,
  },
  {
    key: 'inventory_manager',
    label: 'Inventory manager',
    scope: 'admin' as const,
    templatePermissions: ['stock.*', 'returns.receive', 'returns.process', 'batteries.read', 'reports.run'],
    system: true,
  },
  { key: 'read_only', label: 'Read-only', scope: 'admin' as const, templatePermissions: ['*.read', 'reports.run'], system: true },
];

// memory.md §9 D-08 — demo credit-rate values name these exact models; kept in sync.
const BATTERY_MODELS = [
  { id: 'M3', family: 'M', type: 'IT tall tubular', capacity: '135Ah' },
  { id: 'M5', family: 'M', type: 'IT tall tubular', capacity: '150Ah' },
  { id: 'M7', family: 'M', type: 'IT tall tubular', capacity: '165Ah' },
  { id: 'B5', family: 'B', type: 'Standard flat plate', capacity: '88Ah' },
  { id: 'S5', family: 'S', type: 'SMF', capacity: '35Ah' },
  { id: 'I700', family: 'I', type: 'Inverter battery', capacity: '150Ah' },
];

export async function seedMasters() {
  for (const city of CITIES) {
    await db.insert(cities).values(city).onConflictDoNothing({ target: cities.name });
  }
  for (const role of ROLES) {
    await db.insert(roles).values(role).onConflictDoNothing({ target: roles.key });
  }
  for (const model of BATTERY_MODELS) {
    await db.insert(batteryModels).values(model).onConflictDoNothing({ target: batteryModels.id });
  }
  console.log(`Seeded ${CITIES.length} cities, ${ROLES.length} roles, ${BATTERY_MODELS.length} battery models.`);
}
