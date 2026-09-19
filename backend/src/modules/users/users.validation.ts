import { z } from 'zod';

const name = z.string().trim().min(2, 'Enter the full name.').max(80);
const mobile = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number.');
const email = z.string().trim().toLowerCase().email('Enter a valid email address.');
const reason = z.string().trim().min(5, 'Give a short reason (at least 5 characters).');
const permission = z.string().trim().regex(/^[a-z_]+(\.[a-z_*]+)+$/, 'Permission keys look like "entries.read".');

export const MeUpdateBody = z.object({
  name: name.optional(),
  language: z.enum(['en', 'mr']).optional(),
  smsAlerts: z.boolean().optional(),
});
export type MeUpdateBody = z.infer<typeof MeUpdateBody>;

export const StaffInviteBody = z.object({
  name,
  mobile,
  email: email.optional(),
  role: z.enum(['dealer_user', 'dealer_manager']).default('dealer_user'),
});
export type StaffInviteBody = z.infer<typeof StaffInviteBody>;

export const StaffUpdateBody = z.object({
  name: name.optional(),
  role: z.enum(['dealer_user', 'dealer_manager']).optional(),
  permissions: z.array(permission).max(50).optional(), // extra grants beyond the role template; replaces the set
});
export type StaffUpdateBody = z.infer<typeof StaffUpdateBody>;

export const UserStatusBody = z.object({
  status: z.enum(['active', 'temporarily_blocked', 'inactive', 'soft_deleted']),
  reason,
});
export type UserStatusBody = z.infer<typeof UserStatusBody>;

export const AdminCreateBody = z.object({
  name,
  email,
  mobile: mobile.optional(),
  role: z.string().trim().min(1), // an admin-scope role key from `roles`; checked in the service
  password: z.string().min(8, 'At least 8 characters.'), // initial password, handed over by the main admin
});
export type AdminCreateBody = z.infer<typeof AdminCreateBody>;

export const AdminUpdateBody = z.object({
  name: name.optional(),
  role: z.string().trim().min(1).optional(),
  permissions: z.array(permission).max(50).optional(),
});
export type AdminUpdateBody = z.infer<typeof AdminUpdateBody>;
