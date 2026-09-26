import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TZ: z.string().default('Asia/Kolkata'),

  // auth (architecture.md §5.2)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  OTP_TTL_MIN: z.coerce.number().int().positive().default(5),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // demo code only — validated below to never be usable in production.
  OTP_DEMO_CODE: z.string().optional(),
  // TEMPORARY, until an SMS provider is wired: return each OTP in the API response so the app can
  // show it on screen. Refused in production, like OTP_DEMO_CODE.
  OTP_SHOW_IN_APP: z.enum(['true', 'false']).optional(),
}).refine((v) => v.NODE_ENV !== 'production' || !v.OTP_DEMO_CODE, {
  message: 'OTP_DEMO_CODE must not be set in production',
  path: ['OTP_DEMO_CODE'],
}).refine((v) => v.NODE_ENV !== 'production' || v.OTP_SHOW_IN_APP !== 'true', {
  message: 'OTP_SHOW_IN_APP must not be on in production',
  path: ['OTP_SHOW_IN_APP'],
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
