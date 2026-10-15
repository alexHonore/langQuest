import { describe, expect, it } from 'vitest';
import { rightsAllowPublishing } from './rights';

const base = { verified: true, revoked_at: null, expires_at: null, commercial_redistribution: true };

describe('rightsAllowPublishing (§7.6 publish gate)', () => {
  it('allows only verified, unrevoked, unexpired, redistributable rights', () => {
    expect(rightsAllowPublishing(base)).toBe(true);
    expect(rightsAllowPublishing({ ...base, verified: false })).toBe(false);
    expect(rightsAllowPublishing({ ...base, revoked_at: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(rightsAllowPublishing({ ...base, expires_at: '2020-01-01T00:00:00Z' })).toBe(false);
    expect(rightsAllowPublishing({ ...base, expires_at: '2999-01-01T00:00:00Z' })).toBe(true);
    // Owning a commercial MP3 is not a redistribution licence.
    expect(rightsAllowPublishing({ ...base, commercial_redistribution: false })).toBe(false);
  });
});
