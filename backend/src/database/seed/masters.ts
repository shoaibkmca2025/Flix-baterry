import { db } from '../client';
import { batteryModels, cities, plateTypes } from '../../models/masters.model';
import { settings } from '../../models/governance.model';
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

// The rows from before 22 Sep 2026 ("M5" etc.). Batteries already on the register reference
// them, so they stay resolvable — but inactive, so the dropdowns no longer offer them.
// memory.md §9 D-08 — the demo credit-rate map names these ids; kept in sync.
const LEGACY_MODELS = [
  { id: 'M3', family: 'M', type: 'IT tall tubular', capacity: '135Ah', active: false },
  { id: 'M5', family: 'M', type: 'IT tall tubular', capacity: '150Ah', active: false },
  { id: 'M7', family: 'M', type: 'IT tall tubular', capacity: '165Ah', active: false },
  { id: 'B5', family: 'B', type: 'Standard flat plate', capacity: '88Ah', active: false },
  { id: 'S5', family: 'S', type: 'SMF', capacity: '35Ah', active: false },
  { id: 'I700', family: 'I', type: 'Inverter battery', capacity: '150Ah', active: false },
];

// memory.md D-11 (22 Sep 2026): the label reads PLATE + MODEL NUMBER ("M2200"); the plate
// letter is what the warranty term follows. Letters, numbers and months below are the
// client's EXAMPLES from the conversation — the real grid is still to come (D-12, open).
const PLATE_TYPES = [
  { code: 'M', label: 'M plates', sortOrder: 1 },
  { code: 'N', label: 'N plates', sortOrder: 2 },
  { code: 'L', label: 'L plates', sortOrder: 3 },
  { code: 'S', label: 'S plates', sortOrder: 4 },
  { code: 'I', label: 'I plates', sortOrder: 5 },
  { code: 'T', label: 'T plates', sortOrder: 6 },
];
const MODEL_NUMBERS = ['600', '700', '1200', '1300', '2200'];
// months of cover per plate letter, before the grace months (M2200 = 30 and N2200 = 24 were the client's own examples)
const PLATE_TERM_MONTHS: Record<string, number> = { M: 30, N: 24, L: 36, S: 24, I: 18, T: 18 };

const PLATE_MODELS = PLATE_TYPES.flatMap((p) =>
  MODEL_NUMBERS.map((n) => ({ id: `${p.code}${n}`, family: p.code, plate: p.code, modelNo: n, type: `${p.label} · ${n}`, capacity: null, warrantyMonths: PLATE_TERM_MONTHS[p.code]!, active: true })),
);

export async function seedMasters() {
  for (const city of CITIES) {
    await db.insert(cities).values(city).onConflictDoNothing({ target: cities.name });
  }
  for (const role of ROLES) {
    await db.insert(roles).values(role).onConflictDoNothing({ target: roles.key });
  }
  for (const plate of PLATE_TYPES) {
    await db.insert(plateTypes).values(plate).onConflictDoNothing({ target: plateTypes.code });
  }
  for (const model of [...LEGACY_MODELS, ...PLATE_MODELS]) {
    await db.insert(batteryModels).values(model).onConflictDoNothing({ target: batteryModels.id });
  }
  await db.insert(settings).values({ key: 'warranty.grace_months', value: 2 }).onConflictDoNothing({ target: settings.key });
  console.log(`Seeded ${CITIES.length} cities, ${ROLES.length} roles, ${PLATE_TYPES.length} plate types, ${LEGACY_MODELS.length + PLATE_MODELS.length} battery models.`);
}
