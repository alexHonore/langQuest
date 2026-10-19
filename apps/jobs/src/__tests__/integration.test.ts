/**
 * Queue lifecycle against the LOCAL Supabase stack: enqueue → claim (FOR UPDATE SKIP LOCKED) → handler →
 * complete / fail with backoff → sweep. Skipped with a warning when no stack is reachable
 * (LANGQUEST_REQUIRE_LOCAL_STACK=1 turns the skip into a failure, like the db package).
 */
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositories, createServiceClient, detectLocalStack, type DbClient } from '@langquest/db';
import type { TableName } from '@langquest/db/types';
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
  /** Rows this suite inserted (jobs, assets, collections), in insertion order; deleted in reverse by `afterAll`. */
  const rows: Array<{ table: TableName; id: string }> = [];
  const track = (table: TableName, id: string): string => {
    rows.push({ table, id });
    return id;
  };
  const workerId = `vitest-${process.pid}`;

  beforeAll(async () => {
    client = createServiceClient({ SUPABASE_URL: stack!.url, SUPABASE_SERVICE_ROLE_KEY: stack!.serviceRoleKey });
    const env = readJobsEnv({ SUPABASE_URL: stack!.url, SUPABASE_SERVICE_ROLE_KEY: stack!.serviceRoleKey, OBJECT_STORE: 'local', LOCAL_OBJECT_STORE_DIR: join(tmpdir(), `lq-jobs-it-${process.pid}`), JOBS_WORK_DIR: join(tmpdir(), `lq-jobs-it-work-${process.pid}`), JOBS_TELEMETRY: 'none', JOBS_AUTO_CHAIN: 'false' });
    services = await createJobServices({ env, client, repos: createRepositories(client), log: silentLogger });
  });

  afterAll(async () => {
    if (!client) return;
    // Reverse insertion order: jobs before the asset / collection they hang off (those cascade anyway: processing_jobs
    // from media_assets, audio_collection_manifests from audio_course_collections). A refused delete is reported, never hidden.
    for (const { table, id } of [...rows].reverse()) {
      const res = await client.from(table).delete().eq('id' as never, id as never);
      if (res.error) console.warn(`[jobs integration] cleanup of ${table} ${id} failed: ${res.error.message}`);
    }
    rows.length = 0;
  });

  it('enqueue is idempotent, claim runs the handler and complete records output + cost', async () => {
    const spec = enqueueSpecFor('cleanup_orphan_uploads', { dryRun: true, limitPerStatus: 5 });
    const key = `vitest:cleanup:${crypto.randomUUID()}`;
    const job = await services.repos.processingJobs.enqueue({ jobType: spec.jobType, idempotencyKey: key, params: spec.params, priority: 10 });
    track('processing_jobs', job.id);
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
    track('media_assets', assetId);

    const missing = await services.repos.processingJobs.enqueue({ jobType: 'verify', idempotencyKey: `vitest:verify:${assetId}`, parentAssetId: assetId, priority: 10, maxAttempts: 3 });
    track('processing_jobs', missing.id);
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
    track('processing_jobs', bad.id);
    const runner2 = new PostgresJobRunner({ services, registry: buildRegistry(), workerId, jobTypes: ['transcode'], log: silentLogger });
    let o2 = await runner2.runOne();
    for (let i = 0; i < 20 && o2 && o2.job.id !== bad.id; i += 1) o2 = await runner2.runOne();
    expect(o2).toMatchObject({ status: 'failed', code: 'invalid_params', retry: false });
    expect((await services.repos.processingJobs.getById(bad.id))!.state).toBe('failed');
  });

  it('regenerate_manifest runs under its dedicated job type and stores the version in audio_collection_manifests', async () => {
    const collectionId = crypto.randomUUID();
    const inserted = await client.from('audio_course_collections').insert({ id: collectionId, title_translations: { en: `Jobs IT ${collectionId.slice(0, 8)}` }, instruction_language_code: 'en', state: 'published' }).select('id').single();
    expect(inserted.error).toBeNull();
    track('audio_course_collections', collectionId);

    const spec = enqueueSpecFor('regenerate_manifest', { kind: 'audio_collection', collectionId });
    expect(spec).toEqual({ jobType: 'regenerate_manifest', params: { kind: 'audio_collection', collectionId } });
    const job = await services.repos.processingJobs.enqueue({ jobType: spec.jobType, idempotencyKey: `vitest:manifest:${collectionId}`, params: spec.params, parentEntityTable: 'audio_course_collections', parentEntityId: collectionId, priority: 10 });
    track('processing_jobs', job.id);
    const runner = new PostgresJobRunner({ services, registry: buildRegistry(), workerId, jobTypes: ['regenerate_manifest'], log: silentLogger });
    let outcome = await runner.runOne();
    for (let i = 0; i < 20 && outcome && outcome.job.id !== job.id; i += 1) outcome = await runner.runOne();
    expect(outcome?.job.id).toBe(job.id);
    expect(outcome?.status).toBe('succeeded');
    const row = (await services.repos.processingJobs.getById(job.id))!;
    expect(row.state).toBe('succeeded');
    const output = row.output as Record<string, unknown>;
    expect(output).toMatchObject({ kind: 'audio_collection', version: 1, changed: true, stored: { table: 'audio_collection_manifests', version: 1, written: true } });

    const stored = await services.repos.manifests.getLatestManifest({ kind: 'audio_collection', collectionId, instructionLanguageCode: 'any' });
    expect(stored).toMatchObject({ collection_id: collectionId, instruction_language_code: 'any', version: 1, checksum: output.checksum, generated_by_job_id: job.id });
    expect(stored!.published_at).not.toBeNull();
    expect((stored!.manifest as { collectionId: string; title: string }).collectionId).toBe(collectionId);
    // The object-store copy is still written alongside the row.
    expect(await services.store.head((output.keys as { latest: string }).latest)).not.toBeNull();

    // Unchanged content: same version, no new row.
    const again = await services.repos.processingJobs.enqueue({ jobType: spec.jobType, idempotencyKey: `vitest:manifest:${collectionId}:2`, params: spec.params, priority: 10 });
    track('processing_jobs', again.id);
    let o2 = await runner.runOne();
    for (let i = 0; i < 20 && o2 && o2.job.id !== again.id; i += 1) o2 = await runner.runOne();
    expect(o2?.status).toBe('succeeded');
    expect((await services.repos.processingJobs.getById(again.id))!.output).toMatchObject({ version: 1, changed: false, stored: { written: false } });
    expect((await services.repos.manifests.listAudioCollectionManifestVersions(collectionId, 'any')).length).toBe(1);
  });

  it('sweep (requeue_expired_jobs) is callable with the service role', async () => {
    const runner = new PostgresJobRunner({ services, registry: buildRegistry(), workerId, log: silentLogger });
    const moved = await runner.sweep();
    expect(moved).toBeGreaterThanOrEqual(0);
    expect(runner.stats.sweeps).toBe(1);
  });
});
