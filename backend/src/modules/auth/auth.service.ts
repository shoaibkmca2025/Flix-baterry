import { db, withTransaction, type Tx } from '../../database/client';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { hashOtp, hashPassword, otpCode, verifyPassword } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { env } from '../../config/env';
import * as repo from './auth.repository';
import { newFamilyId, newRefreshToken, signAccessToken, signVerifiedToken, verifyVerifiedToken } from './auth.tokens';
import type { AdminLoginBody, OtpVerifyBody, PasswordResetBody } from './auth.validation';

// requestOtp is also called internally for 'admin_2fa', which a client never requests
// directly (auth.validation.OtpRequestBody deliberately excludes it from the public schema).
type RequestOtpInput = { target: string; purpose: 'login' | 'register' | 'reset' | 'verify_mobile' | 'admin_2fa'; deviceId?: string };

const RATE_LIMIT_WINDOW_MIN = 15;
const RATE_LIMIT_MAX = 5;
const LOCKOUT_WINDOW_MIN = 15;
const LOCKOUT_MAX_BAD_PASSWORDS = 10;

// Stand-in for a real SMS/email provider (architecture.md §5.2 SMS_PROVIDER=msg91|console).
// Deliberately console.log, not the pino logger — the logger redacts otp/mobile/email
// (utils/logger.ts REDACT_PATHS), which would defeat the point of a dev-visible code.
function sendOtp(target: string, purpose: string, code: string) {
  console.log(`[otp:console-adapter] purpose=${purpose} target=${target} code=${code}`);
}

async function assertNotRateLimited(target: string, purpose: string, now: Date) {
  const since = new Date(now.getTime() - RATE_LIMIT_WINDOW_MIN * 60_000);
  const count = await repo.countRecentOtpChallenges(db, target, purpose, since);
  if (count >= RATE_LIMIT_MAX) {
    throw new AppError('rate_limited', 429, 'Too many codes requested. Try again in a few minutes.', {
      nextAction: `Wait a few minutes before requesting another code.`,
    });
  }
}

export async function requestOtp(ctx: Ctx, input: RequestOtpInput) {
  const now = ctx.now();
  await assertNotRateLimited(input.target, input.purpose, now);

  // login/reset/admin_2fa need an existing user; register/verify_mobile don't (no dealer
  // exists yet). Missing 'admin_2fa' here was a real bug: the 2FA challenge would be
  // created with no userId, so a correct code still failed verifyOtp's `!challenge.userId` check.
  const user =
    input.purpose === 'login' || input.purpose === 'reset' || input.purpose === 'admin_2fa'
      ? input.target.includes('@')
        ? await repo.findUserByEmail(db, input.target)
        : await repo.findUserByMobile(db, input.target)
      : null;

  // architecture.md §7.2 — same response whether or not the target exists, to avoid
  // revealing which mobiles/emails are registered.
  const code = env.NODE_ENV !== 'production' && env.OTP_DEMO_CODE ? env.OTP_DEMO_CODE : otpCode(env.OTP_LENGTH);
  const expiresAt = new Date(now.getTime() + env.OTP_TTL_MIN * 60_000);

  const challenge = await withTransaction(async (tx) => {
    const row = await repo.insertOtpChallenge(tx, {
      purpose: input.purpose,
      target: input.target,
      codeHash: hashOtp(code),
      userId: user?.id ?? null,
      maxAttempts: env.OTP_MAX_ATTEMPTS,
      expiresAt,
      createdIp: ctx.request.ip,
    });
    await audit(tx, { ctx, action: 'auth.otp_requested', entityType: 'otp_challenge', entityId: row.id, outcome: 'ok' });
    return row;
  });

  sendOtp(input.target, input.purpose, code);

  return { challengeId: challenge.id, resendAfter: 30 };
}

async function loadChallengeForVerify(challengeId: string, code: string, ctx: Ctx) {
  const challenge = await repo.findOtpChallenge(db, challengeId);
  if (!challenge || challenge.consumedAt || challenge.expiresAt < ctx.now()) {
    throw new AppError('otp_expired', 422, 'This code has expired. Request a new one.');
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    throw new AppError('too_many_attempts', 429, 'Too many wrong attempts. Request a new code.');
  }
  if (hashOtp(code) !== challenge.codeHash) {
    await withTransaction(async (tx) => {
      await repo.incrementOtpAttempts(tx, challenge.id, challenge.attempts + 1);
      await audit(tx, { ctx, action: 'auth.otp_failed', entityType: 'otp_challenge', entityId: challenge.id, outcome: 'denied' });
    });
    throw new AppError('invalid_otp', 422, 'That code is not right. Check the SMS and try again.', { field: 'code' });
  }
  return challenge;
}

async function issueTokens(
  tx: Tx,
  user: { id: string; scope: 'dealer' | 'admin'; role: string; dealerId: string | null },
  deviceId: string | undefined,
  ctx: Ctx,
  familyId?: string,
) {
  const accessToken = await signAccessToken({ sub: user.id, scope: user.scope, role: user.role, dealerId: user.dealerId ?? undefined });
  const { token: refreshToken, hash } = newRefreshToken();
  await repo.insertSession(tx, {
    userId: user.id,
    refreshHash: hash,
    familyId: familyId ?? newFamilyId(),
    deviceId: deviceId ?? null,
    userAgent: ctx.request.userAgent ?? null,
    ip: ctx.request.ip,
    expiresAt: new Date(ctx.now().getTime() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  return { accessToken, refreshToken };
}

export async function verifyOtp(ctx: Ctx, input: OtpVerifyBody) {
  const challenge = await loadChallengeForVerify(input.challengeId, input.code, ctx);

  if (challenge.purpose === 'login' || challenge.purpose === 'admin_2fa') {
    if (!challenge.userId) {
      throw new AppError('invalid_otp', 422, 'That code is not right. Check the SMS and try again.', { field: 'code' });
    }
    const user = await repo.findUserById(db, challenge.userId);
    if (!user || user.status !== 'active') {
      throw new AppError('user_blocked', 403, 'This account is not active.');
    }
    let dealer = null;
    if (user.dealerId) {
      dealer = await repo.findDealerById(db, user.dealerId);
      if (!dealer) {
        throw new AppError('dealer_suspended', 403, 'This shop is not active. Contact Felix Batteries head office.');
      }
      // status is in `details` so the app can route (pending -> d05, suspended/rejected -> a message)
      // instead of every non-active dealer landing on one generic error.
      if (dealer.status !== 'active') {
        throw new AppError('dealer_not_active', 403, `This shop is ${dealer.status.replace('_', ' ')}.`, {
          details: { status: dealer.status, dealerId: dealer.id, reason: dealer.statusReason },
        });
      }
    }

    const tokens = await withTransaction(async (tx) => {
      await repo.consumeOtpChallenge(tx, challenge.id);
      const t = await issueTokens(tx, { id: user.id, scope: user.scope, role: user.role, dealerId: user.dealerId }, input.deviceId, ctx);
      await repo.updateUserLastLogin(tx, user.id);
      await audit(tx, { ctx, action: 'auth.signed_in', entityType: 'user', entityId: user.id, outcome: 'ok' });
      return t;
    });

    return { ...tokens, user: { id: user.id, name: user.name, scope: user.scope, role: user.role }, dealer };
  }

  // register / verify_mobile / reset — prove the OTP was checked, hand back a short-lived
  // token the next step (dealers.register, auth.resetPassword) redeems.
  await withTransaction((tx) => repo.consumeOtpChallenge(tx, challenge.id));
  const verifiedToken = await signVerifiedToken({ purpose: challenge.purpose as 'register' | 'reset' | 'verify_mobile', target: challenge.target });
  return { verifiedToken };
}

export async function loginWithPassword(ctx: Ctx, input: AdminLoginBody) {
  const now = ctx.now();
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MIN * 60_000);
  const badCount = await repo.countRecentBadLogins(db, input.email, since);
  if (badCount >= LOCKOUT_MAX_BAD_PASSWORDS) {
    throw new AppError('account_locked', 423, 'Too many failed attempts. Try again later.');
  }

  const user = await repo.findUserByEmail(db, input.email);
  const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, input.password) : false;

  if (!user || user.scope !== 'admin' || !ok) {
    await withTransaction((tx) => repo.insertLoginAttempt(tx, input.email, ctx.request.ip, 'bad_password'));
    // same message whether the email exists or the password was wrong (rules.md — no enumeration).
    throw new AppError('invalid_credentials', 401, 'That email or password is not right.');
  }
  if (user.status !== 'active') {
    throw new AppError('user_blocked', 403, 'This account is not active.');
  }

  await withTransaction((tx) => repo.insertLoginAttempt(tx, input.email, ctx.request.ip, 'ok'));
  return requestOtp(ctx, { target: input.email, purpose: 'admin_2fa' });
}

export async function forgotPassword(ctx: Ctx, email: string) {
  return requestOtp(ctx, { target: email, purpose: 'reset' });
}

export async function resetPassword(ctx: Ctx, input: PasswordResetBody) {
  const claims = await verifyVerifiedToken(input.verifiedToken, 'reset').catch(() => {
    throw new AppError('verified_token_invalid', 401, 'This link has expired. Start the reset again.');
  });

  const user = claims.target.includes('@') ? await repo.findUserByEmail(db, claims.target) : await repo.findUserByMobile(db, claims.target);
  if (!user) {
    throw new AppError('verified_token_invalid', 401, 'This link has expired. Start the reset again.');
  }

  const passwordHash = await hashPassword(input.newPassword);
  await withTransaction(async (tx) => {
    await repo.updateUserPasswordHash(tx, user.id, passwordHash);
    await repo.revokeAllSessionsForUser(tx, user.id, 'password_reset');
    await audit(tx, { ctx, action: 'auth.password_changed', entityType: 'user', entityId: user.id, outcome: 'ok' });
  });

  return { ok: true as const };
}
