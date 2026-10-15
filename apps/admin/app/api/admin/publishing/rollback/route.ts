import { adminRoute, LocalApiError, recordRevision, throwDb } from '@/src/lib/local-api/handler';
import { RollbackSchema } from '@/src/lib/local-api/schemas';

/** Columns a rollback may restore per entity (never state/publish flags — those go through publish/unpublish). */
const RESTORABLE: Record<string, string[]> = {
  audio_lessons: ['title_translations', 'description_translations', 'sort_order', 'episode_number', 'level', 'target_variety_id', 'instruction_language_code', 'spoken_language_codes', 'regional_dialect', 'topic', 'tags', 'scene', 'visibility', 'content_rights_id', 'cover_visual_asset_id'],
  audio_course_collections: ['title_translations', 'description_translations', 'course_track_id', 'target_variety_id', 'instruction_language_code', 'region', 'instructor_speaker_id', 'cover_visual_asset_id', 'content_rights_id', 'sort_order'],
  audio_chapters: ['title_translations', 'summary_translations', 'sort_order', 'cover_visual_asset_id'],
  missions: ['title_key', 'sort_order'],
  lesson_courses: ['sort_order'],
  expressions: ['canonical_text', 'register', 'difficulty'],
  characters: ['name', 'role', 'personality'],
  visual_assets: ['alt_text_key', 'focal_point', 'review_status'],
};

/** POST /api/admin/publishing/rollback — restore a revision snapshot as a new revision. */
export const POST = adminRoute('publishing', RollbackSchema, async ({ supabase, session, body }) => {
  const { data: rev, error } = await supabase.from('content_revisions').select('snapshot, revision').eq('entity_table', body.entityTable).eq('entity_id', body.entityId).eq('revision', body.revision).maybeSingle();
  if (error) throwDb(error, 'content_revisions');
  if (!rev) throw new LocalApiError('not_found', 'Revision not found');
  const snapshot = rev.snapshot as Record<string, unknown> | null;
  if (!snapshot) throw new LocalApiError('precondition_failed', 'This revision has no snapshot to restore.');
  const allowed = RESTORABLE[body.entityTable] ?? [];
  const patch: Record<string, unknown> = {};
  for (const col of allowed) if (col in snapshot) patch[col] = snapshot[col];
  if (Object.keys(patch).length === 0) throw new LocalApiError('precondition_failed', 'Snapshot holds no restorable columns.');
  const { error: updError } = await supabase.from(body.entityTable).update(patch as never).eq('id', body.entityId);
  if (updError) throwDb(updError, `${body.entityTable}.rollback`);
  const next = await recordRevision(supabase, session, body.entityTable, body.entityId, patch, snapshot, body.note ?? `rollback to revision ${body.revision}`);
  return { entityId: body.entityId, revision: next.revision, restoredColumns: Object.keys(patch) };
});
