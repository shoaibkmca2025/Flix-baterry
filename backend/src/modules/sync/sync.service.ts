import { getEffectivePermissions, permissionGranted } from '../../middleware/rbac';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import * as auditService from '../audit/audit.service';
import { AuditListQuery } from '../audit/audit.validation';
import * as batteriesService from '../batteries/batteries.service';
import { BatteryListQuery } from '../batteries/batteries.validation';
import * as claimsService from '../claims/claims.service';
import { ClaimListQuery } from '../claims/claims.validation';
import * as dealersService from '../dealers/dealers.service';
import { DealerListQuery } from '../dealers/dealers.validation';
import * as entriesService from '../entries/entries.service';
import { EntryListQuery } from '../entries/entries.validation';
import * as creditsService from '../credits/credits.service';
import { CreditNoteListQuery } from '../credits/credits.validation';
import * as mastersService from '../masters/masters.service';
import * as returnsService from '../returns/returns.service';
import { ChallanListQuery } from '../returns/returns.validation';
import * as stockService from '../stock/stock.service';
import { StockMovementListQuery } from '../stock/stock.validation';
import * as usersService from '../users/users.service';

const PAGE = { limit: 200 };

/**
 * Everything the apps load after sign-in, in ONE response — the same lists the individual
 * routes return (same services, same default page of 200), so the app sees identical shapes.
 * The apps sit ~250 ms from the server and the host speaks HTTP/1.1, so nine separate requests
 * meant up to six new TLS connections per refresh; one request is one round trip.
 *
 * Permissions are computed once and checked per section, exactly as each route's
 * requirePermission would; a section the caller may not read comes back as null (the apps
 * already treat a missing audit log or admin list that way). Each service still scopes its own
 * data (a dealer only ever gets their own entries, claims, batteries and challans).
 */
export async function snapshot(ctx: Ctx) {
  const user = ctx.user;
  if (!user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  const perms = await getEffectivePermissions(user.id, user.role);
  const can = (permission: string) => permissionGranted(perms, permission);
  const admin = user.scope === 'admin';
  const when = <T>(allowed: boolean, load: () => Promise<T>): Promise<T | null> => (allowed ? load() : Promise.resolve(null));

  const [masters, entries, batteries, claims, movements, dealers, audit, admins, challans, creditNotes] = await Promise.all([
    mastersService.bundle(),
    when(can('entries.read'), () => entriesService.list(ctx, EntryListQuery.parse(PAGE))),
    when(can('batteries.read'), () => batteriesService.list(ctx, BatteryListQuery.parse(PAGE))),
    when(can('claims.read'), () => claimsService.list(ctx, ClaimListQuery.parse(PAGE))),
    when(can('stock.read'), () => stockService.ledger(ctx, StockMovementListQuery.parse(PAGE))),
    when(admin && can('dealers.read'), () => dealersService.list(ctx, DealerListQuery.parse(PAGE))),
    when(admin && can('audit.read'), () => auditService.list(ctx, AuditListQuery.parse(PAGE))),
    when(admin && can('admins.manage'), async () => ({ items: await usersService.listAdmins(ctx) })),
    when(can('claims.read'), () => returnsService.list(ctx, ChallanListQuery.parse(PAGE))),
    when(can('credits.read'), () => creditsService.list(ctx, CreditNoteListQuery.parse(PAGE))),
  ]);

  return { masters, entries, batteries, claims, movements, dealers, audit, admins, challans, creditNotes, syncedAt: ctx.now().toISOString() };
}
