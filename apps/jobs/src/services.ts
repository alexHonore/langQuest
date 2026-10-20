/**
 * Everything a handler may touch, wired once per process: Supabase (service role, ADR-003), the object
 * store (R2 or the dev-only local store), ffmpeg, OpenRouter adapters from `@langquest/ai`, the event
 * bus and telemetry. Tests build the same shape with in-memory fakes (`src/test-support`).
 */
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpeechRecognizer, TextReasoner, VarietyId } from '@langquest/contracts';
import { ModelProfileSchema, type ModelProfile } from '@langquest/contracts';
import {
  LanguageGuard,
  ModelProfileRegistry,
  OpenRouterClient,
  OpenRouterSpeechRecognizer,
  OpenRouterTextReasoner,
  PricingTable,
  type AiRequestSink,
  type AudioAssetResolver,
} from '@langquest/ai';
import { createRepositories, createServiceClient, type DbClient, type Repositories, type Row } from '@langquest/db';
import { ConsoleSink, SupabaseTableSink, createTelemetryContext, type Sink, type TelemetryContext } from '@langquest/telemetry';
import { readJobsEnv, type JobsEnv } from './config';
import { createSupabaseJobsDb, type JobsDb } from './db';
import { EventBus } from './events';
import { createFfRunner, type FfRunner } from './ffmpeg';
import { createLogger, type Logger } from './logger';
import { createObjectStore, type ObjectStore } from './r2';

/** AI adapters bound to one job (so every request is attributed to that job's cost tracker). */
export interface JobAi {
  recognizer: SpeechRecognizer;
  reasoner: TextReasoner;
  guard: LanguageGuard;
  /** Model chain the recognizer will try for a variety (profiles from `ai_model_profiles` override the matrix). */
  sttModelsFor(variety: VarietyId): readonly string[];
}

export interface JobAiOptions {
  sink: AiRequestSink;
  assetResolver?: AudioAssetResolver;
  /** Variety the job works on; loads that variety's STT profile override when one is enabled. */
  varietyId?: VarietyId | null;
  /**
   * Route text calls through exactly these profiles instead of the process-wide registry of enabled rows (see
   * `scopedProfileRegistry`). A model benchmark passes the one row it measures — enabled or still a disabled draft —
   * so the run uses that row's params, timeout and fallback chain, read fresh for this job.
   */
  profiles?: readonly ModelProfile[];
}

/**
 * A registry holding only the given profiles, each treated as an enabled DB row (no package defaults): resolution can
 * only land on one of them, so a call never silently borrows another profile's parameters. Used for benchmarks of a
 * single `ai_model_profiles` row, which is often a disabled draft that the shared registry would skip.
 */
export function scopedProfileRegistry(profiles: readonly ModelProfile[]): ModelProfileRegistry {
  const registry = new ModelProfileRegistry([]);
  for (const profile of profiles) registry.upsert({ ...profile, enabled: true }, 'db');
  return registry;
}

export interface JobServices {
  env: JobsEnv;
  log: Logger;
  db: JobsDb;
  /** Raw repositories (queue RPCs live here). */
  repos: Repositories;
  client: DbClient | null;
  store: ObjectStore;
  ffmpeg: FfRunner;
  events: EventBus;
  telemetry: { sink: Sink; ctx: TelemetryContext };
  /** Build AI adapters for a job; throws `AiUnavailableError` when no OpenRouter key is configured. */
  ai(options: JobAiOptions): Promise<JobAi>;
  /** True when OpenRouter is configured (handlers can report `provider_unavailable` early). */
  aiConfigured: boolean;
  workRoot: string;
  now(): Date;
  newId(): string;
}

export class AiUnavailableError extends Error {
  readonly code = 'provider_unavailable';
  constructor(message = 'OPENROUTER_API_KEY is not configured for the jobs runner') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/** Map an `ai_model_profiles` row onto the contracts `ModelProfile` (invalid rows are skipped). */
export function profileFromRow(row: Row<'ai_model_profiles'>): ModelProfile | null {
  const parsed = ModelProfileSchema.safeParse({
    id: row.id,
    task: row.task,
    targetVariety: row.target_variety_id,
    sourceLanguage: row.source_language_code,
    provider: row.provider,
    primaryModel: row.primary_model,
    fallbackModels: row.fallback_models ?? [],
    params: row.params ?? {},
    latencyClass: row.latency_class,
    enabled: row.enabled,
    version: row.version,
    benchmarkStatus: row.benchmark_status,
    dailyBudgetUsd: row.daily_budget_usd,
    updatedAt: row.updated_at,
  });
  return parsed.success ? parsed.data : null;
}

/** Repositories stand-in for `offline: true` runs: any queue/DB access through `repos` fails loudly. */
function offlineRepositories(): Repositories {
  const fail = (name: string) => () => {
    throw new Error(`Supabase is not configured in this offline run (repos.${name})`);
  };
  return new Proxy({} as Repositories, { get: (_t, prop) => new Proxy({}, { get: (_r, method) => fail(`${String(prop)}.${String(method)}`) }) });
}

export interface CreateServicesOptions {
  env?: JobsEnv;
  log?: Logger;
  /** Replace the Supabase-backed `JobsDb` (tests). */
  db?: JobsDb;
  repos?: Repositories;
  client?: DbClient;
  store?: ObjectStore;
  ffmpeg?: FfRunner;
  ai?: (options: JobAiOptions) => Promise<JobAi>;
  telemetrySink?: Sink;
  now?: () => Date;
  newId?: () => string;
  /** Skip the Supabase connection entirely (local handler smoke tests with a fake db). */
  offline?: boolean;
}

/**
 * Wire the runner's services from the environment. Pass overrides for tests; with `offline: true` and a
 * fake `db`, no Supabase client is created.
 */
export async function createJobServices(options: CreateServicesOptions = {}): Promise<JobServices> {
  const env = options.env ?? readJobsEnv();
  const log = options.log ?? createLogger({ level: env.JOBS_LOG_LEVEL, base: { app: 'jobs' } });
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());

  let client: DbClient | null = options.client ?? null;
  let repos: Repositories | null = options.repos ?? null;
  let db: JobsDb | null = options.db ?? null;
  if (!options.offline && (!db || !repos)) {
    if (!client) {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (service role; jobs runner only)');
      client = createServiceClient({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY });
    }
    repos = repos ?? createRepositories(client);
    db = db ?? createSupabaseJobsDb(client, repos);
  }
  if (!db) throw new Error('A JobsDb is required (pass `db` when offline)');
  if (!repos) {
    if (client) repos = createRepositories(client);
    else if (options.offline) repos = offlineRepositories();
    else throw new Error('Repositories require a Supabase client');
  }

  const workRoot = env.JOBS_WORK_DIR ?? join(tmpdir(), 'langquest-jobs');
  await mkdir(workRoot, { recursive: true });

  const store = options.store ?? createObjectStore(env, { log: (m) => log.warn(m) });
  const ffmpeg = options.ffmpeg ?? createFfRunner({ ffmpegPath: env.FFMPEG_PATH, ffprobePath: env.FFPROBE_PATH, timeoutMs: env.FFMPEG_TIMEOUT_MS });

  const reposRef = repos;
  const events = new EventBus({ log, autoChain: env.JOBS_AUTO_CHAIN, enqueue: (input) => reposRef.processingJobs.enqueue(input), newId, now: () => now().toISOString() });

  let telemetrySink: Sink;
  if (options.telemetrySink) telemetrySink = options.telemetrySink;
  else if (env.JOBS_TELEMETRY === 'supabase' && client) telemetrySink = new SupabaseTableSink(client as never);
  else if (env.JOBS_TELEMETRY === 'none') telemetrySink = { name: 'none', write: async () => {} };
  else telemetrySink = new ConsoleSink({ format: 'json', prefix: '[jobs-telemetry]' });
  const telemetryCtx = createTelemetryContext({ platform: 'jobs', appVersion: '0.1.0', privacyLevel: 'anonymous', now: () => now().toISOString(), newId });

  const aiConfigured = Boolean(env.OPENROUTER_API_KEY) || Boolean(options.ai);
  let shared: { client: OpenRouterClient; profiles: ModelProfileRegistry; pricing: PricingTable } | null = null;
  const dbRef = db;
  const ai =
    options.ai ??
    (async (aiOptions: JobAiOptions): Promise<JobAi> => {
      if (!env.OPENROUTER_API_KEY) throw new AiUnavailableError();
      if (!shared) {
        const pricing = new PricingTable();
        const orClient = new OpenRouterClient({ apiKey: env.OPENROUTER_API_KEY, baseUrl: env.OPENROUTER_BASE_URL, pricing, appName: 'LangQuest jobs', logger: { info: (m, f) => log.debug(m, f), warn: (m, f) => log.warn(m, f), error: (m, f) => log.error(m, f) } });
        const profiles = new ModelProfileRegistry();
        try {
          const rows = await dbRef.listEnabledModelProfiles();
          await profiles.refresh({ load: async () => rows.map(profileFromRow).filter((p): p is ModelProfile => p !== null) });
        } catch (error) {
          log.warn('ai.profiles.load_failed', { error });
        }
        shared = { client: orClient, profiles, pricing };
      }
      // Per-locale STT model chain: an enabled `speech_recognition` profile for the job's variety overrides
      // the capability-matrix default (admin-configurable, CONVENTIONS §5).
      const overrides: Partial<Record<VarietyId, readonly string[]>> = {};
      if (aiOptions.varietyId) {
        try {
          const models = await dbRef.resolveSttModels(aiOptions.varietyId);
          if (models && models.length) overrides[aiOptions.varietyId] = models;
        } catch (error) {
          log.warn('ai.stt_profile.load_failed', { varietyId: aiOptions.varietyId, error });
        }
      }
      const recognizer = new OpenRouterSpeechRecognizer({ client: shared.client, sink: aiOptions.sink, assetResolver: aiOptions.assetResolver, modelOverrides: overrides });
      const sharedReasoner = new OpenRouterTextReasoner({ client: shared.client, profiles: shared.profiles, sink: aiOptions.sink });
      const reasoner = aiOptions.profiles ? new OpenRouterTextReasoner({ client: shared.client, profiles: scopedProfileRegistry(aiOptions.profiles), sink: aiOptions.sink }) : sharedReasoner;
      // The guard's own model checks keep the normal routing (a scoped registry holds no language_quality_check row).
      const guard = new LanguageGuard({ reasoner: sharedReasoner });
      return { recognizer, reasoner, guard, sttModelsFor: (variety: VarietyId) => recognizer.modelsFor(variety) };
    });

  return {
    env,
    log,
    db,
    repos,
    client,
    store,
    ffmpeg,
    events,
    telemetry: { sink: telemetrySink, ctx: telemetryCtx },
    ai,
    aiConfigured,
    workRoot,
    now,
    newId,
  };
}
