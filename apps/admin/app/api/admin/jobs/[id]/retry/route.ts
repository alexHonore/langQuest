import { serverApi } from '@/src/lib/api-server';
import { forwardApiError } from '@/src/lib/local-api/forward';
import { adminRoute, LocalApiError, throwDb } from '@/src/lib/local-api/handler';
import { planJobRetry } from '@/src/lib/local-api/job-retry';
import { JobRetrySchema } from '@/src/lib/local-api/schemas';

/**
 * POST /api/admin/jobs/:id/retry — re-runs a failed / review_needed job. The failed row stays.
 *
 * - Jobs with a parent asset go through the API (`adminAssetProcess`, `force: true`), so the retry
 *   is audit-logged and the queue backend is woken exactly like a first run.
 * - Jobs without a parent asset (imports, content generation, manifest regeneration) are enqueued
 *   via `enqueue_processing_job` (the only JWT write path to processing_jobs).
 * - Job types the runner does not serve are refused (see `planJobRetry`): a retry must never
 *   create a row that stays pending forever.
 */
export const POST = adminRoute('jobQueue', JobRetrySchema, async ({ supabase, session, params, body }) => {
  const { data: job, error } = await supabase
    .from('processing_jobs')
    .select('id, job_type, params, parent_asset_id, parent_entity_table, parent_entity_id, priority, provider, max_attempts, idempotency_key, state, attempts')
    .eq('id', params.id!)
    .maybeSingle();
  if (error) throwDb(error, 'processing_jobs');
  if (!job) throw new LocalApiError('not_found', 'Job not found');
  const plan = planJobRetry(job, body.priority);
  if (plan.kind === 'refused') throw new LocalApiError(plan.code, plan.message, { jobType: job.job_type, state: job.state });

  if (plan.kind === 'api_asset_process') {
    try {
      const res = await serverApi(session).call('adminAssetProcess', {
        params: { id: plan.assetId },
        body: { operations: [plan.operation], priority: plan.priority, params: plan.params, force: true, idempotencyKey: `retry:${job.id}:${job.attempts + 1}:${Date.now().toString(36)}` },
      });
      const created = res.jobs[0];
      if (!created) throw new LocalApiError('internal', 'The API accepted the retry but returned no job');
      return { jobId: created.id, state: created.state, via: 'api' as const };
    } catch (err) {
      forwardApiError(err, 'asset job retries');
    }
  }

  const { data, error: rpcError } = await supabase.rpc('enqueue_processing_job', {
    p_job_type: plan.jobType,
    p_idempotency_key: plan.idempotencyKey,
    p_params: plan.params as never,
    p_parent_asset_id: undefined,
    p_parent_entity_table: job.parent_entity_table ?? undefined,
    p_parent_entity_id: job.parent_entity_id ?? undefined,
    p_priority: plan.priority,
    p_provider: job.provider ?? undefined,
    p_max_attempts: job.max_attempts,
  });
  if (rpcError) throwDb(rpcError, 'enqueue_processing_job');
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; state: string } | null;
  if (!row) throw new LocalApiError('internal', 'enqueue_processing_job returned no row');
  return { jobId: row.id, state: row.state, via: 'local' as const };
});
