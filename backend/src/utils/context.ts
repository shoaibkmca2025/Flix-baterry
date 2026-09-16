// modules.md §2 — the same shape every module's service functions receive.
export type Ctx = {
  user: { id: string; scope: 'dealer' | 'admin'; role: string; dealerId?: string } | null;
  request: { id: string; ip: string | null; deviceId?: string; userAgent?: string };
  now: () => Date;
};
