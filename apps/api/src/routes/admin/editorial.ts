/**
 * §7 Studio editorial writes (R-4.3-01): coverage editorial status, transcript revisions, approve / reject
 * decisions and revision rollback. These used to be local Next route handlers in `apps/admin` writing through the
 * staff session; the Worker now applies the server-verified role gate (`user_roles`), writes with the service client
 * and audit-logs every mutation. Honesty rules are the shared planners in `@langquest/contracts` (`admin-studio.ts`).
 *
 * Role sets follow the Studio's role table (`docs/content-rights/native-review-process.md`): language reviewers set
 * coverage / native review, save reviewed transcript revisions and approve or reject drafts; rollback is editors only.
 * Within a transcript save, who can read the transcript (`transcripts.access_rights`) and the lesson's
 * `transcript_status` stay editor-owned, as in RLS (`editor_*` policies on `transcripts` / `audio_lessons`): a
 * reviewer's revision keeps the previous revision's access rights and leaves the lesson row alone.
 *
 * A decision is the native review of what it decides: approving an expression sets `reviewed` + `reviewer_id`, and
 * approving / rejecting an audio lesson sets its `quality_review_status` in the same write (the Studio's Quality
 * review calls only this route for lessons in review, so a reviewer never needs the editor-only lesson PATCH).
 * Every revision these routes write for a rollback table carries its restorable snapshot (`./content`
 * `recordRestorableRevision`), so each one can be restored; a rollback of published content refreshes the learner
 * manifests that list it.
 */
import {
  ContentDecisionRequestSchema,
  ContentDecisionResponseSchema,
  ContentRollbackRequestSchema,
  ContentRollbackResponseSchema,
  CoverageUpdateRequestSchema,
  CoverageUpdateResponseSchema,
  TranscriptSaveRequestSchema,
  TranscriptSaveResponseSchema,
  UuidSchema,
  coverageUpdateViolation,
  planDecision,
  rollbackPatch,
  transcriptCoverageOf,
  transcriptSaveViolation,
  type JsonValue,
  type TranscriptSaveRequest,
} from '@langquest/contracts';
import { unwrap, unwrapMaybe } from '@langquest/db/errors';
import type { Insert, Row } from '@langquest/db/types';
import { canTransitionContent } from '@langquest/media/rights';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { ApiProblem, problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams } from '../../http/validate';
import { loadContent, recordPublicationEvent, stateOf, type ContentRow } from '../../lib/content';
import { hasAnyRole } from '../../middleware/auth';
import type { RequestServices } from '../../services/context';
import { invalidatePublishedContent, recordRestorableRevision, type ManifestSubject } from './content';

const IdParams = z.object({ id: UuidSchema });
const LessonParams = z.object({ lessonId: UuidSchema });

/** Transcript bodies carry up to 20,000 segments with per-source translations. */
export const TRANSCRIPT_BODY_LIMIT_BYTES = 16 * 1024 * 1024;
/** Rows per PostgREST insert when writing segments / translations. */
const INSERT_CHUNK = 1000;

/** `audio_lessons.quality_review_status` a lesson decision records (its native review, like `expressions.reviewed`). */
const LESSON_QUALITY_STATUS = { approve: 'approved', reject: 'rejected' } as const;

/**
 * Append the `content_revisions` mirror of a transcript save (the `transcripts` row itself is the revision record;
 * transcripts are not a rollback table, so there is no snapshot). Numbering: latest revision + 1, starting at 1.
 */
async function appendRevision(s: RequestServices, entityTable: string, entityId: string, diff: Record<string, unknown>, snapshot: Record<string, unknown> | null, note: string): Promise<number> {
  const { principal } = s.requireUser();
  const last = unwrapMaybe(await s.service.from('content_revisions').select('revision').eq('entity_table', entityTable).eq('entity_id', entityId).order('revision', { ascending: false }).limit(1).maybeSingle(), 'content_revisions.latest');
  const revision = (last?.revision ?? 0) + 1;
  unwrap(await s.service.from('content_revisions').insert({ entity_table: entityTable, entity_id: entityId, revision, diff: diff as never, snapshot: snapshot as never, editor_id: principal.userId, note }), 'content_revisions.insert');
  return revision;
}

/** Insert transcript segments + translations for `transcriptId` in chunks; returns the number of segment rows. */
async function insertTranscriptRows(s: RequestServices, transcriptId: string, segments: TranscriptSaveRequest['segments'], reviewerId: string): Promise<number> {
  const idByIndex = new Map<number, string>();
  for (let i = 0; i < segments.length; i += INSERT_CHUNK) {
    const rows: Insert<'transcript_segments'>[] = segments.slice(i, i + INSERT_CHUNK).map((seg) => ({
      transcript_id: transcriptId,
      sort_index: seg.sortIndex,
      start_ms: seg.startMs,
      end_ms: seg.endMs,
      text: seg.text,
      speaker_label: seg.speakerLabel,
      speaker_id: seg.speakerId,
      language_code: seg.languageCode,
      target_variety_id: seg.targetVarietyId,
      confidence: seg.confidence,
      reviewed: seg.reviewed,
    }));
    const inserted = unwrap(await s.service.from('transcript_segments').insert(rows).select('id, sort_index'), 'transcript_segments.insert');
    for (const r of inserted) idByIndex.set(r.sort_index, r.id);
  }
  const translations: Insert<'transcript_translations'>[] = segments.flatMap((seg) =>
    seg.translations.map((tr) => ({
      segment_id: idByIndex.get(seg.sortIndex)!,
      language_code: tr.languageCode,
      text: tr.text,
      qa_state: tr.qaState,
      reviewer_id: tr.qaState === 'reviewed' || tr.qaState === 'approved' ? reviewerId : null,
    })),
  );
  for (let i = 0; i < translations.length; i += INSERT_CHUNK) unwrap(await s.service.from('transcript_translations').insert(translations.slice(i, i + INSERT_CHUNK)), 'transcript_translations.insert');
  return idByIndex.size;
}

export function registerEditorialRoutes(define: DefineRoute): void {
  /** Coverage editorial status of one (track, instruction language) pair. Rows come from the catalog seed. */
  define('adminCoveragePut', { role: 'languageReviewer' }, async (c) => {
    const body = await parseBody(c, CoverageUpdateRequestSchema);
    const violation = coverageUpdateViolation(body);
    if (violation) throw problem.validation(violation);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const current = unwrapMaybe(
      await s.service.from('course_source_localizations').select('id, status, native_reviewed, fallback_source_language_code').eq('course_track_id', body.courseTrackId).eq('source_language_code', body.sourceLanguageCode).maybeSingle(),
      'course_source_localizations.get',
    );
    if (!current) throw new ApiProblem('not_found', 'Coverage row missing; run the catalog seed.');
    const updated = unwrap(
      await s.service
        .from('course_source_localizations')
        .update({
          status: body.status,
          metrics: body.metrics,
          native_reviewed: body.nativeReviewed,
          reviewer_id: body.nativeReviewed ? principal.userId : null,
          reviewed_at: body.nativeReviewed ? new Date().toISOString() : null,
          editorial_note_key: body.editorialNoteKey,
          fallback_source_language_code: body.fallbackSourceLanguageCode,
        })
        .eq('id', current.id)
        .select('id, status')
        .single(),
      'course_source_localizations.update',
    );
    s.audit({ action: 'coverage.update', entityTable: 'course_source_localizations', entityId: updated.id, before: { status: current.status, nativeReviewed: current.native_reviewed, fallback: current.fallback_source_language_code }, after: { courseTrackId: body.courseTrackId, sourceLanguageCode: body.sourceLanguageCode, status: body.status, nativeReviewed: body.nativeReviewed, fallback: body.fallbackSourceLanguageCode, metrics: body.metrics } });
    return respondOk(c, CoverageUpdateResponseSchema.parse({ id: updated.id, status: updated.status }));
  });

  /** Save an edited transcript as a NEW revision; earlier revisions stay (§7.5 reviewed version, rollback). */
  define('adminTranscriptSave', { role: 'languageReviewer', bodyLimitBytes: TRANSCRIPT_BODY_LIMIT_BYTES, timeoutMs: 55_000 }, async (c) => {
    const { lessonId } = parseParams(c, LessonParams);
    const body = await parseBody(c, TranscriptSaveRequestSchema);
    const violation = transcriptSaveViolation(body.segments);
    if (violation) throw problem.validation(violation);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const lesson = unwrapMaybe(await s.service.from('audio_lessons').select('id, transcript_status').eq('id', lessonId).maybeSingle(), 'audio_lessons.get');
    if (!lesson) throw problem.notFound('Lesson');
    const last = unwrapMaybe(await s.service.from('transcripts').select('revision, source_asset_id, access_rights').eq('lesson_id', lessonId).order('revision', { ascending: false }).limit(1).maybeSingle(), 'transcripts.latest');
    // Access rights decide whether learners read the revision (RLS `learner_select`); only editors change them.
    const editor = hasAnyRole(principal, 'contentEditor');
    const inheritedAccess = last?.access_rights ?? 'internal_only';
    if (!editor && body.accessRights !== inheritedAccess) {
      throw new ApiProblem('forbidden', 'Only content editors change who can read a transcript; keep the current access rights to save your review.', { accessRights: inheritedAccess });
    }
    const accessRights = editor ? body.accessRights : inheritedAccess;
    const revision = (last?.revision ?? -1) + 1;
    const coveragePct = transcriptCoverageOf(body.segments, body.durationMs);
    const transcript = unwrap(
      await s.service
        .from('transcripts')
        .insert({
          lesson_id: lessonId,
          language_mode: body.languageMode,
          primary_language_code: body.primaryLanguageCode,
          revision,
          coverage_pct: coveragePct,
          status: body.status,
          qa_state: body.qaState,
          access_rights: accessRights,
          source_asset_id: last?.source_asset_id ?? null,
          manually_uploaded: true,
        })
        .select('id')
        .single(),
      'transcripts.insert',
    );
    let segments: number;
    try {
      segments = await insertTranscriptRows(s, transcript.id, body.segments, principal.userId);
    } catch (error) {
      // Never leave a half-written revision behind (segments / translations cascade with the transcript row).
      const cleanup = await s.service.from('transcripts').delete().eq('id', transcript.id);
      if (cleanup.error) s.log.error('transcript.cleanup_failed', { transcriptId: transcript.id, error: cleanup.error.message });
      throw error;
    }
    // The lesson row is editor-owned (RLS `editor_update` on audio_lessons); a reviewer's save leaves it unchanged.
    if (editor) unwrap(await s.service.from('audio_lessons').update({ transcript_status: body.status }).eq('id', lessonId), 'audio_lessons.transcript_status');
    await appendRevision(s, 'transcripts', transcript.id, { revision, segments }, null, body.note ?? 'transcript edit').catch((error: unknown) => {
      // The transcript row IS the revision record; the content_revisions mirror is best-effort.
      s.log.warn('transcript.revision_record_failed', { transcriptId: transcript.id, error });
    });
    s.audit({ action: 'transcript.save', entityTable: 'transcripts', entityId: transcript.id, before: { lessonId, transcriptStatus: lesson.transcript_status, previousRevision: last?.revision ?? null }, after: { lessonId, revision, status: body.status, accessRights, lessonStatusUpdated: editor, segments, coveragePct } });
    return respondOk(c, TranscriptSaveResponseSchema.parse({ transcriptId: transcript.id, revision, coveragePct, segments }), 201);
  });

  /**
   * Approve / reject a draft along a legal §7.6 transition (never published content, never publishes). The decision
   * is the native review of what it decides: an expression's `reviewed` + `reviewer_id`, an audio lesson's
   * `quality_review_status` (both written even when the state already matches). The write is conditional on the
   * state the decision was planned from, so content that moved meanwhile (e.g. published) is a 412, not overwritten.
   * The move is recorded as a revision (snapshot of the row as written) + publication event and audit-logged; a
   * repeated decision moves nothing.
   */
  define('adminContentDecision', { role: 'languageReviewer' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ContentDecisionRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const content = await loadContent(s, body.entityTable, id);
    const plan = planDecision(stateOf(content), body.decision, canTransitionContent);
    if (!plan.ok) throw new ApiProblem(plan.code, plan.message, { from: plan.from, to: plan.to });
    const patch: Record<string, unknown> = { state: plan.to };
    if (content.table === 'expressions') {
      patch.reviewed = body.decision === 'approve';
      patch.reviewer_id = principal.userId;
    }
    const qualityReviewStatus = content.table === 'audio_lessons' ? LESSON_QUALITY_STATUS[body.decision] : null;
    if (qualityReviewStatus) patch.quality_review_status = qualityReviewStatus;
    const reviewFlagWritten = content.table === 'expressions' || (content.table === 'audio_lessons' && content.row.quality_review_status !== qualityReviewStatus);
    let after: Record<string, unknown> = { ...content.row, ...patch };
    if (!plan.noop || reviewFlagWritten) {
      // Conditional on the state the decision was planned from: content that moved meanwhile (a concurrent publish, a
      // takedown, another decision) is a 412, never overwritten — a reject must not skip the takedown of live content.
      const updated = unwrap(await s.service.from(content.table).update(patch as never).eq('id', id).eq('state' as never, plan.from as never).select('*'), `${content.table}.decision`) as unknown as Record<string, unknown>[];
      if (!updated[0]) {
        const now = stateOf(await loadContent(s, body.entityTable, id));
        throw problem.precondition(`This item moved from "${plan.from}" to "${now}" while you were deciding; reload it and decide again.`, { from: plan.from, state: now });
      }
      after = updated[0];
    }
    const note = body.note ?? body.decision;
    const diff: Record<string, unknown> = { state: { from: plan.from, to: plan.to } };
    if (qualityReviewStatus && content.table === 'audio_lessons') diff.qualityReviewStatus = { from: content.row.quality_review_status, to: qualityReviewStatus };
    const revision = await recordRestorableRevision(s, content.table, id, diff, { row: after, note });
    if (!plan.noop) await recordPublicationEvent(s, content.table, id, revision, plan.from, plan.to, note);
    s.audit({ action: 'content.decision', entityTable: content.table, entityId: id, before: { state: plan.from }, after: { state: plan.to, decision: body.decision, noop: plan.noop, revision, ...(qualityReviewStatus ? { qualityReviewStatus } : {}) } });
    return respondOk(c, ContentDecisionResponseSchema.parse({ contentId: id, state: plan.to, revision, noop: plan.noop, publicationEventRecorded: !plan.noop }));
  });

  /**
   * Restore a revision snapshot as a NEW revision (restorable columns only; state flags never). The new revision's
   * snapshot is the restored row, so a rollback can itself be rolled back; published content gets its learner
   * manifests refreshed.
   */
  define('adminContentRollback', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ContentRollbackRequestSchema);
    const s = c.get('services')!;
    s.requireUser();
    const rev = unwrapMaybe(await s.service.from('content_revisions').select('snapshot, revision').eq('entity_table', body.entityTable).eq('entity_id', id).eq('revision', body.revision).maybeSingle(), 'content_revisions.get');
    if (!rev) throw problem.notFound('Revision');
    const snapshot = rev.snapshot && typeof rev.snapshot === 'object' && !Array.isArray(rev.snapshot) ? (rev.snapshot as Record<string, unknown>) : null;
    if (!snapshot) throw problem.precondition('This revision has no snapshot to restore.');
    const patch = rollbackPatch(body.entityTable, snapshot);
    if (Object.keys(patch).length === 0) throw problem.precondition('Snapshot holds no restorable columns.');
    const target = unwrapMaybe(await s.service.from(body.entityTable).select('*').eq('id', id).maybeSingle(), `${body.entityTable}.get`) as Record<string, unknown> | null;
    if (!target) throw problem.notFound('Content');
    unwrap(await s.service.from(body.entityTable).update(patch as never).eq('id', id), `${body.entityTable}.rollback`);
    const restored = { ...target, ...patch };
    const revision = await recordRestorableRevision(s, body.entityTable, id, patch, { row: restored, note: body.note ?? `rollback to revision ${body.revision}` });
    const subject = (body.entityTable === 'audio_chapters' ? { table: 'audio_chapters', row: restored as Row<'audio_chapters'> } : ({ table: body.entityTable, row: restored } as ContentRow)) as ManifestSubject;
    const manifestInvalidated = await invalidatePublishedContent(s, subject, revision);
    s.audit({ action: 'content.rollback', entityTable: body.entityTable, entityId: id, before: { revision: body.revision }, after: { revision, restoredColumns: Object.keys(patch) as JsonValue, manifestInvalidated } });
    return respondOk(c, ContentRollbackResponseSchema.parse({ entityId: id, revision, restoredColumns: Object.keys(patch) }));
  });
}
