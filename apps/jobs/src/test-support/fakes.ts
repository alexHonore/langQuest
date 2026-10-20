/**
 * Test doubles: fake STT recogniser / text reasoner (no network), an offline `JobServices` built on
 * `MemoryJobsDb` + `LocalFsObjectStore`, ffmpeg-generated audio fixtures and a direct handler runner.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { z } from 'zod';
import type { AiTaskName, AudioInput, Capability, LanguageContext, Prompt, SpeechRecognizer, TextReasoner, TextReasonerOptions, TranscriptResult, TranscriptSegment } from '@langquest/contracts';
import { LanguageGuard, type AiRequestRecord, type AiRequestSink } from '@langquest/ai';
import type { Repositories } from '@langquest/db';
import { readJobsEnv, type JobsEnv } from '../config';
import { JobCostTracker } from '../cost';
import { EventBus } from '../events';
import { buildToneCommand, createFfRunner, type FfRunner } from '../ffmpeg';
import { silentLogger } from '../logger';
import { LocalFsObjectStore } from '../r2';
import type { JobContext, JobHandler, JobResult, ProcessingJobRow, HandlerName } from '../queue/types';
import type { JobAi, JobAiOptions, JobServices } from '../services';
import { MemoryJobsDb } from './memory-db';

/** Deterministic recogniser: returns canned segments (chunk-relative) and records every call. */
export class FakeRecognizer implements SpeechRecognizer {
  readonly provider = 'fake';
  /** Shared across instances when `options.calls` is given (the services factory builds one recogniser per job). */
  readonly calls: Array<{ audio: AudioInput; locale: string }>;
  constructor(
    private readonly options: { segments?: TranscriptSegment[]; words?: boolean; language?: string; supported?: boolean; sink?: AiRequestSink | null; costUsd?: number; calls?: Array<{ audio: AudioInput; locale: string }> } = {},
  ) {
    this.calls = options.calls ?? [];
  }
  async supports(locale: string): Promise<Capability> {
    const supported = this.options.supported ?? true;
    return { supported, reasons: supported ? [] : ['locale_unsupported'], features: { word: false, phoneme: false, tone: false, prosody: false, streaming: false, interruptible: false, codeSwitch: true, multiSpeaker: false }, latencyClass: 'batch', effectiveLocale: locale, qualityEstimate: null, provider: this.provider, notes: [] } as Capability;
  }
  async transcribe(audio: AudioInput, locale: string): Promise<TranscriptResult> {
    this.calls.push({ audio, locale });
    const words = this.options.words ?? true;
    const segments: TranscriptSegment[] = this.options.segments ?? [
      { index: 0, text: 'Hola, buenos días.', startMs: 0, endMs: 1200, confidence: 0.9, speakerLabel: null, language: this.options.language ?? 'es', words: words ? [{ text: 'Hola', startMs: 0, endMs: 400, confidence: 0.95 }, { text: 'buenos', startMs: 500, endMs: 800, confidence: 0.9 }, { text: 'días', startMs: 850, endMs: 1200, confidence: 0.9 }] : [] },
      { index: 1, text: 'Quiero un café, por favor.', startMs: 1300, endMs: 2900, confidence: 0.85, speakerLabel: null, language: this.options.language ?? 'es', words: words ? [{ text: 'Quiero', startMs: 1300, endMs: 1700, confidence: 0.9 }, { text: 'un', startMs: 1750, endMs: 1850, confidence: 0.9 }, { text: 'café', startMs: 1900, endMs: 2300, confidence: 0.9 }, { text: 'por', startMs: 2400, endMs: 2550, confidence: 0.9 }, { text: 'favor', startMs: 2600, endMs: 2900, confidence: 0.9 }] : [] },
    ];
    await this.options.sink?.record({ occurredAt: new Date().toISOString(), userId: null, enrollmentId: null, task: 'speech_recognition', provider: this.provider, model: 'fake-stt', profileId: null, fallbackIndex: 0, latencyMs: 5, inputTokens: null, outputTokens: null, audioSeconds: 3, estimatedCostUsd: this.options.costUsd ?? 0.0002, success: true, errorCode: null, traceId: 'fake', redactedLog: null });
    return { text: segments.map((s) => s.text).join(' '), segments, confidence: 0.88, detectedLanguage: { code: this.options.language ?? 'es', confidence: null }, requestedLocale: locale, provider: this.provider, model: 'fake-stt', durationMs: 3000, languageMismatch: false };
  }
}

/** Reasoner that answers from a per-task function; validates the answer with the caller's schema. */
export class FakeReasoner implements TextReasoner {
  readonly calls: Array<{ task: AiTaskName; prompt: Prompt; locale: LanguageContext }> = [];
  constructor(
    private readonly answer: (task: AiTaskName, prompt: Prompt, locale: LanguageContext) => unknown,
    private readonly sink: AiRequestSink | null = null,
  ) {}
  async generateStructured<T>(task: AiTaskName, locale: LanguageContext, prompt: Prompt, schema: z.ZodType<T>): Promise<T> {
    this.calls.push({ task, prompt, locale });
    await this.sink?.record({ occurredAt: new Date().toISOString(), userId: null, enrollmentId: locale.enrollmentId, task, provider: 'fake', model: 'fake-llm', profileId: null, fallbackIndex: 0, latencyMs: 3, inputTokens: 100, outputTokens: 50, audioSeconds: null, estimatedCostUsd: 0.0005, success: true, errorCode: null, traceId: 'fake', redactedLog: null } satisfies AiRequestRecord);
    return schema.parse(this.answer(task, prompt, locale));
  }
}

export interface ScriptedReasonerScript {
  answer: (prompt: Prompt, task: AiTaskName) => unknown;
  /** Fallback index the "provider" answered with (0 = the requested model); a fallback reports `fake/fallback-model`. */
  fallbackIndex?: (prompt: Prompt) => number;
  /** Error to throw for a call (recorded as a failed attempt first, like the real reasoner). */
  fail?: (prompt: Prompt) => Error | null;
  costUsd?: number | null;
}

/**
 * Reasoner that honours `modelOverride` like the OpenRouter one: the requested model answers (and is recorded) unless
 * the script makes a fallback answer. Records one ledger attempt per call through the given sink.
 */
export class ScriptedReasoner implements TextReasoner {
  readonly calls: Array<{ task: AiTaskName; prompt: Prompt; locale: LanguageContext; options: TextReasonerOptions }> = [];
  constructor(
    private readonly sink: AiRequestSink | null,
    private readonly script: ScriptedReasonerScript,
  ) {}
  async generateStructured<T>(task: AiTaskName, locale: LanguageContext, prompt: Prompt, schema: z.ZodType<T>, options: TextReasonerOptions = {}): Promise<T> {
    this.calls.push({ task, prompt, locale, options });
    const error = this.script.fail?.(prompt) ?? null;
    const fallbackIndex = this.script.fallbackIndex?.(prompt) ?? 0;
    const model = fallbackIndex > 0 ? 'fake/fallback-model' : (options.modelOverride ?? 'fake-llm');
    await this.sink?.record({ occurredAt: new Date().toISOString(), userId: null, enrollmentId: locale.enrollmentId, task, provider: 'openrouter', model, profileId: null, fallbackIndex, latencyMs: 4, inputTokens: 120, outputTokens: 30, audioSeconds: null, estimatedCostUsd: this.script.costUsd === undefined ? 0.001 : this.script.costUsd, success: !error, errorCode: error ? 'fake_error' : null, traceId: options.traceId ?? 'fake', redactedLog: { templateId: prompt.templateId, templateVersion: prompt.templateVersion } } satisfies AiRequestRecord);
    if (error) throw error;
    return schema.parse(this.script.answer(prompt, task));
  }
}

export interface TestServicesOptions {
  db?: MemoryJobsDb;
  recognizer?: SpeechRecognizer | ((sink: AiRequestSink) => SpeechRecognizer);
  reasoner?: TextReasoner | ((sink: AiRequestSink) => TextReasoner);
  aiConfigured?: boolean;
  env?: Partial<Record<string, string>>;
}

export interface TestServices {
  services: JobServices;
  db: MemoryJobsDb;
  store: LocalFsObjectStore;
  ffmpeg: FfRunner;
  root: string;
  aiRequests: AiRequestRecord[];
  /** Options every `services.ai(...)` call received (e.g. the profiles a benchmark scopes its reasoner to). */
  aiOptions: JobAiOptions[];
  /** `ai_requests` writes the memory db refused (e.g. the enrollment foreign key); `runHandler` collects them. */
  persistErrors: unknown[];
  cleanup(): Promise<void>;
}

/** Offline services: temp dir, local store, real ffmpeg, memory db, fake AI. */
export async function createTestServices(options: TestServicesOptions = {}): Promise<TestServices> {
  const root = await mkdtemp(join(tmpdir(), 'lq-jobs-'));
  const env: JobsEnv = readJobsEnv({ JOBS_WORK_DIR: join(root, 'work'), LOCAL_OBJECT_STORE_DIR: join(root, 'store'), OBJECT_STORE: 'local', JOBS_TELEMETRY: 'none', FFMPEG_PATH: process.env.FFMPEG_PATH ?? '/opt/homebrew/bin/ffmpeg', FFPROBE_PATH: process.env.FFPROBE_PATH ?? '/opt/homebrew/bin/ffprobe', ...(options.env ?? {}) });
  const db = options.db ?? new MemoryJobsDb();
  const store = new LocalFsObjectStore(join(root, 'store'), 'test-bucket');
  const ffmpeg = createFfRunner({ ffmpegPath: env.FFMPEG_PATH, ffprobePath: env.FFPROBE_PATH, timeoutMs: 120_000 });
  const aiRequests: AiRequestRecord[] = [];
  const aiOptionsSeen: JobAiOptions[] = [];
  const events = new EventBus({ log: silentLogger, autoChain: false });
  const ai = async (aiOptions: JobAiOptions): Promise<JobAi> => {
    if (options.aiConfigured === false) throw new (await import('../services')).AiUnavailableError();
    aiOptionsSeen.push(aiOptions);
    const sink: AiRequestSink = { record: (r) => void (aiRequests.push(r), aiOptions.sink.record(r)) };
    const recognizer = typeof options.recognizer === 'function' ? options.recognizer(sink) : (options.recognizer ?? new FakeRecognizer({ sink }));
    const reasoner = typeof options.reasoner === 'function' ? options.reasoner(sink) : (options.reasoner ?? new FakeReasoner(() => ({}), sink));
    return { recognizer, reasoner, guard: new LanguageGuard({}), sttModelsFor: () => ['fake-stt'] };
  };
  const services: JobServices = {
    env,
    log: silentLogger,
    db,
    repos: {} as Repositories,
    client: null,
    store,
    ffmpeg,
    events,
    telemetry: { sink: { name: 'none', write: async () => {} }, ctx: { platform: 'jobs', appVersion: 'test', sessionId: null, userHash: null, enrollmentId: null, trackId: null, targetVarietyId: null, sourceLanguageCode: null, privacyLevel: 'anonymous' } },
    ai,
    aiConfigured: options.aiConfigured ?? true,
    workRoot: join(root, 'work'),
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  };
  return { services, db, store, ffmpeg, root, aiRequests, aiOptions: aiOptionsSeen, persistErrors: [], cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Generate a short tone fixture with ffmpeg (wav by default). */
export async function makeToneFixture(ffmpeg: FfRunner, dir: string, options: { seconds?: number; format?: 'wav' | 'mp3'; name?: string; channels?: 1 | 2 } = {}): Promise<string> {
  const format = options.format ?? 'wav';
  const path = join(dir, options.name ?? `tone.${format}`);
  await ffmpeg.run(buildToneCommand({ output: path, seconds: options.seconds ?? 3, format, channels: options.channels ?? 1 }));
  return path;
}

export function fakeJobRow(partial: Partial<ProcessingJobRow> & Pick<ProcessingJobRow, 'job_type'>): ProcessingJobRow {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), parent_asset_id: null, parent_entity_table: null, parent_entity_id: null, state: 'running', priority: 5, attempts: 1, max_attempts: 3, progress_pct: 0, provider: null, params: {}, cost_estimate_usd: null, cost_actual_usd: null, failure_code: null, failure_message: null, output_asset_ids: [], output: null, idempotency_key: crypto.randomUUID(), requested_by: null, started_at: now, finished_at: null, locked_by: 'test-worker', locked_until: null, created_at: now, updated_at: now, ...partial };
}

/**
 * Run a handler directly with a hand-built context (params validated by the handler schema). The job's cost tracker
 * persists `ai_requests` rows into the memory db like the runner does in production; refused rows land in
 * `t.persistErrors`.
 */
export async function runHandler<P>(handler: JobHandler<P>, t: TestServices, params: unknown, job: Partial<ProcessingJobRow> = {}): Promise<{ result: JobResult; ctx: JobContext<P>; events: EventBus['emitted'] }> {
  const row = fakeJobRow({ job_type: handler.jobTypes[0] ?? 'describe', ...job });
  const parsed = handler.paramsSchema.parse(params);
  const workDir = join(t.services.workRoot, row.id);
  await (await import('node:fs/promises')).mkdir(workDir, { recursive: true });
  const cost = new JobCostTracker({ jobId: row.id, traceId: `test:${row.id}`, maxUsd: 1, persistAiRequest: (r) => t.db.logAiRequest(r), onPersistError: (error) => void t.persistErrors.push(error) });
  const ctx: JobContext<P> = {
    job: row,
    handler: handler.name as HandlerName,
    workerId: 'test-worker',
    params: parsed,
    services: t.services,
    log: silentLogger,
    workDir,
    signal: new AbortController().signal,
    traceId: `test:${row.id}`,
    cost,
    progress: async () => {},
    emit: (type, payload, key) => t.services.events.emit(type, payload, key, `test:${row.id}`, { jobId: row.id }),
  };
  const result = await handler.run(ctx);
  return { result, ctx, events: t.services.events.emitted };
}
