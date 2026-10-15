/**
 * §6.4 model routing (§8.2, §8.7, A25): list `ai_model_profiles` + live OpenRouter discovery, update a task's
 * profile (publishing a change requires language-specific smoke tests to pass), and benchmarks (live smoke
 * recorded in `ai_model_benchmarks` + a `benchmark_model` job for the full sample set). Changes take effect on
 * the next request through the profile loader — no mobile rebuild.
 */
import { trackForVariety } from '@langquest/ai/capability/registry';
import { getPromptPack } from '@langquest/ai/prompts/packs';
import { AiTaskNameSchema, ModelBenchmarkRequestSchema, ModelBenchmarkResponseSchema, ModelConfigPutRequestSchema, ModelConfigPutResponseSchema, ModelsListQuerySchema, ModelsListResponseSchema, buildLanguageContext, type AiTaskName, type JsonValue, type ModelProfile, type VarietyId } from '@langquest/contracts';
import type { Insert } from '@langquest/db/types';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { AI_TIMEOUT_MS } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { invalidateProfileCache, loadDbProfiles, rowToModelProfile } from '../../services/ai';
import type { RequestServices } from '../../services/context';

const TaskParams = z.object({ task: AiTaskNameSchema });
const SPEECH_TASKS: ReadonlySet<AiTaskName> = new Set(['speech_recognition', 'speech_synthesis', 'realtime_conversation', 'pronunciation_assessment', 'transcription_alignment']);
const SmokeSchema = z.object({ reply: z.string().min(1).max(300), transliteration: z.string().nullable() });

let catalogCache: { at: number; models: { id: string; provider: string; modalities: string[]; contextLength: number | null; pricing: Record<string, unknown> | null }[] } | null = null;

export interface SmokeTest {
  name: string;
  passed: boolean;
  detail: string | null;
}

/** Language-specific smoke tests for a profile: catalog membership + a real in-variety call (text) or support check (speech). */
export async function runSmokeTests(s: RequestServices, profile: Pick<ModelProfile, 'task' | 'provider' | 'primaryModel' | 'fallbackModels' | 'targetVariety' | 'sourceLanguage'>, varietyOverride?: VarietyId | null): Promise<SmokeTest[]> {
  const tests: SmokeTest[] = [];
  if (!s.config.env.OPENROUTER_API_KEY) return [{ name: 'provider_configured', passed: false, detail: 'OPENROUTER_API_KEY is not configured' }];
  const ai = await s.ai();
  const variety = varietyOverride ?? profile.targetVariety ?? 'es-ES';
  const trackId = trackForVariety(variety);
  const language = buildLanguageContext({ uiLocale: 'en', enrollmentId: crypto.randomUUID(), sourceLanguageCode: profile.sourceLanguage ?? 'en', courseTrackId: trackId });
  if (profile.provider === 'openrouter') {
    for (const model of [profile.primaryModel, ...profile.fallbackModels]) {
      try {
        const exists = await ai.client.models.exists(model, { timeoutMs: 10_000 });
        tests.push({ name: `catalog:${model}`, passed: exists, detail: exists ? null : 'model id not found in the OpenRouter catalog' });
      } catch (error) {
        tests.push({ name: `catalog:${model}`, passed: false, detail: `catalog lookup failed: ${(error as Error).message}` });
      }
    }
  }
  if (SPEECH_TASKS.has(profile.task)) {
    const locale = language.targetVariety;
    const cap = profile.task === 'speech_synthesis' ? await ai.synthesizer.supports(locale) : profile.task === 'pronunciation_assessment' ? await ai.assessor.capability(locale) : await ai.recognizer.supports(locale);
    tests.push({ name: `supports:${variety}`, passed: cap.supported, detail: cap.supported ? (cap.notes[0] ?? null) : cap.reasons.join(', ') });
    return tests;
  }
  const pack = getPromptPack(variety);
  const started = Date.now();
  try {
    const out = await ai.reasoner.generateStructured(
      profile.task,
      language,
      { system: `You are a ${pack.name} speaker. Reply ONLY in ${pack.name}. ${pack.scriptRules}`, user: 'Greet a learner in one short sentence and ask how they are.', templateId: 'admin.smoke', templateVersion: '2026-10-14.1' },
      SmokeSchema,
      { modelOverride: profile.primaryModel, timeoutMs: 20_000, traceId: s.requestId },
    );
    const guard = ai.guard.checkHeuristic(out.reply, variety, 'native');
    tests.push({ name: `in_variety_reply:${variety}`, passed: guard.ok, detail: guard.ok ? `latency ${Date.now() - started}ms` : guard.issues.map((i) => `${i.kind}: ${i.detail}`).join('; ') });
  } catch (error) {
    tests.push({ name: `in_variety_reply:${variety}`, passed: false, detail: `call failed: ${(error as Error).message.slice(0, 200)}` });
  }
  return tests;
}

export function registerModelRoutes(define: DefineRoute): void {
  define('adminModelsList', {}, async (c) => {
    const q = parseQuery(c, ModelsListQuerySchema);
    const s = c.get('services')!;
    const loaded = await loadDbProfiles(s.service, s.log, true);
    const profiles = loaded.profiles.filter((p) => (!q.task || p.task === q.task) && (!q.targetVariety || p.targetVariety === q.targetVariety || p.targetVariety === null) && (!q.sourceLanguage || p.sourceLanguage === q.sourceLanguage || p.sourceLanguage === null));
    let availableModels = catalogCache?.models ?? [];
    if (s.config.env.OPENROUTER_API_KEY && (!catalogCache || Date.now() - catalogCache.at > 10 * 60_000)) {
      try {
        const ai = await s.ai();
        const list = await ai.client.models.list({}, { timeoutMs: 15_000 });
        availableModels = list.map((m) => ({ id: m.id, provider: m.id.split('/')[0] ?? 'unknown', modalities: m.outputModalities, contextLength: m.contextLength, pricing: { prompt: m.pricing.prompt, completion: m.pricing.completion } }));
        catalogCache = { at: Date.now(), models: availableModels };
      } catch (error) {
        s.log.warn('models.catalog_failed', { error });
      }
    }
    return respondOk(c, ModelsListResponseSchema.parse({ profiles, availableModels }));
  });

  define('adminModelConfigPut', { role: 'admin', timeoutMs: AI_TIMEOUT_MS }, async (c) => {
    const { task } = parseParams(c, TaskParams);
    const body = await parseBody(c, ModelConfigPutRequestSchema);
    if (body.task !== task) throw problem.validation(`Body task ${body.task} does not match path task ${task}`);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const existing = await s.repos.aiProfiles.resolve(task, body.targetVariety, body.sourceLanguage);
    const exact = existing && existing.target_variety_id === body.targetVariety && existing.source_language_code === body.sourceLanguage ? existing : null;
    if (body.expectedVersion !== undefined && exact && exact.version !== body.expectedVersion) throw problem.precondition(`Profile version is ${exact.version}, expected ${body.expectedVersion}`, { currentVersion: exact.version });
    const smokeTests = body.requireSmokeTests ? await runSmokeTests(s, body) : [];
    const passed = smokeTests.every((t) => t.passed);
    if (body.requireSmokeTests && body.enabled && !passed) throw problem.precondition('Smoke tests failed; the profile was not changed. Fix the model ids or disable the profile.', { smokeTests: smokeTests as unknown as JsonValue });
    const row: Insert<'ai_model_profiles'> = {
      task,
      target_variety_id: body.targetVariety,
      source_language_code: body.sourceLanguage,
      provider: body.provider,
      primary_model: body.primaryModel,
      fallback_models: body.fallbackModels,
      params: body.params as never,
      latency_class: body.latencyClass,
      daily_budget_usd: body.dailyBudgetUsd,
      enabled: body.enabled,
      benchmark_status: body.requireSmokeTests ? (passed ? 'passing' : 'failing') : 'unbenchmarked',
      updated_by: principal.userId,
    };
    const saved = await s.repos.aiProfiles.upsert(row);
    invalidateProfileCache();
    const profile = rowToModelProfile(saved);
    if (!profile) throw problem.internal('Saved profile failed validation');
    s.audit({ action: 'models.config_put', entityTable: 'ai_model_profiles', entityId: saved.id, before: exact ? { primaryModel: exact.primary_model, version: exact.version, enabled: exact.enabled } : null, after: { primaryModel: saved.primary_model, version: saved.version, enabled: saved.enabled, smokeTests } });
    return respondOk(c, ModelConfigPutResponseSchema.parse({ profile, smokeTests }));
  });

  define('adminModelBenchmark', { role: 'admin', timeoutMs: AI_TIMEOUT_MS }, async (c) => {
    const { task } = parseParams(c, TaskParams);
    const body = await parseBody(c, ModelBenchmarkRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const profileRow = body.profileId ? await s.repos.aiProfiles.getById(body.profileId) : await s.repos.aiProfiles.resolve(task, body.targetVariety, body.sourceLanguage ?? null);
    if (!profileRow) throw problem.notFound('Model profile');
    if (profileRow.task !== task) throw problem.validation(`Profile is for task ${profileRow.task}, not ${task}`);
    const profile = rowToModelProfile(profileRow);
    if (!profile) throw problem.internal('Profile row failed validation');
    const model = body.model ?? profile.primaryModel;
    const job = await s.repos.processingJobs.enqueue({ jobType: 'benchmark_model', idempotencyKey: `benchmark_model:${body.idempotencyKey}`, requestedBy: principal.userId, provider: profile.provider, params: { profileId: profileRow.id, model, targetVariety: body.targetVariety, sourceLanguage: body.sourceLanguage ?? null, sampleSetId: body.sampleSetId } });
    const started = Date.now();
    const smoke = await runSmokeTests(s, { ...profile, primaryModel: model }, body.targetVariety);
    const passed = smoke.every((t) => t.passed);
    const bench = await s.repos.aiProfiles.recordBenchmark({ profile_id: profileRow.id, model, target_variety_id: body.targetVariety, source_language_code: body.sourceLanguage ?? null, sample_set_id: body.sampleSetId, evaluator_version: 'smoke@2026-10-14.1', latency_p50_ms: Date.now() - started, passed, reviewer_id: principal.userId, notes: smoke.map((t) => `${t.name}: ${t.passed ? 'ok' : t.detail ?? 'failed'}`).join('\n') }).catch((error) => {
      s.log.warn('benchmark.record_failed', { error });
      return null;
    });
    await s.repos.aiProfiles.update(profileRow.id, { benchmark_status: passed ? 'passing' : 'failing' }).catch(() => undefined);
    invalidateProfileCache();
    s.audit({ action: 'models.benchmark', entityTable: 'ai_model_profiles', entityId: profileRow.id, after: { model, sampleSetId: body.sampleSetId, passed, jobId: job.id } });
    return respondOk(c, ModelBenchmarkResponseSchema.parse({ jobId: job.id, benchmarkId: bench?.id ?? null, state: job.state }), 202);
  });
}
