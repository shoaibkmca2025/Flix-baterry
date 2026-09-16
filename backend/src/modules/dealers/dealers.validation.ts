import { z } from 'zod';

export const DealerRegisterBody = z.object({
  verifiedToken: z.string().min(1),
  name: z.string().trim().min(1, 'Enter the shop name.'),
  contactPerson: z.string().trim().min(1, 'Enter the owner or contact person.'),
  mobile: z.string().regex(/^\d{10}$/, 'Enter the 10-digit mobile number.'),
  email: z.string().email().optional().or(z.literal('')),
  city: z.string().trim().min(1, 'Choose your city.'),
  state: z.string().trim().min(1, 'Enter the state.'),
  pin: z.string().regex(/^\d{6}$/, '6 digits.'),
  place: z.string().trim().optional(),
  address: z.string().trim().min(1, 'Enter the full shop address.'),
  password: z.string().min(8, 'At least 8 characters.'),
});
export type DealerRegisterBody = z.infer<typeof DealerRegisterBody>;

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

export const DealerListQuery = z.object({
  status: z.enum(['pending_approval', 'active', 'rejected', 'suspended']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type DealerListQuery = z.infer<typeof DealerListQuery>;
