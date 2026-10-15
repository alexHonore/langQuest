import { z } from 'zod';
import { adminRoute, throwDb } from '@/src/lib/local-api/handler';
import { LessonAssetAttachSchema } from '@/src/lib/local-api/schemas';

/** POST /api/admin/lessons/:id/assets — attach a media asset to a lesson. */
export const POST = adminRoute('lessons', LessonAssetAttachSchema, async ({ supabase, params, body }) => {
  const { data, error } = await supabase
    .from('audio_lesson_assets')
    .upsert({ lesson_id: params.id!, asset_id: body.assetId, asset_type: body.assetType, sort_order: body.sortOrder }, { onConflict: 'lesson_id,asset_id,asset_type' })
    .select('id')
    .single();
  if (error) throwDb(error, 'audio_lesson_assets');
  return { id: data.id };
});

/** DELETE /api/admin/lessons/:id/assets — detach (body: { assetId }). */
export const DELETE = adminRoute('lessons', z.object({ assetId: z.string().uuid() }), async ({ supabase, params, body }) => {
  const { error } = await supabase.from('audio_lesson_assets').delete().eq('lesson_id', params.id!).eq('asset_id', body.assetId);
  if (error) throwDb(error, 'audio_lesson_assets.delete');
  return { detached: true };
});
