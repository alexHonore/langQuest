/**
 * §6.1 enrollments: create (source language REQUIRED, §6.5), list, patch. Changing `sourceLanguageCode`
 * goes through the `set_enrollment_source_language` RPC, which touches nothing but that column — mastery,
 * reviews, attempts, XP and bookmarks survive (§15 "preserve target skill data", A04).
 *
 * Archiving (status → `archived`) and the destructive DELETE both require an explicit confirmation query
 * (`?confirm=archive` / `?confirm=delete`) so a stray request never erases a course (§15 "User removes a course").
 */
import { EnrollmentCreateRequestSchema, EnrollmentPatchRequestSchema, EnrollmentsListResponseSchema, UuidSchema, getCourseTrack, type CourseTrackId, type SourceLanguageCode } from '@langquest/contracts';
import { DbError } from '@langquest/db/errors';
import type { Context } from 'hono';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { courseCapabilitiesFor, courseCapabilitiesForPairs, pairKey } from '../../lib/course-capabilities';
import { enrollmentToDto, COVERAGE_COLUMNS, type CoverageRow } from '../../lib/dto';
import { loadOwnedEnrollment } from '../../lib/enrollment';
import type { RequestServices } from '../../services/context';
import type { AppEnv } from '../../types';

const IdParams = z.object({ id: UuidSchema });

async function coverageRow(s: RequestServices, trackId: string, source: string): Promise<CoverageRow | null> {
  const res = await s.service.from('course_source_localizations').select(COVERAGE_COLUMNS).eq('course_track_id', trackId).eq('source_language_code', source).maybeSingle();
  return (res.data as CoverageRow | null) ?? null;
}

async function dto(s: RequestServices, row: Awaited<ReturnType<typeof loadOwnedEnrollment>>) {
  const coverage = await coverageRow(s, row.course_track_id, row.source_language_code);
  const capabilities = await courseCapabilitiesFor(s, row.course_track_id as CourseTrackId, row.source_language_code as SourceLanguageCode, coverage);
  return enrollmentToDto(row, coverage, capabilities);
}

const svc = (c: Context<AppEnv>): RequestServices => c.get('services')!;

export function registerEnrollmentRoutes(define: DefineRoute): void {
  define('enrollmentsCreate', {}, async (c) => {
    const body = await parseBody(c, EnrollmentCreateRequestSchema);
    const s = svc(c);
    const { repos, principal } = s.requireUser();
    if (body.targetVarietyId) {
      const expected = getCourseTrack(body.courseTrackId).targetVarietyId;
      if (body.targetVarietyId !== expected) throw problem.validation(`Track ${body.courseTrackId} teaches ${expected}, not ${body.targetVarietyId}`);
    }
    try {
      const row = await repos.enrollments.create({
        userId: principal.userId,
        courseTrackId: body.courseTrackId,
        sourceLanguageCode: body.sourceLanguageCode,
        scriptMode: body.scriptMode ?? null,
        regionalPreference: body.regionalPreference ?? null,
        learnerLevel: body.learnerLevel,
        preferredLearningSpeed: body.preferredLearningSpeed,
      });
      s.log.info('enrollment.created', { enrollmentId: row.id, track: row.course_track_id, source: row.source_language_code });
      return respondOk(c, await dto(s, row), 201);
    } catch (error) {
      if (error instanceof DbError && error.isUniqueViolation) {
        throw problem.conflict('You already have an active enrollment for this course. Change its source language with PATCH instead of creating a second one.');
      }
      if (error instanceof Error && /Script mode/.test(error.message)) throw problem.validation(error.message);
      throw error;
    }
  });

  define('enrollmentsList', {}, async (c) => {
    const s = svc(c);
    const { repos, principal } = s.requireUser();
    const includeArchived = parseQuery(c, z.object({ includeArchived: z.coerce.boolean().default(false) })).includeArchived;
    const rows = await repos.enrollments.listForUser(principal.userId, { includeArchived });
    const coverage = rows.length
      ? ((await s.service.from('course_source_localizations').select(COVERAGE_COLUMNS).in('course_track_id', [...new Set(rows.map((r) => r.course_track_id))])).data as CoverageRow[] | null) ?? []
      : [];
    const find = (t: string, src: string) => coverage.find((r) => r.course_track_id === t && r.source_language_code === src) ?? null;
    const capabilities = await courseCapabilitiesForPairs(s, rows.map((r) => ({ trackId: r.course_track_id as CourseTrackId, source: r.source_language_code as SourceLanguageCode, coverageRow: find(r.course_track_id, r.source_language_code) })));
    return respondOk(c, EnrollmentsListResponseSchema.parse({ enrollments: rows.map((r) => enrollmentToDto(r, find(r.course_track_id, r.source_language_code), capabilities.get(pairKey(r.course_track_id, r.source_language_code)))) }));
  });

  define('enrollmentPatch', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, EnrollmentPatchRequestSchema);
    const confirm = parseQuery(c, z.object({ confirm: z.string().optional() })).confirm;
    const s = svc(c);
    const { db, repos } = s.requireUser();
    let row = await loadOwnedEnrollment(db, id, { allowArchived: true });
    if (body.status === 'archived' && row.status !== 'archived' && confirm !== 'archive') {
      throw problem.precondition('Archiving a course needs confirmation: repeat the request with ?confirm=archive. Progress is kept and the course can be restored.', { requiredConfirmation: 'archive' });
    }
    if (body.sourceLanguageCode !== undefined && body.sourceLanguageCode !== row.source_language_code) {
      try {
        row = await repos.enrollments.changeSourceLanguage(id, body.sourceLanguageCode);
      } catch (error) {
        if (error instanceof DbError && error.isUniqueViolation) throw problem.conflict('You already have an enrollment for this course with that source language');
        throw error;
      }
      s.log.info('enrollment.source_changed', { enrollmentId: id, source: body.sourceLanguageCode });
    }
    const patch: Record<string, unknown> = {};
    if (body.scriptMode !== undefined) patch.script_mode = body.scriptMode;
    if (body.preferredTargetVariantId !== undefined) patch.preferred_target_variant_id = body.preferredTargetVariantId;
    if (body.regionalPreference !== undefined) patch.regional_preference = body.regionalPreference;
    if (body.learnerLevel !== undefined) patch.learner_level = body.learnerLevel;
    if (body.status !== undefined) patch.status = body.status;
    if (body.preferredLearningSpeed !== undefined) patch.preferred_learning_speed = body.preferredLearningSpeed;
    if (body.translationPeekLanguageCode !== undefined) patch.translation_peek_language_code = body.translationPeekLanguageCode;
    if (Object.keys(patch).length) {
      try {
        row = await repos.enrollments.update(id, patch);
      } catch (error) {
        if (error instanceof Error && /Script mode/.test(error.message)) throw problem.validation(error.message);
        if (error instanceof DbError && error.isUniqueViolation) throw problem.conflict('Another active enrollment exists for this course');
        throw error;
      }
    }
    return respondOk(c, await dto(s, row));
  });
}

/**
 * Extension (not in `ROUTES`): permanently delete ONE enrollment and its progress. Requires `?confirm=delete`.
 * Other enrollments and the account are untouched (cascade is scoped by enrollment_id).
 */
export const ENROLLMENT_DELETE_PATH = '/v1/me/enrollments/:id';
export async function deleteEnrollmentHandler(c: Context<AppEnv>): Promise<Response> {
  const { id } = parseParams(c, IdParams);
  const confirm = parseQuery(c, z.object({ confirm: z.string().optional() })).confirm;
  const s = svc(c);
  const { db } = s.requireUser();
  await loadOwnedEnrollment(db, id, { allowArchived: true });
  if (confirm !== 'delete') throw problem.precondition('Deleting a course erases its progress permanently. Repeat with ?confirm=delete, or archive it instead.', { requiredConfirmation: 'delete' });
  const res = await db.from('user_course_enrollments').delete().eq('id', id);
  if (res.error) throw new DbError(res.error, 'enrollments.delete');
  s.log.info('enrollment.deleted', { enrollmentId: id });
  return respondOk(c, { deleted: true, enrollmentId: id });
}
