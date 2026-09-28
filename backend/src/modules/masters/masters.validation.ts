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

// optional details; an empty value clears the field (stored as null)
const cleared = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
const detail = (max: number, what: string) => z.string().trim().max(max, `Keep the ${what} under ${max} characters.`).nullable().optional().transform(cleared);
const plantDetails = {
  location: detail(120, 'location'),
  contactName: detail(80, 'contact name'),
  contactPhone: z.string().trim().nullable().optional()
    .refine((v) => !v || /^\+?[\d\s-]{6,20}$/.test(v), 'Enter a phone number, e.g. 98220 12345.')
    .transform(cleared),
  notes: detail(500, 'notes'),
};

export const PlantCreateBody = z.object({ name: plantName, ...plantDetails });
export type PlantCreateBody = z.infer<typeof PlantCreateBody>;

// rename, change a detail, or switch off / back on. Deleting is its own route, for unused plants only.
export const PlantUpdateBody = z
  .object({ name: plantName.optional(), active: z.boolean().optional(), ...plantDetails })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Change the name or a detail, or switch the plant on or off.' });
export type PlantUpdateBody = z.infer<typeof PlantUpdateBody>;
