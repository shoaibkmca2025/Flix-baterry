import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

// architecture.md §13.1 filter model, trimmed to what the admin Audit log screen filters on.
export const AuditListQuery = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(80).optional(), // exact ('entry.approved') or prefix with '*' ('entry.*')
  entityType: z.string().trim().min(1).max(40).optional(),
  entityId: z.string().trim().min(1).max(80).optional(),
  outcome: z.enum(['ok', 'denied', 'failed']).optional(),
  from: isoDate.optional(), // business-date range, inclusive, Asia/Kolkata
  to: isoDate.optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type AuditListQuery = z.infer<typeof AuditListQuery>;
