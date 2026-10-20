/**
 * Deterministic ids for seeded curriculum content (`scripts/src/seed-curriculum.ts`).
 *
 * Every row the curriculum seed writes (`content_rights`, `lesson_courses`, `chapters`, `missions`,
 * `mission_steps`, `expressions`, `expression_forms`, `dialogue_scenarios`) gets an RFC 4122 UUID v5 derived from its
 * content key under {@link CURRICULUM_UUID_NAMESPACE}, so re-running the seed updates rows in place
 * instead of duplicating them, and tests / other tools can address a seeded row without a lookup.
 *
 * Same pure-TypeScript v5 implementation as `characterUuid` (`../character-uuid`), different namespace.
 */
import { uuidV5 } from '../character-uuid';

/** Fixed namespace for every seeded curriculum row. Never change: ids are referenced by FKs and progress rows. */
export const CURRICULUM_UUID_NAMESPACE = '7b1f3c58-2e64-4a9d-9c0e-4f6a8d2b5e17';
/** Name prefix hashed with `<kind>:<key>`. */
export const CURRICULUM_UUID_NAME_PREFIX = 'langquest.curriculum:';

/** Row kinds the seed addresses deterministically (one id space per table). */
export type CurriculumSeedKind = 'content_rights' | 'lesson_course' | 'chapter' | 'mission' | 'mission_step' | 'expression' | 'expression_form' | 'dialogue_scenario';

/** Deterministic uuid for a seeded curriculum row: `uuidV5(namespace, 'langquest.curriculum:<kind>:<key>')`. */
export function curriculumUuid(kind: CurriculumSeedKind, key: string): string {
  if (!key) throw new Error(`curriculumUuid(${kind}) needs a non-empty key`);
  return uuidV5(CURRICULUM_UUID_NAMESPACE, `${CURRICULUM_UUID_NAME_PREFIX}${kind}:${key}`);
}

/** Content keys used by the seed, in one place so tests and tools agree with the CLI. */
export const curriculumSeedKeys = {
  /** One course per (track, story arc). */
  lessonCourse: (courseTrackId: string, arcKey: string): string => `${courseTrackId}:${arcKey}`,
  chapter: (chapterKey: string): string => chapterKey,
  /** One rights record per seed chapter (its provenance + generator). */
  contentRights: (chapterKey: string): string => chapterKey,
  mission: (chapterKey: string, missionKey: string): string => `${chapterKey}:${missionKey}`,
  missionStep: (chapterKey: string, missionKey: string, order: number): string => `${chapterKey}:${missionKey}:${order}`,
  /** Equals `seedExpressionId()` from `@langquest/curriculum` (`<chapter>:<mission>:<expression>`). */
  expression: (chapterKey: string, missionKey: string, expressionKey: string): string => `${chapterKey}:${missionKey}:${expressionKey}`,
  expressionForm: (chapterKey: string, missionKey: string, expressionKey: string, index: number): string => `${chapterKey}:${missionKey}:${expressionKey}:${index}`,
  /** One cast scenario per seeded mission (the roster character the manifest lists for it). */
  dialogueScenario: (chapterKey: string, missionKey: string): string => `${chapterKey}:${missionKey}:cast`,
} as const;
