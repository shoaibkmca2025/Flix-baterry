import { db, withTransaction } from '../../database/client';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { AppError } from '../../utils/errors';
import { listModels } from '../batteries/batteries.repository';
import * as repo from './masters.repository';
import type { CityCreateBody, CityUpdateBody } from './masters.validation';

// M-06 masters — architecture.md §19 GET /masters: "one bundle with ETag" (ETag itself is
// a later addition — plugins/etag.ts doesn't exist yet). Public: a not-yet-registered
// dealer needs the city list before they have any token (d04's city picker).
export async function bundle() {
  const [allCities, models] = await Promise.all([repo.listCities(db), listModels(db)]);
  return { cities: allCities.filter((c) => c.active), models };
}

function requireManageActor(ctx: Ctx) {
  if (!ctx.user || ctx.user.scope !== 'admin') {
    throw new AppError('unauthenticated', 401, 'Sign in required.');
  }
  return ctx.user;
}

export async function listCitiesAdmin(ctx: Ctx) {
  requireManageActor(ctx);
  return repo.listCities(db);
}

export async function createCity(ctx: Ctx, input: CityCreateBody) {
  requireManageActor(ctx);
  const existing = await repo.findCityByName(db, input.name);
  if (existing) {
    throw new AppError('city_taken', 409, 'A city with this name already exists.', { field: 'name' });
  }
  return withTransaction(async (tx) => {
    const city = await repo.insertCity(tx, input);
    await audit(tx, { ctx, action: 'master.updated', entityType: 'city', entityId: city.id, entityRef: city.name, after: city, outcome: 'ok' });
    return city;
  });
}

export async function updateCity(ctx: Ctx, id: string, input: CityUpdateBody) {
  requireManageActor(ctx);
  const before = await repo.findCityById(db, id);
  if (!before) throw new AppError('city_not_found', 404, 'City not found.');

  return withTransaction(async (tx) => {
    const after = await repo.updateCity(tx, id, input);
    await audit(tx, { ctx, action: 'master.updated', entityType: 'city', entityId: id, entityRef: before.name, before, after, outcome: 'ok' });
    return after;
  });
}
