/**
 * Queue lifecycle against the LOCAL Supabase stack: enqueue → claim (FOR UPDATE SKIP LOCKED) → handler →
 * complete / fail with backoff → sweep. Skipped with a warning when no stack is reachable
 * (LANGQUEST_REQUIRE_LOCAL_STACK=1 turns the skip into a failure, like the db package).
 */
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositories, createServiceClient, detectLocalStack, type DbClient } from '@langquest/db';
import { buildMasterKey } from '@langquest/media';
import { readJobsEnv } from '../config';
import { buildRegistry } from '../handlers';
import { silentLogger } from '../logger';
import { PostgresJobRunner } from '../queue/runner';
import { enqueueSpecFor } from '../queue/types';
import { createJobServices, type JobServices } from '../services';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const stack = detectLocalStack({ cwd: REPO_ROOT });
const describeStack = stack
  ? describe
  : (() => {
      const message = '[jobs integration] Local Supabase stack not reachable; run `pnpm supabase start` (Docker).';
      if (process.env.LANGQUEST_REQUIRE_LOCAL_STACK === '1') throw new Error(message);
      console.warn(`${message} Skipping.`);
      return describe.skip;
    })();

describeStack('processing_jobs lifecycle (local stack)', () => {
  let client: DbClient;
  let services: JobServices;
  const createdJobs: string[] = [];
  const createdAssets: string[] = [];
  const workerId = `vitest-${process.pid}`;

  beforeAll(async () => {
    client = createServiceClient({ SUPABASE_URL: stack!.url, SUPABASE_SERVICE_ROLE_KEY: stack!.serviceRoleKey });
    const env = readJobsEnv({ SUPABASE_URL: stack!.url, SUPABASE_SERVICE_ROLE_KEY: stack!.serviceRoleKey, OBJECT_STORE: 'local', LOCAL_OBJECT_STORE_DIR: join(tmpdir(), `lq-jobs-it-${process.pid}`), JOBS_WORK_DIR: join(tmpdir(), `lq-jobs-it-work-${process.pid}`), JOBS_TELEMETRY: 'none', JOBS_AUTO_CHAIN: 'false' });
    services = await createJobServices({ env, client, repos: createRepositories(client), log: silentLogger });
  });

  afterAll(async () => {
    if (!client) return;
    if (createdJobs.length) await client.from('processing_jobs').delete().in('id', createdJobs);
    if (createdAssets.length) await client.from('media_assets').delete().in('id', createdAssets);
  });

  it('enqueue is idempotent, claim runs the handler and complete records output + cost', async () => {
    const spec = enqueueSpecFor('cleanup_orphan_uploads', { dryRun: true, limitPerStatus: 5 });
    const key = `vitest:cleanup:${crypto.randomUUID()}`;
    const job = await services.repos.processingJobs.enqueue({ jobType: spec.jobType, idempotencyKey: key, params: spec.params, priority: 10 });
    createdJobs.push(job.id);
    const replay = await services.repos.processingJobs.enqueue({ jobType: spec.jobType, idempotencyKey: key, params: spec.params });
    expect(replay.id).toBe(job.id);
    expect(job.state).toBe('pending');

    const runner = new PostgresJobRunner({ services, registry: buildRegistry(), workerId, jobTypes: [spec.jobType], log: silentLogger });
    // Drain anything else of this type that other tests/devs left pending, until our job is done.
    let outcome = await runner.runOne();
    for (let i = 0; i < 20 && outcome && outcome.job.id !== job.id; i += 1) outcome = await runner.runOne();
    expect(outcome?.job.id).toBe(job.id);
    expect(outcome?.status).toBe('succeeded');
    const row = (await services.repos.processingJobs.getById(job.id))!;
    expect(row.state).toBe('succeeded');
    expect(row.attempts).toBe(1);
    expect(row.locked_by).toBeNull();
    expect(row.progress_pct).toBe(100);
    expect(Number(row.cost_actual_usd)).toBe(0);
    expect((row.output as Record<string, unknown>).dryRun).toBe(true);
    expect((row.output as Record<string, unknown>)._cost).toBeDefined();
  });

  it('a retryable failure goes back to pending behind a backoff lease; invalid params fail for good', async () => {
    const assetId = crypto.randomUUID();
    const inserted = await client.from('media_assets').insert({ id: assetId, storage_key: buildMasterKey({ assetId, contentHash: 'a'.repeat(64), mimeType: 'audio/mpeg' }), bucket: 'test', kind: 'audio', checksum_sha256: 'a'.repeat(64), mime_type: 'audio/mpeg', byte_length: 10 }).select('id').single();
    expect(inserted.error).toBeNull();
    createdAssets.push(assetId);

    const missing = await services.repos.processingJobs.enqueue({ jobType: 'verify', idempotencyKey: `vitest:verify:${assetId}`, parentAssetId: assetId, priority: 10, maxAttempts: 3 });
    createdJobs.push(missing.id);
    const runner = new PostgresJobRunner({ services, registry: buildRegistry(), workerId, jobTypes: ['verify'], log: silentLogger });
    let outcome = await runner.runOne();
    for (let i = 0; i < 20 && outcome && outcome.job.id !== missing.id; i += 1) outcome = await runner.runOne();
    expect(outcome).toMatchObject({ status: 'failed', code: 'object_missing', retry: true });
    const row = (await services.repos.processingJobs.getById(missing.id))!;
    expect(row.state).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.failure_code).toBe('object_missing');
    expect(new Date(row.locked_until!).getTime()).toBeGreaterThan(Date.now());
    // The backoff lease keeps it unclaimable right now.
    const again = await services.repos.processingJobs.claim(workerId, ['verify'], 60);
    expect(again?.id).not.toBe(missing.id);
    if (again) await services.repos.processingJobs.fail(again.id, workerId, 'vitest_released', 'released by the jobs integration test', { retry: true, backoffSeconds: 1 });

    const bad = await services.repos.processingJobs.enqueue({ jobType: 'transcode', idempotencyKey: `vitest:bad:${crypto.randomUUID()}`, params: { assetId: 'not-a-uuid' }, priority: 10 });
    createdJobs.push(bad.id);
    const runner2 = new PostgresJobRunner({ services, registry: buildRegistry(), workerId, jobTypes: ['transcode'], log: silentLogger });
    let o2 = await runner2.runOne();
    for (let i = 0; i < 20 && o2 && o2.job.id !== bad.id; i += 1) o2 = await runner2.runOne();
    expect(o2).toMatchObject({ status: 'failed', code: 'invalid_params', retry: false });
    expect((await services.repos.processingJobs.getById(bad.id))!.state).toBe('failed');
  });

  it('sweep (requeue_expired_jobs) is callable with the service role', async () => {
    const runner = new PostgresJobRunner({ services, registry: buildRegistry(), workerId, log: silentLogger });
    const moved = await runner.sweep();
    expect(moved).toBeGreaterThanOrEqual(0);
    expect(runner.stats.sweeps).toBe(1);
  });
});
