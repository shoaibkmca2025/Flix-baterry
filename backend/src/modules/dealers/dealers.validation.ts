import { z } from 'zod';

export const DealerRegisterBody = z.object({
  verifiedToken: z.string().min(1),
  name: z.string().trim().min(1, 'Enter the shop name.'),
  contactPerson: z.string().trim().min(1, 'Enter the owner or contact person.'),
  mobile: z.string().regex(/^\d{10}$/, 'Enter the 10-digit mobile number.'),
  email: z.string().email().optional().or(z.literal('')),
  city: z.string().trim().min(1, 'Choose your city.'),
  district: z.string().trim().min(1, 'Choose the district.').optional(),
  state: z.string().trim().min(1, 'Enter the state.'),
  pin: z.string().regex(/^\d{6}$/, '6 digits.').optional(), // not asked for any more (client, 3 Oct 2026)
  place: z.string().trim().optional(),
  address: z.string().trim().min(1, 'Enter the full shop address.'),
  password: z.string().min(8, 'At least 8 characters.'),
});
export type DealerRegisterBody = z.infer<typeof DealerRegisterBody>;

// A distributor adds a dealer under him (client, 2 Oct 2026). The dealer signs in with this
// mobile number and the SMS code, so no password is set here.
export const DealerCreateBody = z.object({
  name: z.string().trim().min(1, 'Enter the shop name.'),
  contactPerson: z.string().trim().min(1, 'Enter the owner or contact person.'),
  mobile: z.string().regex(/^\d{10}$/, 'Enter the 10-digit mobile number.'),
  email: z.string().email().optional().or(z.literal('')),
  city: z.string().trim().min(1, 'Choose the city.'),
  district: z.string().trim().min(1, 'Choose the district.').optional(),
  state: z.string().trim().min(1, 'Enter the state.'),
  pin: z.string().regex(/^\d{6}$/, '6 digits.').optional(), // not asked for any more (client, 3 Oct 2026)
  place: z.string().trim().optional(),
  address: z.string().trim().min(1, 'Enter the full shop address.'),
});
export type DealerCreateBody = z.infer<typeof DealerCreateBody>;

// Head office adds a dealer too, and says which distributor it belongs under (client,
// 3 Oct 2026). Same shape as a distributor's own form, plus that one field.
export const AdminDealerCreateBody = DealerCreateBody.extend({
  distributorId: z.string().uuid('Choose the distributor this dealer belongs to.'),
});
export type AdminDealerCreateBody = z.infer<typeof AdminDealerCreateBody>;

// Moving a dealer from one distributor to another — a reason, like every other decision.
export const DealerAssignBody = z.object({
  distributorId: z.string().uuid('Choose the distributor this dealer belongs to.'),
  reason: z.string().trim().min(5, 'Give a short reason (at least 5 characters).'),
});
export type DealerAssignBody = z.infer<typeof DealerAssignBody>;

// rules.md §6 — reason is mandatory for every decision endpoint, at least 5 characters.
const reason = z.string().trim().min(5, 'Give a short reason (at least 5 characters).');

export const DealerApproveBody = z.object({
  dealerCode: z.string().regex(/^[A-Z]{2,4}-\d{3}$/, 'Use a code like FPP-014.'),
  reason,
});
export type DealerApproveBody = z.infer<typeof DealerApproveBody>;

export const DealerReasonBody = z.object({ reason });
export type DealerReasonBody = z.infer<typeof DealerReasonBody>;

export const DealerProfileUpdateBody = z.object({
  contactPerson: z.string().trim().min(1).optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().trim().min(1).optional(),
  place: z.string().trim().optional(),
});
export type DealerProfileUpdateBody = z.infer<typeof DealerProfileUpdateBody>;

/**
 * Head office correcting a shop's record (client, 4 Oct 2026).
 *
 * Every field is optional: the console sends only what changed, so an edit to the address
 * cannot quietly rewrite the mobile number. A reason is required, like every other decision —
 * the before and after go into the audit log with it.
 */
export const DealerAdminUpdateBody = z.object({
  name: z.string().trim().min(1, 'Enter the shop name.').optional(),
  contactPerson: z.string().trim().min(1, 'Enter the owner or contact person.').optional(),
  mobile: z.string().regex(/^\d{10}$/, 'Enter the 10-digit mobile number.').optional(),
  email: z.string().email('Check the email address.').optional().or(z.literal('')),
  city: z.string().trim().min(1, 'Choose the city.').optional(),
  district: z.string().trim().min(1, 'Choose the district.').optional(),
  state: z.string().trim().min(1, 'Enter the state.').optional(),
  place: z.string().trim().optional(),
  address: z.string().trim().min(1, 'Enter the full shop address.').optional(),
  distributorId: z.string().uuid('Choose the distributor this dealer belongs to.').optional(),
  reason,
});
export type DealerAdminUpdateBody = z.infer<typeof DealerAdminUpdateBody>;

export const DealerListQuery = z.object({
  status: z.enum(['pending_approval', 'active', 'rejected', 'suspended']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type DealerListQuery = z.infer<typeof DealerListQuery>;
