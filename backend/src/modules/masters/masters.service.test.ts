import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({
  db: {},
  withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));
vi.mock('../../utils/settings', () => ({ graceMonths: vi.fn(async () => 2), serialDigitLengths: vi.fn(async () => [7, 8]) }));
vi.mock('../batteries/batteries.repository', () => ({ listModels: vi.fn(async () => [{ id: 'M5', family: 'M', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24, active: true }]) }));

vi.mock('./masters.repository', () => ({
  listCities: vi.fn(),
  listPlateTypes: vi.fn(async () => [{ code: 'M', label: 'M plates', sortOrder: 1, active: true }, { code: 'X', label: 'old', sortOrder: 9, active: false }]),
  findCityById: vi.fn(),
  findCityByName: vi.fn(),
  insertCity: vi.fn(),
  updateCity: vi.fn(),
  listPlants: vi.fn(async () => []),
  findPlantById: vi.fn(),
  findPlantByName: vi.fn(),
  countActivePlants: vi.fn(),
  insertPlant: vi.fn(),
  updatePlant: vi.fn(),
  countPlantUse: vi.fn(),
  deletePlant: vi.fn(),
}));

import { audit } from '../../utils/audit';
import * as repo from './masters.repository';
import { bundle, createCity, createPlant, deletePlant, listCitiesAdmin, listPlantsAdmin, updateCity, updatePlant } from './masters.service';
import { PlantCreateBody, PlantUpdateBody } from './masters.validation';
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
    expect(result.plateTypes).toEqual([expect.objectContaining({ code: 'M' })]); // active plate types only
    expect(result.warrantyGraceMonths).toBe(2);
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

describe('plants (D-19) — head office keeps its own list', () => {
  const main = { id: 'p-1', name: 'Main plant', active: true, createdAt: new Date(), updatedAt: new Date() };
  const branch = { id: 'p-2', name: 'Branch 1', active: true, createdAt: new Date(), updatedAt: new Date() };

  it('the bundle carries every plant, switched-off ones flagged, so old tags still have a name', async () => {
    vi.mocked(repo.listCities).mockResolvedValue([] as never);
    vi.mocked(repo.listPlants).mockResolvedValue([main, { ...branch, active: false }] as never);
    const result = await bundle();
    expect(result.plants).toEqual([{ id: 'p-1', name: 'Main plant', active: true }, { id: 'p-2', name: 'Branch 1', active: false }]);
  });

  it('only an admin can list, add or change plants', async () => {
    await expect(listPlantsAdmin(ctx)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(createPlant(ctx, { name: 'Sinnar' })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(updatePlant(ctx, 'p-1', { name: 'Sinnar' })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('adds a plant, audited', async () => {
    vi.mocked(repo.findPlantByName).mockResolvedValue(null as never);
    vi.mocked(repo.insertPlant).mockResolvedValue({ ...branch, id: 'p-9', name: 'Sinnar' } as never);
    const r = await createPlant(adminCtx, { name: 'Sinnar' });
    expect(r.name).toBe('Sinnar');
    expect(vi.mocked(audit).mock.calls[0]?.[1]).toMatchObject({ action: 'master.updated', entityType: 'plant', entityRef: 'Sinnar' });
  });

  it('refuses a second plant with the same name, whatever the capitals', async () => {
    vi.mocked(repo.findPlantByName).mockResolvedValue(branch as never);
    await expect(createPlant(adminCtx, { name: 'branch 1' })).rejects.toMatchObject({ code: 'plant_taken', status: 409, message: 'There is already a plant called Branch 1.' });
    expect(repo.insertPlant).not.toHaveBeenCalled();
  });

  it('renames a plant; the name check ignores the plant being renamed', async () => {
    vi.mocked(repo.findPlantById).mockResolvedValue(branch as never);
    vi.mocked(repo.findPlantByName).mockResolvedValue(null as never);
    vi.mocked(repo.updatePlant).mockResolvedValue({ ...branch, name: 'Sinnar plant' } as never);
    const r = await updatePlant(adminCtx, 'p-2', { name: 'Sinnar plant' });
    expect(r.name).toBe('Sinnar plant');
    expect(repo.findPlantByName).toHaveBeenCalledWith(expect.anything(), 'Sinnar plant', 'p-2');
    expect(vi.mocked(audit).mock.calls[0]?.[1]).toMatchObject({ before: { name: 'Branch 1' }, after: { name: 'Sinnar plant' } });
  });

  it('switches a plant off rather than deleting it', async () => {
    vi.mocked(repo.findPlantById).mockResolvedValue(branch as never);
    vi.mocked(repo.countActivePlants).mockResolvedValue(4);
    vi.mocked(repo.updatePlant).mockResolvedValue({ ...branch, active: false } as never);
    expect((await updatePlant(adminCtx, 'p-2', { active: false })).active).toBe(false);
  });

  it('will not switch off the last plant that is on — nothing could arrive after that', async () => {
    vi.mocked(repo.findPlantById).mockResolvedValue(main as never);
    vi.mocked(repo.countActivePlants).mockResolvedValue(1);
    await expect(updatePlant(adminCtx, 'p-1', { active: false })).rejects.toMatchObject({ code: 'last_active_plant', status: 409 });
    expect(repo.updatePlant).not.toHaveBeenCalled();
  });

  it('404 for a plant that does not exist', async () => {
    vi.mocked(repo.findPlantById).mockResolvedValue(null as never);
    await expect(updatePlant(adminCtx, 'nope', { name: 'X plant' })).rejects.toMatchObject({ code: 'plant_not_found', status: 404 });
  });

  it('validation: a name is needed, and an edit must change something', () => {
    expect(PlantCreateBody.safeParse({ name: ' ' }).success).toBe(false);
    expect(PlantUpdateBody.safeParse({}).success).toBe(false);
    expect(PlantUpdateBody.safeParse({ active: false }).success).toBe(true);
  });

  it('keeps the details; an empty detail clears it, a bad phone is refused', () => {
    const full = PlantCreateBody.parse({ name: 'Sinnar plant', location: ' MIDC, Sinnar ', contactName: 'R. Patil', contactPhone: '98220 12345', notes: 'Night shift only' });
    expect(full).toMatchObject({ location: 'MIDC, Sinnar', contactName: 'R. Patil', contactPhone: '98220 12345', notes: 'Night shift only' });
    expect(PlantUpdateBody.parse({ location: '' })).toEqual({ location: null });
    expect(PlantUpdateBody.parse({ notes: 'Moved' })).toEqual({ notes: 'Moved' });
    expect(PlantUpdateBody.safeParse({ contactPhone: 'call me' }).success).toBe(false);
  });

  it('the public bundle never carries the contact details', async () => {
    vi.mocked(repo.listCities).mockResolvedValue([] as never);
    vi.mocked(repo.listPlants).mockResolvedValue([{ ...main, location: 'Nashik', contactName: 'R. Patil', contactPhone: '9822012345', notes: 'x' }] as never);
    expect((await bundle()).plants).toStrictEqual([{ id: 'p-1', name: 'Main plant', active: true }]);
  });

  describe('deletePlant', () => {
    it('deletes a plant nothing is counted under, audited', async () => {
      vi.mocked(repo.findPlantById).mockResolvedValue(branch as never);
      vi.mocked(repo.countPlantUse).mockResolvedValue(0);
      vi.mocked(repo.countActivePlants).mockResolvedValue(4);
      expect(await deletePlant(adminCtx, 'p-2')).toEqual({ id: 'p-2', deleted: true });
      expect(repo.deletePlant).toHaveBeenCalledWith(expect.anything(), 'p-2');
      expect(vi.mocked(audit).mock.calls[0]?.[1]).toMatchObject({ action: 'master.deleted', entityType: 'plant', entityRef: 'Branch 1', before: { name: 'Branch 1' } });
    });

    it('refuses a plant with batteries under it, and says to switch it off', async () => {
      vi.mocked(repo.findPlantById).mockResolvedValue(branch as never);
      vi.mocked(repo.countPlantUse).mockResolvedValue(12);
      await expect(deletePlant(adminCtx, 'p-2')).rejects.toMatchObject({ code: 'plant_in_use', status: 409, message: expect.stringContaining('Branch 1 has 12 batteries counted under it') });
      expect(repo.deletePlant).not.toHaveBeenCalled();
    });

    it('a battery tagged at the same moment still stops it (foreign key)', async () => {
      vi.mocked(repo.findPlantById).mockResolvedValue(branch as never);
      vi.mocked(repo.countPlantUse).mockResolvedValue(0);
      vi.mocked(repo.countActivePlants).mockResolvedValue(4);
      vi.mocked(repo.deletePlant).mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }) as never);
      await expect(deletePlant(adminCtx, 'p-2')).rejects.toMatchObject({ code: 'plant_in_use', status: 409 });
    });

    it('will not delete the last plant that is on', async () => {
      vi.mocked(repo.findPlantById).mockResolvedValue(main as never);
      vi.mocked(repo.countPlantUse).mockResolvedValue(0);
      vi.mocked(repo.countActivePlants).mockResolvedValue(1);
      await expect(deletePlant(adminCtx, 'p-1')).rejects.toMatchObject({ code: 'last_active_plant', status: 409 });
    });

    it('needs an admin, and 404s for a plant that does not exist', async () => {
      await expect(deletePlant(ctx, 'p-2')).rejects.toMatchObject({ code: 'unauthenticated' });
      vi.mocked(repo.findPlantById).mockResolvedValue(null as never);
      await expect(deletePlant(adminCtx, 'nope')).rejects.toMatchObject({ code: 'plant_not_found', status: 404 });
    });
  });
});
