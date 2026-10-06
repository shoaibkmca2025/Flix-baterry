import { describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('../../config/env', () => ({ env: { JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256-0123456789', ACCESS_TOKEN_TTL_MIN: 15 } }));

import { passwordFingerprint, signAccessToken, signVerifiedToken, verifyAccessToken, verifyVerifiedToken } from './auth.tokens';

const secret = new TextEncoder().encode('test-secret-that-is-long-enough-for-hs256-0123456789');

describe('access tokens', () => {
  it('round-trips a real access token', async () => {
    const t = await signAccessToken({ sub: 'u1', scope: 'dealer', role: 'dealer_manager', dealerId: 'd1' });
    await expect(verifyAccessToken(t)).resolves.toMatchObject({ sub: 'u1', scope: 'dealer', dealerId: 'd1' });
  });

  it('refuses a "verified" (OTP-proof) token used as a session, although it has the same secret', async () => {
    const verified = await signVerifiedToken({ purpose: 'register', target: '9876543210' });
    await expect(verifyAccessToken(verified)).rejects.toThrow();
  });

  it('refuses a token signed with another HMAC algorithm', async () => {
    const hs512 = await new SignJWT({ scope: 'admin', role: 'main_admin' }).setProtectedHeader({ alg: 'HS512' }).setSubject('u1').setExpirationTime('5m').sign(secret);
    await expect(verifyAccessToken(hs512)).rejects.toThrow();
  });

  it('refuses a token without an expiry', async () => {
    const forever = await new SignJWT({ scope: 'admin', role: 'main_admin' }).setProtectedHeader({ alg: 'HS256' }).setSubject('u1').sign(secret);
    await expect(verifyAccessToken(forever)).rejects.toThrow();
  });

  it('refuses an access token presented as an OTP proof', async () => {
    const access = await signAccessToken({ sub: 'u1', scope: 'admin', role: 'main_admin' });
    await expect(verifyVerifiedToken(access, 'register')).rejects.toThrow();
  });
});

/**
 * A password-reset proof is a stateless JWT: nothing marked it used, so the same one reset the
 * password twice — ten minutes apart, to two different values (QA, 6 Oct 2026).
 *
 * It is bound to the password it replaces instead. The first reset changes the password, the
 * fingerprint stops matching, and the spent proof is refused — single use, with no table to keep.
 */
describe('a reset proof is spent when it is used', () => {
  it('matches the password it was issued against, and nothing else', () => {
    const before = passwordFingerprint('$argon2id$hash-before');
    expect(passwordFingerprint('$argon2id$hash-before')).toBe(before);
    expect(passwordFingerprint('$argon2id$hash-after')).not.toBe(before);
    // an account with no password at all still gets a stable fingerprint
    expect(passwordFingerprint(null)).toBe(passwordFingerprint(undefined));
    expect(passwordFingerprint(null)).not.toBe(before);
  });

  it('is not the password hash, nor anything it can be read back from', () => {
    const hash = '$argon2id$v=19$m=65536,t=3,p=4$abcdefgh$ijklmnop';
    const fp = passwordFingerprint(hash);
    expect(fp).toHaveLength(16);
    expect(hash).not.toContain(fp);
    expect(fp).not.toContain('argon2');
  });

  it('travels in the token and comes back out of it', async () => {
    const pwv = passwordFingerprint('$argon2id$hash-before');
    const token = await signVerifiedToken({ purpose: 'reset', target: 'qa@example.com', pwv });
    await expect(verifyVerifiedToken(token, 'reset')).resolves.toMatchObject({ purpose: 'reset', target: 'qa@example.com', pwv });
  });

  it('a registration proof carries no password, because there is no account yet', async () => {
    const token = await signVerifiedToken({ purpose: 'register', target: '9822001122' });
    expect((await verifyVerifiedToken(token, 'register')).pwv).toBeUndefined();
  });
});
