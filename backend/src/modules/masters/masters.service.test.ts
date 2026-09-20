import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({
  db: {},
  withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));
vi.mock('../batteries/batteries.repository', () => ({ listModels: vi.fn(async () => [{ id: 'M5', family: 'M', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24, active: true }]) }));

vi.mock('./masters.repository', () => ({
  listCities: vi.fn(),
  findCityById: vi.fn(),
  findCityByName: vi.fn(),
  insertCity: vi.fn(),
  updateCity: vi.fn(),
}));

import * as repo from './masters.repository';
import { bundle, createCity, listCitiesAdmin, updateCity } from './masters.service';
import type { Ctx } from '../../utils/context';

const ctx: Ctx = {
  user: null,
  request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' },
  now: () => new Date('2026-09-16T10:00:00Z'),
};
const adminCtx: Ctx = { ...ctx, user: { id: 'admin-1', scope: 'admin', role: 'main_admin' } };

beforeEach(() => vi.clearAllMocks());

describe('bundle', () => {
  it('is public and only returns active cities', async () => {
    vi.mocked(repo.listCities).mockResolvedValue([
      { id: '1', name: 'Dhule', state: 'Maharashtra', active: true },
      { id: '2', name: 'Retired City', state: 'Maharashtra', active: false },
    ] as never);

    const result = await bundle();

    expect(result.cities).toHaveLength(1);
    expect(result.models).toHaveLength(1); // the app's model catalogue rides along
    expect(result.cities[0]).toMatchObject({ name: 'Dhule' });
  });
});

describe('listCitiesAdmin / createCity / updateCity', () => {
  it('rejects a non-admin caller for all three', async () => {
    await expect(listCitiesAdmin(ctx)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(createCity(ctx, { name: 'Pune', state: 'Maharashtra' })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(updateCity(ctx, 'city-1', { active: false })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects creating a city name that already exists', async () => {
    vi.mocked(repo.findCityByName).mockResolvedValue({ id: 'city-1' } as never);
    await expect(createCity(adminCtx, { name: 'Dhule', state: 'Maharashtra' })).rejects.toMatchObject({ code: 'city_taken' });
  });

  it('creates a new city', async () => {
    vi.mocked(repo.findCityByName).mockResolvedValue(undefined);
    vi.mocked(repo.insertCity).mockResolvedValue({ id: 'city-1', name: 'Pune', state: 'Maharashtra', active: true } as never);

    const result = await createCity(adminCtx, { name: 'Pune', state: 'Maharashtra' });

    expect(result).toMatchObject({ name: 'Pune' });
  });

  it('rejects updating a city that does not exist', async () => {
    vi.mocked(repo.findCityById).mockResolvedValue(undefined);
    await expect(updateCity(adminCtx, 'missing', { active: false })).rejects.toMatchObject({ code: 'city_not_found' });
  });

  it('retires a city instead of deleting it', async () => {
    vi.mocked(repo.findCityById).mockResolvedValue({ id: 'city-1', name: 'Dhule', active: true } as never);
    vi.mocked(repo.updateCity).mockResolvedValue({ id: 'city-1', name: 'Dhule', active: false } as never);

    const result = await updateCity(adminCtx, 'city-1', { active: false });

    expect(result).toMatchObject({ active: false });
  });
});
