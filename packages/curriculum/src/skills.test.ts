import { describe, expect, it } from 'vitest';
import { SKILLS, SKILL_KEYS, getSkill, prerequisiteClosure, skillsForSituation, skillsUpToCefr, validateSkillRegistry, SITUATION_TAG_VALUES } from './skills';

describe('skills registry', () => {
  it('has at least 40 skills with unique keys and a valid, acyclic prerequisite graph', () => {
    expect(SKILLS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(SKILL_KEYS).size).toBe(SKILLS.length);
    expect(validateSkillRegistry()).toEqual([]);
  });

  it('includes the spec §3.4 example skills', () => {
    for (const key of ['greet_politely', 'ask_price', 'request_item', 'repair_misunderstanding', 'respond_to_unexpected_question', 'narrate_past_experience']) {
      expect(getSkill(key).skillKey).toBe(key);
    }
  });

  it('covers every required situational tag from §3.2', () => {
    const required = ['restaurant', 'introductions', 'work', 'directions', 'shopping', 'emergencies', 'travel', 'family', 'plans', 'daily_life', 'debates', 'repair_misunderstanding', 'ask_to_slow_down'] as const;
    for (const tag of required) {
      expect(SITUATION_TAG_VALUES).toContain(tag);
      expect(skillsForSituation(tag).length, tag).toBeGreaterThan(0);
    }
  });

  it('computes transitive prerequisites in dependency order', () => {
    const closure = prerequisiteClosure('negotiate_price');
    expect(closure).toContain('ask_price');
    expect(closure).toContain('decline_politely');
    expect(closure).not.toContain('negotiate_price');
  });

  it('detects cycles and unknown prerequisites', () => {
    const broken = [
      { ...getSkill('greet_politely'), prerequisites: ['respond_to_greeting'] },
      { ...getSkill('respond_to_greeting'), prerequisites: ['greet_politely'] },
      { ...getSkill('ask_name'), prerequisites: ['does_not_exist'] },
    ];
    const problems = validateSkillRegistry(broken);
    expect(problems.some((p) => p.includes('cycle'))).toBe(true);
    expect(problems.some((p) => p.includes('unknown prerequisite'))).toBe(true);
  });

  it('filters by CEFR band', () => {
    const a1 = skillsUpToCefr('A1');
    expect(a1.every((s) => s.cefrCanDo === 'A1')).toBe(true);
    expect(a1.length).toBeGreaterThan(10);
    expect(skillsUpToCefr('B1').length).toBe(SKILLS.length);
  });
});
