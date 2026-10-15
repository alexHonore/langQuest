/**
 * Runner configuration (`apps/jobs`, ADR-005). Everything comes from the environment; the job runner is a
 * server process and may hold the Supabase service-role key, OpenRouter key and R2 credentials. None of
 * these values is ever shipped to mobile/admin bundles.
 */
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : /^(1|true|yes|on)$/i.test(v.trim())));

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().int().min(min).max(max).default(def);

export const JobsEnvSchema = z.object({
  /** `postgres` (default, zero fixed cost) or `cloudflare_queues` (requires Workers Paid). */
  JOBS_BACKEND: z.enum(['postgres', 'cloudflare_queues']).default('postgres'),
  /** Stable worker id (defaults to `${hostname}-${pid}`); appears in `processing_jobs.locked_by`. */
  JOBS_WORKER_ID: z.string().min(1).optional(),
  JOBS_CONCURRENCY: int(2, 1, 32),
  JOBS_POLL_INTERVAL_MS: int(2000, 100, 60_000),
  JOBS_LEASE_SECONDS: int(600, 30, 86_400),
  JOBS_HEARTBEAT_MS: int(30_000, 1000, 600_000),
  JOBS_REQUEUE_SWEEP_MS: int(60_000, 5000, 3_600_000),
  /** Comma-separated subset of processing job types to claim (default: every registered type). */
  JOBS_JOB_TYPES: z.string().optional(),
  /** Exit once the queue is empty for this long (cron / on-demand mode). 0 = run forever. */
  JOBS_IDLE_EXIT_MS: int(0, 0, 86_400_000),
  /** Hard cap on process lifetime (container with a budget); 0 = unlimited. */
  JOBS_MAX_RUNTIME_MS: int(0, 0, 7 * 86_400_000),
  /** Scratch directory for downloads / ffmpeg output. */
  JOBS_WORK_DIR: z.string().optional(),
  /** Enqueue follow-up jobs from domain events (`EVENT_JOB_HINTS`), e.g. verify → extract_metadata. */
  JOBS_AUTO_CHAIN: bool.default(true),
  /** `console` (structured JSON lines), `supabase` (daily metrics + ai_requests) or `none`. */
  JOBS_TELEMETRY: z.enum(['console', 'supabase', 'none']).default('console'),
  JOBS_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  /** `r2` (default when the four R2 variables are set) or `local` (dev-only filesystem store). */
  OBJECT_STORE: z.enum(['r2', 'local']).optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  /** Separate bucket for explicitly public assets; defaults to `R2_BUCKET`. */
  R2_PUBLIC_BUCKET: z.string().min(1).optional(),
  /** Root for the dev-only `LocalFsObjectStore`. */
  LOCAL_OBJECT_STORE_DIR: z.string().optional(),

  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.string().url().optional(),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().optional(),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  /** Kill an ffmpeg invocation that runs longer than this. */
  FFMPEG_TIMEOUT_MS: int(30 * 60_000, 1000),

  /** Default OpenRouter spend ceiling per job (USD); handlers refuse to start AI calls past it. */
  JOBS_MAX_COST_PER_JOB_USD: z.coerce.number().min(0).default(2),
});
export type JobsEnv = z.infer<typeof JobsEnvSchema>;

/** Parse and validate the runner environment; blank strings count as unset. */
export function readJobsEnv(source: Record<string, string | undefined> = process.env): JobsEnv {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => typeof v === 'string' && v.trim() !== ''));
  return JobsEnvSchema.parse(cleaned);
}

/** True when every R2 variable needed by the S3 client is present. */
export function r2Configured(env: JobsEnv): boolean {
  return Boolean(env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET);
}

/** Which object store backend to use: explicit `OBJECT_STORE`, else R2 when configured, else local. */
export function objectStoreKind(env: JobsEnv): 'r2' | 'local' {
  if (env.OBJECT_STORE) return env.OBJECT_STORE;
  return r2Configured(env) ? 'r2' : 'local';
}

/** Parse the optional `JOBS_JOB_TYPES` filter into a list (empty = no filter). */
export function parseJobTypeFilter(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
