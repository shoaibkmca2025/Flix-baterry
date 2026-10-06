import { describe, expect, it } from 'vitest';
import { decodeCursor } from './cursor';

/**
 * A cursor is a string anybody can put in a URL, so it is checked before it reaches a query.
 *
 * Seven list endpoints answered 500 to {"createdAt":"bad-date","id":"not-uuid"}: it parsed as
 * JSON, so the old decoder's try/catch never fired, and an Invalid Date and a non-UUID went
 * straight to Postgres (QA, 6 Oct 2026).
 */
const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('decodeCursor', () => {
  it('reads a cursor this list actually issued', () => {
    const at = '2026-10-06T09:30:00.000Z';
    expect(decodeCursor(encode({ createdAt: at, id: '11111111-2222-3333-4444-555555555555' }), 'createdAt'))
      .toEqual({ createdAt: new Date(at), id: '11111111-2222-3333-4444-555555555555' });
  });

  it('refuses the nonsense that used to reach Postgres', () => {
    const bad = [
      { createdAt: 'bad-date', id: 'not-uuid' },          // the exact cursor QA sent
      { createdAt: 'bad-date', id: '11111111-2222-3333-4444-555555555555' },
      { createdAt: '2026-10-06T09:30:00.000Z', id: 'not-uuid' },
      { createdAt: '2026-10-06T09:30:00.000Z' },          // no id at all
      { id: '11111111-2222-3333-4444-555555555555' },     // no timestamp
      { createdAt: 12345, id: '11111111-2222-3333-4444-555555555555' },
      [], 'a string', 42, null,
    ];
    for (const b of bad) {
      expect(() => decodeCursor(encode(b), 'createdAt'), JSON.stringify(b)).toThrowError(
        expect.objectContaining({ code: 'filter_invalid', status: 422 }),
      );
    }
    // and something that is not even base64url JSON
    expect(() => decodeCursor('@@not-base64@@', 'createdAt')).toThrowError(expect.objectContaining({ status: 422 }));
  });

  it('no cursor is the first page, not an error', () => {
    expect(decodeCursor(undefined, 'createdAt')).toBeUndefined();
  });

  it('reads each list by the field it sorts on', () => {
    const at = '2026-10-06T09:30:00.000Z', id = '11111111-2222-3333-4444-555555555555';
    expect(decodeCursor(encode({ issuedAt: at, id }), 'issuedAt')).toEqual({ issuedAt: new Date(at), id });
    expect(decodeCursor(encode({ postedAt: at, id }), 'postedAt')).toEqual({ postedAt: new Date(at), id });
    // a cursor from a different list does not pass as this one's
    expect(() => decodeCursor(encode({ createdAt: at, id }), 'postedAt')).toThrowError();
  });

  it('the audit log is numbered, not keyed by uuid', () => {
    const at = '2026-10-06T09:30:00.000Z';
    expect(decodeCursor(encode({ at, id: 4210 }), 'at', 'number')).toEqual({ at: new Date(at), id: 4210 });
    expect(decodeCursor(encode({ at, id: '4210' }), 'at', 'number')).toEqual({ at: new Date(at), id: 4210 });
    for (const id of ['not-a-number', -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => decodeCursor(encode({ at, id }), 'at', 'number'), String(id)).toThrowError();
    }
  });
});
