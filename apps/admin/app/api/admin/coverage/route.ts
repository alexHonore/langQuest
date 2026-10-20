import { LocalApiError, adminRoute, throwDb } from '@/src/lib/local-api/handler';
import { CoverageUpdateSchema } from '@/src/lib/local-api/schemas';

/**
 * PUT /api/admin/coverage — editorial status of one (track, source) pair.
 * Honesty rules mirror @langquest/locales `generateCourseSourceLocalizationRows`: `complete`
 * needs a native review with every metric at 100; a fallback is never set on complete rows.
 */
export const PUT = adminRoute('languages', CoverageUpdateSchema, async ({ supabase, session, body }) => {
  const m = body.metrics;
  const allFull = Object.values(m).every((v) => v >= 100);
  if (body.status === 'complete' && !(body.nativeReviewed && allFull)) {
    throw new LocalApiError('validation_failed', '"complete" requires nativeReviewed and every metric at 100%.');
  }
  if (body.status === 'complete' && body.fallbackSourceLanguageCode) {
    throw new LocalApiError('validation_failed', 'A complete pair must not advertise a fallback language.');
  }
  if (body.fallbackSourceLanguageCode === body.sourceLanguageCode) {
    throw new LocalApiError('validation_failed', 'Fallback must differ from the source language.');
  }
  const { data, error } = await supabase
    .from('course_source_localizations')
    .update({
      status: body.status,
      metrics: m,
      native_reviewed: body.nativeReviewed,
      reviewer_id: body.nativeReviewed ? session.userId : null,
      reviewed_at: body.nativeReviewed ? new Date().toISOString() : null,
      editorial_note_key: body.editorialNoteKey,
      fallback_source_language_code: body.fallbackSourceLanguageCode,
    })
    .eq('course_track_id', body.courseTrackId)
    .eq('source_language_code', body.sourceLanguageCode)
    .select('id, status')
    .maybeSingle();
  if (error) throwDb(error, 'course_source_localizations');
  if (!data) throw new LocalApiError('not_found', 'Coverage row missing; run the catalog seed.');
  return { id: data.id, status: data.status };
});
