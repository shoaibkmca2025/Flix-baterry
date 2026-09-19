// Pure state machines — architecture.md §8.3 / modules.md M-03. No I/O.

export const USER_STATUSES = ['active', 'temporarily_blocked', 'inactive', 'soft_deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// soft_deleted is terminal: the row stays (audit history points at it) but never comes back.
export const USER_TRANSITIONS: Record<UserStatus, readonly UserStatus[]> = {
  active: ['temporarily_blocked', 'inactive', 'soft_deleted'],
  temporarily_blocked: ['active', 'inactive', 'soft_deleted'],
  inactive: ['active', 'soft_deleted'],
  soft_deleted: [],
};

export function canChangeUserStatus(from: UserStatus, to: UserStatus): boolean {
  return USER_TRANSITIONS[from].includes(to);
}
