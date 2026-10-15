/**
 * Enrollments (§2.1, §5.1). Every enrollment carries its own `source_language_code`;
 * `changeSourceLanguage` goes through the `set_enrollment_source_language` RPC which touches
 * nothing but that column (mastery, reviews, XP and bookmarks are preserved by construction).
 *
 * Script mode is a property of the TARGET track, never of the source language (§2.3, §10.1):
 * when the caller omits it, the catalog's `defaultScriptMode` for the track is persisted
 * (`'both'` for Darija, Cantonese, Hebrew… — never a blanket `'native'`), and an explicit value
 * must be one of the track's `scriptModeOptions`.
 */
import {
  getCourseTrack,
  isCourseTrackId,
  isSourceLanguageCode,
  resolveScriptMode,
  type CourseTrackId,
  type ScriptMode,
  type SourceLanguageCode,
} from '@langquest/contracts';
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import type { Insert, Row, Update } from '../types';

export interface CreateEnrollmentInput {
  userId: string;
  courseTrackId: CourseTrackId;
  /** Required: the instruction language of this enrollment (prefilled by the caller from the profile default). */
  sourceLanguageCode: SourceLanguageCode;
  /**
   * Optional explicit script mode. Must be one of the track's `scriptModeOptions`; when omitted the
   * track's catalog `defaultScriptMode` is stored (resolved with `resolveScriptMode`).
   */
  scriptMode?: ScriptMode | null;
  regionalPreference?: string | null;
  preferredTargetVariantId?: string | null;
  learnerLevel?: Row<'user_course_enrollments'>['learner_level'];
  preferredLearningSpeed?: Row<'user_course_enrollments'>['preferred_learning_speed'];
}

export interface EnrollmentsRepository {
  getById(id: string): Promise<Row<'user_course_enrollments'> | null>;
  listForUser(
    userId: string,
    opts?: { includeArchived?: boolean },
  ): Promise<Row<'user_course_enrollments'>[]>;
  /**
   * Creates an enrollment. Throws when `sourceLanguageCode` or `courseTrackId` is not a catalog
   * value, or when an explicit `scriptMode` is not supported by the track.
   */
  create(input: CreateEnrollmentInput): Promise<Row<'user_course_enrollments'>>;
  /**
   * Generic patch (status, script mode, regional preference, level…). Never use it to change the
   * source language. A `script_mode` in the patch is validated against the enrollment's track.
   */
  update(
    id: string,
    patch: Omit<
      Update<'user_course_enrollments'>,
      'source_language_code' | 'user_id' | 'course_track_id'
    >,
  ): Promise<Row<'user_course_enrollments'>>;
  /** Changes ONLY the instruction language via RPC; progress/mastery untouched. */
  changeSourceLanguage(
    id: string,
    sourceLanguageCode: SourceLanguageCode,
  ): Promise<Row<'user_course_enrollments'>>;
  touchOpened(id: string, at?: Date): Promise<void>;
  setActiveMission(id: string, missionId: string | null): Promise<void>;
}

/**
 * Validates an explicit script mode against the track's catalog options and resolves the
 * stored value (the track default when `requested` is null/undefined). Exported for unit tests.
 *
 * @throws Error when `requested` is set but not one of the track's `scriptModeOptions`.
 */
export function resolveEnrollmentScriptMode(
  courseTrackId: CourseTrackId,
  requested: string | null | undefined,
): ScriptMode {
  const track = getCourseTrack(courseTrackId);
  if (requested != null) {
    if (!(track.scriptModeOptions as readonly string[]).includes(requested)) {
      throw new Error(
        `Script mode '${requested}' is not supported by track '${courseTrackId}' (allowed: ${track.scriptModeOptions.join(', ')})`,
      );
    }
    return resolveScriptMode(courseTrackId, requested as ScriptMode);
  }
  return resolveScriptMode(courseTrackId, null);
}

export function enrollmentsRepository(db: DbClient): EnrollmentsRepository {
  const getById = async (id: string) =>
    unwrapMaybe(
      await db.from('user_course_enrollments').select('*').eq('id', id).single(),
      'enrollments.getById',
    );

  return {
    getById,
    async listForUser(userId, opts) {
      let q = db
        .from('user_course_enrollments')
        .select('*')
        .eq('user_id', userId)
        .order('added_at', { ascending: false });
      if (!opts?.includeArchived) q = q.neq('status', 'archived');
      return unwrap(await q, 'enrollments.listForUser');
    },
    async create(input) {
      if (!isCourseTrackId(input.courseTrackId))
        throw new Error(`Unknown course track: ${String(input.courseTrackId)}`);
      if (!isSourceLanguageCode(input.sourceLanguageCode))
        throw new Error(`Unknown source language: ${String(input.sourceLanguageCode)}`);
      const row: Insert<'user_course_enrollments'> = {
        user_id: input.userId,
        course_track_id: input.courseTrackId,
        source_language_code: input.sourceLanguageCode,
        // Derived from the target track's catalog entry — independent of the source language.
        script_mode: resolveEnrollmentScriptMode(input.courseTrackId, input.scriptMode),
        regional_preference: input.regionalPreference ?? null,
        preferred_target_variant_id: input.preferredTargetVariantId ?? null,
        learner_level: input.learnerLevel ?? 'beginner',
        preferred_learning_speed: input.preferredLearningSpeed ?? 'regular',
      };
      return unwrap(
        await db.from('user_course_enrollments').insert(row).select('*').single(),
        'enrollments.create',
      );
    },
    async update(id, patch) {
      if (patch.script_mode != null) {
        const current = await getById(id);
        if (!current) throw new Error(`Enrollment not found: ${id}`);
        if (!isCourseTrackId(current.course_track_id))
          throw new Error(`Unknown course track: ${current.course_track_id}`);
        resolveEnrollmentScriptMode(current.course_track_id, patch.script_mode);
      }
      return unwrap(
        await db.from('user_course_enrollments').update(patch).eq('id', id).select('*').single(),
        'enrollments.update',
      );
    },
    async changeSourceLanguage(id, sourceLanguageCode) {
      if (!isSourceLanguageCode(sourceLanguageCode))
        throw new Error(`Unknown source language: ${String(sourceLanguageCode)}`);
      return unwrap(
        await db
          .rpc('set_enrollment_source_language', {
            p_enrollment_id: id,
            p_source_language_code: sourceLanguageCode,
          })
          .single(),
        'enrollments.changeSourceLanguage',
      ) as Row<'user_course_enrollments'>;
    },
    async touchOpened(id, at = new Date()) {
      unwrap(
        await db
          .from('user_course_enrollments')
          .update({ last_opened_at: at.toISOString() })
          .eq('id', id),
        'enrollments.touchOpened',
      );
    },
    async setActiveMission(id, missionId) {
      unwrap(
        await db
          .from('user_course_enrollments')
          .update({ active_mission_id: missionId })
          .eq('id', id),
        'enrollments.setActiveMission',
      );
    },
  };
}
