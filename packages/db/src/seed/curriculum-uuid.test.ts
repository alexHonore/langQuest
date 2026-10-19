import { describe, expect, it } from 'vitest';
import { CHARACTER_UUID_NAMESPACE, characterUuid } from '../character-uuid';
import { CURRICULUM_UUID_NAMESPACE, curriculumSeedKeys, curriculumUuid } from './curriculum-uuid';

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('curriculumUuid', () => {
  it('is a stable RFC 4122 v5 uuid per (kind, key)', () => {
    const a = curriculumUuid('mission', 'ary_ch1_arrival_casablanca:ary_greet_and_introduce');
    expect(a).toMatch(UUID_V5);
    expect(curriculumUuid('mission', 'ary_ch1_arrival_casablanca:ary_greet_and_introduce')).toBe(a);
    // Pinned so a future refactor cannot silently re-key every seeded row.
    expect(a).toBe('fe3f3825-77bb-54fe-9f7e-983983f18313');
  });

  it('separates kinds and keys', () => {
    expect(curriculumUuid('chapter', 'x')).not.toBe(curriculumUuid('mission', 'x'));
    expect(curriculumUuid('chapter', 'x')).not.toBe(curriculumUuid('chapter', 'y'));
    expect(() => curriculumUuid('chapter', '')).toThrow(/non-empty/);
  });

  it('never collides with the character id space', () => {
    expect(CURRICULUM_UUID_NAMESPACE).not.toBe(CHARACTER_UUID_NAMESPACE);
    expect(curriculumUuid('expression', 'ary-cafe-staff-nadia')).not.toBe(characterUuid('ary-cafe-staff-nadia'));
  });

  it('builds the content keys the CLI uses', () => {
    expect(curriculumSeedKeys.lessonCourse('arabic-moroccan', 'arrival')).toBe('arabic-moroccan:arrival');
    expect(curriculumSeedKeys.expression('c', 'm', 'e')).toBe('c:m:e');
    expect(curriculumSeedKeys.missionStep('c', 'm', 3)).toBe('c:m:3');
    expect(curriculumSeedKeys.expressionForm('c', 'm', 'e', 1)).toBe('c:m:e:1');
  });
});
