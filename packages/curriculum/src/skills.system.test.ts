/**
 * System skills, the full key set and catalog name keys (device QA 2026-10-19 §6.2: Progress showed raw keys such
 * as `speaking.intelligibility` because the API looks names up in this registry and the key was not in it).
 */
import { KeySchema } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { INTENTS } from './intents';
import { SITUATIONAL_BLUEPRINTS } from './missions';
import { curriculumSkillReferences } from './skill-references';
import {
  ALL_SKILLS,
  ALL_SKILL_KEYS,
  SKILLS,
  SKILL_KEYS,
  SKILL_NAME_KEY_PREFIX,
  SYSTEM_SKILLS,
  SYSTEM_SKILL_KEYS,
  findSkill,
  getSkill,
  isKnownSkillKey,
  isSkillKey,
  skillNameKey,
  skillsForSituation,
  skillsUpToCefr,
  validateSkillRegistry,
} from './skills';

describe('system skills', () => {
  it('defines the keys the API records outside mission objectives', () => {
    expect([...SYSTEM_SKILL_KEYS].sort()).toEqual(['general.participation', 'speaking.intelligibility', 'speaking.pronunciation']);
    for (const key of SYSTEM_SKILL_KEYS) {
      expect(KeySchema.safeParse(key).success, key).toBe(true);
      // The `skills.skill_key` check constraint (migration 020).
      expect(key).toMatch(/^[a-z0-9]+(?:[._][a-z0-9]+)*$/);
    }
  });

  it('the combined registry is valid, unique and keeps the communicative registry first', () => {
    expect(validateSkillRegistry(ALL_SKILLS)).toEqual([]);
    expect(new Set(ALL_SKILL_KEYS).size).toBe(ALL_SKILLS.length);
    expect(ALL_SKILLS.length).toBe(SKILLS.length + SYSTEM_SKILLS.length);
    expect(ALL_SKILL_KEYS.slice(0, SKILL_KEYS.length)).toEqual([...SKILL_KEYS]);
    for (const s of SYSTEM_SKILLS) {
      expect(SKILL_KEYS).not.toContain(s.skillKey);
      expect(s.prerequisites).toEqual([]);
    }
  });

  it('findSkill / getSkill resolve system skills (what the progress and review routes read), isSkillKey stays registry-only', () => {
    expect(findSkill('speaking.intelligibility')?.descriptor).toBe('Be understood when speaking');
    expect(findSkill('general.participation')?.descriptor).toBe('Take part in the conversation');
    expect(getSkill('speaking.pronunciation').cefrCanDo).toBe('A1');
    expect(findSkill('greet_politely')?.skillKey).toBe('greet_politely');
    expect(findSkill('greetings.basic')).toBeUndefined();
    expect(() => getSkill('greetings.basic')).toThrow(/Unknown skill key/);
    expect(isSkillKey('speaking.intelligibility')).toBe(false);
    expect(isKnownSkillKey('speaking.intelligibility')).toBe(true);
    expect(isSkillKey('greet_politely')).toBe(true);
    expect(isKnownSkillKey('greet_politely')).toBe(true);
    expect(isKnownSkillKey(42)).toBe(false);
  });

  it('keeps system skills out of the planner-facing selectors', () => {
    expect(skillsUpToCefr('C2').map((s) => s.skillKey)).not.toContain('speaking.intelligibility');
    expect(skillsForSituation('daily_life').map((s) => s.skillKey)).not.toContain('general.participation');
  });

  it('honesty: the pronunciation skill says it is measured only by an acoustic assessor (ADR-006)', () => {
    expect(getSkill('speaking.pronunciation').canDoStatement).toMatch(/acoustic assessor/);
  });
});

describe('skill name keys', () => {
  it('maps a skill key to its catalog key under progress.skill', () => {
    expect(SKILL_NAME_KEY_PREFIX).toBe('progress.skill');
    expect(skillNameKey('greet_politely')).toBe('progress.skill.greet_politely');
    expect(skillNameKey('speaking.intelligibility')).toBe('progress.skill.speaking.intelligibility');
  });

  it('no skill key is the dotted prefix of another (a catalog leaf can never collide with a nested object)', () => {
    for (const a of ALL_SKILL_KEYS) {
      for (const b of ALL_SKILL_KEYS) if (a !== b) expect(b.startsWith(`${a}.`), `${a} prefixes ${b}`).toBe(false);
    }
  });
});

describe('curriculumSkillReferences', () => {
  const refs = curriculumSkillReferences();

  it('every key the curriculum references is a known skill', () => {
    const unknown = [...refs.keys()].filter((k) => !isKnownSkillKey(k));
    expect(unknown).toEqual([]);
    expect([...refs.keys()].sort()).toEqual([...ALL_SKILL_KEYS].sort());
  });

  it('records where each key comes from', () => {
    expect([...refs.get('greet_politely')!]).toEqual(expect.arrayContaining(['registry', 'blueprint_objective', 'intent', 'story_milestone']));
    expect([...refs.get('speaking.intelligibility')!]).toEqual(['system']);
    const objectiveKeys = new Set(SITUATIONAL_BLUEPRINTS.flatMap((bp) => bp.objectives.flatMap((o) => o.skillKeys)));
    for (const k of objectiveKeys) expect(refs.get(k)?.has('blueprint_objective'), k).toBe(true);
    for (const k of new Set(INTENTS.flatMap((i) => i.skillKeys))) expect(refs.get(k)?.has('intent'), k).toBe(true);
  });

  it('surfaces a reference to a key outside the registry (what the seed must refuse)', () => {
    const custom = curriculumSkillReferences({ blueprints: [], intents: [{ intentKey: 'x', skillKeys: ['greetings.basic'] }], storyArcs: [] });
    expect(custom.get('greetings.basic')).toEqual(new Set(['intent']));
    expect(isKnownSkillKey('greetings.basic')).toBe(false);
  });
});
