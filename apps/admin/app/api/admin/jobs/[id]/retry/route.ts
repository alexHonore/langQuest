import { adminRoute, LocalApiError, throwDb } from '@/src/lib/local-api/handler';
import { JobRetrySchema } from '@/src/lib/local-api/schemas';

/**
 * POST /api/admin/jobs/:id/retry — enqueues a fresh job with the same type/params/parent via
 * `enqueue_processing_job` (the only JWT write path to processing_jobs). The failed job stays.
 */
export const POST = adminRoute('jobQueue', JobRetrySchema, async ({ supabase, params, body }) => {
  const { data: job, error } = await supabase
    .from('processing_jobs')
    .select('id, job_type, params, parent_asset_id, parent_entity_table, parent_entity_id, priority, provider, max_attempts, idempotency_key, state, attempts')
    .eq('id', params.id!)
    .maybeSingle();
  if (error) throwDb(error, 'processing_jobs');
  if (!job) throw new LocalApiError('not_found', 'Job not found');
  if (job.state === 'running' || job.state === 'pending') throw new LocalApiError('precondition_failed', `Job is ${job.state}; retry applies to failed or review_needed jobs.`);
  const { data, error: rpcError } = await supabase.rpc('enqueue_processing_job', {
    p_job_type: job.job_type,
    p_idempotency_key: `${job.idempotency_key}:retry:${job.attempts + 1}:${Date.now().toString(36)}`,
    p_params: job.params,
    p_parent_asset_id: job.parent_asset_id ?? undefined,
    p_parent_entity_table: job.parent_entity_table ?? undefined,
    p_parent_entity_id: job.parent_entity_id ?? undefined,
    p_priority: body.priority ?? job.priority,
    p_provider: job.provider ?? undefined,
    p_max_attempts: job.max_attempts,
  });
  if (rpcError) throwDb(rpcError, 'enqueue_processing_job');
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; state: string } | null;
  if (!row) throw new LocalApiError('internal', 'enqueue_processing_job returned no row');
  return { jobId: row.id, state: row.state };
});
