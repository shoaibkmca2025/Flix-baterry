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
