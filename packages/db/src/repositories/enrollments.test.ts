import { COURSE_TRACKS } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { resolveEnrollmentScriptMode } from './enrollments';

describe('resolveEnrollmentScriptMode (script mode follows the TARGET track, §2.3/§10.1)', () => {
  it('defaults to the catalog defaultScriptMode of the track, never a blanket native', () => {
    expect(resolveEnrollmentScriptMode('arabic-moroccan', undefined)).toBe('both');
    expect(resolveEnrollmentScriptMode('arabic-eastern', null)).toBe('both');
    expect(resolveEnrollmentScriptMode('chinese-cantonese', null)).toBe('both');
    expect(resolveEnrollmentScriptMode('arabic-msa', null)).toBe('native');
    expect(resolveEnrollmentScriptMode('french', null)).toBe('native');
    for (const track of COURSE_TRACKS)
      expect(resolveEnrollmentScriptMode(track.id, null)).toBe(track.defaultScriptMode);
  });

  it('keeps an explicit mode the track supports', () => {
    expect(resolveEnrollmentScriptMode('arabic-moroccan', 'latin')).toBe('latin');
    expect(resolveEnrollmentScriptMode('arabic-moroccan', 'native')).toBe('native');
    expect(resolveEnrollmentScriptMode('french', 'native')).toBe('native');
  });

  it('rejects an explicit mode the track does not offer instead of silently downgrading', () => {
    expect(() => resolveEnrollmentScriptMode('french', 'latin')).toThrow(
      /not supported by track 'french'/,
    );
    expect(() => resolveEnrollmentScriptMode('english', 'both')).toThrow(/not supported/);
    expect(() => resolveEnrollmentScriptMode('arabic-moroccan', 'arabizi')).toThrow(
      /not supported/,
    );
  });
});
