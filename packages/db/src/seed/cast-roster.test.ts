import { CHARACTER_ROSTER } from '@langquest/ui/art/web';
import { describe, expect, it } from 'vitest';
import { characterUuid } from '../character-uuid';
import { CAST_ROSTER, castRosterForVariety } from './cast-roster';

describe('CAST_ROSTER', () => {
  it('projects every roster character with its seeded uuid, age band and intents (roster order kept)', () => {
    expect(CAST_ROSTER).toHaveLength(CHARACTER_ROSTER.length);
    expect(CAST_ROSTER.map((c) => c.id)).toEqual(CHARACTER_ROSTER.map((c) => c.id));
    for (const c of CAST_ROSTER) {
      expect(c.characterId).toBe(characterUuid(c.id));
      expect(['child', 'teen', 'adult', 'elder']).toContain(c.ageBand);
      expect(c.intents.length).toBeGreaterThan(0);
      expect(c.situations.length).toBeGreaterThanOrEqual(3);
      expect(c.role.trim().length).toBeGreaterThan(0);
    }
  });

  it('castRosterForVariety never crosses a variety boundary', () => {
    const ary = castRosterForVariety('ary');
    expect(ary.length).toBeGreaterThan(0);
    expect(ary.every((c) => c.varietyId === 'ary')).toBe(true);
    expect(castRosterForVariety('no-such-variety')).toEqual([]);
  });
});
