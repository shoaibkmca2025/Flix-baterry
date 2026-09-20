import { randomBytes, randomInt, createHash } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

// rules.md §7 — Argon2id, m=64 MiB, t=3. hash-wasm (WebAssembly, no native binary) so the
// same code runs on the local server and inside the bundled Neon Function. Output is the
// standard PHC string ($argon2id$v=19$m=65536,t=3,p=1$…), so hashes made earlier by
// @node-rs/argon2 still verify.
const ARGON2_OPTS = { parallelism: 1, iterations: 3, memorySize: 65536, hashLength: 32, outputType: 'encoded' as const };

export function hashPassword(password: string): Promise<string> {
  return argon2id({ password, salt: randomBytes(16), ...ARGON2_OPTS });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false; // malformed / non-argon2 hash — treat as no match, never as an error
  }
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
