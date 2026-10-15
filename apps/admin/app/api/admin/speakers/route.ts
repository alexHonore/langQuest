import { adminRoute, throwDb } from '@/src/lib/local-api/handler';
import { SpeakerUpsertSchema } from '@/src/lib/local-api/schemas';

/** POST /api/admin/speakers — create or update a speaker (RLS: content editors). */
export const POST = adminRoute('speakers', SpeakerUpsertSchema, async ({ supabase, body }) => {
  const row = {
    display_name: body.displayName,
    pseudonymous: body.pseudonymous,
    target_variety_id: body.targetVarietyId,
    region: body.region,
    consent_state: body.consentState,
    content_rights_id: body.contentRightsId,
    voice_description: body.voiceDescription,
    synthetic: body.synthetic,
  };
  const query = body.id ? supabase.from('speakers').update(row).eq('id', body.id).select('id').single() : supabase.from('speakers').insert(row).select('id').single();
  const { data, error } = await query;
  if (error) throwDb(error, 'speakers');
  return { id: data.id };
});
