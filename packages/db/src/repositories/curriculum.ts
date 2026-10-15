/**
 * Curriculum reads/writes (§5.2) and course-manifest assembly (ADR-004).
 * Learner clients only ever see published rows (RLS); editor clients see drafts.
 *
 * Honest localization (§2.1): a manifest requested for source language `S` never silently
 * substitutes another language's titles. A title is served in `S`, or in the fallback language
 * the (track, S) coverage row explicitly declares (`course_source_localizations.fallback_source_language_code`,
 * which the learner opts into in the UI), or it is empty — and `titleLanguageCode` always says which.
 */
import {
  MANIFEST_FORMAT_VERSION,
  isSourceLanguageCode,
  type CourseManifest,
  type ManifestChapter,
  type ManifestCharacter,
  type ManifestMission,
  type ManifestStep,
  type SourceLanguageCode,
} from '@langquest/contracts';
import { createHash } from 'node:crypto';
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import type { Insert, Row, Update } from '../types';

/**
 * Which language a manifest title is actually in.
 *
 * Gap note: `@langquest/contracts` `ManifestChapterSchema` has no such field yet (and its
 * `ManifestMissionSchema` only has `localizationComplete`); until it does, these fields are
 * carried as a structural extension of the contract types so clients can render a coverage
 * notice instead of foreign-language text.
 */
export interface ManifestTitleLocalization {
  /**
   * Language of `title`: the requested source language, the coverage row's declared fallback,
   * or `null` when no usable title exists in either (then `title` is `''`).
   */
  titleLanguageCode: SourceLanguageCode | null;
  /** True only when `title` is in the requested source language. */
  localizationComplete: boolean;
}
export type LocalizedManifestMission = ManifestMission &
  Pick<ManifestTitleLocalization, 'titleLanguageCode'>;
export type LocalizedManifestChapter = Omit<ManifestChapter, 'missions'> &
  ManifestTitleLocalization & { missions: LocalizedManifestMission[] };
/** `CourseManifest` whose chapters/missions say which language each title is in. */
export type LocalizedCourseManifest = Omit<CourseManifest, 'chapters'> & {
  chapters: LocalizedManifestChapter[];
};

export interface ResolvedManifestTitle {
  title: string;
  titleLanguageCode: SourceLanguageCode | null;
}

/**
 * Picks a title from a `*_translations` JSON object without silent substitution:
 * the requested source language first, then ONLY the explicitly declared fallback language,
 * otherwise an empty title. Never "the first available language" and never an implicit `en`.
 */
export function resolveManifestTitle(
  translations: unknown,
  sourceLanguageCode: string,
  fallbackSourceLanguageCode: string | null | undefined,
): ResolvedManifestTitle {
  const titles = (
    translations !== null && typeof translations === 'object' && !Array.isArray(translations)
      ? translations
      : {}
  ) as Record<string, unknown>;
  const pick = (code: string | null | undefined): string | null => {
    if (!code) return null;
    const value = titles[code];
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  };
  const own = pick(sourceLanguageCode);
  if (own !== null)
    return {
      title: own,
      titleLanguageCode: isSourceLanguageCode(sourceLanguageCode) ? sourceLanguageCode : null,
    };
  const fallback = pick(fallbackSourceLanguageCode);
  if (
    fallback !== null &&
    fallbackSourceLanguageCode &&
    isSourceLanguageCode(fallbackSourceLanguageCode)
  ) {
    return { title: fallback, titleLanguageCode: fallbackSourceLanguageCode };
  }
  return { title: '', titleLanguageCode: null };
}

export interface MissionBundle {
  mission: Row<'missions'>;
  steps: Row<'mission_steps'>[];
  /** Localization for the enrollment's source language, or null when none exists (never a silent fallback). */
  localization: Row<'mission_localizations'> | null;
  expressions: Row<'expressions'>[];
  forms: Row<'expression_forms'>[];
  /** Translations in the requested source language only. */
  translations: Row<'expression_translations'>[];
  audio: Row<'expression_audio'>[];
}

export interface CurriculumRepository {
  listCourses(courseTrackId: string): Promise<Row<'lesson_courses'>[]>;
  listChapters(lessonCourseId: string): Promise<Row<'chapters'>[]>;
  listMissions(chapterId: string): Promise<Row<'missions'>[]>;
  getMission(id: string): Promise<Row<'missions'> | null>;
  getMissionSteps(missionId: string): Promise<Row<'mission_steps'>[]>;
  getMissionLocalization(
    missionId: string,
    sourceLanguageCode: string,
  ): Promise<Row<'mission_localizations'> | null>;
  /** Everything a client needs to run one mission, scoped to a source language. */
  getMissionBundle(missionId: string, sourceLanguageCode: string): Promise<MissionBundle | null>;
  getExpressions(ids: string[]): Promise<Row<'expressions'>[]>;
  listCharacters(targetVarietyId: string): Promise<Row<'characters'>[]>;
  getCharacter(id: string): Promise<Row<'characters'> | null>;
  listScenarios(missionId: string): Promise<Row<'dialogue_scenarios'>[]>;
  listSkills(): Promise<Row<'skills'>[]>;
  /**
   * Assembles a versioned course manifest for (track, source) from published rows.
   * Titles are in `sourceLanguageCode`, or in the fallback language the coverage row declares,
   * or empty — each chapter/mission carries `titleLanguageCode` saying which (§2.1).
   */
  buildManifest(
    courseTrackId: string,
    sourceLanguageCode: string,
    targetVarietyId: string,
  ): Promise<LocalizedCourseManifest>;
  // editor writes
  upsertMission(mission: Insert<'missions'>): Promise<Row<'missions'>>;
  updateMission(id: string, patch: Update<'missions'>): Promise<Row<'missions'>>;
  replaceMissionSteps(
    missionId: string,
    steps: Omit<Insert<'mission_steps'>, 'mission_id'>[],
  ): Promise<Row<'mission_steps'>[]>;
  upsertMissionLocalization(
    loc: Insert<'mission_localizations'>,
  ): Promise<Row<'mission_localizations'>>;
  insertExpression(expr: Insert<'expressions'>): Promise<Row<'expressions'>>;
  upsertExpressionTranslation(
    tr: Insert<'expression_translations'>,
  ): Promise<Row<'expression_translations'>>;
  // --- content-factory / importer helpers (migration 100, cross-package gaps from scripts + jobs) ---
  getIntentByKey(intentKey: string): Promise<Row<'communicative_intents'> | null>;
  listIntents(): Promise<Row<'communicative_intents'>[]>;
  insertExpressionForm(form: Insert<'expression_forms'>): Promise<Row<'expression_forms'>>;
  listExpressionForms(expressionId: string): Promise<Row<'expression_forms'>[]>;
  /**
   * Idempotent lookup of a generated expression by the draft id its provenance recorded
   * (`script_annotations -> provenance -> draftId`, JSONB containment).
   */
  findExpressionByDraftId(draftId: string): Promise<Row<'expressions'> | null>;
  /** Missions whose scoring rubric records a content-factory draft id (`scoring_rubric -> provenance -> draftId`). */
  findMissionByDraftId(draftId: string): Promise<Row<'missions'> | null>;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function curriculumRepository(db: DbClient): CurriculumRepository {
  const getMissionSteps = async (missionId: string) =>
    unwrap(
      await db.from('mission_steps').select('*').eq('mission_id', missionId).order('sort_order'),
      'curriculum.getMissionSteps',
    );
  const getMissionLocalization = async (missionId: string, sourceLanguageCode: string) =>
    unwrapMaybe(
      await db
        .from('mission_localizations')
        .select('*')
        .eq('mission_id', missionId)
        .eq('source_language_code', sourceLanguageCode)
        .single(),
      'curriculum.getMissionLocalization',
    );
  const getExpressions = async (ids: string[]) =>
    ids.length === 0
      ? []
      : unwrap(await db.from('expressions').select('*').in('id', ids), 'curriculum.getExpressions');

  return {
    async listCourses(courseTrackId) {
      return unwrap(
        await db
          .from('lesson_courses')
          .select('*')
          .eq('course_track_id', courseTrackId)
          .order('sort_order'),
        'curriculum.listCourses',
      );
    },
    async listChapters(lessonCourseId) {
      return unwrap(
        await db
          .from('chapters')
          .select('*')
          .eq('lesson_course_id', lessonCourseId)
          .order('sort_index'),
        'curriculum.listChapters',
      );
    },
    async listMissions(chapterId) {
      return unwrap(
        await db.from('missions').select('*').eq('chapter_id', chapterId).order('sort_order'),
        'curriculum.listMissions',
      );
    },
    async getMission(id) {
      return unwrapMaybe(
        await db.from('missions').select('*').eq('id', id).single(),
        'curriculum.getMission',
      );
    },
    getMissionSteps,
    getMissionLocalization,
    async getMissionBundle(missionId, sourceLanguageCode) {
      const mission = unwrapMaybe(
        await db.from('missions').select('*').eq('id', missionId).single(),
        'curriculum.getMissionBundle',
      );
      if (!mission) return null;
      const [steps, localization] = await Promise.all([
        getMissionSteps(missionId),
        getMissionLocalization(missionId, sourceLanguageCode),
      ]);
      const expressionIds = [...new Set(steps.flatMap((s) => s.target_expression_ids))];
      const expressions = await getExpressions(expressionIds);
      const [forms, translations, audio] = expressionIds.length
        ? await Promise.all([
            unwrap(
              await db.from('expression_forms').select('*').in('expression_id', expressionIds),
              'curriculum.forms',
            ),
            unwrap(
              await db
                .from('expression_translations')
                .select('*')
                .in('expression_id', expressionIds)
                .eq('source_language_code', sourceLanguageCode),
              'curriculum.translations',
            ),
            unwrap(
              await db.from('expression_audio').select('*').in('expression_id', expressionIds),
              'curriculum.audio',
            ),
          ])
        : [[], [], []];
      return { mission, steps, localization, expressions, forms, translations, audio };
    },
    getExpressions,
    async listCharacters(targetVarietyId) {
      return unwrap(
        await db
          .from('characters')
          .select('*')
          .eq('target_variety_id', targetVarietyId)
          .order('name'),
        'curriculum.listCharacters',
      );
    },
    async getCharacter(id) {
      return unwrapMaybe(
        await db.from('characters').select('*').eq('id', id).single(),
        'curriculum.getCharacter',
      );
    },
    async listScenarios(missionId) {
      return unwrap(
        await db.from('dialogue_scenarios').select('*').eq('mission_id', missionId),
        'curriculum.listScenarios',
      );
    },
    async listSkills() {
      return unwrap(
        await db.from('skills').select('*').order('skill_key'),
        'curriculum.listSkills',
      );
    },
    async buildManifest(courseTrackId, sourceLanguageCode, targetVarietyId) {
      const courses = unwrap(
        await db
          .from('lesson_courses')
          .select('*')
          .eq('course_track_id', courseTrackId)
          .eq('state', 'published')
          .order('sort_order'),
        'manifest.courses',
      );
      const courseIds = courses.map((c) => c.id);
      const chapters = courseIds.length
        ? unwrap(
            await db
              .from('chapters')
              .select('*')
              .in('lesson_course_id', courseIds)
              .eq('state', 'published')
              .order('sort_index'),
            'manifest.chapters',
          )
        : [];
      const chapterIds = chapters.map((c) => c.id);
      const missions = chapterIds.length
        ? unwrap(
            await db
              .from('missions')
              .select('*')
              .in('chapter_id', chapterIds)
              .eq('state', 'published')
              .order('sort_order'),
            'manifest.missions',
          )
        : [];
      const missionIds = missions.map((m) => m.id);
      const [steps, localizations, characters] = missionIds.length
        ? await Promise.all([
            unwrap(
              await db
                .from('mission_steps')
                .select('*')
                .in('mission_id', missionIds)
                .order('sort_order'),
              'manifest.steps',
            ),
            unwrap(
              await db
                .from('mission_localizations')
                .select('*')
                .in('mission_id', missionIds)
                .eq('source_language_code', sourceLanguageCode),
              'manifest.localizations',
            ),
            unwrap(
              await db
                .from('characters')
                .select('*')
                .eq('target_variety_id', targetVarietyId)
                .eq('state', 'published'),
              'manifest.characters',
            ),
          ])
        : [[], [], []];
      const scenarios = missionIds.length
        ? unwrap(
            await db
              .from('dialogue_scenarios')
              .select('mission_id, character_id')
              .in('mission_id', missionIds)
              .eq('state', 'published'),
            'manifest.scenarios',
          )
        : [];
      // The only language we may substitute for a missing title: the fallback the coverage row
      // declares for this (track, source) pair. No row / no fallback → empty titles, honestly.
      const coverage = unwrapMaybe(
        await db
          .from('course_source_localizations')
          .select('fallback_source_language_code')
          .eq('course_track_id', courseTrackId)
          .eq('source_language_code', sourceLanguageCode)
          .maybeSingle(),
        'manifest.coverage',
      );
      const fallbackSourceLanguageCode = coverage?.fallback_source_language_code ?? null;
      const scenariosByMission = new Map<string, string[]>();
      for (const sc of scenarios)
        if (sc.mission_id)
          scenariosByMission.set(sc.mission_id, [
            ...new Set([...(scenariosByMission.get(sc.mission_id) ?? []), sc.character_id]),
          ]);
      const locByMission = new Map(localizations.map((l) => [l.mission_id, l]));
      const stepsByMission = new Map<string, Row<'mission_steps'>[]>();
      for (const s of steps)
        stepsByMission.set(s.mission_id, [...(stepsByMission.get(s.mission_id) ?? []), s]);

      const manifestChapters: LocalizedManifestChapter[] = chapters.map((ch) => {
        const chapterTitle = resolveManifestTitle(
          ch.title_translations,
          sourceLanguageCode,
          fallbackSourceLanguageCode,
        );
        const descriptions = (ch.description_translations ?? {}) as Record<string, unknown>;
        const description = descriptions[sourceLanguageCode];
        return {
          id: ch.id,
          order: ch.sort_index,
          title: chapterTitle.title,
          titleLanguageCode: chapterTitle.titleLanguageCode,
          localizationComplete: chapterTitle.titleLanguageCode === sourceLanguageCode,
          description: typeof description === 'string' ? description : null,
          scene: ch.scene,
          region: ch.region,
          coverArt: null,
          mapArt: null,
          missions: missions
            .filter((m) => m.chapter_id === ch.id)
            .map((m): LocalizedManifestMission => {
              const loc = locByMission.get(m.id);
              const goals =
                (m.goals as { id: string; skill_keys: string[]; description_key: string }[]) ?? [];
              // A mission_localizations row is by construction in the requested source language;
              // otherwise the editorial title translations are resolved without silent substitution.
              const missionTitle: ResolvedManifestTitle =
                loc && loc.title.trim().length > 0
                  ? {
                      title: loc.title,
                      titleLanguageCode: isSourceLanguageCode(sourceLanguageCode)
                        ? sourceLanguageCode
                        : null,
                    }
                  : resolveManifestTitle(
                      m.title_translations,
                      sourceLanguageCode,
                      fallbackSourceLanguageCode,
                    );
              return {
                id: m.id,
                order: m.sort_order,
                type: m.mission_type as ManifestMission['type'],
                titleKey: null,
                title: missionTitle.title,
                titleLanguageCode: missionTitle.titleLanguageCode,
                level: m.level as ManifestMission['level'],
                difficulty: m.difficulty,
                recommendedMinutes: Number(m.recommended_minutes),
                prerequisiteSkillKeys: m.prerequisite_skill_keys,
                skillKeys: [...new Set(goals.flatMap((g) => g.skill_keys ?? []))],
                characterIds: scenariosByMission.get(m.id) ?? [],
                sceneArt: null,
                publishedRevision: m.published_revision ?? 0,
                localizationComplete:
                  loc != null && (loc.qa_state === 'reviewed' || loc.qa_state === 'approved'),
                steps: (stepsByMission.get(m.id) ?? []).map((s): ManifestStep => ({
                  id: s.id,
                  order: s.sort_order,
                  type: s.step_type as ManifestStep['type'],
                  lessonType: (s.lesson_type as ManifestStep['lessonType']) ?? null,
                  estimatedSeconds: s.estimated_seconds,
                  expressionIds: s.target_expression_ids,
                  assets: [],
                  visuals: [],
                  offlineCapable: s.offline_capable,
                })),
              };
            }),
        };
      });

      const body = {
        formatVersion: MANIFEST_FORMAT_VERSION,
        courseTrackId: courseTrackId as CourseManifest['courseTrackId'],
        sourceLanguageCode: sourceLanguageCode as CourseManifest['sourceLanguageCode'],
        targetVarietyId: targetVarietyId as CourseManifest['targetVarietyId'],
        chapters: manifestChapters,
        characters: characters.map((c): ManifestCharacter => ({
          id: c.id,
          name: c.name,
          role: c.role,
          varietyId: c.target_variety_id as ManifestCharacter['varietyId'],
          portrait: null,
          syntheticVoice: Boolean((c.voice_profile as Record<string, unknown>).synthetic ?? true),
        })),
      };
      const checksum = sha256(JSON.stringify(body));
      const version = Math.max(
        0,
        ...missions.map((m) => m.published_revision ?? 0),
        ...courses.map((c) => c.published_revision ?? 0),
      );
      const manifest: LocalizedCourseManifest = {
        ...body,
        version,
        checksum,
        generatedAt: new Date().toISOString(),
        coverArt: null,
        cacheTtlSeconds: 3600,
      };
      return manifest;
    },
    async upsertMission(mission) {
      return unwrap(
        await db.from('missions').upsert(mission).select('*').single(),
        'curriculum.upsertMission',
      );
    },
    async updateMission(id, patch) {
      return unwrap(
        await db.from('missions').update(patch).eq('id', id).select('*').single(),
        'curriculum.updateMission',
      );
    },
    async replaceMissionSteps(missionId, steps) {
      unwrap(
        await db.from('mission_steps').delete().eq('mission_id', missionId),
        'curriculum.replaceMissionSteps.delete',
      );
      if (steps.length === 0) return [];
      const rows = steps.map((s, i) => ({
        ...s,
        mission_id: missionId,
        sort_order: s.sort_order ?? i,
      }));
      return unwrap(
        await db.from('mission_steps').insert(rows).select('*').order('sort_order'),
        'curriculum.replaceMissionSteps.insert',
      );
    },
    async upsertMissionLocalization(loc) {
      return unwrap(
        await db
          .from('mission_localizations')
          .upsert(loc, { onConflict: 'mission_id,source_language_code' })
          .select('*')
          .single(),
        'curriculum.upsertMissionLocalization',
      );
    },
    async insertExpression(expr) {
      return unwrap(
        await db.from('expressions').insert(expr).select('*').single(),
        'curriculum.insertExpression',
      );
    },
    async getIntentByKey(intentKey) {
      return unwrapMaybe(
        await db.from('communicative_intents').select('*').eq('intent_key', intentKey).maybeSingle(),
        'curriculum.getIntentByKey',
      );
    },
    async listIntents() {
      return unwrap(
        await db.from('communicative_intents').select('*').order('intent_key'),
        'curriculum.listIntents',
      );
    },
    async insertExpressionForm(form) {
      return unwrap(
        await db.from('expression_forms').insert(form).select('*').single(),
        'curriculum.insertExpressionForm',
      );
    },
    async listExpressionForms(expressionId) {
      return unwrap(
        await db.from('expression_forms').select('*').eq('expression_id', expressionId),
        'curriculum.listExpressionForms',
      );
    },
    async findExpressionByDraftId(draftId) {
      const rows = unwrap(
        await db
          .from('expressions')
          .select('*')
          .contains('script_annotations', { provenance: { draftId } })
          .order('created_at')
          .limit(1),
        'curriculum.findExpressionByDraftId',
      );
      return rows[0] ?? null;
    },
    async findMissionByDraftId(draftId) {
      const rows = unwrap(
        await db
          .from('missions')
          .select('*')
          .contains('scoring_rubric', { provenance: { draftId } })
          .order('created_at')
          .limit(1),
        'curriculum.findMissionByDraftId',
      );
      return rows[0] ?? null;
    },
    async upsertExpressionTranslation(tr) {
      return unwrap(
        await db
          .from('expression_translations')
          .upsert(tr, { onConflict: 'expression_id,source_language_code' })
          .select('*')
          .single(),
        'curriculum.upsertExpressionTranslation',
      );
    },
  };
}
