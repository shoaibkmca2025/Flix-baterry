import { describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('../../config/env', () => ({ env: { JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256-0123456789', ACCESS_TOKEN_TTL_MIN: 15 } }));

import { signAccessToken, signVerifiedToken, verifyAccessToken, verifyVerifiedToken } from './auth.tokens';

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
