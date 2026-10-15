/**
 * Enrollment access + `LanguageContext` construction (CONVENTIONS §2.3). Every mission/AI/audio call is scoped
 * to ONE enrollment, which carries its own `source_language_code`; the context is derived from the row, never
 * from the profile default.
 */
import { buildLanguageContext, getCourseTrack, isCourseTrackId, type LanguageContext, type LearnerLevel, type ScriptMode } from '@langquest/contracts';
import type { DbClient } from '@langquest/db/client';
import type { Row } from '@langquest/db/types';
import { problem } from '../http/envelope';

export type EnrollmentRow = Row<'user_course_enrollments'>;

/** Load an enrollment through the learner's RLS-bound client; a foreign or missing id is a 404 (never a leak). */
export async function loadOwnedEnrollment(db: DbClient, enrollmentId: string, options: { allowArchived?: boolean } = {}): Promise<EnrollmentRow> {
  const res = await db.from('user_course_enrollments').select('*').eq('id', enrollmentId).maybeSingle();
  if (res.error) throw problem.internal('Could not read the enrollment');
  if (!res.data) throw problem.notFound('Enrollment');
  if (res.data.status === 'archived' && !options.allowArchived) throw problem.precondition('This course is archived; restore it before continuing');
  return res.data;
}

export function languageContextFor(enrollment: EnrollmentRow, uiLocale: string): LanguageContext {
  if (!isCourseTrackId(enrollment.course_track_id)) throw problem.internal('Enrollment references an unknown track');
  return buildLanguageContext({
    uiLocale: uiLocale || 'en',
    enrollmentId: enrollment.id,
    sourceLanguageCode: enrollment.source_language_code,
    courseTrackId: enrollment.course_track_id,
    scriptMode: enrollment.script_mode as ScriptMode,
    regionalPreference: enrollment.regional_preference,
    learnerLevel: enrollment.learner_level as LearnerLevel,
  });
}

export const varietyOf = (enrollment: EnrollmentRow) => {
  if (!isCourseTrackId(enrollment.course_track_id)) throw problem.internal('Enrollment references an unknown track');
  return getCourseTrack(enrollment.course_track_id).targetVarietyId;
};

/** Dialect boundaries are never crossed silently: a request naming another variety is rejected. */
export function assertVarietyMatches(enrollment: EnrollmentRow, requested: string): void {
  const expected = varietyOf(enrollment);
  if (requested !== expected) throw problem.validation(`This enrollment teaches ${expected}; ${requested} is a different variety and cannot be substituted`);
}

export async function loadUiLocale(db: DbClient, userId: string): Promise<string> {
  const res = await db.from('profiles').select('ui_locale').eq('user_id', userId).maybeSingle();
  return res.data?.ui_locale ?? 'en';
}
