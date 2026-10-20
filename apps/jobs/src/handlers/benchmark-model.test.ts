import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiProviderUnavailableError, MemoryAiRequestSink, OpenRouterClient, OpenRouterTextReasoner, StructuredOutputError } from '@langquest/ai';
import { chatResponse, mockFetch } from '@langquest/ai/test-support/fakes';
import { buildLanguageContext, type Prompt } from '@langquest/contracts';
import type { Row } from '@langquest/db';
import { profileFromRow, scopedProfileRegistry } from '../services';
import { ScriptedReasoner, createTestServices, runHandler, type ScriptedReasonerScript, type TestServices } from '../test-support/fakes';
import { BENCHMARK_EVALUATOR_VERSION, CORE_SET_TASKS, benchmarkModelHandler, percentile, scoreBenchmark, statusBlocker } from './benchmark-model';
import { CORE_SAMPLE_SET_ID, SAMPLE_SET_ALIASES, buildSampleSet, resolveSampleSetId } from './benchmark-samples';

const ADMIN = '66666666-6666-4666-8666-666666666666';
const SMOKE_ID = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';

/** In-variety Spanish (Spain) replies per core sample (all pass the heuristic language guard). */
const SPANISH: Record<string, string> = {
  greeting: '¡Hola! ¿Qué tal estás?',
  service_exchange: 'Claro, ahora mismo te pongo un café. ¿Lo quieres con leche?',
  directions: 'La parada está ahí mismo, al final de la calle.',
  repair_request: 'Perdona, no te he entendido. ¿Me lo repites más despacio?',
  code_switch: 'Vale, tranquilo. ¿Quieres algo de beber?',
  register: 'Perdone, cerramos dentro de diez minutos.',
};
const FRENCH = 'Bonjour, je vais bien merci, et vous ?';

/** Sample id of a benchmark prompt (the sample's user text is unique within the set). */
const sampleOf = (prompt: Prompt): string => buildSampleSet(CORE_SAMPLE_SET_ID, { variety: 'es-ES', source: 'fr' }).samples.find((s) => s.user === prompt.user)?.id ?? 'unknown';
const PARAMS = { model: 'fake/model-a', targetVariety: 'es-ES', sourceLanguage: 'fr', sampleSetId: 'default' } as const;

describe('benchmark sample sets', () => {
  it('resolves the dialog default to the versioned core set and refuses unknown ids', () => {
    expect(resolveSampleSetId('default')).toBe('core-v1');
    expect(resolveSampleSetId(' Core-V1 ')).toBe('core-v1');
    expect(resolveSampleSetId('smoke-fr')).toBeNull();
    // The API refuses any other id before spending (`KNOWN_BENCHMARK_SAMPLE_SETS` in apps/api routes/admin/models.ts).
    expect(Object.keys(SAMPLE_SET_ALIASES).sort()).toEqual(['core', 'core-v1', 'default']);
  });

  it('asks for replies in the target variety and mixes the source language into the code-switch sample', () => {
    const set = buildSampleSet('core-v1', { variety: 'ary', source: 'fr' });
    expect(set.samples.map((s) => s.id)).toEqual(['greeting', 'service_exchange', 'directions', 'repair_request', 'code_switch', 'register']);
    expect(set.samples.every((s) => /Moroccan/.test(s.system) && /Reply ONLY in/.test(s.system))).toBe(true);
    const codeSwitch = set.samples.find((s) => s.id === 'code_switch')!;
    expect(codeSwitch.user).toMatch(/mixed French into the message/);
    expect(codeSwitch.user).toMatch(/never switch to French or to another variety/);
  });
});

describe('scoreBenchmark', () => {
  it('scores adherence over answered samples, nearest-rank latency and cost per call; one failed call fails the run', () => {
    const results = [
      { id: 'a', outcome: 'in_variety' as const, latencyMs: 100, costUsd: 0.001, detail: null },
      { id: 'b', outcome: 'in_variety' as const, latencyMs: 300, costUsd: 0.001, detail: null },
      { id: 'c', outcome: 'off_variety' as const, latencyMs: 200, costUsd: 0.001, detail: 'wrong_variety' },
      { id: 'd', outcome: 'in_variety' as const, latencyMs: 400, costUsd: 0.001, detail: null },
      { id: 'e', outcome: 'in_variety' as const, latencyMs: 500, costUsd: 0.001, detail: null },
    ];
    const s = scoreBenchmark(results, results.map(() => ({ estimatedCostUsd: 0.001 })));
    expect(s).toEqual({ answered: 5, samples: 5, dialectAdherence: 0.8, latencyP50Ms: 300, latencyP95Ms: 500, costPerCallUsd: 0.001, passed: true });
    const withFailure = scoreBenchmark([...results, { id: 'f', outcome: 'call_failed', latencyMs: null, costUsd: null, detail: 'x' }], [...results.map(() => ({ estimatedCostUsd: 0.001 })), { estimatedCostUsd: null }]);
    expect(withFailure).toMatchObject({ answered: 5, samples: 6, passed: false, costPerCallUsd: null });
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('benchmark_model', () => {
  let t: TestServices;
  let reasoner: ScriptedReasoner;
  let profile: Row<'ai_model_profiles'>;
  let script: ScriptedReasonerScript;

  const services = async (s: Partial<ScriptedReasonerScript> = {}) => {
    script = { answer: (prompt) => ({ reply: SPANISH[sampleOf(prompt)] ?? '¡Hola!', transliteration: null }), ...s };
    // Replaced by the job's own reasoner once the handler asks for AI services (refusals never do).
    reasoner = new ScriptedReasoner(null, script);
    t = await createTestServices({ reasoner: (sink) => (reasoner = new ScriptedReasoner(sink, script)) });
    profile = t.db.seedModelProfile({ task: 'character_dialogue', target_variety_id: 'es-ES', primary_model: 'fake/model-a', benchmark_status: 'unbenchmarked' });
  };
  const run = (params: Record<string, unknown> = {}, job: Partial<Row<'processing_jobs'>> = {}) => runHandler(benchmarkModelHandler, t, { profileId: profile.id, ...PARAMS, ...params }, { job_type: 'benchmark_model', requested_by: ADMIN, output: { benchmarkId: SMOKE_ID } as never, ...job });
  afterEach(() => t.cleanup());

  describe('a profile the core set can measure', () => {
    beforeEach(() => services());

    it('runs the core sample set on the benchmarked model, records the benchmark, marks the profile and links the job output', async () => {
      const { result, ctx } = await run();
      const out = result.output as Record<string, unknown>;
      const [bench] = [...t.db.tables.ai_model_benchmarks.values()];
      expect(bench).toMatchObject({
        profile_id: profile.id,
        model: 'fake/model-a',
        target_variety_id: 'es-ES',
        source_language_code: 'fr',
        sample_set_id: 'core-v1',
        evaluator_version: BENCHMARK_EVALUATOR_VERSION,
        dialect_adherence: 1,
        cost_per_call_usd: 0.001,
        passed: true,
        // Never invented: nothing in the core set measures these.
        naturalness: null,
        intelligibility: null,
        false_correction_rate: null,
        wer: null,
        reviewer_id: null,
      });
      expect(bench!.latency_p50_ms).toEqual(expect.any(Number));
      expect(bench!.latency_p95_ms).toBeGreaterThanOrEqual(bench!.latency_p50_ms!);
      expect(bench!.notes).toContain('greeting: in_variety');
      expect(bench!.notes).toContain('Naturalness and intelligibility need native raters');
      expect(t.db.tables.ai_model_profiles.get(profile.id)!.benchmark_status).toBe('passing');
      // The route's replay reads `output.benchmarkId`; the inline smoke row stays linked next to it.
      expect(out).toMatchObject({ benchmarkId: bench!.id, smokeBenchmarkId: SMOKE_ID, sampleSetId: 'core-v1', requestedSampleSetId: 'default', profileStatus: { updated: true, status: 'passing' }, scores: { answered: 6, samples: 6, passed: true } });
      // Every sample went to the benchmarked model first, for the requested variety and source language, through a
      // reasoner scoped to the measured row (its params and fallbacks, not another profile's).
      expect(t.aiOptions.map((o) => o.profiles?.map((x) => x.id))).toEqual([[profile.id]]);
      expect(reasoner.calls).toHaveLength(6);
      expect(reasoner.calls.every((c) => c.task === 'character_dialogue' && c.options.modelOverride === 'fake/model-a' && c.locale.targetVariety === 'es-ES' && c.locale.sourceLanguage === 'fr')).toBe(true);
      expect(reasoner.calls.every((c) => c.prompt.templateId === 'benchmark.core-v1')).toBe(true);
      // Ledger: one ai_requests row per attempt, attributed to the staff requester and the profile, no enrollment.
      await ctx.cost.flush();
      const rows = [...t.db.tables.ai_requests.values()];
      expect(t.persistErrors).toEqual([]);
      expect(rows).toHaveLength(6);
      for (const row of rows) {
        expect(row).toMatchObject({ user_id: ADMIN, enrollment_id: null, profile_id: profile.id, model: 'fake/model-a', estimated_cost_usd: 0.001 });
        expect(row.redacted_log).toMatchObject({ purpose: 'model_benchmark', actor: 'staff', sampleSetId: 'core-v1', benchmarkedModel: 'fake/model-a', jobId: ctx.job.id });
      }
      expect(rows.map((r) => (r.redacted_log as { sampleId: string }).sampleId)).toEqual(['greeting', 'service_exchange', 'directions', 'repair_request', 'code_switch', 'register']);
      expect([...t.db.tables.audit_logs.values()]).toEqual([expect.objectContaining({ action: 'models.benchmark_completed', entity_id: profile.id, actor_id: ADMIN })]);
    });

    it('replies outside the variety lower the adherence; below the pass line the benchmark fails and the profile is marked failing', async () => {
      script.answer = (prompt) => ({ reply: ['code_switch', 'register'].includes(sampleOf(prompt)) ? FRENCH : SPANISH[sampleOf(prompt)], transliteration: null });
      await run();
      const [bench] = [...t.db.tables.ai_model_benchmarks.values()];
      expect(bench).toMatchObject({ passed: false, dialect_adherence: 0.667 });
      expect(bench!.notes).toMatch(/code_switch: off_variety — source_language_leak/);
      expect(t.db.tables.ai_model_profiles.get(profile.id)!.benchmark_status).toBe('failing');
    });

    it('a fallback model answering a sample is reported and never credited to the benchmarked model', async () => {
      script.fallbackIndex = (prompt) => (sampleOf(prompt) === 'directions' ? 1 : 0);
      const { result } = await run();
      const [bench] = [...t.db.tables.ai_model_benchmarks.values()];
      expect(bench!.passed).toBe(false);
      expect(bench!.notes).toContain('directions: fallback_answered — answered by fallback fake/fallback-model, not fake/model-a');
      expect((result.output as { scores: { answered: number } }).scores.answered).toBe(5);
    });

    it('scores an invalid structured reply as a failed sample instead of failing the job', async () => {
      script.fail = (prompt) => (sampleOf(prompt) === 'register' ? new StructuredOutputError('Model output failed schema validation', null, '{}') : null);
      await run();
      const [bench] = [...t.db.tables.ai_model_benchmarks.values()];
      expect(bench).toMatchObject({ passed: false, dialect_adherence: 1 });
      expect(bench!.notes).toMatch(/register: call_failed — structured output invalid/);
    });

    it('a provider outage fails the job for a retry and records no benchmark (an outage is not a model result)', async () => {
      script.fail = (prompt) => (sampleOf(prompt) === 'directions' ? new AiProviderUnavailableError('Text generation is temporarily unavailable.', 'openrouter', { cause: { kind: 'rate_limited' } }) : null);
      await expect(run()).rejects.toBeInstanceOf(AiProviderUnavailableError);
      expect(t.db.tables.ai_model_benchmarks.size).toBe(0);
      expect(t.db.tables.ai_model_profiles.get(profile.id)!.benchmark_status).toBe('unbenchmarked');
    });

    it('a profile serving every variety is never marked from one variety: the row is kept as per-variety evidence', async () => {
      const global = t.db.seedModelProfile({ task: 'character_dialogue', target_variety_id: null, primary_model: 'fake/model-a', benchmark_status: 'unbenchmarked' });
      const { result } = await run({ profileId: global.id });
      const [bench] = [...t.db.tables.ai_model_benchmarks.values()];
      expect(bench).toMatchObject({ profile_id: global.id, target_variety_id: 'es-ES', passed: true });
      // A passing es-ES run would otherwise read as `verified` for ary, yue, ht … through modelCapabilities.
      expect(t.db.tables.ai_model_profiles.get(global.id)!.benchmark_status).toBe('unbenchmarked');
      expect((result.output as { profileStatus: unknown }).profileStatus).toMatchObject({ updated: false, reason: expect.stringContaining('serves every variety') });
    });

    it('a config change during the run wins: the status is not written over a new primary model or version', async () => {
      const answer = script.answer;
      script.answer = (prompt, task) => {
        // An admin saves the profile (adminModelConfigPut bumps the version) while the samples are running.
        if (sampleOf(prompt) === 'directions') t.db.tables.ai_model_profiles.set(profile.id, { ...t.db.tables.ai_model_profiles.get(profile.id)!, primary_model: 'fake/model-b', version: 2, benchmark_status: 'passing' });
        return answer(prompt, task);
      };
      script.fail = (prompt) => (sampleOf(prompt) === 'register' ? new StructuredOutputError('Model output failed schema validation', null, '{}') : null);
      const { result } = await run();
      expect([...t.db.tables.ai_model_benchmarks.values()][0]).toMatchObject({ model: 'fake/model-a', passed: false });
      expect(t.db.tables.ai_model_profiles.get(profile.id)!.benchmark_status).toBe('passing');
      expect((result.output as { profileStatus: unknown }).profileStatus).toMatchObject({ updated: false, reason: expect.stringContaining('changed during the run') });
    });

    it('a disabled draft runs with its own params and fallbacks, and the row names the source the samples used', async () => {
      const draft = t.db.seedModelProfile({ task: 'character_dialogue', target_variety_id: 'es-ES', source_language_code: 'fr', enabled: false, primary_model: 'fake/model-a', fallback_models: ['fake/draft-fallback'], params: { temperature: 0.3, maxOutputTokens: 321, timeoutMs: 7000 } });
      await run({ profileId: draft.id, sourceLanguage: null });
      expect(t.aiOptions.at(-1)!.profiles).toEqual([expect.objectContaining({ id: draft.id, enabled: false, fallbackModels: ['fake/draft-fallback'], params: expect.objectContaining({ temperature: 0.3, maxOutputTokens: 321 }) })]);
      expect(reasoner.calls.every((c) => c.locale.sourceLanguage === 'fr')).toBe(true);
      const [bench] = [...t.db.tables.ai_model_benchmarks.values()];
      // The request said "any source"; the samples were built for the profile's French, and the row says so.
      expect(bench).toMatchObject({ profile_id: draft.id, source_language_code: 'fr' });
      expect(bench!.notes).toContain('source fr, job ');
      expect(bench!.notes).not.toContain('serves any source language');
    });

    it('with no source requested on a profile serving any source, the row records the source actually used', async () => {
      const anySource = t.db.seedModelProfile({ task: 'character_dialogue', target_variety_id: 'es-ES', source_language_code: null, primary_model: 'fake/model-a' });
      const { result } = await run({ profileId: anySource.id, sourceLanguage: null });
      const [bench] = [...t.db.tables.ai_model_benchmarks.values()];
      expect(bench).toMatchObject({ source_language_code: 'en' });
      expect(bench!.notes).toContain('source en (the profile serves any source language; none was requested, so en)');
      expect(result.output).toMatchObject({ sourceLanguage: null, sourceLanguageUsed: 'en' });
    });

    it('a retry after the row was recorded finishes from that row: no second paid run, no second row', async () => {
      const recordAudit = t.db.recordAudit.bind(t.db);
      let failAudit = true;
      t.db.recordAudit = async (row) => {
        if (failAudit) {
          failAudit = false;
          throw new Error('audit insert failed');
        }
        return recordAudit(row);
      };
      const JOB = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
      await expect(run({}, { id: JOB })).rejects.toThrow('audit insert failed');
      expect(reasoner.calls).toHaveLength(6);
      const firstReasoner = reasoner;
      const { result } = await run({}, { id: JOB });
      expect(firstReasoner.calls).toHaveLength(6);
      expect(t.aiOptions).toHaveLength(1); // the retry never asked for AI services
      expect(t.db.tables.ai_model_benchmarks.size).toBe(1);
      const [bench] = [...t.db.tables.ai_model_benchmarks.values()];
      expect(result.output).toMatchObject({ benchmarkId: bench!.id, resumed: true, scores: { passed: true, dialectAdherence: 1 }, profileStatus: { updated: true, status: 'passing' } });
      expect(t.db.tables.ai_model_profiles.get(profile.id)!.benchmark_status).toBe('passing');
      expect([...t.db.tables.audit_logs.values()]).toEqual([expect.objectContaining({ action: 'models.benchmark_completed', request_id: JOB })]);
      // Another job on the same profile is a new run, not a resume.
      await run();
      expect(t.db.tables.ai_model_benchmarks.size).toBe(2);
    });

    it('a candidate model is recorded but leaves the status of the model the profile routes to alone', async () => {
      const { result } = await run({ model: 'fake/candidate' });
      const [bench] = [...t.db.tables.ai_model_benchmarks.values()];
      expect(bench).toMatchObject({ model: 'fake/candidate', passed: true });
      expect(reasoner.calls.every((c) => c.options.modelOverride === 'fake/candidate')).toBe(true);
      expect(t.db.tables.ai_model_profiles.get(profile.id)!.benchmark_status).toBe('unbenchmarked');
      expect((result.output as { profileStatus: unknown }).profileStatus).toMatchObject({ updated: false, reason: expect.stringContaining('not the profile') });
    });
  });

  describe('spend limits', () => {
    beforeEach(() => services());

    it("stops at the profile's daily budget (ledger spend today + this run) and records no partial benchmark", async () => {
      t.db.tables.ai_model_profiles.set(profile.id, { ...profile, daily_budget_usd: 0.0025 });
      await t.db.logAiRequest({ task: 'character_dialogue', provider: 'openrouter', model: 'fake/model-a', profile_id: profile.id, success: true, trace_id: 'earlier-today', estimated_cost_usd: 0.002 });
      await expect(run()).rejects.toMatchObject({ code: 'profile_budget_exhausted', retry: false, details: { samplesRun: 1 } });
      expect(reasoner.calls).toHaveLength(1);
      expect(t.db.tables.ai_model_benchmarks.size).toBe(0);
      expect(t.db.tables.ai_model_profiles.get(profile.id)!.benchmark_status).toBe('unbenchmarked');
      // The one call that ran is still in the ledger.
      expect([...t.db.tables.ai_requests.values()].filter((r) => (r.redacted_log as { purpose?: string } | null)?.purpose === 'model_benchmark')).toHaveLength(1);
    });

    it('spend from earlier days does not count against today', async () => {
      t.db.tables.ai_model_profiles.set(profile.id, { ...profile, daily_budget_usd: 0.01 });
      await t.db.logAiRequest({ task: 'character_dialogue', provider: 'openrouter', model: 'fake/model-a', profile_id: profile.id, success: true, trace_id: 'yesterday', estimated_cost_usd: 5, created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
      const { result } = await run();
      expect((result.output as { budget: unknown }).budget).toEqual({ dailyBudgetUsd: 0.01, spentTodayUsd: 0.006 });
      expect(t.db.tables.ai_model_benchmarks.size).toBe(1);
    });
  });

  describe('tasks core-v1 cannot measure (nothing is called, recorded or marked; the smoke row stays the benchmark)', () => {
    beforeEach(() => services());

    it.each([
      ['speech_recognition', 'openrouter', /reference-audio sample set/],
      ['pronunciation_assessment', 'azure_speech', /reference-audio sample set/],
      ['source_explanation', 'openrouter', /source language or returns a judgment/],
      ['meaning_assessment', 'openrouter', /source language or returns a judgment/],
      ['learner_evaluation', 'openrouter', /source language or returns a judgment/],
      ['language_quality_check', 'openrouter', /source language or returns a judgment/],
    ] as const)('%s', async (task, provider, reason) => {
      const other = t.db.seedModelProfile({ task, provider, target_variety_id: 'es-ES', primary_model: 'fake/model-a', benchmark_status: 'unbenchmarked' });
      const { result } = await run({ profileId: other.id });
      expect(result.output).toMatchObject({ benchmarkId: SMOKE_ID, smokeBenchmarkId: SMOKE_ID, sampleSetId: null, fullRun: { ran: false, reason: expect.stringMatching(reason) }, profileStatus: { updated: false } });
      expect(t.aiOptions).toHaveLength(0);
      expect(t.db.tables.ai_model_benchmarks.size).toBe(0);
      expect(t.db.tables.ai_requests.size).toBe(0);
      expect(t.db.tables.ai_model_profiles.get(other.id)!.benchmark_status).toBe('unbenchmarked');
    });

    it('runs only the tasks whose output is target-variety text', () => {
      expect([...CORE_SET_TASKS].sort()).toEqual(['character_dialogue', 'content_generation', 'scene_planning']);
    });
  });

  describe('refusals (nothing is called, nothing is recorded)', () => {
    beforeEach(() => services());

    it.each([
      ['an unknown sample set', () => ({ sampleSetId: 'smoke-fr' }), 'sample_set_unknown'],
      ['a missing profile', () => ({ profileId: '7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f' }), 'profile_not_found'],
      ['a variety the profile does not serve (no variety substitution)', () => ({ targetVariety: 'es-419' }), 'variety_mismatch'],
      ['a non-OpenRouter provider', () => ({ profileId: t.db.seedModelProfile({ task: 'character_dialogue', provider: 'azure_speech' }).id }), 'provider_unsupported'],
      ['another source language than the profile serves', () => ({ profileId: t.db.seedModelProfile({ task: 'character_dialogue', target_variety_id: 'es-ES', source_language_code: 'en' }).id, sourceLanguage: 'fr' }), 'source_mismatch'],
    ])('%s', async (_name, params, code) => {
      await expect(run(params())).rejects.toMatchObject({ code, retry: false });
      expect(reasoner.calls).toHaveLength(0);
      expect(t.aiOptions).toHaveLength(0);
      expect(t.db.tables.ai_model_benchmarks.size).toBe(0);
      expect(t.db.tables.ai_requests.size).toBe(0);
    });
  });
});

describe('the status rule and the scoped reasoner', () => {
  it('statusBlocker: only the primary model, on the profile\'s own variety, may set the status', () => {
    expect(statusBlocker({ primary_model: 'm', target_variety_id: 'ary' }, { model: 'm', targetVariety: 'ary' })).toBeNull();
    expect(statusBlocker({ primary_model: 'm', target_variety_id: 'ary' }, { model: 'other', targetVariety: 'ary' })).toMatch(/not the profile's primary model/);
    expect(statusBlocker({ primary_model: 'm', target_variety_id: null }, { model: 'm', targetVariety: 'es-ES' })).toMatch(/serves every variety/);
  });

  it('scopedProfileRegistry routes a disabled draft row with its own chain and params (no package default borrowed)', async () => {
    const now = new Date().toISOString();
    const row: Row<'ai_model_profiles'> = { id: '9c9c9c9c-9c9c-4c9c-8c9c-9c9c9c9c9c9c', task: 'character_dialogue', target_variety_id: 'ary', source_language_code: null, provider: 'openrouter', primary_model: 'fake/draft-primary', fallback_models: ['fake/draft-fallback'], params: { temperature: 0.25, maxOutputTokens: 333, timeoutMs: 9000 }, capabilities: {}, latency_class: 'interactive', daily_budget_usd: null, enabled: false, version: 3, benchmark_status: 'unbenchmarked', updated_by: null, created_at: now, updated_at: now };
    const registry = scopedProfileRegistry([profileFromRow(row)!]);
    expect(registry.find({ task: 'character_dialogue', targetVariety: 'ary', sourceLanguage: 'fr' })).toMatchObject({ id: row.id, resolvedSource: 'db', fallbackModels: ['fake/draft-fallback'] });
    // Nothing else resolves: no package default can stand in for the measured row.
    expect(registry.find({ task: 'character_dialogue', targetVariety: 'arb', sourceLanguage: 'fr' })).toBeNull();
    expect(registry.find({ task: 'scene_planning', targetVariety: 'ary', sourceLanguage: 'fr' })).toBeNull();
    const { fetchImpl, calls } = mockFetch([{ match: (u) => u.endsWith('/chat/completions'), respond: () => chatResponse('{"reply":"لاباس عليك؟","transliteration":"labas 3lik?"}', 'fake/candidate') }]);
    const client = new OpenRouterClient({ apiKey: 'k', fetch: fetchImpl, sleep: async () => {}, requestIdFactory: () => 'req' });
    const sink = new MemoryAiRequestSink();
    const reasoner = new OpenRouterTextReasoner({ client, profiles: registry, sink });
    const locale = buildLanguageContext({ uiLocale: 'en', enrollmentId: '11111111-1111-4111-8111-111111111111', sourceLanguageCode: 'fr', courseTrackId: 'arabic-moroccan' });
    await reasoner.generateStructured('character_dialogue', locale, { system: 's', user: 'u', templateId: 'benchmark.core-v1', templateVersion: '1' }, z.object({ reply: z.string(), transliteration: z.string().nullable() }), { modelOverride: 'fake/candidate' });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.models).toEqual(['fake/candidate', 'fake/draft-primary', 'fake/draft-fallback']);
    expect(body).toMatchObject({ temperature: 0.25, max_tokens: 333 });
    expect(sink.records[0]).toMatchObject({ profileId: row.id, model: 'fake/candidate' });
  });
});
