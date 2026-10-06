import { describe, expect, it } from 'vitest';
import { EntryCreateBody, shopEntryIssues } from './entries.validation';

/**
 * What the request body itself refuses, before any service sees it.
 *
 * `entry_date` is stored as text and nothing downstream re-read it, so a string that merely
 * looked like a date went all the way into the database: QA submitted 2026-99-99 and found it
 * there afterwards (6 Oct 2026).
 */
const body = (over: Record<string, unknown> = {}) => ({
  entryType: 'replacement',
  place: 'Nashik',
  items: [{ modelId: 'M5', code: '26041212', oldCode: '26030777', faultCode: 'low_backup' }],
  coverTold: false,
  ...over,
});

describe('EntryCreateBody — the date', () => {
  it('refuses a day that does not exist', () => {
    for (const entryDate of ['2026-99-99', '2026-02-31', '2026-13-01', '2026-00-10', '2026-01-00', '2025-02-29']) {
      expect(EntryCreateBody.safeParse(body({ entryDate })).success, entryDate).toBe(false);
    }
  });

  it('takes the days that do', () => {
    for (const entryDate of ['2026-10-06', '2024-02-29', '2026-01-31', '2026-12-31']) {
      expect(EntryCreateBody.safeParse(body({ entryDate })).success, entryDate).toBe(true);
    }
    // and no date at all is fine: the server dates it today
    expect(EntryCreateBody.safeParse(body()).success).toBe(true);
  });

  it('still refuses anything that is not shaped like a date', () => {
    for (const entryDate of ['06-10-2026', '2026/10/06', 'today', '', '2026-10-6']) {
      expect(EntryCreateBody.safeParse(body({ entryDate })).success, entryDate).toBe(false);
    }
  });
});

describe('shopEntryIssues — the window a shop may date within', () => {
  const today = '2026-10-06';

  it('refuses the future and the distant past', () => {
    expect(shopEntryIssues(body({ entryDate: '2099-01-01' }) as never, today)?.field).toBe('entryDate');
    expect(shopEntryIssues(body({ entryDate: '2026-10-07' }) as never, today)?.field).toBe('entryDate');
    expect(shopEntryIssues(body({ entryDate: '2020-01-01' }) as never, today)?.field).toBe('entryDate');
  });

  it('takes today and the days just behind it', () => {
    for (const entryDate of [today, '2026-10-01', '2026-09-20']) {
      expect(shopEntryIssues(body({ entryDate }) as never, today), entryDate).toBeNull();
    }
    // exactly at the edge of the window, and one day past it
    expect(shopEntryIssues(body({ entryDate: '2026-09-06' }) as never, today)).toBeNull();
    expect(shopEntryIssues(body({ entryDate: '2026-09-05' }) as never, today)?.field).toBe('entryDate');
  });
});
