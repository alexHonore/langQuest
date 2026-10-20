import { describe, expect, it } from 'vitest';
import { COURSE_TRACK_IDS } from '@langquest/contracts';
import { AGE_BANDS, castForTrack } from './cast';

describe('castForTrack', () => {
  it('returns null for an unknown track', () => {
    expect(castForTrack('nope')).toBeNull();
    expect(castForTrack(null)).toBeNull();
  });

  it('tallies the roster per track consistently', () => {
    for (const id of COURSE_TRACK_IDS) {
      const cast = castForTrack(id);
      expect(cast).not.toBeNull();
      const n = cast!.members.length;
      expect(n).toBeGreaterThan(0);
      expect(AGE_BANDS.reduce((s, b) => s + cast!.ageBands[b], 0)).toBe(n);
      expect(cast!.genders.feminine + cast!.genders.masculine).toBe(n);
      expect(cast!.missingAgeBands.every((b) => cast!.ageBands[b] === 0)).toBe(true);
      expect(cast!.intentCount).toBeGreaterThan(0);
      for (const m of cast!.members) expect(m.situations.every((s) => s.label.length > 0)).toBe(true);
    }
  });
});
