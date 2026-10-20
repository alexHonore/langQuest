import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import type { ProcessingJobsRepository, Repositories } from '@langquest/db';
import { JobExecutor, PostgresJobRunner, classifyError, runDirect } from './runner';
import { createQueueConsumer } from './cloudflare-queues';
import { PROCESSING_JOB_TYPE_VALUES_ALL, PROCESSING_JOB_TYPE_EXTENSION_VALUES } from '@langquest/contracts';
import { HANDLER_PRIMARY_JOB_TYPE, JOB_TYPE_HANDLERS, LEGACY_CARRIER_JOB_TYPE, HandlerRegistry, JobFailure, enqueueSpecFor, isProcessingJobType, resolveHandlerName, type JobHandler, type ProcessingJobRow } from './types';
import { buildRegistry } from '../handlers';
import { ScriptedReasoner, createTestServices, fakeJobRow } from '../test-support/fakes';
import { AiCapabilityError } from '@langquest/ai';

/** In-memory stand-in for the Postgres queue RPCs (claim / heartbeat / complete / fail). */
function fakeQueue(initial: ProcessingJobRow[] = []) {
  const rows = new Map(initial.map((r) => [r.id, r]));
  const calls: string[] = [];
  const repo: ProcessingJobsRepository = {
    async enqueue(input) {
      const row = fakeJobRow({ job_type: input.jobType, state: 'pending', attempts: 0, params: (input.params ?? {}) as never, idempotency_key: input.idempotencyKey, parent_asset_id: input.parentAssetId ?? null, locked_by: null });
      rows.set(row.id, row);
      return row;
    },
    async claim(workerId, jobTypes) {
      const job = [...rows.values()].find((r) => r.state === 'pending' && r.attempts < r.max_attempts && (!jobTypes || jobTypes.includes(r.job_type as never)));
      if (!job) return null;
      const claimed = { ...job, state: 'running', locked_by: workerId, attempts: job.attempts + 1, locked_until: new Date(Date.now() + 60_000).toISOString() };
      rows.set(job.id, claimed);
      calls.push(`claim:${job.id}`);
      return claimed;
    },
    async heartbeat(jobId, workerId, pct) {
      calls.push(`heartbeat:${pct ?? ''}`);
      const row = rows.get(jobId);
      return Boolean(row && row.locked_by === workerId && row.state === 'running');
    },
    async complete(jobId, workerId, output, outputAssetIds, cost) {
      const row = rows.get(jobId)!;
      if (row.locked_by !== workerId || row.state !== 'running') throw new Error('not running under worker');
      const next = { ...row, state: 'succeeded', output: (output ?? null) as never, output_asset_ids: outputAssetIds ?? [], cost_actual_usd: cost ?? null, locked_by: null };
      rows.set(jobId, next);
      calls.push(`complete:${jobId}`);
      return next;
    },
    async fail(jobId, workerId, code, message, opts) {
      const row = rows.get(jobId)!;
      if (row.locked_by !== workerId || row.state !== 'running') throw new Error('not running under worker');
      const retry = opts?.retry ?? true;
      const state = retry && row.attempts < row.max_attempts ? 'pending' : retry ? 'review_needed' : 'failed';
      const next = { ...row, state, failure_code: code, failure_message: message ?? null, locked_by: null };
      rows.set(jobId, next);
      calls.push(`fail:${code}:${state}`);
      return next;
    },
    async requeueExpired() {
      calls.push('sweep');
      return [];
    },
    async getById(id) {
      return rows.get(id) ?? null;
    },
    async listForAsset() {
      return [];
    },
    async listByState(state) {
      return [...rows.values()].filter((r) => r.state === state);
    },
    async recordProvenance(row) {
      return row as never;
    },
  };
  return { repo, rows, calls };
}

const okHandler: JobHandler<{ value?: number }> = {
  name: 'cleanup_orphan_uploads',
  jobTypes: ['cleanup_orphan_uploads'],
  runtime: 'any',
  paramsSchema: z.object({ value: z.number().optional() }),
  async run(ctx) {
    await ctx.progress(50);
    return { output: { doubled: (ctx.params.value ?? 1) * 2 } };
  },
};

describe('handler routing', () => {
  it('maps DB job types to handlers, including the dedicated extension values, and still honours params.handler on legacy carrier rows', () => {
    expect(resolveHandlerName({ job_type: 'verify', params: {} })).toBe('inspect_asset');
    expect(resolveHandlerName({ job_type: 'describe', params: {} })).toBe('infer_metadata');
    expect(resolveHandlerName({ job_type: 'translate_transcript', params: {} })).toBe('translate_transcript');
    expect(resolveHandlerName({ job_type: 'regenerate_manifest', params: {} })).toBe('regenerate_manifest');
    expect(resolveHandlerName({ job_type: 'cleanup_orphan_uploads', params: {} })).toBe('cleanup_orphan_uploads');
    expect(resolveHandlerName({ job_type: 'render_cover', params: {} })).toBe('render_cover');
    expect(resolveHandlerName({ job_type: 'infer_metadata', params: {} })).toBe('infer_metadata');
    expect(resolveHandlerName({ job_type: 'generate_content', params: {} })).toBe('generate_content');
    expect(resolveHandlerName({ job_type: 'import_r2_prefix', params: {} })).toBe('import_r2_prefix');
    // Rows written before migration 100 (carrier type + params.handler) keep resolving.
    expect(resolveHandlerName({ job_type: LEGACY_CARRIER_JOB_TYPE, params: { handler: 'translate_transcript' } })).toBe('translate_transcript');
    expect(resolveHandlerName({ job_type: 'benchmark_model', params: {} })).toBe('benchmark_model');
    expect(resolveHandlerName({ job_type: 'image_generate', params: {} })).toBeNull();
    expect(resolveHandlerName({ job_type: 'nonsense', params: {} })).toBeNull();
  });
  it('every value of the processing_job_type domain resolves to a handler or is explicitly null', () => {
    const registry = buildRegistry();
    for (const jobType of PROCESSING_JOB_TYPE_VALUES_ALL) {
      expect(isProcessingJobType(jobType), jobType).toBe(true);
      expect(Object.hasOwn(JOB_TYPE_HANDLERS, jobType), `${jobType} missing from JOB_TYPE_HANDLERS`).toBe(true);
      const handler = JOB_TYPE_HANDLERS[jobType];
      if (handler === null) {
        expect(['image_generate'], `${jobType} unexpectedly unhandled`).toContain(jobType);
        continue;
      }
      expect(registry.get(handler)?.jobTypes, `${jobType} → ${handler} must list it in jobTypes (claim filter)`).toContain(jobType);
      expect(registry.resolve({ job_type: jobType, params: {} })?.name).toBe(handler);
    }
    // No extension value is left unclaimable.
    for (const jobType of PROCESSING_JOB_TYPE_EXTENSION_VALUES) expect(registry.jobTypes()).toContain(jobType);
    // Every handler's primary type routes back to that handler.
    for (const h of registry.list()) expect(JOB_TYPE_HANDLERS[HANDLER_PRIMARY_JOB_TYPE[h.name]]).toBe(h.name);
  });
  it('enqueueSpecFor enqueues the dedicated job type without a carrier marker', () => {
    expect(enqueueSpecFor('transcode', { a: 1 })).toEqual({ jobType: 'transcode', params: { a: 1 } });
    expect(enqueueSpecFor('regenerate_manifest', { kind: 'course' })).toEqual({ jobType: 'regenerate_manifest', params: { kind: 'course' } });
    expect(enqueueSpecFor('translate_transcript', { transcriptId: 'x' })).toEqual({ jobType: 'translate_transcript', params: { transcriptId: 'x' } });
    expect(enqueueSpecFor('cleanup_orphan_uploads', {})).toEqual({ jobType: 'cleanup_orphan_uploads', params: {} });
    expect(enqueueSpecFor('infer_metadata', {})).toEqual({ jobType: 'describe', params: {} });
  });
  it('the full registry covers every runner job type', () => {
    const registry = buildRegistry();
    expect(registry.list().map((h) => h.name).sort()).toEqual(['align', 'benchmark_model', 'cleanup_orphan_uploads', 'generate_content', 'import_manifest', 'import_r2_prefix', 'infer_metadata', 'inspect_asset', 'regenerate_manifest', 'render_cover', 'transcode', 'transcribe', 'translate_transcript']);
    expect(registry.jobTypes().sort()).toEqual([...PROCESSING_JOB_TYPE_VALUES_ALL].filter((t) => t !== 'image_generate').sort());
    // A partial registry never claims the legacy carrier type it cannot run.
    expect(new HandlerRegistry().register(okHandler).jobTypes()).toEqual(['cleanup_orphan_uploads']);
    expect(() => new HandlerRegistry().register(okHandler).register(okHandler)).toThrow(/twice/);
  });
});

describe('classifyError', () => {
  it('maps failure classes to codes and retry decisions', () => {
    expect(classifyError(new JobFailure('x', 'm', { retry: false }))).toMatchObject({ code: 'x', retry: false });
    expect(classifyError(new AiCapabilityError('nope', { supported: false } as never, 'xx'))).toMatchObject({ code: 'capability_unsupported', retry: false });
    expect(classifyError(new Error('boom'))).toMatchObject({ code: 'unhandled_error', retry: true });
  });
});

describe('JobExecutor', () => {
  it('completes a job with cost and progress heartbeats', async () => {
    const t = await createTestServices();
    try {
      const q = fakeQueue();
      const services = { ...t.services, repos: { processingJobs: q.repo } as unknown as Repositories };
      const registry = new HandlerRegistry().register(okHandler);
      const job = fakeJobRow({ job_type: 'describe', params: { handler: 'cleanup_orphan_uploads', value: 21 } as never, locked_by: 'w1' });
      q.rows.set(job.id, job);
      const exec = new JobExecutor({ services, registry, workerId: 'w1', heartbeatMs: 10_000 });
      const outcome = await exec.execute(job);
      expect(outcome.status).toBe('succeeded');
      expect(q.rows.get(job.id)?.state).toBe('succeeded');
      expect((q.rows.get(job.id)?.output as Record<string, unknown>).doubled).toBe(42);
      expect(q.calls).toContain('heartbeat:50');
      expect(q.calls.some((c) => c.startsWith('complete:'))).toBe(true);
    } finally {
      await t.cleanup();
    }
  });

  it('runs a queued benchmark_model job with the full registry and links the benchmark in processing_jobs.output', async () => {
    const t = await createTestServices({ reasoner: (sink) => new ScriptedReasoner(sink, { answer: () => ({ reply: '¡Hola! ¿Qué tal estás?', transliteration: null }) }) });
    try {
      const q = fakeQueue();
      const services = { ...t.services, repos: { processingJobs: q.repo } as unknown as Repositories };
      const profile = t.db.seedModelProfile({ task: 'character_dialogue', target_variety_id: 'es-ES', primary_model: 'fake/model-a' });
      const smoke = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
      const job = fakeJobRow({ job_type: 'benchmark_model', params: { profileId: profile.id, model: 'fake/model-a', targetVariety: 'es-ES', sourceLanguage: null, sampleSetId: 'default' } as never, output: { benchmarkId: smoke } as never, locked_by: 'w1' });
      q.rows.set(job.id, job);
      const outcome = await new JobExecutor({ services, registry: buildRegistry(), workerId: 'w1', heartbeatMs: 10_000 }).execute(job);
      expect(outcome.status).toBe('succeeded');
      const [bench] = [...t.db.tables.ai_model_benchmarks.values()];
      const row = q.rows.get(job.id)!;
      expect(row.state).toBe('succeeded');
      expect(row.output).toMatchObject({ benchmarkId: bench!.id, smokeBenchmarkId: smoke, _cost: { aiCalls: 6 } });
      expect(t.db.tables.ai_model_profiles.get(profile.id)!.benchmark_status).toBe('passing');
    } finally {
      await t.cleanup();
    }
  });

  it('fails invalid params without retry and unhandled errors with retry', async () => {
    const t = await createTestServices();
    try {
      const q = fakeQueue();
      const services = { ...t.services, repos: { processingJobs: q.repo } as unknown as Repositories };
      const boom: JobHandler = { ...okHandler, name: 'translate_transcript', paramsSchema: z.object({ n: z.number() }), run: async () => { throw new Error('kaboom'); } };
      const registry = new HandlerRegistry().register(boom);
      const bad = fakeJobRow({ job_type: 'describe', params: { handler: 'translate_transcript' } as never, locked_by: 'w1' });
      q.rows.set(bad.id, bad);
      const exec = new JobExecutor({ services, registry, workerId: 'w1' });
      expect(await exec.execute(bad)).toMatchObject({ status: 'failed', code: 'invalid_params', retry: false });
      expect(q.rows.get(bad.id)?.state).toBe('failed');

      const crash = fakeJobRow({ job_type: 'describe', params: { handler: 'translate_transcript', n: 1 } as never, locked_by: 'w1', attempts: 1, max_attempts: 3 });
      q.rows.set(crash.id, crash);
      expect(await exec.execute(crash)).toMatchObject({ status: 'failed', code: 'unhandled_error', retry: true });
      expect(q.rows.get(crash.id)?.state).toBe('pending');

      const unknown = fakeJobRow({ job_type: 'image_generate', locked_by: 'w1' });
      q.rows.set(unknown.id, unknown);
      expect(await exec.execute(unknown)).toMatchObject({ status: 'failed', code: 'no_handler' });
    } finally {
      await t.cleanup();
    }
  });

  it('runDirect runs a handler without touching the queue', async () => {
    const t = await createTestServices();
    try {
      const q = fakeQueue();
      const services = { ...t.services, repos: { processingJobs: q.repo } as unknown as Repositories };
      const outcome = await runDirect({ services, registry: new HandlerRegistry().register(okHandler), workerId: 'w', handler: 'cleanup_orphan_uploads', jobType: 'describe', params: { value: 5 } });
      expect(outcome.status).toBe('succeeded');
      expect(q.rows.size).toBe(0);
    } finally {
      await t.cleanup();
    }
  });
});

describe('PostgresJobRunner', () => {
  it('drains pending jobs with concurrency and exits when idle', async () => {
    const t = await createTestServices();
    try {
      const q = fakeQueue();
      const services = { ...t.services, repos: { processingJobs: q.repo } as unknown as Repositories };
      for (let i = 0; i < 5; i += 1) await q.repo.enqueue({ jobType: 'cleanup_orphan_uploads', idempotencyKey: `k${i}`, params: { value: i } });
      const runner = new PostgresJobRunner({ services, registry: new HandlerRegistry().register(okHandler), workerId: 'w1', concurrency: 2, pollIntervalMs: 5, idleExitMs: 20, requeueSweepMs: 1_000_000 });
      const stats = await runner.start();
      expect(stats.claimed).toBe(5);
      expect(stats.succeeded).toBe(5);
      expect([...q.rows.values()].every((r) => r.state === 'succeeded')).toBe(true);
    } finally {
      await t.cleanup();
    }
  });

  it('claims rows enqueued with the dedicated extension job types (translate_transcript, regenerate_manifest, …) with the full registry', async () => {
    const t = await createTestServices();
    try {
      const q = fakeQueue();
      const services = { ...t.services, repos: { processingJobs: q.repo } as unknown as Repositories };
      const registry = buildRegistry();
      const fresh = await q.repo.enqueue({ jobType: 'cleanup_orphan_uploads', idempotencyKey: 'fresh', params: { dryRun: true } });
      const legacy = await q.repo.enqueue({ jobType: 'describe', idempotencyKey: 'legacy', params: { handler: 'cleanup_orphan_uploads', dryRun: true } });
      // Invalid params on a dedicated-type row: claimed (not stuck pending) and failed with a real code, not no_handler.
      const broken = await q.repo.enqueue({ jobType: 'translate_transcript', idempotencyKey: 'broken', params: { transcriptId: 'not-a-uuid' } });
      const runner = new PostgresJobRunner({ services, registry, workerId: 'w1', concurrency: 1, pollIntervalMs: 5, idleExitMs: 20, requeueSweepMs: 1_000_000 });
      const stats = await runner.start();
      expect(stats.claimed).toBe(3);
      expect(q.rows.get(fresh.id)?.state).toBe('succeeded');
      expect(q.rows.get(legacy.id)?.state).toBe('succeeded');
      expect(q.rows.get(broken.id)).toMatchObject({ state: 'failed', failure_code: 'invalid_params' });
    } finally {
      await t.cleanup();
    }
  });

  it('stop() ends the loop and reports stats', async () => {
    const t = await createTestServices();
    try {
      const q = fakeQueue();
      const services = { ...t.services, repos: { processingJobs: q.repo } as unknown as Repositories };
      const runner = new PostgresJobRunner({ services, registry: new HandlerRegistry().register(okHandler), workerId: 'w1', pollIntervalMs: 5, idleExitMs: 0, requeueSweepMs: 1_000_000 });
      setTimeout(() => runner.stop('test'), 30);
      const stats = await runner.start();
      expect(stats.claimed).toBe(0);
    } finally {
      await t.cleanup();
    }
  });
});

describe('Cloudflare Queues consumer', () => {
  it('claims and runs the job for a message, acks handled/missing messages, defers node-only handlers in a Worker', async () => {
    const t = await createTestServices();
    try {
      const q = fakeQueue();
      const services = { ...t.services, repos: { processingJobs: q.repo } as unknown as Repositories };
      const nodeOnly: JobHandler = { ...okHandler, name: 'transcode', jobTypes: ['transcode'], runtime: 'node' };
      const registry = new HandlerRegistry().register(okHandler).register(nodeOnly);
      const pending = await q.repo.enqueue({ jobType: 'describe', idempotencyKey: 'a', params: { handler: 'cleanup_orphan_uploads' } });
      const heavy = await q.repo.enqueue({ jobType: 'transcode', idempotencyKey: 'b' });
      const worker = createQueueConsumer({ services, registry, workerId: 'cf', runtime: 'worker' });
      const acked: string[] = [];
      const msg = (jobId: string) => ({ id: jobId, body: { jobId }, ack: () => acked.push(jobId), retry: () => {} });
      await worker.queue({ queue: 'jobs', messages: [msg(pending.id), msg(heavy.id), msg(crypto.randomUUID())] });
      expect(acked.length).toBe(3);
      expect(q.rows.get(pending.id)?.state).toBe('succeeded');
      expect(q.rows.get(heavy.id)?.state).toBe('pending');
      const node = createQueueConsumer({ services, registry, workerId: 'node', runtime: 'node' });
      const res = await node.handleMessage(msg(heavy.id));
      expect(res.action).toBe('ack');
      expect(q.rows.get(heavy.id)?.state).toBe('succeeded');
    } finally {
      await t.cleanup();
    }
  });
});
