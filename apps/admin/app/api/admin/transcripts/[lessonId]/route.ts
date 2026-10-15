import { adminRoute, LocalApiError, recordRevision, throwDb } from '@/src/lib/local-api/handler';
import { TranscriptReplaceSchema } from '@/src/lib/local-api/schemas';

/**
 * PUT /api/admin/transcripts/:lessonId — saves an edited transcript as a NEW revision
 * (segments + per-source translations). Earlier revisions are kept (§7.5 "reviewed version",
 * rollback). The lesson's transcript_status follows the saved status.
 */
export const PUT = adminRoute('transcripts', TranscriptReplaceSchema, async ({ supabase, session, params, body }) => {
  const lessonId = params.lessonId!;
  for (const s of body.segments) if (s.endMs < s.startMs) throw new LocalApiError('validation_failed', `Segment ${s.sortIndex}: end before start`);
  const { data: last } = await supabase.from('transcripts').select('revision, source_asset_id').eq('lesson_id', lessonId).order('revision', { ascending: false }).limit(1).maybeSingle();
  const revision = (last?.revision ?? -1) + 1;
  const coveredMs = body.segments.reduce((acc, s) => acc + Math.max(0, s.endMs - s.startMs), 0);
  const coveragePct = body.durationMs && body.durationMs > 0 ? Math.min(100, Math.round((coveredMs / body.durationMs) * 100)) : 0;
  const { data: transcript, error } = await supabase
    .from('transcripts')
    .insert({
      lesson_id: lessonId,
      language_mode: body.languageMode,
      primary_language_code: body.primaryLanguageCode,
      revision,
      coverage_pct: coveragePct,
      status: body.status,
      qa_state: body.qaState,
      access_rights: body.accessRights,
      source_asset_id: last?.source_asset_id ?? null,
      manually_uploaded: true,
    })
    .select('id')
    .single();
  if (error) throwDb(error, 'transcripts');
  if (body.segments.length > 0) {
    const rows = body.segments.map((s) => ({
      transcript_id: transcript.id,
      sort_index: s.sortIndex,
      start_ms: s.startMs,
      end_ms: s.endMs,
      text: s.text,
      speaker_label: s.speakerLabel,
      speaker_id: s.speakerId,
      language_code: s.languageCode,
      target_variety_id: s.targetVarietyId,
      confidence: s.confidence,
      reviewed: s.reviewed,
    }));
    const { data: inserted, error: segError } = await supabase.from('transcript_segments').insert(rows).select('id, sort_index');
    if (segError) throwDb(segError, 'transcript_segments');
    const idByIndex = new Map(inserted.map((r) => [r.sort_index, r.id]));
    const translations = body.segments.flatMap((s) =>
      s.translations.map((tr) => ({
        segment_id: idByIndex.get(s.sortIndex)!,
        language_code: tr.languageCode,
        text: tr.text,
        qa_state: tr.qaState,
        reviewer_id: tr.qaState === 'reviewed' || tr.qaState === 'approved' ? session.userId : null,
      })),
    );
    if (translations.length > 0) {
      const { error: trError } = await supabase.from('transcript_translations').insert(translations);
      if (trError) throwDb(trError, 'transcript_translations');
    }
  }
  const { error: lessonError } = await supabase.from('audio_lessons').update({ transcript_status: body.status }).eq('id', lessonId);
  if (lessonError) throwDb(lessonError, 'audio_lessons.transcript_status');
  await recordRevision(supabase, session, 'transcripts', transcript.id, { revision, segments: body.segments.length }, null, body.note ?? 'transcript edit');
  return { transcriptId: transcript.id, revision, coveragePct };
});
