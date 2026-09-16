import { describe, expect, it } from 'vitest';
import { permissionGranted } from './rbac';

describe('permissionGranted', () => {
  it('grants an exact match', () => {
    expect(permissionGranted(new Set(['dealers.approve']), 'dealers.approve')).toBe(true);
  });

  it('refuses when the permission is absent', () => {
    expect(permissionGranted(new Set(['dealers.read']), 'dealers.approve')).toBe(false);
  });

  it('main_admin wildcard grants everything', () => {
    expect(permissionGranted(new Set(['*']), 'anything.at.all')).toBe(true);
  });

  it('a domain wildcard (co_admin style) grants every action in that domain', () => {
    expect(permissionGranted(new Set(['entries.*']), 'entries.approve')).toBe(true);
    expect(permissionGranted(new Set(['entries.*']), 'claims.approve')).toBe(false);
  });

  it('a verb wildcard (read_only style) grants that verb across every domain', () => {
    expect(permissionGranted(new Set(['*.read']), 'dealers.read')).toBe(true);
    expect(permissionGranted(new Set(['*.read']), 'entries.read')).toBe(true);
    expect(permissionGranted(new Set(['*.read']), 'dealers.approve')).toBe(false);
  });
});
