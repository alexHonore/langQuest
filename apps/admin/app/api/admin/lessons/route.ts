import { adminRoute, recordRevision, throwDb } from '@/src/lib/local-api/handler';
import { LessonCreateSchema } from '@/src/lib/local-api/schemas';

/** POST /api/admin/lessons — create a lesson shell (detailed edits go through the API `adminAudioLessonPatch`). */
export const POST = adminRoute('lessons', LessonCreateSchema, async ({ supabase, session, body }) => {
  const row = {
    chapter_id: body.chapterId,
    title_translations: body.titleTranslations,
    sort_order: body.sortOrder,
    level: body.level,
    target_variety_id: body.targetVarietyId,
    instruction_language_code: body.instructionLanguageCode,
  };
  const { data, error } = await supabase.from('audio_lessons').insert(row).select('id, state').single();
  if (error) throwDb(error, 'audio_lessons');
  await recordRevision(supabase, session, 'audio_lessons', data.id, row, row, 'create');
  return { id: data.id, state: data.state };
});
