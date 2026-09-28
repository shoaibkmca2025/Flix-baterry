import { z } from 'zod';

export const CityCreateBody = z.object({
  name: z.string().trim().min(1, 'Enter a city name.'),
  state: z.string().trim().min(1, 'Enter a state.'),
});
export type CityCreateBody = z.infer<typeof CityCreateBody>;

export const CityUpdateBody = z.object({
  name: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
});
export type CityUpdateBody = z.infer<typeof CityUpdateBody>;

// ---- plants (D-19)
const plantName = z.string().trim().min(2, 'Enter the plant name.').max(60, 'Keep the plant name under 60 characters.');

export const PlantCreateBody = z.object({ name: plantName });
export type PlantCreateBody = z.infer<typeof PlantCreateBody>;

// rename, or switch off / back on. There is no delete: tagged batteries keep pointing at a plant.
export const PlantUpdateBody = z
  .object({ name: plantName.optional(), active: z.boolean().optional() })
  .refine((b) => b.name !== undefined || b.active !== undefined, { message: 'Change the name, or switch the plant on or off.' });
export type PlantUpdateBody = z.infer<typeof PlantUpdateBody>;
