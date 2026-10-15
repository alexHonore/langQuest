import { adminRoute, throwDb } from '@/src/lib/local-api/handler';
import { RightsUpsertSchema } from '@/src/lib/local-api/schemas';

/** POST /api/admin/rights — create or update a content_rights record. Verification stamps the reviewer. */
export const POST = adminRoute('rights', RightsUpsertSchema, async ({ supabase, session, body }) => {
  const row = {
    origin_url: body.originUrl,
    authors: body.authors,
    speakers: body.speakers,
    permission_grant: body.permissionGrant,
    license_id: body.licenseId,
    license_version: body.licenseVersion,
    commercial_redistribution: body.commercialRedistribution,
    attribution_required: body.attributionRequired,
    attribution_text: body.attributionText,
    alterations_permitted: body.alterationsPermitted,
    ai_processing_permitted: body.aiProcessingPermitted,
    voice_rights: body.voiceRights,
    expires_at: body.expiresAt,
    revoked_at: body.revokedAt,
    evidence_asset_id: body.evidenceAssetId,
    verified: body.verified,
    reviewer_id: body.verified ? session.userId : null,
    reviewed_at: body.verified ? new Date().toISOString() : null,
  };
  const query = body.id ? supabase.from('content_rights').update(row).eq('id', body.id).select('id').single() : supabase.from('content_rights').insert(row).select('id').single();
  const { data, error } = await query;
  if (error) throwDb(error, 'content_rights');
  return { id: data.id };
});
