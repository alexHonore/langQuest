import { adminRoute, throwDb } from '@/src/lib/local-api/handler';

/** DELETE /api/admin/speakers/:id */
export const DELETE = adminRoute('speakers', null, async ({ supabase, params }) => {
  const { error } = await supabase.from('speakers').delete().eq('id', params.id!);
  if (error) throwDb(error, 'speakers.delete');
  return { id: params.id };
});
