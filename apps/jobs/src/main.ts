#!/usr/bin/env node
/**
 * LangQuest job runner CLI (ADR-005). Node ≥ 22, run with `tsx`.
 *
 *   pnpm --filter @langquest/jobs start                    # poll loop (JOBS_BACKEND=postgres) or Queues pull loop
 *   pnpm --filter @langquest/jobs run-once -- --type transcode --asset <uuid> [--params '{"slow":false}']
 *   pnpm --filter @langquest/jobs run-once -- --type regenerate_manifest --params '{"kind":"course",...}' --direct
 *   pnpm --filter @langquest/jobs enqueue  -- --type transcribe --asset <uuid> --params '{"locale":"ary"}'
 *   pnpm --filter @langquest/jobs requeue                  # sweep expired leases once
 *   pnpm --filter @langquest/jobs -- status                # queue counts by state
 *
 * `--type` accepts a handler name (inspect_asset, transcode, …) or a raw processing job type (verify, …).
 */
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { parseJobTypeFilter, readJobsEnv } from './config';
import { buildRegistry } from './handlers';
import { createLogger } from './logger';
import { startQueuePullLoop } from './queue/cloudflare-queues';
import { PostgresJobRunner, runDirect } from './queue/runner';
import { HANDLER_NAMES, JOB_TYPE_HANDLERS, enqueueSpecFor, isHandlerName, isProcessingJobType, type HandlerName } from './queue/types';
import { createJobServices } from './services';

const here = dirname(fileURLToPath(import.meta.url));
for (const candidate of [resolve(process.cwd(), '.env'), resolve(here, '../.env'), resolve(here, '../../../.env')]) {
  if (existsSync(candidate)) loadDotenv({ path: candidate, override: false, quiet: true });
}

interface Args {
  command: string;
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): Args {
  const [command = 'start', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else flags[key] = true;
  }
  return { command, flags };
}

function str(flags: Args['flags'], key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

function parseParams(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('--params must be a JSON object');
  return parsed as Record<string, unknown>;
}

/** `--type` → handler name + DB job type + params marker. */
export function resolveTypeFlag(type: string | undefined, params: Record<string, unknown>): { handler: HandlerName; jobType: string; params: Record<string, unknown> } {
  if (!type) throw new Error(`--type is required (one of ${HANDLER_NAMES.join(', ')} or a processing job type)`);
  if (isHandlerName(type)) {
    const spec = enqueueSpecFor(type, params);
    return { handler: type, jobType: spec.jobType, params: spec.params };
  }
  if (isProcessingJobType(type)) {
    const handler = JOB_TYPE_HANDLERS[type];
    if (!handler) throw new Error(`job type ${type} has no handler in this runner`);
    return { handler, jobType: type, params };
  }
  throw new Error(`Unknown --type ${type}`);
}

async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  const env = readJobsEnv();
  const log = createLogger({ level: env.JOBS_LOG_LEVEL, base: { app: 'jobs' } });
  const workerId = env.JOBS_WORKER_ID ?? `${hostname()}-${process.pid}`;

  if (command === 'help' || flags.help) {
    process.stdout.write(`langquest jobs — commands: start | run-once | enqueue | requeue | status | handlers\n`);
    return 0;
  }
  if (command === 'handlers') {
    const registry = buildRegistry();
    for (const h of registry.list()) process.stdout.write(`${h.name.padEnd(24)} job types: ${h.jobTypes.join(', ')}  runtime: ${h.runtime}\n`);
    return 0;
  }

  const services = await createJobServices({ env, log });
  const registry = buildRegistry();

  switch (command) {
    case 'start': {
      if (env.JOBS_BACKEND === 'cloudflare_queues') {
        log.warn('backend.cloudflare_queues', { message: 'Cloudflare Queues pull consumer requires the Workers Paid plan and CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_QUEUE_ID / CLOUDFLARE_API_TOKEN' });
        const stop = new AbortController();
        process.once('SIGINT', () => stop.abort());
        process.once('SIGTERM', () => stop.abort());
        await startQueuePullLoop({ services, registry, workerId, runtime: 'node', signal: stop.signal, log });
        return 0;
      }
      const runner = new PostgresJobRunner({ services, registry, workerId, jobTypes: parseJobTypeFilter(env.JOBS_JOB_TYPES), log });
      process.once('SIGINT', () => runner.stop('SIGINT'));
      process.once('SIGTERM', () => runner.stop('SIGTERM'));
      const stats = await runner.start();
      return stats.failed > 0 && stats.succeeded === 0 && stats.claimed > 0 ? 1 : 0;
    }
    case 'enqueue': {
      const params = parseParams(str(flags, 'params'));
      const asset = str(flags, 'asset');
      const spec = resolveTypeFlag(str(flags, 'type'), asset ? { assetId: asset, ...params } : params);
      const job = await services.repos.processingJobs.enqueue({
        jobType: spec.jobType as never,
        idempotencyKey: str(flags, 'key') ?? `cli:${spec.handler}:${asset ?? 'none'}:${crypto.randomUUID()}`,
        params: spec.params,
        parentAssetId: asset ?? null,
        priority: flags.priority ? Number(flags.priority) : undefined,
        requestedBy: str(flags, 'requested-by') ?? null,
      });
      process.stdout.write(`${JSON.stringify({ id: job.id, jobType: job.job_type, state: job.state, handler: spec.handler, params: job.params }, null, 2)}\n`);
      return 0;
    }
    case 'run-once': {
      const params = parseParams(str(flags, 'params'));
      const asset = str(flags, 'asset');
      const spec = resolveTypeFlag(str(flags, 'type'), asset ? { assetId: asset, ...params } : params);
      if (flags.direct) {
        const outcome = await runDirect({ services, registry, workerId, handler: spec.handler, jobType: spec.jobType, params: spec.params, parentAssetId: asset ?? null, log });
        process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
        return outcome.status === 'succeeded' ? 0 : 1;
      }
      const job = await services.repos.processingJobs.enqueue({
        jobType: spec.jobType as never,
        idempotencyKey: str(flags, 'key') ?? `cli:${spec.handler}:${asset ?? 'none'}:${crypto.randomUUID()}`,
        params: spec.params,
        parentAssetId: asset ?? null,
        priority: 10,
        requestedBy: str(flags, 'requested-by') ?? null,
      });
      log.info('run-once.enqueued', { jobId: job.id, jobType: job.job_type, state: job.state });
      const runner = new PostgresJobRunner({ services, registry, workerId, jobTypes: [spec.jobType], concurrency: 1, idleExitMs: 1, log });
      process.once('SIGINT', () => runner.stop('SIGINT'));
      const stats = await runner.start();
      const final = await services.repos.processingJobs.getById(job.id);
      process.stdout.write(`${JSON.stringify({ job: final, stats }, null, 2)}\n`);
      return final?.state === 'succeeded' ? 0 : 1;
    }
    case 'requeue': {
      const runner = new PostgresJobRunner({ services, registry, workerId, log });
      const moved = await runner.sweep();
      process.stdout.write(`requeued ${moved} expired job(s)\n`);
      return 0;
    }
    case 'status': {
      const out: Record<string, number> = {};
      for (const state of ['pending', 'running', 'succeeded', 'failed', 'review_needed'] as const) out[state] = (await services.repos.processingJobs.listByState(state, 200)).length;
      process.stdout.write(`${JSON.stringify({ counts: out, note: 'counts capped at 200 per state' }, null, 2)}\n`);
      return 0;
    }
    default:
      process.stderr.write(`Unknown command ${command}. Try: start | run-once | enqueue | requeue | status | handlers\n`);
      return 2;
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exit(1);
    });
}
