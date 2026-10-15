import { adminRoute, recordRevision, throwDb } from '@/src/lib/local-api/handler';
import { CollectionUpsertSchema } from '@/src/lib/local-api/schemas';

/** POST /api/admin/collections — create or update an audio course collection. */
export const POST = adminRoute('collections', CollectionUpsertSchema, async ({ supabase, session, body }) => {
  const row = {
    title_translations: body.titleTranslations,
    description_translations: body.descriptionTranslations,
    course_track_id: body.courseTrackId,
    target_variety_id: body.targetVarietyId,
    instruction_language_code: body.instructionLanguageCode,
    region: body.region,
    instructor_speaker_id: body.instructorSpeakerId,
    cover_visual_asset_id: body.coverVisualAssetId,
    content_rights_id: body.contentRightsId,
    sort_order: body.sortOrder,
    ...(body.state ? { state: body.state } : {}),
  };
  const query = body.id
    ? supabase.from('audio_course_collections').update(row).eq('id', body.id).select('id, state').single()
    : supabase.from('audio_course_collections').insert(row).select('id, state').single();
  const { data, error } = await query;
  if (error) throwDb(error, 'audio_course_collections');
  const rev = await recordRevision(supabase, session, 'audio_course_collections', data.id, row, row, body.id ? 'edit' : 'create');
  return { id: data.id, state: data.state, revision: rev.revision };
});
