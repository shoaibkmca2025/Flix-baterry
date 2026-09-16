import pino from 'pino';
import { env } from '../config/env';

// rules.md §7 / logs.md Part B.1 — never log these, even by accident.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'password',
  'otp',
  'code',
  'accessToken',
  'refreshToken',
  'mobile',
  'email',
  'customer',
  'gps',
  'signature',
];

// Plain options object — pass this to Fastify's own `logger` option so Fastify builds the
// pino instance itself (avoids cross-version pino type friction with Fastify's bundled types).
export const loggerOptions = {
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
};

// Standalone instance for logging outside a request (startup, worker, jobs).
export const logger = pino(loggerOptions);
