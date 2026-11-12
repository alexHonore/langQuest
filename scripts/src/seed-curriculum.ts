#!/usr/bin/env tsx
/**
 * seed-curriculum — loads the authored curriculum seed content (`@langquest/curriculum` `content/*`)
 * into Postgres so the course manifest (`lesson_courses → chapters → missions → mission_steps`) has
 * something to serve: the four flagship AI-draft chapters (arabic-moroccan fr+en, spanish-spain en,
 * japanese en, english fr+ru) and the planned chapter-1 skeletons of every other track.
 *
 * Honesty rules (spec §9.8/§9.9, CONVENTIONS §8 "visible means usable"):
 *  - Flagship draft chapters are **published** (course, chapter, missions, expressions) so learners get
 *    content instead of an empty Missions tab — but every row keeps `reviewed = false`, translations and
 *    mission localizations stay `needs_review`, rights stay `verified = false`, and the (track, source)
 *    coverage row stays `partial` with `editorial_note_key = enrollment.coverage.draftAvailable`, so the
 *    clients render the draft disclosure the UI already has (`localizationComplete: false`).
 *  - Skeleton chapters (no target text) are loaded as `review_needed` structure and are never published;
 *    they carry no expression rows (never a placeholder string) and no localizations (their titles are
 *    catalog keys, not text).
 *  - No fake audio: `expression_audio` rows need a verified media asset, so none are written.
 *  - Cast (owner decision 2026-10-19, roles correlate with lesson content): every mission is cast from the
 *    `@langquest/ui` roster with `castChapter()` (`@langquest/curriculum`), and the chosen character is written
 *    as the mission's published `dialogue_scenarios` row, which is where `buildManifest()` reads a mission's
 *    `characterIds`. When nobody in the variety carries the scene the mission stays uncast (no row, honest)
 *    rather than getting a wrong character; the plan lists those as `uncast`.
 *
 * Skills (device QA 2026-10-19 §6.2): every registry and system skill (`ALL_SKILLS`) is planned as a `skills` row with
 * its en/fr catalog name (`skillNameKey`), and the plan refuses to apply while any skill key referenced by the curriculum
 * or by the seeded missions (goals, prerequisites, rubric objectives) lacks a row or a name (`./lib/skills-seed`).
 * Skills are language independent, so `--track` never narrows them.
 *
 * Idempotent: every row id is a deterministic UUID v5 of its content key (`@langquest/db/seed/curriculum-uuid`),
 * so re-runs update in place; stale `mission_steps` / `expression_forms` of a seeded mission/expression are
 * removed. `published_revision` and an editor-raised coverage status are never lowered. A `skills` row that already
 * exists keeps its id, and unchanged skills are not rewritten.
 *
 * Target: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (local URL, or `LANGQUEST_DB_TARGET=hosted`), else the
 * local stack via `supabase status`. Nothing is written without `--apply`.
 *
 * Usage: pnpm --filter @langquest/scripts seed-curriculum -- [--track arabic-moroccan,japanese] [--no-skeletons] [--apply] [--json-out data/derived/seed-curriculum.json]
 */
import { resolve } from 'node:path';
import { COURSE_TRACKS, deriveScriptOptions, getCourseTrack, type CourseTrackId, type CoverageMetrics, type SourceLanguageCode } from '@langquest/contracts';
import {
  DEFAULT_STORY_ARC,
  DRAFT_CHAPTERS,
  arcMissionsThrough,
  buildAllPlannedSkeletons,
  castChapter,
  expandTemplate,
  getBlueprint,
  type BlueprintStep,
  type CastFit,
  type CastMember,
  type CastResult,
  type MissionBlueprint,
  type MissionCasting,
  type SeedChapter,
  type SeedExpression,
  type SeedMission,
} from '@langquest/curriculum';
import { createRepositories, type DbClient, type Insert, type Json } from '@langquest/db';
import { CAST_ROSTER } from '@langquest/db/seed/cast-roster';

/** Non-null jsonb payload (the generated `Insert` types reject `null` for `not null` json columns). */
type JsonValue = NonNullable<Json>;
import { curriculumSeedKeys, curriculumUuid } from '@langquest/db/seed/curriculum-uuid';
import { uiCoveragePctByLanguage } from '@langquest/locales';
import { flagBool, flagList, flagString, isDirectRun, runCli, CliUsageError, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { ensureIntents, probeDb, resolveServiceDb } from './lib/db';
import { loadRootEnv, repoRoot, writeJsonFileSync } from './lib/io';
import { applySkillSeed, buildSkillSeedPlan, describeSkillSeedPlan, type SkillSeedPlan, type SkillSeedRow } from './lib/skills-seed';

export const spec: CliSpec = {
  name: 'seed-curriculum',
  summary: 'Load the curriculum seed chapters (flagship AI drafts published with draft disclosure; skeletons as review_needed) into lesson_courses/chapters/missions/steps/expressions.',
  description: `Deterministic ids (UUID v5 of content keys) make re-runs update in place. Flagship draft chapters are
published with reviewed=false / needs_review translations / unverified rights so learners see content with the
draft disclosure; planned skeletons (no target text) are loaded as review_needed and never published. No audio
rows are faked. Coverage rows for sources with overlays become 'partial' (never downgrading an editor-set status).
Skills: one skills row per registry and system skill, each named in the en and fr catalogs (progress.skill.<key>);
the plan refuses to apply (exit 1, even with --dry-run) while a referenced skill lacks a row or a name.`,
  flags: [
    { name: 'track', type: 'list', description: 'Only these course tracks (default: all 30).' },
    { name: 'apply', type: 'boolean', description: 'Write to the database (otherwise the plan is only printed).', default: false },
    { name: 'skeletons', type: 'boolean', description: 'Include the planned chapter-1 skeletons of tracks without a draft chapter.', default: true },
    { name: 'verify', type: 'boolean', description: 'After --apply, rebuild the course manifest of every published (track, source) pair and check it lists missions.', default: true },
    { name: 'cast', type: 'boolean', description: 'Print who plays each mission (roster character, fit, or uncast) in the plan.', default: false },
    { name: 'json-out', type: 'string', description: 'Write the plan summary (chapters, row counts, cast) to this JSON file.' },
  ],
  examples: ['seed-curriculum -- --dry-run', 'seed-curriculum -- --track arabic-moroccan --dry-run --cast', 'seed-curriculum -- --track arabic-moroccan --apply', 'seed-curriculum -- --apply --no-skeletons'],
};

// ---------------------------------------------------------------------------
// Plan (pure)
// ---------------------------------------------------------------------------

/** Seed provenance tag written into `scoring_rubric` / `script_annotations` so rows are traceable. */
export const SEED_PROVENANCE = 'seed-curriculum';
/** License id for LangQuest-authored draft content (original work, rights unverified until a reviewer signs off). */
export const SEED_LICENSE_ID = 'langquest-original-draft';

export type PlannedExpressionRow = Omit<Insert<'expressions'>, 'intent_id'> & { id: string; intentKey: string };
export type PlannedStepRow = Omit<Insert<'mission_steps'>, 'valid_intent_ids'> & { id: string; acceptedIntentKeys: string[] };
/** The mission's cast scenario (one per cast mission; `character_id` is the roster character's seeded uuid). */
export type PlannedScenarioRow = Omit<Insert<'dialogue_scenarios'>, 'expected_intent_ids'> & { id: string; mission_id: string; expectedIntentKeys: string[] };

/** Who plays a mission, and why (`plan.cast`; also stored in `missions.narrative_segment.casting`). */
export interface PlannedMissionCast {
  courseTrackId: CourseTrackId;
  chapterKey: string;
  missionKey: string;
  missionId: string;
  blueprintKey: string;
  /** Language-neutral role the blueprint asks for. */
  characterRole: string;
  targetVarietyId: string;
  fit: CastFit;
  preferred: MissionCasting;
  /** `null` when nobody in the variety carries the scene (no scenario row is written). */
  character: { id: string; characterKey: string; name: string | null; role: string; ageBand: CastMember['ageBand']; regionalOption: string | null } | null;
  reasons: string[];
}
export interface PlannedCoverageRow {
  course_track_id: CourseTrackId;
  source_language_code: SourceLanguageCode;
  metrics: CoverageMetrics;
}

export interface PlannedChapterSummary {
  courseTrackId: CourseTrackId;
  targetVarietyId: string;
  chapterKey: string;
  kind: 'draft' | 'skeleton';
  state: 'published' | 'review_needed';
  sourceLanguages: SourceLanguageCode[];
  missions: number;
  steps: number;
  expressions: number;
  localizations: number;
  /** Missions with a cast roster character / missions nobody in the variety could play. */
  cast: number;
  uncast: number;
}

export interface CurriculumSeedPlan {
  chapters: PlannedChapterSummary[];
  /** Per-mission casting outcome (every mission, cast or not). */
  cast: PlannedMissionCast[];
  /** Skeletons not loaded because a draft chapter already covers that chapter index of the track. */
  supersededSkeletons: { courseTrackId: CourseTrackId; chapterKey: string; supersededBy: string }[];
  /** Skills plan: one row per registry/system skill with its en/fr names; `problems` must be empty to apply. */
  skills: SkillSeedPlan;
  rows: {
    skills: SkillSeedRow[];
    contentRights: (Insert<'content_rights'> & { id: string })[];
    lessonCourses: (Insert<'lesson_courses'> & { id: string })[];
    chapters: (Insert<'chapters'> & { id: string })[];
    missions: (Insert<'missions'> & { id: string })[];
    missionSteps: PlannedStepRow[];
    dialogueScenarios: PlannedScenarioRow[];
    missionLocalizations: Insert<'mission_localizations'>[];
    expressions: PlannedExpressionRow[];
    expressionForms: (Insert<'expression_forms'> & { id: string })[];
    expressionTranslations: Insert<'expression_translations'>[];
    coverage: PlannedCoverageRow[];
  };
}

export interface PlanOptions {
  tracks?: readonly CourseTrackId[];
  includeSkeletons?: boolean;
  drafts?: readonly SeedChapter[];
  skeletons?: readonly SeedChapter[];
  /** Cast roster (default: the `@langquest/ui` roster as seeded by migration 140). */
  roster?: readonly CastMember[];
}

const pct = (num: number, den: number): number => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);
const clampPct = (v: number | undefined): number => Math.max(0, Math.min(100, Number.isFinite(v ?? NaN) ? (v as number) : 0));
const isDraft = (c: SeedChapter): boolean => c.provenance === 'ai_draft';
const seedTitle = (chapter: SeedChapter): string => `${chapter.key} (${chapter.provenance})`;

/** Objective description key convention (`@langquest/locales` may fill it; until then the API reports an empty description honestly). */
export const objectiveDescriptionKey = (blueprintKey: string, objectiveId: string): string => `curriculum.objective.${blueprintKey}.${objectiveId}`;

function rightsRow(chapter: SeedChapter): Insert<'content_rights'> & { id: string } {
  const provenance = isDraft(chapter) ? 'ai_draft' : 'skeleton';
  return {
    id: curriculumUuid('content_rights', curriculumSeedKeys.contentRights(chapter.key)),
    origin_url: null,
    authors: [chapter.generatedBy],
    speakers: [],
    permission_grant: `LangQuest original ${provenance} content (${chapter.generatedBy}); provenance=${provenance}; nativeReviewed=false; reviewStatus=${chapter.reviewStatus}. Rights unverified until a reviewer signs off.`,
    license_id: SEED_LICENSE_ID,
    license_version: null,
    commercial_redistribution: false,
    attribution_required: false,
    attribution_text: null,
    alterations_permitted: true,
    ai_processing_permitted: true,
    voice_rights: 'none',
    expires_at: null,
    revoked_at: null,
    evidence_asset_id: null,
    reviewer_id: null,
    reviewed_at: null,
    verified: false,
  };
}

function stepExpressions(step: BlueprintStep, expressions: readonly SeedExpression[]): SeedExpression[] {
  if (step.slots === 'none') return [];
  const withText = expressions.filter((e) => e.targetText !== null);
  return step.slots === 'all' ? withText : withText.filter((e) => e.speaker === step.slots);
}

function stepRows(chapter: SeedChapter, mission: SeedMission, bp: MissionBlueprint, missionId: string): PlannedStepRow[] {
  const scriptOptions = deriveScriptOptions(chapter.courseTrackId);
  const template = expandTemplate(bp, { includeScriptSupport: scriptOptions.hasTransliteration, level: bp.level });
  const learnerSlotIntents = [...new Set(bp.slots.filter((s) => s.speaker === 'learner').map((s) => s.intentKey))];
  const objectiveIntents = [...new Set(bp.objectives.flatMap((o) => o.intentKeys))];
  const requiredObjectiveIds = bp.objectives.filter((o) => o.required).map((o) => o.id);
  const rejectIntentKeys = [...new Set([...bp.rejectIntentKeys, 'insult'])];
  return template.map((t, order) => {
    const expressions = stepExpressions(t, mission.expressions);
    const isConversation = t.type === 'character_conversation' || t.type === 'story_branch';
    const expected = isConversation ? objectiveIntents : [...new Set(expressions.filter((e) => e.speaker === 'learner').map((e) => e.intentKey))];
    const acceptedIntentKeys = expected.length ? expected : learnerSlotIntents;
    const successConditions = {
      minOutcome: isConversation || t.type === 'anticipation' ? 'success' : 'partial',
      acceptedIntentKeys,
      requiredObjectiveIds: isConversation ? requiredObjectiveIds : [],
      requiresAttemptBeforeReveal: t.attemptBeforeReveal,
      maxHintsForAutonomy: t.hintsAllowed ? 1 : 0,
      rejectIntentKeys,
    };
    const branching = isConversation
      ? {
          rules: bp.branching.length
            ? bp.branching
            : [
                { when: 'all_required_completed', goTo: 'next', memoryNote: null },
                { when: 'partial', goTo: 'feedback', memoryNote: null },
                { when: 'none', goTo: 'conversation_again', memoryNote: null },
                { when: 'learner_asked_repair', goTo: 'retry_current', memoryNote: null },
              ],
          maxRetries: 2,
        }
      : null;
    return {
      id: curriculumUuid('mission_step', curriculumSeedKeys.missionStep(chapter.key, mission.key, order)),
      mission_id: missionId,
      sort_order: order,
      step_type: t.type,
      lesson_type: t.lessonType,
      prompt_asset_ids: [],
      visual_asset_ids: [],
      target_expression_ids: expressions.map((e) => curriculumUuid('expression', curriculumSeedKeys.expression(chapter.key, mission.key, e.key))),
      success_conditions: successConditions as unknown as JsonValue,
      // Language-neutral column: hints are realised per source language at runtime, never stored here.
      hint_scaffold: [],
      branching: branching as unknown as Json,
      // No audio exists yet, so a step that shows expressions cannot run offline (honest, like `realise()`).
      estimated_seconds: t.seconds,
      offline_capable: t.offlineCapable && expressions.length === 0,
      acceptedIntentKeys,
    };
  });
}

function expressionRows(chapter: SeedChapter, mission: SeedMission, bp: MissionBlueprint, publish: boolean, rightsId: string): { expressions: PlannedExpressionRow[]; forms: (Insert<'expression_forms'> & { id: string })[]; translations: Insert<'expression_translations'>[] } {
  const expressions: PlannedExpressionRow[] = [];
  const forms: (Insert<'expression_forms'> & { id: string })[] = [];
  const translations: Insert<'expression_translations'>[] = [];
  for (const e of mission.expressions) {
    // Skeleton expressions have no text by design — never a placeholder row.
    if (e.targetText === null) continue;
    const key = curriculumSeedKeys.expression(chapter.key, mission.key, e.key);
    const id = curriculumUuid('expression', key);
    expressions.push({
      id,
      intentKey: e.intentKey,
      target_variety_id: chapter.targetVarietyId,
      canonical_text: e.targetText,
      register: e.register,
      difficulty: e.difficulty,
      scenario_tags: [bp.key, chapter.key],
      script_annotations: {
        provenance: { draftId: key, seed: SEED_PROVENANCE, chapterKey: chapter.key, missionKey: mission.key, expressionKey: e.key, generatedBy: chapter.generatedBy, provenance: e.provenance, slotId: e.slotId, speaker: e.speaker },
        review: { nativeReviewed: false, reviewStatus: e.reviewStatus },
        notes: { codeSwitch: e.codeSwitchNote, pronunciation: e.pronunciationNote },
      } as unknown as JsonValue,
      phonetic_annotations: (e.pronunciationNote ? { note: e.pronunciationNote } : {}) as unknown as JsonValue,
      reviewed: false,
      reviewer_id: null,
      content_rights_id: rightsId,
      origin: 'ai_generated',
      // Published so RLS lets enrolled learners read the mission's expressions; `reviewed=false` keeps the draft label.
      state: publish ? 'published' : 'review_needed',
    });
    e.forms.forEach((f, index) => {
      forms.push({
        id: curriculumUuid('expression_form', curriculumSeedKeys.expressionForm(chapter.key, mission.key, e.key, index)),
        expression_id: id,
        script: f.script,
        transliteration_scheme: f.transliterationScheme,
        text: f.text,
        word_alignment: [] as unknown as JsonValue,
        tone_markers: null,
        ipa: null,
      });
    });
    for (const source of chapter.sourceLanguages) {
      const meaning = e.meanings[source];
      if (!meaning) continue;
      translations.push({ expression_id: id, source_language_code: source, natural_meaning: meaning.meaning, context_note: meaning.contextNote, literal_gloss: meaning.literalGloss, qa_state: 'needs_review', reviewer_id: null });
    }
  }
  return { expressions, forms, translations };
}

/** Cast every mission of a chapter from the roster of its variety (pure; see `castChapter`). */
export function castSeedChapter(chapter: SeedChapter, roster: readonly CastMember[]): Map<string, CastResult> {
  const regionalOption = chapter.characters.find((c) => c.regionalOption)?.regionalOption ?? null;
  return castChapter(
    chapter.missions.map((m) => ({ key: m.key, blueprint: getBlueprint(m.blueprintKey), casting: m.casting, rosterCharacterId: m.rosterCharacterId })),
    roster,
    { varietyId: chapter.targetVarietyId, regionalOption },
  );
}

function scenarioRow(chapter: SeedChapter, mission: SeedMission, bp: MissionBlueprint, missionId: string, characterId: string, publish: boolean): PlannedScenarioRow {
  const scene = bp.sceneVariants[0]!;
  return {
    id: curriculumUuid('dialogue_scenario', curriculumSeedKeys.dialogueScenario(chapter.key, mission.key)),
    mission_id: missionId,
    scene: scene.id,
    learner_role: bp.learnerRole,
    character_id: characterId,
    min_level: bp.level,
    max_level: 'advanced',
    expectedIntentKeys: [...new Set(bp.objectives.flatMap((o) => o.intentKeys))],
    interruption_policy: 'allow_barge_in',
    // The character row carries the guard-rails (seeded safety_rules); scene-level rules stay language-neutral facts.
    safety_rules: [],
    topic_rules: [`Stay in the "${bp.situation}" scene as the ${bp.characterRole}; the learner is the ${bp.learnerRole}.`],
    scene_facts: [...scene.sceneFacts, ...(scene.twist ? [`Twist: ${scene.twist}`] : [])],
    state: publish ? 'published' : 'review_needed',
  };
}

/**
 * One coverage row per instruction language of a course, measured over every draft chapter taught from it (a course
 * has one row per language, however many chapters): against the missions the story arc plans in those chapters.
 */
function coverageRows(chapters: readonly SeedChapter[], uiPct: Record<string, number>): PlannedCoverageRow[] {
  const sources = [...new Set(chapters.flatMap((c) => c.sourceLanguages))];
  return sources.map((source) => {
    const own = chapters.filter((c) => c.sourceLanguages.includes(source));
    const missions = own.flatMap((c) => c.missions);
    const expressions = missions.flatMap((m) => m.expressions);
    const withText = expressions.filter((e) => e.targetText !== null).length;
    const missionsWithOverlay = missions.filter((m) => m.titles[source] && m.expressions.some((e) => e.targetText !== null)).length;
    const withMeaning = expressions.filter((e) => e.targetText !== null && e.meanings[source]).length;
    const expectedMissions = arcMissionsThrough(Math.max(...own.map((c) => c.chapterIndex)));
    return {
      course_track_id: own[0]!.courseTrackId,
      source_language_code: source,
      metrics: {
        mission_instructions_pct: pct(missionsWithOverlay, Math.max(expectedMissions, missions.length)),
        explanations_pct: withText > 0 ? pct(withMeaning, withText) : 0,
        ui_pct: clampPct(uiPct[source]),
        subtitles_pct: 0,
        audio_overlays_pct: 0,
      },
    };
  });
}

/** Build the complete, deterministic seed plan. Pure (no I/O). */
export function buildCurriculumSeedPlan(options: PlanOptions = {}): CurriculumSeedPlan {
  const wanted = options.tracks ? new Set<string>(options.tracks) : null;
  const drafts = (options.drafts ?? DRAFT_CHAPTERS).filter((c) => !wanted || wanted.has(c.courseTrackId));
  const includeSkeletons = options.includeSkeletons ?? true;
  const skeletons = includeSkeletons ? (options.skeletons ?? buildAllPlannedSkeletons()).filter((c) => !wanted || wanted.has(c.courseTrackId)) : [];
  const supersededSkeletons: CurriculumSeedPlan['supersededSkeletons'] = [];
  const chapters: SeedChapter[] = [...drafts];
  for (const sk of skeletons) {
    const superseding = drafts.find((d) => d.courseTrackId === sk.courseTrackId && d.chapterIndex === sk.chapterIndex);
    if (superseding) supersededSkeletons.push({ courseTrackId: sk.courseTrackId, chapterKey: sk.key, supersededBy: superseding.key });
    else chapters.push(sk);
  }
  const uiPct = uiCoveragePctByLanguage();
  const roster = options.roster ?? CAST_ROSTER;
  const plan: CurriculumSeedPlan = {
    chapters: [],
    cast: [],
    supersededSkeletons,
    skills: { planned: [], referencedKeys: [], problems: [] },
    rows: { skills: [], contentRights: [], lessonCourses: [], chapters: [], missions: [], missionSteps: [], dialogueScenarios: [], missionLocalizations: [], expressions: [], expressionForms: [], expressionTranslations: [], coverage: [] },
  };

  // One lesson course per track (the default story arc); published when the track has a published draft chapter.
  const courseIds = new Map<CourseTrackId, string>();
  for (const track of COURSE_TRACKS) {
    const own = chapters.filter((c) => c.courseTrackId === track.id);
    if (own.length === 0) continue;
    const publish = own.some(isDraft);
    const rightsSource = own.find(isDraft) ?? own[0]!;
    const id = curriculumUuid('lesson_course', curriculumSeedKeys.lessonCourse(track.id, DEFAULT_STORY_ARC.key));
    courseIds.set(track.id, id);
    plan.rows.lessonCourses.push({
      id,
      course_track_id: track.id,
      // Editorial label only (the manifest never exposes course titles); learner-facing titles live on chapters/missions.
      title_translations: { en: track.displayName } as unknown as JsonValue,
      description_translations: {} as unknown as JsonValue,
      cover_visual_asset_id: null,
      sort_order: 0,
      state: publish ? 'published' : 'review_needed',
      content_rights_id: curriculumUuid('content_rights', curriculumSeedKeys.contentRights(rightsSource.key)),
      published_revision: publish ? 1 : null,
    });
  }

  for (const chapter of chapters) {
    const draft = isDraft(chapter);
    const publish = draft;
    const state = publish ? 'published' : 'review_needed';
    const rights = rightsRow(chapter);
    plan.rows.contentRights.push(rights);
    const chapterId = curriculumUuid('chapter', curriculumSeedKeys.chapter(chapter.key));
    const track = getCourseTrack(chapter.courseTrackId);
    plan.rows.chapters.push({
      id: chapterId,
      lesson_course_id: courseIds.get(chapter.courseTrackId)!,
      // Skeleton titles are catalog keys, not text: an editor must author the title before publishing.
      title_translations: (draft ? chapter.titles : {}) as unknown as JsonValue,
      description_translations: {} as unknown as JsonValue,
      sort_index: chapter.chapterIndex,
      scene: null,
      region: draft ? (chapter.characters[0]?.homeRegion ?? null) : null,
      cover_visual_asset_id: null,
      map_visual_asset_id: null,
      state,
    });
    const summary: PlannedChapterSummary = { courseTrackId: chapter.courseTrackId, targetVarietyId: chapter.targetVarietyId, chapterKey: chapter.key, kind: draft ? 'draft' : 'skeleton', state, sourceLanguages: [...chapter.sourceLanguages], missions: chapter.missions.length, steps: 0, expressions: 0, localizations: 0, cast: 0, uncast: 0 };
    const castResults = castSeedChapter(chapter, roster);

    chapter.missions.forEach((mission, sortOrder) => {
      const bp = getBlueprint(mission.blueprintKey);
      const missionId = curriculumUuid('mission', curriculumSeedKeys.mission(chapter.key, mission.key));
      const character = chapter.characters.find((c) => c.characterKey === mission.characterKey) ?? null;
      const cast = castResults.get(mission.key)!;
      const member = cast.character && cast.character.characterId ? cast.character : null;
      const plannedCast: PlannedMissionCast = {
        courseTrackId: chapter.courseTrackId,
        chapterKey: chapter.key,
        missionKey: mission.key,
        missionId,
        blueprintKey: bp.key,
        characterRole: bp.characterRole,
        targetVarietyId: chapter.targetVarietyId,
        fit: member ? cast.fit : 'none',
        preferred: cast.casting,
        character: member ? { id: member.characterId!, characterKey: member.id, name: member.name ?? null, role: member.role, ageBand: member.ageBand, regionalOption: member.regionalOption ?? null } : null,
        reasons: cast.reasons,
      };
      plan.cast.push(plannedCast);
      if (member) {
        plan.rows.dialogueScenarios.push(scenarioRow(chapter, mission, bp, missionId, member.characterId!, publish));
        summary.cast += 1;
      } else summary.uncast += 1;
      const withText = mission.expressions.filter((e) => e.targetText !== null);
      const difficulty = withText.length ? withText.reduce((a, e) => a + e.difficulty, 0) / withText.length : 0.25;
      plan.rows.missions.push({
        id: missionId,
        chapter_id: chapterId,
        template_key: null,
        mission_type: bp.missionType,
        title_translations: (draft ? mission.titles : {}) as unknown as JsonValue,
        goals: bp.objectives.map((o) => ({ id: o.id, skill_keys: [...o.skillKeys], description_key: objectiveDescriptionKey(bp.key, o.id), required: o.required })) as unknown as JsonValue,
        target_variety_id: chapter.targetVarietyId,
        level: bp.level,
        recommended_minutes: bp.recommendedMinutes,
        published_revision: publish ? 1 : null,
        prerequisite_skill_keys: [...bp.prerequisiteSkillKeys],
        difficulty: Math.round(difficulty * 1000) / 1000,
        narrative_segment: {
          blueprintKey: bp.key,
          titleKey: bp.titleKey,
          situation: bp.situation,
          learnerRole: bp.learnerRole,
          characterRole: bp.characterRole,
          sceneVariants: bp.sceneVariants,
          sceneNotes: mission.sceneNotes,
          character: character ? { key: character.characterKey, name: character.name, role: character.role, homeRegion: character.homeRegion, regionalOption: character.regionalOption, ageBand: character.ageBand } : null,
          // Roster cast (who the manifest lists for this mission, via dialogue_scenarios) and the preferences that chose it.
          casting: { preferred: plannedCast.preferred, fit: plannedCast.fit, character: plannedCast.character, reasons: plannedCast.reasons },
          region: track.displayName,
        } as unknown as JsonValue,
        scoring_rubric: {
          provenance: { draftId: curriculumSeedKeys.mission(chapter.key, mission.key), seed: SEED_PROVENANCE, chapterKey: chapter.key, missionKey: mission.key, generatedBy: chapter.generatedBy, provenance: chapter.provenance, nativeReviewed: false, reviewStatus: chapter.reviewStatus, notes: chapter.notes },
          objectives: bp.objectives,
          rejectIntentKeys: bp.rejectIntentKeys,
        } as unknown as JsonValue,
        sort_order: sortOrder,
        state,
      });
      const steps = stepRows(chapter, mission, bp, missionId);
      plan.rows.missionSteps.push(...steps);
      summary.steps += steps.length;
      if (draft) {
        for (const source of chapter.sourceLanguages) {
          const title = mission.titles[source];
          if (!title) continue;
          plan.rows.missionLocalizations.push({ mission_id: missionId, source_language_code: source, title, instructions: mission.sceneNotes[source] ?? '', hints: [], help_text: null, qa_state: 'needs_review', reviewer_id: null });
          summary.localizations += 1;
        }
      }
      const { expressions, forms, translations } = expressionRows(chapter, mission, bp, publish, rights.id);
      plan.rows.expressions.push(...expressions);
      plan.rows.expressionForms.push(...forms);
      plan.rows.expressionTranslations.push(...translations);
      summary.expressions += expressions.length;
    });
    plan.chapters.push(summary);
  }
  // Coverage: one row per (course, instruction language), over all of the course's draft chapters.
  for (const trackId of new Set(chapters.filter(isDraft).map((c) => c.courseTrackId))) {
    plan.rows.coverage.push(...coverageRows(chapters.filter((c) => isDraft(c) && c.courseTrackId === trackId), uiPct));
  }
  // Skills last: the plan must cover every key the curriculum and the mission rows above reference.
  plan.skills = buildSkillSeedPlan({ missions: plan.rows.missions });
  plan.rows.skills = plan.skills.planned.map((p) => p.row);
  return plan;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface TableCounts {
  inserted: number;
  updated: number;
  deleted: number;
  skipped: number;
}
export type ApplyCounts = Record<'skills' | 'content_rights' | 'lesson_courses' | 'chapters' | 'missions' | 'mission_steps' | 'dialogue_scenarios' | 'mission_localizations' | 'expressions' | 'expression_forms' | 'expression_translations' | 'expression_audio' | 'course_source_localizations', TableCounts>;

const CHUNK = 200;
const chunks = <T,>(rows: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
};
const fail = (ctx: string, error: { message: string } | null): void => {
  if (error) throw new Error(`${ctx}: ${error.message}`);
};
const emptyCounts = (): TableCounts => ({ inserted: 0, updated: 0, deleted: 0, skipped: 0 });

type IdTable = 'content_rights' | 'lesson_courses' | 'chapters' | 'missions' | 'mission_steps' | 'expressions' | 'expression_forms' | 'dialogue_scenarios';

async function existingIds(db: DbClient, table: IdTable, ids: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunks(ids)) {
    const res = await db.from(table).select('id').in('id', part);
    fail(`${table}.select`, res.error);
    for (const r of res.data ?? []) found.add(r.id);
  }
  return found;
}

async function upsertById<T extends { id: string }>(db: DbClient, table: IdTable, rows: readonly T[], counts: TableCounts): Promise<void> {
  if (rows.length === 0) return;
  const existing = await existingIds(db, table, rows.map((r) => r.id));
  for (const r of rows) if (existing.has(r.id)) counts.updated += 1; else counts.inserted += 1;
  for (const part of chunks(rows)) {
    const res = await db.from(table).upsert(part as never[], { onConflict: 'id' });
    fail(`${table}.upsert`, res.error);
  }
}

/** Remove rows of `table` that belong to the seeded parents but are not part of the plan any more (template drift). */
async function deleteStale(db: DbClient, table: 'mission_steps' | 'expression_forms', parentColumn: 'mission_id' | 'expression_id', parentIds: readonly string[], keepIds: ReadonlySet<string>, counts: TableCounts): Promise<void> {
  for (const part of chunks(parentIds)) {
    const res = await db.from(table).select('id').in(parentColumn, part);
    fail(`${table}.select stale`, res.error);
    const stale = (res.data ?? []).map((r) => r.id).filter((id) => !keepIds.has(id));
    for (const ids of chunks(stale)) {
      const del = await db.from(table).delete().in('id', ids);
      fail(`${table}.delete stale`, del.error);
      counts.deleted += ids.length;
    }
  }
}

/** Never lower a `published_revision` an editor raised through the admin publish flow. */
async function preservePublishedRevision<T extends { id: string; published_revision?: number | null }>(db: DbClient, table: 'lesson_courses' | 'missions', rows: T[]): Promise<void> {
  for (const part of chunks(rows.map((r) => r.id))) {
    const res = await db.from(table).select('id, published_revision').in('id', part);
    fail(`${table}.select revision`, res.error);
    const current = new Map((res.data ?? []).map((r) => [r.id, r.published_revision]));
    for (const row of rows) {
      const existing = current.get(row.id) ?? null;
      if (existing !== null && existing !== undefined && (row.published_revision ?? 0) < existing) row.published_revision = existing;
    }
  }
}

export async function applyCurriculumSeedPlan(db: DbClient, plan: CurriculumSeedPlan, io: CliIo): Promise<ApplyCounts> {
  if (plan.skills.problems.length) throw new Error(`skills plan has ${plan.skills.problems.length} problem(s); nothing applied: ${plan.skills.problems.join('; ')}`);
  const counts: ApplyCounts = {
    skills: emptyCounts(),
    content_rights: emptyCounts(),
    lesson_courses: emptyCounts(),
    chapters: emptyCounts(),
    missions: emptyCounts(),
    mission_steps: emptyCounts(),
    dialogue_scenarios: emptyCounts(),
    mission_localizations: emptyCounts(),
    expressions: emptyCounts(),
    expression_forms: emptyCounts(),
    expression_translations: emptyCounts(),
    expression_audio: emptyCounts(),
    course_source_localizations: emptyCounts(),
  };
  const intentIds = await ensureIntents(db);
  const skills = await applySkillSeed(db, plan.rows.skills);
  counts.skills = { inserted: skills.inserted, updated: skills.updated, deleted: skills.deleted, skipped: skills.skipped };
  io.log(`registries: ${intentIds.size} intents upserted; skills inserted=${skills.inserted} updated=${skills.updated} unchanged=${skills.skipped} (kept ${skills.keptExistingIds} pre-existing ids)`);
  const intentId = (key: string): string => {
    const id = intentIds.get(key);
    if (!id) throw new Error(`intent ${key} missing in communicative_intents`);
    return id;
  };

  await upsertById(db, 'content_rights', plan.rows.contentRights, counts.content_rights);
  const courses = plan.rows.lessonCourses.map((r) => ({ ...r }));
  await preservePublishedRevision(db, 'lesson_courses', courses);
  await upsertById(db, 'lesson_courses', courses, counts.lesson_courses);
  await upsertById(db, 'chapters', plan.rows.chapters, counts.chapters);
  const missions = plan.rows.missions.map((r) => ({ ...r }));
  await preservePublishedRevision(db, 'missions', missions);
  await upsertById(db, 'missions', missions, counts.missions);

  // Expressions before steps: `target_expression_ids` is a plain uuid[] (no FK), but readers expect the rows.
  const expressions = plan.rows.expressions.map(({ intentKey, ...row }) => ({ ...row, intent_id: intentId(intentKey) }));
  await upsertById(db, 'expressions', expressions, counts.expressions);
  await upsertById(db, 'expression_forms', plan.rows.expressionForms, counts.expression_forms);
  await deleteStale(db, 'expression_forms', 'expression_id', expressions.map((e) => e.id), new Set(plan.rows.expressionForms.map((f) => f.id)), counts.expression_forms);

  const steps = plan.rows.missionSteps.map(({ acceptedIntentKeys, ...row }) => ({ ...row, valid_intent_ids: acceptedIntentKeys.map(intentId) }));
  // Steps are unique on (mission_id, sort_order): drop stale ones first so a re-ordered template cannot collide.
  await deleteStale(db, 'mission_steps', 'mission_id', missions.map((m) => m.id), new Set(steps.map((s) => s.id)), counts.mission_steps);
  await upsertById(db, 'mission_steps', steps, counts.mission_steps);

  // Cast scenarios: one seed-owned row per cast mission (deterministic id). A mission that is no longer cast loses
  // only its seed-owned row; editor-authored scenarios of the same mission are never touched.
  const scenarios = plan.rows.dialogueScenarios.map(({ expectedIntentKeys, ...row }) => ({ ...row, expected_intent_ids: expectedIntentKeys.map(intentId) }));
  const keepScenarioIds = new Set(scenarios.map((sc) => sc.id));
  const uncastScenarioIds = plan.cast.filter((c) => !c.character).map((c) => curriculumUuid('dialogue_scenario', curriculumSeedKeys.dialogueScenario(c.chapterKey, c.missionKey))).filter((id) => !keepScenarioIds.has(id));
  for (const ids of chunks(uncastScenarioIds)) {
    const res = await db.from('dialogue_scenarios').select('id').in('id', ids);
    fail('dialogue_scenarios.select stale', res.error);
    const stale = (res.data ?? []).map((r) => r.id);
    if (stale.length === 0) continue;
    const del = await db.from('dialogue_scenarios').delete().in('id', stale);
    fail('dialogue_scenarios.delete stale', del.error);
    counts.dialogue_scenarios.deleted += stale.length;
  }
  await upsertById(db, 'dialogue_scenarios', scenarios, counts.dialogue_scenarios);

  if (plan.rows.missionLocalizations.length) {
    const missionIds = [...new Set(plan.rows.missionLocalizations.map((l) => l.mission_id))];
    const have = new Set<string>();
    for (const part of chunks(missionIds)) {
      const res = await db.from('mission_localizations').select('mission_id, source_language_code').in('mission_id', part);
      fail('mission_localizations.select', res.error);
      for (const r of res.data ?? []) have.add(`${r.mission_id}|${r.source_language_code}`);
    }
    for (const l of plan.rows.missionLocalizations) if (have.has(`${l.mission_id}|${l.source_language_code}`)) counts.mission_localizations.updated += 1; else counts.mission_localizations.inserted += 1;
    for (const part of chunks(plan.rows.missionLocalizations)) {
      const res = await db.from('mission_localizations').upsert(part, { onConflict: 'mission_id,source_language_code' });
      fail('mission_localizations.upsert', res.error);
    }
  }

  if (plan.rows.expressionTranslations.length) {
    const have = new Set<string>();
    for (const part of chunks(expressions.map((e) => e.id))) {
      const res = await db.from('expression_translations').select('expression_id, source_language_code').in('expression_id', part);
      fail('expression_translations.select', res.error);
      for (const r of res.data ?? []) have.add(`${r.expression_id}|${r.source_language_code}`);
    }
    for (const t of plan.rows.expressionTranslations) if (have.has(`${t.expression_id}|${t.source_language_code}`)) counts.expression_translations.updated += 1; else counts.expression_translations.inserted += 1;
    for (const part of chunks(plan.rows.expressionTranslations)) {
      const res = await db.from('expression_translations').upsert(part, { onConflict: 'expression_id,source_language_code' });
      fail('expression_translations.upsert', res.error);
    }
  }

  // Coverage: raise to `partial` with measured metrics; never touch a row a reviewer marked complete / native-reviewed.
  for (const cov of plan.rows.coverage) {
    const res = await db.from('course_source_localizations').select('id, status, native_reviewed, metrics').eq('course_track_id', cov.course_track_id).eq('source_language_code', cov.source_language_code).maybeSingle();
    fail('course_source_localizations.select', res.error);
    const existing = res.data;
    if (existing && (existing.native_reviewed || existing.status === 'complete')) {
      counts.course_source_localizations.skipped += 1;
      continue;
    }
    const metrics = { ...((existing?.metrics as Record<string, number> | null) ?? {}), ...cov.metrics };
    const up = await db.from('course_source_localizations').upsert({ course_track_id: cov.course_track_id, source_language_code: cov.source_language_code, status: 'partial', metrics: metrics as unknown as JsonValue, native_reviewed: false, editorial_note_key: 'enrollment.coverage.draftAvailable' }, { onConflict: 'course_track_id,source_language_code' });
    fail('course_source_localizations.upsert', up.error);
    if (existing) counts.course_source_localizations.updated += 1;
    else counts.course_source_localizations.inserted += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Verification: the manifest the learner API serves must list the published chapters' missions.
// ---------------------------------------------------------------------------

export interface ManifestCheck {
  courseTrackId: CourseTrackId;
  sourceLanguageCode: SourceLanguageCode;
  /** Seeded published chapters the manifest lists / expected. */
  seededChapters: number;
  expectedChapters: number;
  /** Seeded missions the manifest lists / expected. */
  seededMissions: number;
  expectedMissions: number;
  steps: number;
  /** Seeded missions whose title is in the requested source language. */
  titledInSource: number;
  /** Manifest `localizationComplete` is false until a reviewer approves the overlay — expected for drafts. */
  localizationComplete: number;
  /** Published chapters / missions in the manifest that the seed did not write (editor content or test leftovers). */
  foreignChapters: number;
  foreignMissions: number;
  /** Seeded missions the plan cast / whose manifest `characterIds` list exactly that roster character. */
  expectedCast: number;
  castListed: number;
  /** Seeded missions the plan left uncast (the manifest lists no character for them, honestly). */
  uncast: number;
  ok: boolean;
}

/** Rebuild the manifest of every published (track, source) pair and check it lists the seeded chapters and missions. */
export async function verifyManifests(db: DbClient, plan: CurriculumSeedPlan): Promise<ManifestCheck[]> {
  const repos = createRepositories(db);
  const publishedMissions = new Set(plan.rows.missions.filter((m) => m.state === 'published').map((m) => m.id));
  const castByMission = new Map(plan.cast.map((c) => [c.missionId, c.character?.id ?? null]));
  const pairs = new Map<string, { courseTrackId: CourseTrackId; sourceLanguageCode: SourceLanguageCode; chapterIds: Set<string>; missionIds: Set<string> }>();
  for (const summary of plan.chapters) {
    if (summary.state !== 'published') continue;
    const chapterId = curriculumUuid('chapter', curriculumSeedKeys.chapter(summary.chapterKey));
    const missionIds = plan.rows.missions.filter((m) => m.chapter_id === chapterId && publishedMissions.has(m.id)).map((m) => m.id);
    for (const s of summary.sourceLanguages) {
      const key = `${summary.courseTrackId}|${s}`;
      const pair = pairs.get(key) ?? { courseTrackId: summary.courseTrackId, sourceLanguageCode: s, chapterIds: new Set<string>(), missionIds: new Set<string>() };
      pair.chapterIds.add(chapterId);
      for (const id of missionIds) pair.missionIds.add(id);
      pairs.set(key, pair);
    }
  }
  const out: ManifestCheck[] = [];
  for (const { courseTrackId, sourceLanguageCode, chapterIds, missionIds } of pairs.values()) {
    const track = getCourseTrack(courseTrackId);
    const manifest = await repos.curriculum.buildManifest(courseTrackId, sourceLanguageCode, track.targetVarietyId);
    const allMissions = manifest.chapters.flatMap((ch) => ch.missions);
    const seeded = allMissions.filter((m) => missionIds.has(m.id));
    const seededChapters = manifest.chapters.filter((ch) => chapterIds.has(ch.id));
    const titledInSource = seeded.filter((m) => m.titleLanguageCode === sourceLanguageCode && m.title.trim().length > 0).length;
    const expectedCast = seeded.filter((m) => castByMission.get(m.id)).length;
    const castListed = seeded.filter((m) => {
      const id = castByMission.get(m.id);
      return id ? m.characterIds.includes(id) && manifest.characters.some((c) => c.id === id) : false;
    }).length;
    out.push({
      courseTrackId,
      sourceLanguageCode,
      seededChapters: seededChapters.length,
      expectedChapters: chapterIds.size,
      seededMissions: seeded.length,
      expectedMissions: missionIds.size,
      steps: seeded.reduce((n, m) => n + m.steps.length, 0),
      titledInSource,
      localizationComplete: seeded.filter((m) => m.localizationComplete).length,
      foreignChapters: manifest.chapters.length - seededChapters.length,
      foreignMissions: allMissions.length - seeded.length,
      expectedCast,
      castListed,
      uncast: seeded.filter((m) => !castByMission.get(m.id)).length,
      ok:
        seededChapters.length === chapterIds.size &&
        seeded.length === missionIds.size &&
        missionIds.size > 0 &&
        seeded.every((m) => m.steps.length > 0) &&
        titledInSource === seeded.length &&
        castListed === expectedCast &&
        seededChapters.every((ch) => ch.titleLanguageCode === sourceLanguageCode && ch.title.trim().length > 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseTracks(args: ParsedArgs): CourseTrackId[] | undefined {
  const list = flagList(args, 'track');
  if (list.length === 0) return undefined;
  const known = new Set<string>(COURSE_TRACKS.map((t) => t.id));
  const bad = list.filter((t) => !known.has(t));
  if (bad.length) throw new CliUsageError(`Unknown course track(s): ${bad.join(', ')}`);
  return list as CourseTrackId[];
}

export function summarisePlan(plan: CurriculumSeedPlan): Record<string, number> {
  const r = plan.rows;
  return {
    skills: r.skills.length,
    chapters_total: plan.chapters.length,
    chapters_published: plan.chapters.filter((c) => c.state === 'published').length,
    chapters_review_needed: plan.chapters.filter((c) => c.state === 'review_needed').length,
    content_rights: r.contentRights.length,
    lesson_courses: r.lessonCourses.length,
    chapters: r.chapters.length,
    missions: r.missions.length,
    mission_steps: r.missionSteps.length,
    dialogue_scenarios: r.dialogueScenarios.length,
    missions_cast: plan.cast.filter((c) => c.character).length,
    missions_uncast: plan.cast.filter((c) => !c.character).length,
    mission_localizations: r.missionLocalizations.length,
    expressions: r.expressions.length,
    expression_forms: r.expressionForms.length,
    expression_translations: r.expressionTranslations.length,
    expression_audio: 0,
    course_source_localizations: r.coverage.length,
  };
}

/** Injection points for tests; the defaults are the bundled plan builder and the real database resolver. */
export interface SeedCurriculumDeps {
  buildPlan: (options: PlanOptions) => CurriculumSeedPlan;
  resolveDb: () => ReturnType<typeof resolveServiceDb>;
}

const defaultDeps: SeedCurriculumDeps = { buildPlan: buildCurriculumSeedPlan, resolveDb: () => resolveServiceDb() };

export async function main(args: ParsedArgs, io: CliIo, deps: SeedCurriculumDeps = defaultDeps): Promise<number> {
  loadRootEnv();
  const plan = deps.buildPlan({ tracks: parseTracks(args), includeSkeletons: flagBool(args, 'skeletons') });
  for (const c of plan.chapters) io.log(`${c.kind.padEnd(8)} ${c.state.padEnd(13)} ${c.courseTrackId.padEnd(24)} ${c.chapterKey.padEnd(34)} sources=${c.sourceLanguages.join(',').padEnd(5)} missions=${c.missions} steps=${c.steps} expressions=${c.expressions} localizations=${c.localizations} cast=${c.cast} uncast=${c.uncast}`);
  for (const s of plan.supersededSkeletons) io.log(`skip     superseded    ${s.courseTrackId.padEnd(24)} ${s.chapterKey.padEnd(34)} (draft ${s.supersededBy} covers chapter 1)`);
  if (flagBool(args, 'cast')) {
    for (const c of plan.cast) {
      const who = c.character ? `${c.character.characterKey} (${c.character.role}, ${c.character.ageBand})` : '— nobody in the variety carries this scene';
      io.log(`cast     ${c.fit.padEnd(8)} ${c.courseTrackId.padEnd(24)} ${c.missionKey.padEnd(40)} ${c.characterRole.padEnd(32)} → ${who}`);
    }
  }
  const totals = summarisePlan(plan);
  io.log(`plan: ${Object.entries(totals).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  io.log('expression_audio: 0 rows by design (no verified media asset exists; nothing is faked)');
  io.log(describeSkillSeedPlan(plan.skills));
  const jsonOut = flagString(args, 'json-out');
  if (jsonOut) {
    const path = resolve(repoRoot(), jsonOut);
    const skills = plan.skills.planned.map((p) => ({ skillKey: p.row.skill_key, id: p.row.id, kind: p.kind, nameKey: p.nameKey, names: p.names, referencedBy: p.referencedBy }));
    writeJsonFileSync(path, { generatedAt: new Date().toISOString(), totals, chapters: plan.chapters, supersededSkeletons: plan.supersededSkeletons, coverage: plan.rows.coverage, cast: plan.cast, skills, skillProblems: plan.skills.problems });
    io.log(`wrote ${path}`);
  }
  if (plan.skills.problems.length) {
    for (const p of plan.skills.problems) io.error(`skills: ${p}`);
    io.error('skills plan has problems: nothing applied (every referenced skill needs a row and en+fr names)');
    return 1;
  }
  if (args.dryRun || !flagBool(args, 'apply')) {
    io.log(args.dryRun ? 'dry-run: nothing applied' : 'nothing applied: pass --apply to write to the database');
    return 0;
  }

  const resolved = deps.resolveDb();
  if (!resolved) {
    io.error('No database reachable: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (local) or start the local stack (pnpm supabase start).');
    return 1;
  }
  const probe = await probeDb(resolved.client);
  if (!probe.ok) {
    io.error(`Database not reachable at ${resolved.url}: ${probe.reason}`);
    return 1;
  }
  if (probe.trackCount !== 30) {
    io.error(`course_tracks has ${probe.trackCount} rows (expected 30): run seed-languages first.`);
    return 1;
  }
  io.log(`applying to ${resolved.url} (${resolved.source})`);
  const counts = await applyCurriculumSeedPlan(resolved.client, plan, io);
  for (const [table, c] of Object.entries(counts)) io.log(`${table.padEnd(28)} inserted=${c.inserted} updated=${c.updated} deleted=${c.deleted} skipped=${c.skipped}`);
  const published = [...new Set(plan.chapters.filter((c) => c.state === 'published').map((c) => c.courseTrackId))];
  io.log(`published draft chapters: ${published.join(', ') || '(none)'}`);

  if (!flagBool(args, 'verify')) return 0;
  const checks = await verifyManifests(resolved.client, plan);
  let ok = true;
  for (const c of checks) {
    ok &&= c.ok;
    io.log(`manifest ${c.courseTrackId} × ${c.sourceLanguageCode}: seededChapters=${c.seededChapters}/${c.expectedChapters} seededMissions=${c.seededMissions}/${c.expectedMissions} steps=${c.steps} titledInSource=${c.titledInSource} localizationComplete=${c.localizationComplete} cast=${c.castListed}/${c.expectedCast} uncast=${c.uncast} foreignChapters=${c.foreignChapters} foreignMissions=${c.foreignMissions} ${c.ok ? 'OK' : 'FAILED'}`);
    if (c.foreignChapters || c.foreignMissions) io.warn(`manifest ${c.courseTrackId} × ${c.sourceLanguageCode}: ${c.foreignChapters} published chapter(s) / ${c.foreignMissions} mission(s) were not written by this seed (editor content or test leftovers; left untouched)`);
  }
  if (!ok) io.error('manifest verification failed: a seeded published chapter is missing from its manifest, a seeded mission has no steps / no title in the requested source language, or a cast character is not listed in characterIds');
  return ok ? 0 : 1;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
