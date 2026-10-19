/**
 * Mission goals (`missions.goals` jsonb, §10.1): learner-facing descriptions exist per enrollment source
 * language only. A goal is described either by a `description_key` rendered through the source-language
 * catalog or by a `description` map keyed by source language code. A bare `description` string carries no
 * language and is therefore never shown to a learner (it may still inform the character agent's prompt).
 */
import type { Row } from '@langquest/db/types';
import type { SourceLanguageCode } from '@langquest/contracts';

export interface MissionGoal {
  id: string;
  skill_keys: string[];
  description_key?: string;
  /** Legacy free text (language unknown) or a `{ [sourceLanguageCode]: text }` map. */
  description?: string | Record<string, string>;
}

export interface GoalTranslator {
  has(key: string): boolean;
  t(key: string): string;
}

/** Goals of a mission row (entries without a string `id` are ignored). */
export const goalsOf = (mission: Pick<Row<'missions'>, 'goals'>): MissionGoal[] => (Array.isArray(mission.goals) ? (mission.goals as unknown as MissionGoal[]) : []).filter((g) => typeof g?.id === 'string');

/**
 * Learner-facing description for ONE source language, or `null` when the goal has none in that language
 * (the caller then reports `localizationComplete: false` / an empty description rather than text of unknown language).
 */
export function goalDescriptionFor(goal: Pick<MissionGoal, 'description_key' | 'description'>, source: SourceLanguageCode, translator: GoalTranslator): string | null {
  if (goal.description_key && translator.has(goal.description_key)) return translator.t(goal.description_key);
  if (goal.description && typeof goal.description === 'object') {
    const text = goal.description[source];
    return typeof text === 'string' && text.trim() ? text : null;
  }
  return null;
}

/** Editor-authored free text with no language tag (prompt context only, never learner UI). */
export function goalEditorialText(goal: Pick<MissionGoal, 'description'>): string | null {
  return typeof goal.description === 'string' && goal.description.trim() ? goal.description : null;
}
