import { adminRoute, LocalApiError, throwDb } from '@/src/lib/local-api/handler';
import { ProfileLocalUpsertSchema } from '@/src/lib/local-api/schemas';

/**
 * POST /api/admin/models/profiles — DRAFT save of a model profile directly in `ai_model_profiles`
 * (RLS: admins). This path can never enable a profile: `enabled` always stays false and
 * `benchmark_status` resets to `unbenchmarked`. Enabling goes through the API
 * `adminModelConfigPut`, which runs the language-specific smoke tests (§8.7).
 */
export const POST = adminRoute('aiModels', ProfileLocalUpsertSchema, async ({ supabase, session, body }) => {
  const row = {
    task: body.task,
    target_variety_id: body.targetVariety,
    source_language_code: body.sourceLanguage,
    provider: body.provider,
    primary_model: body.primaryModel,
    fallback_models: body.fallbackModels,
    params: body.params as never,
    latency_class: body.latencyClass,
    daily_budget_usd: body.dailyBudgetUsd,
    enabled: false,
    benchmark_status: 'unbenchmarked',
    updated_by: session.userId,
  };
  if (body.id) {
    if (body.expectedVersion !== undefined) {
      const { data: current } = await supabase.from('ai_model_profiles').select('version').eq('id', body.id).maybeSingle();
      if (current && current.version !== body.expectedVersion) throw new LocalApiError('conflict', 'Profile changed elsewhere (version mismatch).');
    }
    const { data, error } = await supabase
      .from('ai_model_profiles')
      .update({ ...row, version: (body.expectedVersion ?? 0) + 1 })
      .eq('id', body.id)
      .select('id, version')
      .single();
    if (error) throwDb(error, 'ai_model_profiles.update');
    return { id: data.id, version: data.version, enabled: false };
  }
  const { data, error } = await supabase.from('ai_model_profiles').insert({ ...row, version: 1 }).select('id, version').single();
  if (error) throwDb(error, 'ai_model_profiles.insert');
  return { id: data.id, version: data.version, enabled: false };
});
