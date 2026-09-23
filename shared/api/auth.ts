import { apiPost } from './client';

export type OtpPurpose = 'login' | 'register' | 'reset' | 'verify_mobile';

export function requestOtp(target: string, purpose: OtpPurpose) {
  return apiPost<{ challengeId: string; resendAfter: number }>('/auth/otp/request', { target, purpose });
}

export type VerifyOtpLoginResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; scope: 'dealer' | 'admin'; role: string };
  dealer: {
    id: string;
    dealerCode: string | null;
    name: string;
    contactPerson: string;
    mobile: string;
    email: string | null;
    cityId: string;
    state: string;
    pin: string;
    place: string | null;
    address: string;
    status: 'pending_approval' | 'active' | 'rejected' | 'suspended';
  } | null;
};
export type VerifyOtpVerifiedResult = { verifiedToken: string };

export function verifyOtp(challengeId: string, code: string): Promise<VerifyOtpLoginResult | VerifyOtpVerifiedResult> {
  return apiPost('/auth/otp/verify', { challengeId, code });
}

export function adminLogin(email: string, password: string) {
  return apiPost<{ challengeId: string; resendAfter: number }>('/auth/login', { email, password });
}

export function passwordForgot(email: string) {
  return apiPost<{ challengeId: string; resendAfter: number }>('/auth/password/forgot', { email });
}

export function passwordReset(verifiedToken: string, newPassword: string) {
  return apiPost<{ ok: true }>('/auth/password/reset', { verifiedToken, newPassword });
}
