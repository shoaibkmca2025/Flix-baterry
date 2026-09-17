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
}));

import * as repo from './auth.repository';
import { loginWithPassword, requestOtp, verifyOtp } from './auth.service';
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

    const result = await requestOtp(ctx, { target: '9876543210', purpose: 'login' });

    expect(result).toEqual({ challengeId: 'chal-1', resendAfter: 30 });
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

  // Regression: requestOtp used to only attach a userId to the challenge for purposes
  // 'login'/'reset', leaving admin_2fa challenges with userId: null — so a correct 2FA
  // code still failed verifyOtp's "!challenge.userId" check. Found manually against a
  // real database; this test would have caught it without needing one.
  it('a correct password creates a 2FA challenge carrying the admin userId, and the right code then signs them in', async () => {
    const passwordHash = await hashPassword('Password123');
    vi.mocked(repo.countRecentBadLogins).mockResolvedValue(0);
    vi.mocked(repo.countRecentOtpChallenges).mockResolvedValue(0);
    vi.mocked(repo.findUserByEmail).mockResolvedValue({ id: 'admin-1', scope: 'admin', role: 'main_admin', status: 'active', passwordHash } as never);
    vi.mocked(repo.insertOtpChallenge).mockResolvedValue({ id: 'chal-2fa' } as never);

    await loginWithPassword(ctx, { email: 'admin@example.com', password: 'Password123' });

    expect(repo.insertOtpChallenge).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'admin-1', purpose: 'admin_2fa' }));

    vi.mocked(repo.findOtpChallenge).mockResolvedValue({
      id: 'chal-2fa', purpose: 'admin_2fa', target: 'admin@example.com', codeHash: hashOtp('123456'), userId: 'admin-1',
      attempts: 0, maxAttempts: 5, expiresAt: new Date('2026-09-16T10:10:00Z'), consumedAt: null,
    } as never);
    vi.mocked(repo.findUserById).mockResolvedValue({ id: 'admin-1', scope: 'admin', role: 'main_admin', dealerId: null, status: 'active', name: 'Admin' } as never);
    vi.mocked(repo.insertSession).mockResolvedValue({ id: 'session-1' } as never);

    const result = await verifyOtp(ctx, { challengeId: 'chal-2fa', code: '123456' });

    expect(result).toHaveProperty('accessToken');
  });
});
