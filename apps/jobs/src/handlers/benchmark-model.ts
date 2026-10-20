/**
 * `benchmark_model` — the full-sample-set model benchmark (§8.7, R-6.4-19, R-8.4-03). `POST /v1/admin/models/:task/
 * benchmark` records an inline smoke row and enqueues this job; the job runs a fixed sample set
 * (`benchmark-samples.ts`) through a reasoner scoped to the measured `ai_model_profiles` row (its params, timeout and
 * fallback chain, read fresh for this job, even while the row is a disabled draft) with the benchmarked model first
 * (`modelOverride`), and writes:
 *
 * - one `ai_model_benchmarks` row: dialect adherence (share of answered samples passing the heuristic language guard),
 *   latency p50 / p95, cost per call, pass / fail and per-sample notes, for the variety and the source language the
 *   samples were actually built for. Naturalness, intelligibility, false-correction rate and WER stay null: nothing
 *   here measures them, and a number is never invented (native raters / reference audio are needed);
 * - the profile's `benchmark_status` (`passing` / `failing`) only when the run measured exactly what the profile routes:
 *   its primary model (a candidate model's result says nothing about it), on the variety the profile is scoped to (a
 *   profile serving every variety is never marked from one variety's run: the row stays per-variety evidence), and
 *   only while the row still routes to that model at the version the run read;
 * - `processing_jobs.output.benchmarkId` (the route's idempotent replay answers with it) plus the smoke row's id;
 * - `ai_requests` rows for every attempt, attributed to the requesting staff member and the profile
 *   (`JobCostTracker.attributed`, purpose `model_benchmark`), with no enrollment.
 *
 * `core-v1` asks for replies in the target variety, so only tasks whose output is target-variety text are run
 * (`CORE_SET_TASKS`). For any other task (speech tasks need reference audio; source explanations answer in the
 * learner's language; assessments return judgments) the job finishes without a call or a row and says so in its
 * output: the request's smoke row stays the only benchmark.
 *
 * Spend: the per-job ceiling (`JOBS_MAX_COST_PER_JOB_USD`) and the profile's `daily_budget_usd` (today's ledger spend
 * for the profile, UTC) are checked before every sample call; a run cut short by the budget records no benchmark row
 * (a partial run is not evidence either way) and fails with `profile_budget_exhausted`. Provider outages (auth,
 * credits, rate limit, network) fail the job for a retry instead of being scored as model failures; a fallback model
 * answering a sample is reported, never credited to the benchmarked model. A retry after the row was recorded finds
 * it (`findModelBenchmarkForJob`) and only finishes the status, audit and output steps: the samples are never paid
 * for twice.
 */
import { z } from 'zod';
import type { AiTaskName, SourceLanguageCode } from '@langquest/contracts';
import { AiTaskNameSchema, SourceLanguageCodeSchema, VarietyIdSchema, getCourseTrack } from '@langquest/contracts';
import { AiProviderUnavailableError, OpenRouterError, StructuredOutputError, type AiRequestRecord, type AiRequestSink } from '@langquest/ai';
import { CostCeilingExceeded } from '../cost';
import { benchmarkNotesJobMarker, type JobsDb } from '../db';
import { JobFailure, type JobContext, type JobHandler } from '../queue/types';
import { profileFromRow } from '../services';
import { buildSampleSet, resolveSampleSetId, SAMPLE_SET_ALIASES } from './benchmark-samples';
import { jobLanguageContext, trackForVarietyOrThrow } from './common';

export const BENCHMARK_EVALUATOR_VERSION = 'benchmark-core@2026-10-20.1';
/** Pass rule: every sample answered by the benchmarked model, and at least this share of the replies in the variety. */
export const BENCHMARK_MIN_DIALECT_ADHERENCE = 0.8;

/** Tasks whose benchmark needs reference audio (WER/CER, TTS naturalness); no such sample set ships with the runner. */
const SPEECH_TASKS: ReadonlySet<AiTaskName> = new Set(['speech_recognition', 'speech_synthesis', 'realtime_conversation', 'pronunciation_assessment', 'transcription_alignment']);
/**
 * Tasks whose output is text in the target variety: the only ones `core-v1` measures. `source_explanation` writes in
 * the learner's source language and `meaning_assessment` / `learner_evaluation` / `language_quality_check` return
 * judgments, so an in-variety reply says nothing about them (and must not become a `verified` claim for the task).
 */
export const CORE_SET_TASKS: ReadonlySet<AiTaskName> = new Set(['character_dialogue', 'scene_planning', 'content_generation']);

export const BenchmarkModelParamsSchema = z.object({
  profileId: z.string().uuid(),
  model: z.string().trim().min(1),
  targetVariety: VarietyIdSchema,
  sourceLanguage: SourceLanguageCodeSchema.nullable().default(null),
  sampleSetId: z.string().trim().min(1).default('default'),
});
export type BenchmarkModelParams = z.infer<typeof BenchmarkModelParamsSchema>;

const ReplySchema = z.object({ reply: z.string().min(1).max(400), transliteration: z.string().nullable() });
/** `processing_jobs.output` written by the API once its inline smoke run is recorded. */
const SmokeLinkSchema = z.object({ benchmarkId: z.string().uuid() });

export type SampleOutcome = 'in_variety' | 'off_variety' | 'fallback_answered' | 'call_failed';

export interface SampleResult {
  id: string;
  outcome: SampleOutcome;
  /** Wall time of the sample call (repair attempt included); null when the call failed. */
  latencyMs: number | null;
  costUsd: number | null;
  detail: string | null;
}

export interface BenchmarkScores {
  answered: number;
  samples: number;
  dialectAdherence: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  costPerCallUsd: number | null;
  passed: boolean;
}

const round = (n: number, digits: number): number => Math.round(n * 10 ** digits) / 10 ** digits;

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1]!;
}

/** Pure scoring of a finished run (exported for tests). */
export function scoreBenchmark(results: readonly SampleResult[], records: readonly Pick<AiRequestRecord, 'estimatedCostUsd'>[]): BenchmarkScores {
  const answered = results.filter((r) => r.outcome === 'in_variety' || r.outcome === 'off_variety');
  const inVariety = answered.filter((r) => r.outcome === 'in_variety').length;
  const latencies = answered.map((r) => r.latencyMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const priced = records.length > 0 && records.every((r) => r.estimatedCostUsd !== null);
  const totalUsd = records.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0);
  const dialectAdherence = answered.length ? round(inVariety / answered.length, 3) : null;
  return {
    answered: answered.length,
    samples: results.length,
    dialectAdherence,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    costPerCallUsd: priced && results.length ? round(totalUsd / results.length, 6) : null,
    passed: results.length > 0 && answered.length === results.length && dialectAdherence !== null && dialectAdherence >= BENCHMARK_MIN_DIALECT_ADHERENCE,
  };
}

const describeError = (error: unknown): string => {
  if (error instanceof StructuredOutputError) return `structured output invalid: ${error.message}`.slice(0, 300);
  if (error instanceof OpenRouterError) return `provider ${error.kind}: ${error.message}`.slice(0, 300);
  if (error instanceof AiProviderUnavailableError) return `provider ${error.providerErrorKind ?? 'unavailable'}`;
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
};

/** Errors that end the job instead of being scored: spend limits, shutdown, and operator-level provider outages. */
const isFatal = (error: unknown): boolean =>
  error instanceof JobFailure ||
  error instanceof CostCeilingExceeded ||
  (error instanceof Error && error.name === 'AbortError') ||
  (error instanceof AiProviderUnavailableError && error.providerErrorKind !== 'timeout');

const startOfUtcDay = (d: Date): string => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();

export const benchmarkModelHandler: JobHandler<BenchmarkModelParams> = {
  name: 'benchmark_model',
  jobTypes: ['benchmark_model'],
  runtime: 'any',
  paramsSchema: BenchmarkModelParamsSchema,
  async run(ctx) {
    const { db } = ctx.services;
    const p = ctx.params;
    const profile = await db.getModelProfile(p.profileId);
    if (!profile) throw new JobFailure('profile_not_found', `ai_model_profiles row ${p.profileId} not found`, { retry: false });
    const taskParsed = AiTaskNameSchema.safeParse(profile.task);
    if (!taskParsed.success) throw new JobFailure('profile_invalid', `Profile ${profile.id} has an unknown task ${profile.task}`, { retry: false });
    const task = taskParsed.data;
    // Never measure a variety-specific profile on another variety (no ary→arb, yue→cmn, ht→fr).
    if (profile.target_variety_id !== null && profile.target_variety_id !== p.targetVariety) throw new JobFailure('variety_mismatch', `Profile ${profile.id} serves ${profile.target_variety_id}; benchmarking it on ${p.targetVariety} would cross a variety boundary`, { retry: false });
    if (profile.source_language_code !== null && p.sourceLanguage !== null && profile.source_language_code !== p.sourceLanguage) throw new JobFailure('source_mismatch', `Profile ${profile.id} serves source language ${profile.source_language_code}, not ${p.sourceLanguage}`, { retry: false });
    const sampleSetId = resolveSampleSetId(p.sampleSetId);
    if (!sampleSetId) throw new JobFailure('sample_set_unknown', `Unknown benchmark sample set "${p.sampleSetId}" (known: ${Object.keys(SAMPLE_SET_ALIASES).join(', ')})`, { retry: false });
    const smoke = SmokeLinkSchema.safeParse(ctx.job.output);
    const smokeBenchmarkId = smoke.success ? smoke.data.benchmarkId : null;
    const base = { smokeBenchmarkId, profileId: profile.id, task, model: p.model, targetVariety: p.targetVariety, sourceLanguage: p.sourceLanguage, requestedSampleSetId: p.sampleSetId };

    if (!CORE_SET_TASKS.has(task)) {
      // Nothing this runner can score: finish without a call, a row or a status change. The smoke row recorded with the
      // request stays the benchmark the replay answers with.
      const reason = SPEECH_TASKS.has(task)
        ? `A full ${task} benchmark needs a reference-audio sample set (WER/CER, voice naturalness); none ships with this runner, so nothing is scored.`
        : `${sampleSetId} asks for replies in the target variety; ${task} answers in the learner's source language or returns a judgment, so the set would not measure it. No full-run sample set ships for this task, so nothing is scored.`;
      return { output: { ...base, benchmarkId: smokeBenchmarkId, sampleSetId: null, fullRun: { ran: false, reason }, profileStatus: { updated: false, status: profile.benchmark_status, reason: 'no full run for this task' } } };
    }
    if (profile.provider !== 'openrouter') throw new JobFailure('provider_unsupported', `Profile ${profile.id} uses provider ${profile.provider}; the jobs runner benchmarks OpenRouter text models only`, { retry: false });
    const measured = profileFromRow(profile);
    if (!measured) throw new JobFailure('profile_invalid', `Profile ${profile.id} failed validation`, { retry: false });

    // A retry after the row was recorded (status, audit or completion failed) finishes from that row: no second run.
    const earlier = await db.findModelBenchmarkForJob({ profileId: profile.id, jobId: ctx.job.id });
    if (earlier) {
      const profileStatus = await finishStatus(db, profile, p, earlier.passed);
      await db.recordAudit({ actor_id: ctx.job.requested_by, actor_role: 'jobs', action: 'models.benchmark_completed', entity_table: 'ai_model_profiles', entity_id: profile.id, before: { benchmarkStatus: profile.benchmark_status } as never, after: { benchmarkId: earlier.id, model: p.model, sampleSetId: earlier.sample_set_id, passed: earlier.passed, profileStatus, resumed: true } as never, request_id: ctx.job.id });
      await ctx.progress(100);
      return {
        output: {
          ...base,
          benchmarkId: earlier.id,
          sampleSetId: earlier.sample_set_id,
          sourceLanguageUsed: earlier.source_language_code,
          evaluatorVersion: earlier.evaluator_version,
          resumed: true,
          scores: { dialectAdherence: earlier.dialect_adherence, latencyP50Ms: earlier.latency_p50_ms, latencyP95Ms: earlier.latency_p95_ms, costPerCallUsd: earlier.cost_per_call_usd, passed: earlier.passed },
          samples: null,
          profileStatus,
        },
      };
    }

    const source = (p.sourceLanguage ?? profile.source_language_code ?? 'en') as SourceLanguageCode;
    const track = trackForVarietyOrThrow(p.targetVariety);
    const scriptMode = getCourseTrack(track).defaultScriptMode;
    const language = jobLanguageContext(ctx, { track, sourceLanguage: source });
    const set = buildSampleSet(sampleSetId, { variety: p.targetVariety, source });

    const budgetUsd = profile.daily_budget_usd === null ? null : Number(profile.daily_budget_usd);
    const spentBeforeUsd = budgetUsd === null ? 0 : await db.sumAiSpendSince({ profileId: profile.id, since: startOfUtcDay(ctx.services.now()) });

    // Every attempt is ledgered through the job tracker (ceiling + `ai_requests`), attributed to the staff requester
    // and the measured profile, and captured here per sample.
    const captured: Array<AiRequestRecord & { sampleId: string }> = [];
    let currentSample = '';
    const ledger = ctx.cost.attributed({ userId: ctx.job.requested_by, profileId: profile.id, purpose: 'model_benchmark', log: { actor: 'staff', sampleSetId: set.id, benchmarkedModel: p.model } });
    const sink: AiRequestSink = {
      record: (entry) => {
        const stamped = { ...entry, redactedLog: { ...(entry.redactedLog ?? {}), sampleId: currentSample } };
        captured.push({ ...stamped, sampleId: currentSample });
        return ledger.record(stamped);
      },
    };
    // Scoped to the measured row: a disabled draft is not in the shared registry, and the shared one is cached per process.
    const ai = await ctx.services.ai({ sink, varietyId: p.targetVariety, profiles: [measured] });
    const spentUsd = (): number => spentBeforeUsd + captured.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0);

    const results: SampleResult[] = [];
    for (const [index, sample] of set.samples.entries()) {
      ctx.signal.throwIfAborted();
      ctx.cost.assertBudget();
      if (budgetUsd !== null && spentUsd() >= budgetUsd) {
        throw new JobFailure('profile_budget_exhausted', `Profile ${profile.id} reached its daily budget (${spentUsd().toFixed(4)} of ${budgetUsd} USD today) after ${index}/${set.samples.length} samples; no benchmark was recorded`, { retry: false, details: { samplesRun: index, spentUsd: round(spentUsd(), 6), budgetUsd } });
      }
      currentSample = sample.id;
      const first = captured.length;
      const started = Date.now();
      try {
        const out = await ai.reasoner.generateStructured(task, language, { system: sample.system, user: sample.user, templateId: `benchmark.${set.id}`, templateVersion: set.version }, ReplySchema, { modelOverride: p.model, traceId: ctx.traceId });
        const latencyMs = Date.now() - started;
        const attempts = captured.slice(first);
        const costUsd = attempts.every((r) => r.estimatedCostUsd !== null) ? round(attempts.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0), 6) : null;
        const answeredBy = attempts.filter((r) => r.success).at(-1) ?? null;
        if (answeredBy && answeredBy.fallbackIndex > 0) {
          results.push({ id: sample.id, outcome: 'fallback_answered', latencyMs, costUsd, detail: `answered by fallback ${answeredBy.model}, not ${p.model}` });
        } else {
          const verdict = ai.guard.checkHeuristic(out.reply, p.targetVariety, scriptMode, { sourceLanguage: source, track });
          results.push({ id: sample.id, outcome: verdict.ok ? 'in_variety' : 'off_variety', latencyMs, costUsd, detail: verdict.ok ? null : verdict.issues.map((i) => `${i.kind}${i.suspectedVariety ? ` (${i.suspectedVariety})` : ''}`).join(', ') });
        }
      } catch (error) {
        if (isFatal(error)) throw error;
        const attempts = captured.slice(first);
        results.push({ id: sample.id, outcome: 'call_failed', latencyMs: null, costUsd: attempts.length && attempts.every((r) => r.estimatedCostUsd !== null) ? round(attempts.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0), 6) : null, detail: describeError(error) });
      }
      await ctx.progress(Math.round(((index + 1) / set.samples.length) * 90));
    }

    const scores = scoreBenchmark(results, captured);
    const sourceNote = profile.source_language_code !== null ? '' : p.sourceLanguage === null ? ' (the profile serves any source language; none was requested, so en)' : ' (the profile serves any source language)';
    const notes = [
      `${set.id} (${set.version}), evaluator ${BENCHMARK_EVALUATOR_VERSION}, model ${p.model}, variety ${p.targetVariety}, source ${source}${sourceNote}, ${benchmarkNotesJobMarker(ctx.job.id)}`,
      `Machine-scored: dialect adherence = share of answered samples passing the heuristic language guard (${scores.dialectAdherence ?? 'n/a'}). Naturalness and intelligibility need native raters and are not scored.`,
      ...results.map((r) => `${r.id}: ${r.outcome}${r.detail ? ` — ${r.detail}` : ''}${r.latencyMs !== null ? ` (${r.latencyMs} ms)` : ''}`),
      `Pass rule: all ${scores.samples} samples answered by ${p.model} and adherence ≥ ${BENCHMARK_MIN_DIALECT_ADHERENCE}: ${scores.passed ? 'passed' : 'failed'}.`,
    ].join('\n');
    const bench = await db.recordModelBenchmark({
      profile_id: profile.id,
      model: p.model,
      target_variety_id: p.targetVariety,
      // The source the samples were built for (not the request's "any source"): the row describes what was run.
      source_language_code: source,
      sample_set_id: set.id,
      evaluator_version: BENCHMARK_EVALUATOR_VERSION,
      naturalness: null,
      intelligibility: null,
      dialect_adherence: scores.dialectAdherence,
      false_correction_rate: null,
      wer: null,
      latency_p50_ms: scores.latencyP50Ms,
      latency_p95_ms: scores.latencyP95Ms,
      cost_per_call_usd: scores.costPerCallUsd,
      passed: scores.passed,
      // Machine-scored: no human reviewed this run (the requester is on the job row and in the audit log).
      reviewer_id: null,
      notes,
    });

    const profileStatus = await finishStatus(db, profile, p, scores.passed);
    await db.recordAudit({ actor_id: ctx.job.requested_by, actor_role: 'jobs', action: 'models.benchmark_completed', entity_table: 'ai_model_profiles', entity_id: profile.id, before: { benchmarkStatus: profile.benchmark_status } as never, after: { benchmarkId: bench.id, model: p.model, sampleSetId: set.id, passed: scores.passed, profileStatus } as never, request_id: ctx.job.id });
    await ctx.progress(100);
    return {
      output: {
        ...base,
        benchmarkId: bench.id,
        sampleSetId: set.id,
        sourceLanguageUsed: source,
        evaluatorVersion: BENCHMARK_EVALUATOR_VERSION,
        passRule: { allAnsweredByModel: true, minDialectAdherence: BENCHMARK_MIN_DIALECT_ADHERENCE },
        scores,
        samples: results,
        profileStatus,
        budget: { dailyBudgetUsd: budgetUsd, spentTodayUsd: budgetUsd === null ? null : round(spentUsd(), 6) },
      },
    };
  },
};

type ProfileRow = NonNullable<Awaited<ReturnType<JobsDb['getModelProfile']>>>;
export type ProfileStatusOutcome = { updated: true; status: 'passing' | 'failing' } | { updated: false; status: ProfileRow['benchmark_status']; reason: string };

/**
 * Why a finished run must not set the profile's `benchmark_status`, or null when it may. The status is what
 * `modelCapabilities` turns into a `verified` claim for every variety the profile routes, so it is written only when the
 * run measured exactly that: the primary model, on the profile's own variety (refusals above already rule out another
 * variety or source language).
 */
export function statusBlocker(profile: Pick<ProfileRow, 'primary_model' | 'target_variety_id'>, p: Pick<BenchmarkModelParams, 'model' | 'targetVariety'>): string | null {
  if (profile.primary_model !== p.model) return `benchmarked model ${p.model} is not the profile's primary model ${profile.primary_model}`;
  if (profile.target_variety_id !== p.targetVariety) return `the profile serves every variety; this run measured ${p.targetVariety} only (kept as per-variety evidence on the benchmark row), so the profile-wide status is unchanged`;
  return null;
}

async function finishStatus(db: JobsDb, profile: ProfileRow, p: JobContext<BenchmarkModelParams>['params'], passed: boolean): Promise<ProfileStatusOutcome> {
  const status = passed ? 'passing' : 'failing';
  const blocker = statusBlocker(profile, p);
  if (blocker) return { updated: false, status: profile.benchmark_status, reason: blocker };
  // Conditional on the row the run read: a config change meanwhile (new primary model, version bump) wins.
  const written = await db.setModelProfileBenchmarkStatus({ id: profile.id, status, primaryModel: p.model, version: profile.version });
  if (!written) return { updated: false, status: profile.benchmark_status, reason: `the profile changed during the run (no longer ${p.model} at version ${profile.version}); its status is left to the newer configuration` };
  return { updated: true, status };
}
