import { describe, expect, it } from 'vitest';
import { PROCESSING_JOB_TYPE_VALUES } from '@langquest/contracts';
import { RUNNER_JOB_TYPE_HANDLERS, planJobRetry, runnerHandlerFor, type RetryableJob } from './job-retry';

const base: RetryableJob = {
  id: 'job-1',
  job_type: 'transcode',
  state: 'failed',
  params: { preset: 'mobile' },
  parent_asset_id: 'asset-1',
  parent_entity_table: null,
  parent_entity_id: null,
  priority: 5,
  provider: null,
  max_attempts: 3,
  idempotency_key: 'transcode:asset-1:abc',
  attempts: 3,
};

describe('runnerHandlerFor', () => {
  it('maps every base job type (null for the two the runner does not serve)', () => {
    for (const type of PROCESSING_JOB_TYPE_VALUES) expect(type in RUNNER_JOB_TYPE_HANDLERS).toBe(true);
    expect(runnerHandlerFor({ job_type: 'benchmark_model', params: {} })).toBeNull();
    expect(runnerHandlerFor({ job_type: 'image_generate', params: {} })).toBeNull();
    expect(runnerHandlerFor({ job_type: 'transcribe', params: {} })).toBe('transcribe');
  });

  it('honours params.handler for extension handlers riding on a carrier type', () => {
    expect(runnerHandlerFor({ job_type: 'describe', params: { handler: 'regenerate_manifest' } })).toBe('regenerate_manifest');
    expect(runnerHandlerFor({ job_type: 'translate_transcript', params: {} })).toBeNull();
    expect(runnerHandlerFor({ job_type: 'translate_transcript', params: { handler: 'translate_transcript' } })).toBe('translate_transcript');
  });
});

describe('planJobRetry', () => {
  it('refuses pending and running jobs', () => {
    expect(planJobRetry({ ...base, state: 'running' }, undefined)).toMatchObject({ kind: 'refused', code: 'precondition_failed' });
    expect(planJobRetry({ ...base, state: 'pending' }, undefined)).toMatchObject({ kind: 'refused' });
  });

  it('refuses job types no runner serves so no permanently pending row is created', () => {
    const plan = planJobRetry({ ...base, job_type: 'benchmark_model', parent_asset_id: null }, undefined);
    expect(plan.kind).toBe('refused');
    if (plan.kind === 'refused') expect(plan.message).toContain('AI models screen');
    expect(planJobRetry({ ...base, job_type: 'translate_transcript', params: {} }, undefined).kind).toBe('refused');
    expect(planJobRetry({ ...base, job_type: 'not_a_type' }, undefined)).toMatchObject({ kind: 'refused', code: 'validation_failed' });
  });

  it('routes asset-parented jobs through the API process route with the original params', () => {
    expect(planJobRetry(base, 2)).toEqual({ kind: 'api_asset_process', assetId: 'asset-1', operation: 'transcode', params: { preset: 'mobile' }, priority: 2 });
  });

  it('enqueues directly only for jobs without a parent asset, with a unique retry key', () => {
    const plan = planJobRetry({ ...base, job_type: 'import_manifest', parent_asset_id: null, idempotency_key: 'import_manifest:x', attempts: 1, params: null }, undefined, 1000);
    expect(plan).toEqual({ kind: 'local_enqueue', jobType: 'import_manifest', params: {}, priority: 5, idempotencyKey: `import_manifest:x:retry:2:${(1000).toString(36)}` });
  });
});
