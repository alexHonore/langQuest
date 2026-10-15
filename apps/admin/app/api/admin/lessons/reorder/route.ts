import { adminRoute, throwDb } from '@/src/lib/local-api/handler';
import { LessonReorderSchema } from '@/src/lib/local-api/schemas';

/** POST /api/admin/lessons/reorder — move/renumber lessons (optionally into another chapter). */
export const POST = adminRoute('lessons', LessonReorderSchema, async ({ supabase, body }) => {
  let updated = 0;
  for (const item of body.items) {
    const patch: { sort_order: number; chapter_id?: string } = { sort_order: item.sortOrder };
    if (item.chapterId) patch.chapter_id = item.chapterId;
    const { error, count } = await supabase.from('audio_lessons').update(patch, { count: 'exact' }).eq('id', item.id);
    if (error) throwDb(error, 'audio_lessons.reorder');
    updated += count ?? 0;
  }
  return { updated };
});
