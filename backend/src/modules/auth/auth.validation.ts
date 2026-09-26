import { z } from 'zod';

const mobile = z.string().regex(/^\d{10}$/, 'Enter the 10-digit mobile number.');
const email = z.string().email('Enter a valid email.');

export const OtpRequestBody = z.object({
  target: z.union([mobile, email]),
  purpose: z.enum(['login', 'register', 'reset', 'verify_mobile']),
  deviceId: z.string().optional(),
});
export type OtpRequestBody = z.infer<typeof OtpRequestBody>;

export const OtpVerifyBody = z.object({
  challengeId: z.string().uuid(),
  code: z.string().min(4).max(8),
  deviceId: z.string().optional(),
});
export type OtpVerifyBody = z.infer<typeof OtpVerifyBody>;

export const AdminLoginBody = z.object({
  email,
  password: z.string().min(1),
});
export type AdminLoginBody = z.infer<typeof AdminLoginBody>;

export const PasswordForgotBody = z.object({ email });
export type PasswordForgotBody = z.infer<typeof PasswordForgotBody>;

export const PasswordResetBody = z.object({
  verifiedToken: z.string().min(1),
  newPassword: z.string().min(8, 'At least 8 characters.'),
});
export type PasswordResetBody = z.infer<typeof PasswordResetBody>;

// A refresh token is single-use: POST /auth/refresh swaps it for a new access + refresh pair.
export const RefreshBody = z.object({
  refreshToken: z.string().min(20),
  deviceId: z.string().optional(),
});
export type RefreshBody = z.infer<typeof RefreshBody>;
