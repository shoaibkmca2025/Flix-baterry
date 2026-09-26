import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../config/env';
import { randomToken, sha256 } from '../../utils/crypto';

const secret = new TextEncoder().encode(env.JWT_SECRET);

export type AccessTokenClaims = {
  sub: string; // user id
  scope: 'dealer' | 'admin';
  role: string;
  dealerId?: string;
};

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ scope: claims.scope, role: claims.role, dealerId: claims.dealerId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_MIN}m`)
    .sign(secret);
}

// jose docs: pin the algorithm and the claims a token must carry. Only HS256 is ever signed here,
// and every access token has sub + exp — so a "verified" token (same secret, no sub) or any
// token with another alg is refused instead of being read as a session.
const ACCESS_VERIFY = { algorithms: ['HS256'], requiredClaims: ['sub', 'exp'] };

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secret, ACCESS_VERIFY);
  if (payload.typ === 'verified' || (payload.scope !== 'dealer' && payload.scope !== 'admin')) throw new Error('not_an_access_token');
  return {
    sub: payload.sub as string,
    scope: payload.scope as 'dealer' | 'admin',
    role: payload.role as string,
    dealerId: payload.dealerId as string | undefined,
  };
}

export function newRefreshToken() {
  const token = randomToken(32);
  return { token, hash: sha256(token) };
}

export function newFamilyId() {
  return randomUUID();
}

// Short-lived token proving an OTP was verified for a purpose other than login
// (register / reset / verify_mobile), redeemed by dealers.register / auth.resetPassword.
// Not a session — carries no scope/role, only enough to prove "this target's OTP was checked".
export type VerifiedTokenClaims = { purpose: 'register' | 'reset' | 'verify_mobile'; target: string };

export async function signVerifiedToken(claims: VerifiedTokenClaims): Promise<string> {
  return new SignJWT({ typ: 'verified', purpose: claims.purpose, target: claims.target })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret);
}

export async function verifyVerifiedToken(token: string, expectedPurpose: VerifiedTokenClaims['purpose']): Promise<VerifiedTokenClaims> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'], requiredClaims: ['exp'] });
  if (payload.typ !== 'verified' || payload.purpose !== expectedPurpose) {
    throw new Error('verified_token_invalid');
  }
  return { purpose: payload.purpose as VerifiedTokenClaims['purpose'], target: payload.target as string };
}
