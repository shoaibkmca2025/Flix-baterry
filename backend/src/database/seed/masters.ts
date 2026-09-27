import { notInArray } from 'drizzle-orm';
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
      'batteries.read', 'warranty.read', 'warranty.override.request', 'claims.read', 'credits.read', 'returns.dispatch', 'stock.read',
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
      'batteries.read', 'warranty.read', 'warranty.override.request', 'claims.read', 'credits.read', 'returns.dispatch', 'stock.read',
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
  // (the old 'I700' row is gone — 'I 700' is a real product in the catalogue below)
];

// ---------------------------------------------------------------------------------------------
// The real catalogue — the client's warranty grid of 25 Sep 2026 (memory.md D-12).
//
// A label reads  <code> <model> <YYMM> <NNNN>, e.g. "M 1000 2609 0676", and the code+model pair
// IS the product: that pair decides the warranty. For the flooded range the code is one letter
// whose alphabet position is the plate count (G=7 … W=23) — verified against the client's
// earlier plate sheet, 26 of 27 rows. The tubular range uses two-character series codes.
// "GP" in front (e.g. "GP M 1000") is the Gold Power brand — the red case, always 12 months.
// ---------------------------------------------------------------------------------------------
const letterPlates = (code: string) => code.charCodeAt(0) - 64; // 'G' -> 7

// [code, model, months, brand?]
const CATALOGUE: [string, string, number, 'gold_power'?][] = [
  ['G', '400', 12], ['I', '400', 18], // the client settled this row on 25 Sep 2026: I 400 is the 18-month one and the 24-month 400 is withdrawn (D-12)
  ['I', '700', 12], ['I', '700', 12, 'gold_power'], ['J', '700', 18], ['K', '700', 24],
  ['K', '800', 12], ['K', '800', 12, 'gold_power'], ['L', '800', 18], ['M', '800', 24],
  ['M', '1000', 12], ['M', '1000', 12, 'gold_power'], ['N', '1000', 18], ['O', '1000', 24],
  ['Q', '1350', 12], ['S', '1350', 18],
  ['S', '1500', 12], ['S', '1500', 12, 'gold_power'], ['U', '1500', 18],
  ['U', '1800', 12], ['W', '1800', 18],
  ['O', 'H29', 18], ['K', '60L', 18],
  ['I', 'DIN75', 18], ['I', 'DIN50', 18], ['K', 'DIN60', 18], ['M', 'DIN66', 18],
  // tubular / inverter — 30 months throughout
  ['SE', '1800', 30], ['S5', '1800', 30], ['SS', '1800', 30],
  ['ME', '2000', 30], ['SS', '2000', 30],
  ['SG', '2200', 30], ['BE', '2200', 30], ['SS', '2200', 30],
  ['MG', '2500', 30], ['SS', '2500', 30],
];

const TUBULAR = new Set(['SE', 'S5', 'ME', 'SG', 'BE', 'MG', 'SS']);
const PLATE_CODES = [...new Set(CATALOGUE.map(([code]) => code))];

const PLATE_TYPES = PLATE_CODES.map((code, i) => ({
  code,
  label: TUBULAR.has(code) ? `${code} series` : `${letterPlates(code)} plates`,
  plateCount: TUBULAR.has(code) ? null : letterPlates(code),
  sortOrder: (TUBULAR.has(code) ? 100 : 0) + (TUBULAR.has(code) ? i : letterPlates(code)),
}));

/** 'M' + '1000' -> 'M1000'; the Gold Power variant is 'GPM1000', exactly as the label prints it. */
export const modelIdOf = (code: string, modelNo: string, brand?: string) =>
  `${brand === 'gold_power' ? 'GP' : ''}${code}${modelNo}`;

const CATALOGUE_MODELS = CATALOGUE.map(([code, modelNo, months, brand]) => ({
  id: modelIdOf(code, modelNo, brand),
  family: code,
  plate: code,
  modelNo,
  brand: brand ?? 'felix',
  type: TUBULAR.has(code) ? `Tubular ${code} · ${modelNo}` : `${letterPlates(code)} plates · ${modelNo}`,
  capacity: null,
  warrantyMonths: months,
  active: true,
}));

export async function seedMasters() {
  for (const city of CITIES) {
    await db.insert(cities).values(city).onConflictDoNothing({ target: cities.name });
  }
  // System roles are defined here, not by hand in the database, so a permission added to one
  // has to reach the existing row — insert-only left the old permission set in place.
  for (const role of ROLES) {
    await db
      .insert(roles)
      .values(role)
      .onConflictDoUpdate({ target: roles.key, set: { label: role.label, scope: role.scope, templatePermissions: role.templatePermissions } });
  }
  for (const plate of PLATE_TYPES) {
    await db
      .insert(plateTypes)
      .values(plate)
      .onConflictDoUpdate({ target: plateTypes.code, set: { label: plate.label, plateCount: plate.plateCount, sortOrder: plate.sortOrder, active: true } });
  }
  // Anything not in the client's current grid — placeholders, and products he withdraws —
  // leaves the dropdowns but stays resolvable for the batteries that already reference it.
  await db.update(plateTypes).set({ active: false }).where(notInArray(plateTypes.code, PLATE_CODES));
  await db.update(batteryModels).set({ active: false }).where(notInArray(batteryModels.id, CATALOGUE_MODELS.map((m) => m.id)));
  for (const model of LEGACY_MODELS) {
    await db.insert(batteryModels).values(model).onConflictDoNothing({ target: batteryModels.id });
  }
  // The client's grid is the source of truth: re-running the seed brings the database in line
  // with it, so a term he corrects (or a product he withdraws) actually takes effect.
  for (const model of CATALOGUE_MODELS) {
    await db
      .insert(batteryModels)
      .values(model)
      .onConflictDoUpdate({
        target: batteryModels.id,
        set: { plate: model.plate, modelNo: model.modelNo, brand: model.brand, type: model.type, warrantyMonths: model.warrantyMonths, active: true, updatedAt: new Date() },
      });
  }
  await db.insert(settings).values({ key: 'warranty.grace_months', value: 2 }).onConflictDoNothing({ target: settings.key });
  await db.insert(settings).values({ key: 'warranty.override_max_days', value: 90 }).onConflictDoNothing({ target: settings.key });
  console.log(`Seeded ${CITIES.length} cities, ${ROLES.length} roles, ${PLATE_TYPES.length} plate/series codes, ${LEGACY_MODELS.length + CATALOGUE_MODELS.length} battery models.`);
}
