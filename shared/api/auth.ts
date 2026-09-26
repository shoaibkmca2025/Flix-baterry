import { apiPost } from './client';

export type OtpPurpose = 'login' | 'register' | 'reset' | 'verify_mobile';

/** `devCode` is only present while the backend's temporary OTP_SHOW_IN_APP switch is on. */
export type OtpChallenge = { challengeId: string; resendAfter: number; devCode?: string };

export function requestOtp(target: string, purpose: OtpPurpose) {
  return apiPost<OtpChallenge>('/auth/otp/request', { target, purpose });
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
  return apiPost<OtpChallenge>('/auth/login', { email, password });
}

export function passwordForgot(email: string) {
  return apiPost<OtpChallenge>('/auth/password/forgot', { email });
}

export function passwordReset(verifiedToken: string, newPassword: string) {
  return apiPost<{ ok: true }>('/auth/password/reset', { verifiedToken, newPassword });
}
