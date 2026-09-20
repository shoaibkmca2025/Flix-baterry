import { apiGet, apiPatch, apiPost } from './client';

export type UserStatus = 'active' | 'temporarily_blocked' | 'inactive' | 'soft_deleted';
export type ApiUser = {
  id: string;
  scope: 'dealer' | 'admin';
  dealerId: string | null;
  name: string;
  mobile: string | null;
  email: string | null;
  role: string;
  status: UserStatus;
  statusReason: string | null;
  lastLoginAt: string | null;
  language: 'en' | 'mr';
  smsAlerts: boolean;
  createdAt: string;
};

export function getMe(accessToken: string) {
  return apiGet<{ user: ApiUser; dealer: { id: string; dealerCode: string | null; name: string; status: string } | null; permissions: string[] }>('/me', { accessToken });
}
export function updateMe(input: { name?: string; language?: 'en' | 'mr'; smsAlerts?: boolean }, accessToken: string) {
  return apiPatch<ApiUser>('/me', input, { accessToken });
}

// --- head office accounts (admins.manage — Main Admin)
export function listAdmins(accessToken: string) {
  return apiGet<{ items: ApiUser[] }>('/admins', { accessToken });
}
export function createAdmin(input: { name: string; email: string; mobile?: string; role: string; password: string }, accessToken: string) {
  return apiPost<ApiUser>('/admins', input, { accessToken });
}
export function updateAdmin(id: string, input: { name?: string; role?: string; permissions?: string[] }, accessToken: string) {
  return apiPatch<ApiUser>(`/admins/${id}`, input, { accessToken });
}
export function setAdminStatus(id: string, status: UserStatus, reason: string, accessToken: string) {
  return apiPost<ApiUser>(`/admins/${id}/status`, { status, reason }, { accessToken });
}
export function listRoles(accessToken: string) {
  return apiGet<{ items: { key: string; label: string; scope: 'dealer' | 'admin'; templatePermissions: string[] }[] }>('/roles', { accessToken });
}

// --- dealer staff (dealers.staff.manage — a dealer manager for their own shop, admins for any)
export function listStaff(dealerId: string, accessToken: string) {
  return apiGet<{ items: ApiUser[] }>(`/dealers/${dealerId}/staff`, { accessToken });
}
export function inviteStaff(dealerId: string, input: { name: string; mobile: string; email?: string; role: 'dealer_user' | 'dealer_manager' }, accessToken: string) {
  return apiPost<ApiUser>(`/dealers/${dealerId}/staff`, input, { accessToken });
}
export function setStaffStatus(dealerId: string, userId: string, status: UserStatus, reason: string, accessToken: string) {
  return apiPost<ApiUser>(`/dealers/${dealerId}/staff/${userId}/status`, { status, reason }, { accessToken });
}
