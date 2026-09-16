import { randomBytes, randomInt, createHash } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify, Algorithm } from '@node-rs/argon2';

// rules.md §7 — Argon2id, m=64 MiB, t=3.
const ARGON2_OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 65536, timeCost: 3 };

export function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTS);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2Verify(hash, password);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// Numeric OTP, e.g. otpCode(6) -> '048213'. Uses randomInt (CSPRNG), not Math.random.
export function otpCode(length = 6): string {
  const max = 10 ** length;
  return String(randomInt(0, max)).padStart(length, '0');
}

// OTPs are short-lived, high-entropy, and rate-limited (rules.md §7) — a plain sha256
// (no per-record salt) is sufficient here and keeps lookup-by-hash simple.
export function hashOtp(code: string): string {
  return sha256(code);
}
