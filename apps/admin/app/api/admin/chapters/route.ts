import { adminRoute, recordRevision, throwDb } from '@/src/lib/local-api/handler';
import { ChapterUpsertSchema } from '@/src/lib/local-api/schemas';

/** POST /api/admin/chapters — create or update an audio chapter. */
export const POST = adminRoute('chapters', ChapterUpsertSchema, async ({ supabase, session, body }) => {
  const row = {
    collection_id: body.collectionId,
    title_translations: body.titleTranslations,
    summary_translations: body.summaryTranslations,
    sort_order: body.sortOrder,
    cover_visual_asset_id: body.coverVisualAssetId,
    ...(body.state ? { state: body.state } : {}),
  };
  const query = body.id ? supabase.from('audio_chapters').update(row).eq('id', body.id).select('id, state').single() : supabase.from('audio_chapters').insert(row).select('id, state').single();
  const { data, error } = await query;
  if (error) throwDb(error, 'audio_chapters');
  const rev = await recordRevision(supabase, session, 'audio_chapters', data.id, row, row, body.id ? 'edit' : 'create');
  return { id: data.id, state: data.state, revision: rev.revision };
});
