/**
 * Processing-job retry (ADR-005, R-4.3-01). Formerly a local Next route handler in `apps/admin`. A retry enqueues a
 * fresh job with the same parameters; the failed row stays in the log. `planJobRetry` (`@langquest/contracts`)
 * refuses pending / running jobs and job types no runner serves, so a retry never creates a row that would sit
 * `pending` forever. Asset-parented jobs are re-run exactly like `adminAssetProcess` with `force` (asset must be
 * active); the others go through the `enqueue_processing_job` SECURITY DEFINER RPC. Both wake the queue backend.
 */
import { ProcessingJobRetryRequestSchema, ProcessingJobRetryResponseSchema, UuidSchema, planJobRetry } from '@langquest/contracts';
import { unwrapMaybe } from '@langquest/db/errors';
import type { Row } from '@langquest/db/types';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { ApiProblem, problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams } from '../../http/validate';

const IdParams = z.object({ id: UuidSchema });

const RETRYABLE_COLUMNS = 'id, job_type, params, parent_asset_id, parent_entity_table, parent_entity_id, priority, provider, max_attempts, idempotency_key, state, attempts';

export function registerJobRoutes(define: DefineRoute): void {
  define('adminProcessingJobRetry', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ProcessingJobRetryRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const job = unwrapMaybe(await s.service.from('processing_jobs').select(RETRYABLE_COLUMNS).eq('id', id).maybeSingle(), 'processing_jobs.get');
    if (!job) throw problem.notFound('Job');
    const plan = planJobRetry(job, body.priority);
    if (plan.kind === 'refused') throw new ApiProblem(plan.code, plan.message, { jobType: job.job_type, state: job.state });

    let created: Row<'processing_jobs'>;
    if (plan.kind === 'asset_process') {
      const asset = unwrapMaybe(await s.service.from('media_assets').select('id, checksum_sha256, disposition').eq('id', plan.assetId).maybeSingle(), 'media_assets.get');
      if (!asset) throw problem.notFound('Asset');
      if (asset.disposition !== 'active') throw problem.rights(`Asset is ${asset.disposition}; processing is blocked`);
      // Same key shape as `adminAssetProcess` with `force: true`: a new row, results cached by content hash ignored.
      created = await s.repos.processingJobs.enqueue({ jobType: plan.operation, idempotencyKey: `${plan.operation}:${asset.id}:${asset.checksum_sha256}:${Date.now()}`, parentAssetId: asset.id, priority: plan.priority, requestedBy: principal.userId, params: plan.params });
    } else {
      created = await s.repos.processingJobs.enqueue({ jobType: plan.jobType, idempotencyKey: plan.idempotencyKey, params: plan.params, parentEntityTable: job.parent_entity_table, parentEntityId: job.parent_entity_id, priority: plan.priority, requestedBy: principal.userId, provider: job.provider, maxAttempts: job.max_attempts });
    }
    if (s.config.env.JOBS_BACKEND === 'cloudflare_queues' && s.config.bindings.JOBS_QUEUE) await s.config.bindings.JOBS_QUEUE.send({ jobId: created.id, jobType: created.job_type });
    const via = plan.kind === 'asset_process' ? 'asset_process' : 'enqueue';
    s.audit({ action: 'jobs.retry', entityTable: 'processing_jobs', entityId: created.id, before: { jobId: job.id, jobType: job.job_type, state: job.state, attempts: job.attempts }, after: { jobId: created.id, via, priority: plan.priority } });
    return respondOk(c, ProcessingJobRetryResponseSchema.parse({ jobId: created.id, state: created.state, retriedJobId: job.id, via }), 202);
  });
}
