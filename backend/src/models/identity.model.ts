import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  char,
  check,
  customType,
  index,
  inet,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cities } from './masters.model';

// Postgres `citext` (case-insensitive text) — enabled by the pgcrypto/pg_trgm/citext extensions
// migration (0000_init.sql). Drizzle has no first-class helper for it, so it's a thin custom type.
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

// architecture.md §8.3 IDENTITY ------------------------------------------------------------

export const dealerStatus = pgEnum('dealer_status', ['pending_approval', 'active', 'rejected', 'suspended']);
export const registeredVia = pgEnum('registered_via', ['self', 'admin']);

// dealers owns this table (modules.md §4). `city_id` needs `cities` (masters.model.ts) to exist first.
export const dealers = pgTable(
  'dealers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealerCode: text('dealer_code').unique(), // assigned at approval; immutable after; ^[A-Z]{2,4}-\d{3}$
    name: text('name').notNull(),
    contactPerson: text('contact_person').notNull(),
    mobile: text('mobile').notNull().unique(), // 10 digits
    email: citext('email').unique(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id),
    state: text('state').notNull(),
    pin: char('pin', { length: 6 }).notNull(),
    place: text('place'),
    address: text('address').notNull(),
    status: dealerStatus('status').notNull().default('pending_approval'),
    statusReason: text('status_reason'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    // fk -> users; added once users exists below (same-file forward reference via callback).
    statusChangedBy: uuid('status_changed_by'),
    registeredVia: registeredVia('registered_via').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('dealers_status_idx').on(t.status), index('dealers_city_idx').on(t.cityId)],
);

export const userScope = pgEnum('user_scope', ['dealer', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'temporarily_blocked', 'inactive', 'soft_deleted']);
export const mfaType = pgEnum('mfa_type', ['none', 'email_otp', 'totp']);
export const userLanguage = pgEnum('user_language', ['en', 'mr']);

// users owns this table + user_permissions (modules.md §4). One table for dealer staff and admins.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: userScope('scope').notNull(),
    dealerId: uuid('dealer_id').references(() => dealers.id),
    name: text('name').notNull(),
    mobile: text('mobile').unique(),
    email: citext('email').unique(),
    passwordHash: text('password_hash'),
    role: text('role').notNull(), // fk -> roles.key, added once roles exists below
    status: userStatus('status').notNull().default('active'),
    statusReason: text('status_reason'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    mfa: mfaType('mfa').notNull().default('none'),
    totpSecretEnc: text('totp_secret_enc'),
    language: userLanguage('language').notNull().default('en'),
    smsAlerts: boolean('sms_alerts').notNull().default(true),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // architecture.md §8.3 — chk(scope='dealer' = (dealer_id is not null))
    check('users_scope_dealer_check', sql`(${t.scope} = 'dealer') = (${t.dealerId} is not null)`),
  ],
);

// roles owns this table (admins module writes it — modules.md §4).
export const roles = pgTable('roles', {
  key: text('key').primaryKey(), // 'dealer_user', 'main_admin', ...
  label: text('label').notNull(),
  scope: userScope('scope').notNull(),
  templatePermissions: text('template_permissions').array().notNull(),
  system: boolean('system').notNull().default(false),
});

export const userPermissions = pgTable(
  'user_permissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    permission: text('permission').notNull(),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => users.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('user_permissions_uq').on(t.userId, t.permission)],
);

export const otpPurpose = pgEnum('otp_purpose', ['login', 'register', 'reset', 'admin_2fa', 'verify_mobile']);
export const loginOutcome = pgEnum('login_outcome', ['ok', 'bad_password', 'bad_otp', 'locked', 'blocked']);

// auth module owns sessions, otp_challenges, login_attempts (modules.md §4).
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    refreshHash: text('refresh_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(),
    deviceId: text('device_id'),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    replacedBy: uuid('replaced_by'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_family_idx').on(t.familyId)],
);

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: otpPurpose('purpose').notNull(),
    target: text('target').notNull(), // mobile or email
    codeHash: text('code_hash').notNull(),
    userId: uuid('user_id').references(() => users.id),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdIp: inet('created_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('otp_challenges_target_idx').on(t.target, t.purpose, t.createdAt)],
);

export const loginAttempts = pgTable('login_attempts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  target: text('target').notNull(),
  ip: inet('ip'),
  outcome: loginOutcome('outcome').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
