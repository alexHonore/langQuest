/**
 * Where each skill key is referenced inside the curriculum (device QA 2026-10-19 §6.2).
 *
 * The `skills` table, the catalog names (`skillNameKey`) and the evidence pipeline must agree on one key set.
 * This module lists every key the curriculum itself references (registry, system skills, blueprint objectives and
 * prerequisites, intents, story milestones) so `scripts/src/seed-curriculum.ts` can prove that every referenced key
 * gets a seed row and a name before anything is written. Pure, no I/O.
 *
 * Kept out of `skills.ts` because blueprints and intents import `skills.ts` (a cycle otherwise); import it from
 * `@langquest/curriculum/skill-references`.
 */
import { INTENTS } from './intents';
import { DEFAULT_STORY_ARC, SITUATIONAL_BLUEPRINTS, type MissionBlueprint, type StoryArcBlueprint } from './missions';
import { SKILLS, SYSTEM_SKILLS, type Skill } from './skills';

export const SKILL_REFERENCE_SOURCE_VALUES = ['registry', 'system', 'blueprint_objective', 'blueprint_prerequisite', 'skill_prerequisite', 'intent', 'story_milestone'] as const;
export type SkillReferenceSource = (typeof SKILL_REFERENCE_SOURCE_VALUES)[number];

export interface SkillReferenceInputs {
  skills?: readonly Skill[];
  systemSkills?: readonly Skill[];
  blueprints?: readonly MissionBlueprint[];
  intents?: readonly { intentKey: string; skillKeys: readonly string[] }[];
  storyArcs?: readonly StoryArcBlueprint[];
}

/** Skill key → the kinds of curriculum data that reference it (insertion order: registry first). */
export function curriculumSkillReferences(inputs: SkillReferenceInputs = {}): Map<string, Set<SkillReferenceSource>> {
  const out = new Map<string, Set<SkillReferenceSource>>();
  const add = (key: string, source: SkillReferenceSource): void => {
    const set = out.get(key) ?? new Set<SkillReferenceSource>();
    set.add(source);
    out.set(key, set);
  };
  for (const s of inputs.skills ?? SKILLS) {
    add(s.skillKey, 'registry');
    for (const p of s.prerequisites) add(p, 'skill_prerequisite');
  }
  for (const s of inputs.systemSkills ?? SYSTEM_SKILLS) add(s.skillKey, 'system');
  for (const bp of inputs.blueprints ?? SITUATIONAL_BLUEPRINTS) {
    for (const o of bp.objectives) for (const k of o.skillKeys) add(k, 'blueprint_objective');
    for (const k of bp.prerequisiteSkillKeys) add(k, 'blueprint_prerequisite');
  }
  for (const i of inputs.intents ?? INTENTS) for (const k of i.skillKeys) add(k, 'intent');
  for (const arc of inputs.storyArcs ?? [DEFAULT_STORY_ARC]) {
    for (const ch of arc.chapters) for (const k of ch.milestone?.requiresSkillKeys ?? []) add(k, 'story_milestone');
  }
  return out;
}
