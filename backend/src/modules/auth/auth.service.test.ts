import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({
  db: {},
  withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));

vi.mock('./auth.repository', () => ({
  countRecentOtpChallenges: vi.fn(),
  insertOtpChallenge: vi.fn(),
  findOtpChallenge: vi.fn(),
  incrementOtpAttempts: vi.fn(),
  consumeOtpChallenge: vi.fn(),
  findUserById: vi.fn(),
  findUserByMobile: vi.fn(),
  findUserByEmail: vi.fn(),
  findDealerById: vi.fn(),
  insertSession: vi.fn(),
  updateUserLastLogin: vi.fn(),
  updateUserPasswordHash: vi.fn(),
  revokeAllSessionsForUser: vi.fn(),
  insertLoginAttempt: vi.fn(),
  countRecentBadLogins: vi.fn(),
  findSessionByRefreshHash: vi.fn(),
  revokeSession: vi.fn(),
  revokeSessionFamily: vi.fn(),
}));

import * as repo from './auth.repository';
import { loginWithPassword, refresh, requestOtp, verifyOtp } from './auth.service';
import { hashOtp, hashPassword } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import type { Ctx } from '../../utils/context';

const ctx: Ctx = {
  user: null,
  request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' },
  now: () => new Date('2026-09-16T10:00:00Z'),
};

beforeEach(() => vi.clearAllMocks());

describe('requestOtp', () => {
  it('creates a challenge and returns a challengeId (same shape whether or not the target exists)', async () => {
    vi.mocked(repo.countRecentOtpChallenges).mockResolvedValue(0);
    vi.mocked(repo.findUserByMobile).mockResolvedValue(undefined);
    vi.mocked(repo.insertOtpChallenge).mockResolvedValue({ id: 'chal-1' } as never);

    const unknown = await requestOtp(ctx, { target: '9876543210', purpose: 'login' });
    vi.mocked(repo.findUserByMobile).mockResolvedValue({ id: 'user-1', status: 'active' } as never);
    const known = await requestOtp(ctx, { target: '9876543210', purpose: 'login' });

    expect(unknown).toMatchObject({ challengeId: 'chal-1', resendAfter: 30 });
    // no account enumeration: a registered and an unknown number get the same response shape
    // (with the temporary OTP_SHOW_IN_APP switch on, both carry a devCode)
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());
  });

  it('rejects once the rate limit is hit', async () => {
    vi.mocked(repo.countRecentOtpChallenges).mockResolvedValue(5);
    await expect(requestOtp(ctx, { target: '9876543210', purpose: 'login' })).rejects.toThrow(AppError);
  });
});

describe('verifyOtp', () => {
  const baseChallenge = {
    id: 'chal-1',
    purpose: 'login' as const,
    target: '9876543210',
    codeHash: hashOtp('654321'),
    userId: 'user-1',
    attempts: 0,
    maxAttempts: 5,
    expiresAt: new Date('2026-09-16T10:10:00Z'),
    consumedAt: null,
  };

  it('rejects a wrong code and increments attempts', async () => {
    vi.mocked(repo.findOtpChallenge).mockResolvedValue(baseChallenge as never);

    await expect(verifyOtp(ctx, { challengeId: 'chal-1', code: '000000' })).rejects.toThrow('That code is not right');
    expect(repo.incrementOtpAttempts).toHaveBeenCalledWith(expect.anything(), 'chal-1', 1);
  });

  it('an unregistered number with the RIGHT code is told it is not registered (404 not_registered)', async () => {
    vi.mocked(repo.findOtpChallenge).mockResolvedValue({ ...baseChallenge, userId: null } as never);
    await expect(verifyOtp(ctx, { challengeId: 'chal-1', code: '654321' })).rejects.toMatchObject({ code: 'not_registered', status: 404, nextAction: 'register' });
  });

  it('an unregistered number with a WRONG code gets the same "not right" as anyone (no probing)', async () => {
    vi.mocked(repo.findOtpChallenge).mockResolvedValue({ ...baseChallenge, userId: null } as never);
    await expect(verifyOtp(ctx, { challengeId: 'chal-1', code: '000000' })).rejects.toMatchObject({ code: 'invalid_otp' });
  });

  it('rejects an expired challenge', async () => {
    vi.mocked(repo.findOtpChallenge).mockResolvedValue({ ...baseChallenge, expiresAt: new Date('2020-01-01') } as never);
    await expect(verifyOtp(ctx, { challengeId: 'chal-1', code: '654321' })).rejects.toThrow('expired');
  });

  it('refuses a code beyond max attempts, even if correct', async () => {
    vi.mocked(repo.findOtpChallenge).mockResolvedValue({ ...baseChallenge, attempts: 5 } as never);
    await expect(verifyOtp(ctx, { challengeId: 'chal-1', code: '654321' })).rejects.toThrow('Too many wrong attempts');
  });

  it('issues tokens for a correct login code and an active dealer', async () => {
    vi.mocked(repo.findOtpChallenge).mockResolvedValue(baseChallenge as never);
    vi.mocked(repo.findUserById).mockResolvedValue({
      id: 'user-1',
      scope: 'dealer',
      role: 'dealer_user',
      dealerId: 'dealer-1',
      status: 'active',
      name: 'Test Dealer',
    } as never);
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'dealer-1', status: 'active', name: 'Felix Power Point' } as never);
    vi.mocked(repo.insertSession).mockResolvedValue({ id: 'session-1' } as never);

    const result = (await verifyOtp(ctx, { challengeId: 'chal-1', code: '654321' })) as {
      accessToken: string;
      refreshToken: string;
      user: { id: string; name: string };
    };

    expect(result.accessToken).toBeTypeOf('string');
    expect(result.refreshToken).toBeTypeOf('string');
    expect(result.user).toMatchObject({ id: 'user-1', name: 'Test Dealer' });
    expect(repo.consumeOtpChallenge).toHaveBeenCalledWith(expect.anything(), 'chal-1');
  });

  it('blocks sign-in when the dealer is suspended, even with the right code, and tells the app why', async () => {
    vi.mocked(repo.findOtpChallenge).mockResolvedValue(baseChallenge as never);
    vi.mocked(repo.findUserById).mockResolvedValue({ id: 'user-1', scope: 'dealer', role: 'dealer_user', dealerId: 'dealer-1', status: 'active' } as never);
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'dealer-1', status: 'suspended', statusReason: 'GST mismatch' } as never);

    await expect(verifyOtp(ctx, { challengeId: 'chal-1', code: '654321' })).rejects.toMatchObject({
      code: 'dealer_not_active',
      details: { status: 'suspended' },
    });
  });

  it('blocks sign-in for a pending dealer distinctly, so the app can route to the pending screen', async () => {
    vi.mocked(repo.findOtpChallenge).mockResolvedValue(baseChallenge as never);
    vi.mocked(repo.findUserById).mockResolvedValue({ id: 'user-1', scope: 'dealer', role: 'dealer_user', dealerId: 'dealer-1', status: 'active' } as never);
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'dealer-1', status: 'pending_approval' } as never);

    await expect(verifyOtp(ctx, { challengeId: 'chal-1', code: '654321' })).rejects.toMatchObject({
      code: 'dealer_not_active',
      details: { status: 'pending_approval' },
    });
  });

  it('hands back a verifiedToken (not tokens) for a register-purpose challenge', async () => {
    vi.mocked(repo.findOtpChallenge).mockResolvedValue({ ...baseChallenge, purpose: 'register', userId: null } as never);

    const result = await verifyOtp(ctx, { challengeId: 'chal-1', code: '654321' });

    expect(result).toHaveProperty('verifiedToken');
    expect(result).not.toHaveProperty('accessToken');
  });
});

describe('loginWithPassword', () => {
  it('rejects with one generic message whether the email is unknown or the password is wrong', async () => {
    vi.mocked(repo.countRecentBadLogins).mockResolvedValue(0);
    vi.mocked(repo.findUserByEmail).mockResolvedValue(undefined);

    await expect(loginWithPassword(ctx, { email: 'admin@example.com', password: 'wrong' })).rejects.toThrow('not right');
  });

  it('locks out after too many recent bad attempts', async () => {
    vi.mocked(repo.countRecentBadLogins).mockResolvedValue(10);
    await expect(loginWithPassword(ctx, { email: 'admin@example.com', password: 'x' })).rejects.toThrow('Too many failed attempts');
  });

  // Client, 28 Sep 2026 (memory.md D-21): head office signs in with the password alone.
  it('a correct password signs the admin in at once — no two-step code is sent', async () => {
    const passwordHash = await hashPassword('Password123');
    vi.mocked(repo.countRecentBadLogins).mockResolvedValue(0);
    vi.mocked(repo.findUserByEmail).mockResolvedValue({ id: 'admin-1', name: 'S. Deshpande', scope: 'admin', role: 'main_admin', dealerId: null, status: 'active', passwordHash } as never);
    vi.mocked(repo.insertSession).mockResolvedValue({ id: 'session-1' } as never);

    const result = await loginWithPassword(ctx, { email: 'admin@example.com', password: 'Password123' });

    expect(result).toMatchObject({ user: { id: 'admin-1', scope: 'admin', role: 'main_admin' }, dealer: null });
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(repo.insertOtpChallenge).not.toHaveBeenCalled();
    expect(repo.insertLoginAttempt).toHaveBeenCalledWith(expect.anything(), 'admin@example.com', expect.anything(), 'ok');
    expect(repo.updateUserLastLogin).toHaveBeenCalledWith(expect.anything(), 'admin-1');
  });

  it('a dealer account cannot use the admin password sign-in', async () => {
    const passwordHash = await hashPassword('Password123');
    vi.mocked(repo.countRecentBadLogins).mockResolvedValue(0);
    vi.mocked(repo.findUserByEmail).mockResolvedValue({ id: 'u-9', scope: 'dealer', role: 'dealer_manager', status: 'active', passwordHash } as never);
    await expect(loginWithPassword(ctx, { email: 'dealer@example.com', password: 'Password123' })).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(repo.insertSession).not.toHaveBeenCalled();
  });

  it('a switched-off admin is refused even with the right password', async () => {
    const passwordHash = await hashPassword('Password123');
    vi.mocked(repo.countRecentBadLogins).mockResolvedValue(0);
    vi.mocked(repo.findUserByEmail).mockResolvedValue({ id: 'admin-2', scope: 'admin', role: 'operations', status: 'suspended', passwordHash } as never);
    await expect(loginWithPassword(ctx, { email: 'ops@example.com', password: 'Password123' })).rejects.toMatchObject({ code: 'user_blocked' });
    expect(repo.insertSession).not.toHaveBeenCalled();
  });
});

describe('refresh (rotating refresh tokens)', () => {
  const rctx = { user: null, request: { id: 'req-9', ip: '127.0.0.1' }, now: () => new Date('2026-09-26T12:00:00Z') } as unknown as Ctx;
  const live = { id: 'sess-1', userId: 'user-1', familyId: 'fam-1', deviceId: 'dev-1', revokedAt: null, expiresAt: new Date('2026-10-20T00:00:00Z') };

  it('swaps a live refresh token for a new pair and revokes the old one as rotated', async () => {
    vi.mocked(repo.findSessionByRefreshHash).mockResolvedValue(live as never);
    vi.mocked(repo.findUserById).mockResolvedValue({ id: 'user-1', status: 'active', scope: 'admin', role: 'main_admin', dealerId: null } as never);
    vi.mocked(repo.insertSession).mockResolvedValue({ id: 'sess-2' } as never);

    const r = await refresh(rctx, { refreshToken: 'x'.repeat(40) });

    expect(r.accessToken).toBeTruthy();
    expect(r.refreshToken).toBeTruthy();
    expect(repo.insertSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'user-1', familyId: 'fam-1' }));
    expect(repo.revokeSession).toHaveBeenCalledWith(expect.anything(), 'sess-1', 'rotated', 'sess-2');
  });

  it('a reused (already rotated) token revokes the whole family and is refused', async () => {
    vi.mocked(repo.findSessionByRefreshHash).mockResolvedValue({ ...live, revokedAt: new Date() } as never);
    await expect(refresh(rctx, { refreshToken: 'x'.repeat(40) })).rejects.toMatchObject({ code: 'session_invalid', status: 401 });
    expect(repo.revokeSessionFamily).toHaveBeenCalledWith(expect.anything(), 'fam-1', 'refresh_token_reused');
    expect(repo.insertSession).not.toHaveBeenCalled();
  });

  it('refuses an unknown or expired refresh token', async () => {
    vi.mocked(repo.findSessionByRefreshHash).mockResolvedValue(undefined as never);
    await expect(refresh(rctx, { refreshToken: 'x'.repeat(40) })).rejects.toMatchObject({ code: 'session_invalid' });
    vi.mocked(repo.findSessionByRefreshHash).mockResolvedValue({ ...live, expiresAt: new Date('2026-09-01T00:00:00Z') } as never);
    await expect(refresh(rctx, { refreshToken: 'x'.repeat(40) })).rejects.toMatchObject({ code: 'session_expired' });
  });

  it('refuses a blocked user and a suspended dealer', async () => {
    vi.mocked(repo.findSessionByRefreshHash).mockResolvedValue(live as never);
    vi.mocked(repo.findUserById).mockResolvedValue({ id: 'user-1', status: 'temporarily_blocked' } as never);
    await expect(refresh(rctx, { refreshToken: 'x'.repeat(40) })).rejects.toMatchObject({ code: 'user_blocked' });
    vi.mocked(repo.findUserById).mockResolvedValue({ id: 'user-1', status: 'active', scope: 'dealer', role: 'dealer_manager', dealerId: 'd-1' } as never);
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'd-1', status: 'suspended' } as never);
    await expect(refresh(rctx, { refreshToken: 'x'.repeat(40) })).rejects.toMatchObject({ code: 'dealer_not_active' });
  });
});
