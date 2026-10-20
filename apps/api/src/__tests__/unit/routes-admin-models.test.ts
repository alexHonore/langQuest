/**
 * `POST /v1/admin/models/:task/benchmark` (R-6.4-19) through the real app, the real OpenRouter client / reasoner /
 * language guard and a fake OpenRouter: the admin-only gate, contract validation, profile resolution, the
 * `benchmark_model` job + `ai_model_benchmarks` row + profile `benchmark_status`, the in-variety smoke check (a reply in
 * the wrong script fails the benchmark), a replay that never re-spends on live smoke calls, a full run that finishes
 * during the smoke call is never overwritten, refusals before any spend (another variety or source language, an
 * unknown sample set), the status rule (only the primary model on the profile's own variety, never over a config
 * change made meanwhile), and an honest `capability_unsupported` when the deployment has no AI provider. Staff spend (smoke tests, `POST /v1/admin/models/test` prompt probes) lands in `ai_requests` without an
 * enrollment, attributed to the admin (R-5.4-03).
 */
import { ModelBenchmarkResponseSchema, apiEnvelope } from '@langquest/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { invalidateProfileCache } from '../../services/ai';
import { modelProfileRow, routeHarness, type DbRow, type RouteHarness } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const EDITOR = '33333333-3333-4333-8333-333333333333';
const SUPPORT = '44444444-4444-4444-8444-444444444444';
const ADMIN = '66666666-6666-4666-8666-666666666666';
const ROLES = { [EDITOR]: ['content_editor' as const], [SUPPORT]: ['support_readonly' as const], [ADMIN]: ['admin' as const] };
const KEY = 'bench-route-key-0001';
const PATH = '/v1/admin/models/character_dialogue/benchmark';
const Envelope = apiEnvelope(ModelBenchmarkResponseSchema);

describe('POST /v1/admin/models/:task/benchmark', () => {
  let h: RouteHarness;
  let admin: string;
  let profile: DbRow;
  let darija: DbRow;

  const setup = async (openRouter: boolean) => {
    h = routeHarness({ roles: ROLES, openRouter });
    admin = await h.token(ADMIN);
    [profile, darija] = h.db.seed('ai_model_profiles', [modelProfileRow({ benchmark_status: 'passing' }), modelProfileRow({ target_variety_id: 'ary', primary_model: 'fake/darija-model' })]) as [DbRow, DbRow];
    h.db.seed('ai_model_profiles', [modelProfileRow({ task: 'scene_planning', target_variety_id: null })]);
    h.openrouter.catalog = ['fake/dialogue-model', 'fake/darija-model'];
  };
  afterEach(() => h.restore());

  describe('with the AI provider configured', () => {
    beforeEach(() => setup(true));

    it('is admin-only: anonymous 401, learner / support / content editor 403', async () => {
      const body = { targetVariety: 'fr', sampleSetId: 'default', idempotencyKey: KEY };
      expect((await h.call(PATH, { body })).status).toBe(401);
      for (const user of [LEARNER, SUPPORT, EDITOR]) {
        const res = await h.call(PATH, { token: await h.token(user), body });
        expect(res.status).toBe(403);
        expect(res.json.error.code).toBe('forbidden');
      }
      expect(h.db.rows('processing_jobs')).toHaveLength(0);
      expect(h.openrouter.calls).toHaveLength(0);
    });

    it('validates the task, the body and the profile (422 / 404) before any provider call', async () => {
      expect((await h.call('/v1/admin/models/dancing/benchmark', { token: admin, body: { targetVariety: 'fr', sampleSetId: 's', idempotencyKey: KEY } })).status).toBe(422);
      for (const body of [{ targetVariety: 'fr', idempotencyKey: KEY }, { targetVariety: 'klingon', sampleSetId: 's', idempotencyKey: KEY }, { targetVariety: 'fr', sampleSetId: 's', idempotencyKey: 'short' }, { targetVariety: 'fr', sampleSetId: '', idempotencyKey: KEY }]) {
        const res = await h.call(PATH, { token: admin, body });
        expect(res.status).toBe(422);
        expect(res.json.error.code).toBe('validation_failed');
      }
      const none = await h.call(PATH, { token: admin, body: { targetVariety: 'de', sampleSetId: 'smoke-de', idempotencyKey: KEY } });
      expect(none.status).toBe(404); // no enabled character_dialogue profile covers German
      const otherTask = h.db.rows('ai_model_profiles').find((p) => p.task === 'scene_planning')!;
      const mismatch = await h.call(PATH, { token: admin, body: { profileId: otherTask.id, targetVariety: 'fr', sampleSetId: 's', idempotencyKey: KEY } });
      expect(mismatch.status).toBe(422);
      expect(mismatch.json.error.message).toContain('scene_planning');
      expect(h.db.rows('processing_jobs')).toHaveLength(0);
      expect(h.openrouter.calls).toHaveLength(0);
    });

    it('enqueues benchmark_model, records a passing smoke benchmark for the variety and marks the profile (202)', async () => {
      const res = await h.call(PATH, { token: admin, body: { targetVariety: 'fr', sampleSetId: 'default', idempotencyKey: KEY } });
      expect(res.status).toBe(202);
      const parsed = Envelope.parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      const [job] = h.db.rows('processing_jobs');
      const [bench] = h.db.rows('ai_model_benchmarks');
      expect(parsed.data).toEqual({ jobId: job!.id, benchmarkId: bench!.id, state: 'pending' });
      expect(job).toMatchObject({ job_type: 'benchmark_model', idempotency_key: `benchmark_model:${KEY}`, requested_by: ADMIN, provider: 'openrouter', params: { profileId: profile.id, model: 'fake/dialogue-model', targetVariety: 'fr', sourceLanguage: null, sampleSetId: 'default' } });
      // The row names the source the smoke call ran with (the profile serves any source; none was requested: en).
      expect(bench).toMatchObject({ profile_id: profile.id, model: 'fake/dialogue-model', target_variety_id: 'fr', source_language_code: 'en', sample_set_id: 'default', passed: true, reviewer_id: ADMIN });
      expect(String(bench!.notes)).toContain('catalog:fake/dialogue-model: ok');
      expect(String(bench!.notes)).toContain('in_variety_reply:fr: ok');
      expect(profile.benchmark_status).toBe('passing');
      // The smoke call ran on the benchmarked model, in the requested variety, through the fake provider only.
      const [chat] = h.openrouter.callsTo('/chat/completions');
      expect(chat?.body?.model ?? (chat?.body?.models as string[] | undefined)?.[0]).toBe('fake/dialogue-model');
      expect(JSON.stringify(chat?.body?.messages)).toContain('French');
      await h.flush();
      expect(h.db.rows('audit_logs')).toEqual([expect.objectContaining({ action: 'models.benchmark', entity_id: profile.id, actor_id: ADMIN })]);
      // The smoke call's spend is ledgered as staff spend: no enrollment (the probe has none), the admin as actor.
      expect(h.db.rows('ai_requests')).toEqual([expect.objectContaining({ task: 'character_dialogue', model: 'fake/dialogue-model', enrollment_id: null, user_id: ADMIN, profile_id: profile.id, success: true })]);
      expect(h.db.rows('ai_requests')[0]!.redacted_log).toMatchObject({ purpose: 'admin_smoke_test', actor: 'staff', templateId: 'admin.smoke' });
      expect(h.blocked).toEqual([]);
    });

    it('a full run that finishes during the smoke call keeps its job output and profile status', async () => {
      const FULL = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
      darija.benchmark_status = 'unbenchmarked';
      const reply = h.openrouter.chat;
      // The jobs runner completes the full sample set while the route is still waiting on its smoke call.
      h.openrouter.chat = (req) => {
        const [job] = h.db.rows('processing_jobs');
        Object.assign(job!, { state: 'succeeded', output: { benchmarkId: FULL, profileStatus: { updated: true, status: 'passing' } } });
        darija.benchmark_status = 'passing';
        return reply(req);
      };
      const res = await h.call(PATH, { token: admin, body: { profileId: darija.id, targetVariety: 'ary', sampleSetId: 'default', idempotencyKey: KEY } });
      expect(res.status).toBe(202);
      // The Latin-script smoke reply failed for Darija and is recorded, but it overwrites neither the job's output nor
      // the status the full run set.
      const [smoke] = h.db.rows('ai_model_benchmarks');
      expect(smoke).toMatchObject({ passed: false, target_variety_id: 'ary' });
      expect(h.db.rows('processing_jobs')[0]!.output).toEqual({ benchmarkId: FULL, profileStatus: { updated: true, status: 'passing' } });
      expect(darija.benchmark_status).toBe('passing');
      const replay = await h.call(PATH, { token: admin, body: { profileId: darija.id, targetVariety: 'ary', sampleSetId: 'default', idempotencyKey: KEY } });
      expect(replay.json.data).toMatchObject({ benchmarkId: FULL, state: 'succeeded' });
    });

    it('a job that finished without writing a status (no full run for the task) does not block the smoke status', async () => {
      darija.benchmark_status = 'passing';
      const reply = h.openrouter.chat;
      h.openrouter.chat = (req) => {
        const [job] = h.db.rows('processing_jobs');
        Object.assign(job!, { state: 'succeeded', output: { benchmarkId: null, fullRun: { ran: false, reason: 'no full-run sample set' }, profileStatus: { updated: false, status: 'passing', reason: 'no full run for this task' } } });
        return reply(req);
      };
      const res = await h.call(PATH, { token: admin, body: { profileId: darija.id, targetVariety: 'ary', sampleSetId: 'default', idempotencyKey: KEY } });
      expect(res.status).toBe(202);
      expect(darija.benchmark_status).toBe('failing');
    });

    it('refuses before any spend: a profile of another variety or source language, an unknown sample set (422)', async () => {
      const [english] = h.db.seed('ai_model_profiles', [modelProfileRow({ target_variety_id: 'es-ES', source_language_code: 'en' })]) as [DbRow];
      const cases: Array<[Record<string, unknown>, RegExp]> = [
        [{ profileId: darija.id, targetVariety: 'arb', sampleSetId: 'default' }, /serves ary; benchmarking it on arb would cross a variety boundary/],
        [{ profileId: english.id, targetVariety: 'es-ES', sourceLanguage: 'fr', sampleSetId: 'default' }, /serves source language en, not fr/],
        [{ profileId: darija.id, targetVariety: 'ary', sampleSetId: 'smoke-ary' }, /Unknown benchmark sample set "smoke-ary"/],
      ];
      for (const [body, message] of cases) {
        const res = await h.call(PATH, { token: admin, body: { ...body, idempotencyKey: KEY } });
        expect(res.status).toBe(422);
        expect(res.json.error.message).toMatch(message);
      }
      expect(h.db.rows('processing_jobs')).toHaveLength(0);
      expect(h.db.rows('ai_model_benchmarks')).toHaveLength(0);
      expect(h.openrouter.calls).toHaveLength(0);
      expect(darija.benchmark_status).toBe('unbenchmarked');
    });

    it('a profile serving every variety records the smoke row for the variety but keeps its status', async () => {
      const [global] = h.db.seed('ai_model_profiles', [modelProfileRow({ target_variety_id: null, benchmark_status: 'unbenchmarked' })]) as [DbRow];
      const res = await h.call(PATH, { token: admin, body: { profileId: global.id, targetVariety: 'fr', sampleSetId: 'default', idempotencyKey: KEY } });
      expect(res.status).toBe(202);
      const [bench] = h.db.rows('ai_model_benchmarks');
      expect(bench).toMatchObject({ profile_id: global.id, target_variety_id: 'fr', passed: true });
      // A passing French smoke call would otherwise read as `verified` for every variety the profile routes.
      expect(global.benchmark_status).toBe('unbenchmarked');
      await h.flush();
      expect(h.db.rows('audit_logs')[0]!.after).toMatchObject({ profileStatus: { updated: false, reason: expect.stringContaining('serves every variety') } });
    });

    it('a config change saved during the smoke call wins over the smoke status', async () => {
      darija.benchmark_status = 'passing';
      const reply = h.openrouter.chat;
      h.openrouter.chat = (req) => {
        // adminModelConfigPut bumps the version while the smoke call is in flight.
        darija.version = 2;
        return reply(req);
      };
      const res = await h.call(PATH, { token: admin, body: { profileId: darija.id, targetVariety: 'ary', sampleSetId: 'default', idempotencyKey: KEY } });
      expect(res.status).toBe(202);
      expect(h.db.rows('ai_model_benchmarks')[0]).toMatchObject({ passed: false });
      expect(darija.benchmark_status).toBe('passing');
    });

    it('a reply outside the target variety (wrong script) fails the benchmark and marks the profile failing', async () => {
      darija.benchmark_status = 'passing';
      const res = await h.call(PATH, { token: admin, body: { profileId: darija.id, targetVariety: 'ary', sampleSetId: 'core-v1', idempotencyKey: KEY } });
      expect(res.status).toBe(202);
      const [bench] = h.db.rows('ai_model_benchmarks');
      expect(bench).toMatchObject({ passed: false, target_variety_id: 'ary', model: 'fake/darija-model' });
      expect(String(bench!.notes)).toMatch(/in_variety_reply:ary: wrong_script/);
      expect(darija.benchmark_status).toBe('failing');
    });

    it('an override model missing from the provider catalog fails its benchmark (no silent substitution) and leaves the profile status alone', async () => {
      const res = await h.call(PATH, { token: admin, body: { targetVariety: 'fr', model: 'fake/unknown-model', sampleSetId: 'default', idempotencyKey: KEY } });
      expect(res.status).toBe(202);
      const [bench] = h.db.rows('ai_model_benchmarks');
      expect(bench).toMatchObject({ model: 'fake/unknown-model', passed: false });
      expect(String(bench!.notes)).toContain('catalog:fake/unknown-model: model id not found');
      expect(h.db.rows('processing_jobs')[0]!.params).toMatchObject({ model: 'fake/unknown-model' });
      // A candidate's result says nothing about the primary model the profile routes to (same rule as the full run).
      expect(profile.benchmark_status).toBe('passing');
    });

    it('a replay with the same idempotency key returns the same job and benchmark without new live smoke calls', async () => {
      const first = await h.call(PATH, { token: admin, body: { targetVariety: 'fr', sampleSetId: 'default', idempotencyKey: KEY } });
      const callsAfterFirst = h.openrouter.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0);
      const replay = await h.call(PATH, { token: admin, body: { targetVariety: 'fr', sampleSetId: 'default', idempotencyKey: KEY } });
      expect(replay.status).toBe(200);
      expect(replay.json.data).toEqual(first.json.data);
      expect(h.openrouter.calls.length).toBe(callsAfterFirst);
      expect(h.db.rows('processing_jobs')).toHaveLength(1);
      expect(h.db.rows('ai_model_benchmarks')).toHaveLength(1);
      // The benchmark is linked to its own job, which is what a replay reads back.
      expect(h.db.rows('processing_jobs')[0]!.output).toEqual({ benchmarkId: first.json.data.benchmarkId });
    });

    it('a replay never answers with another run’s benchmark (in-flight first run, older run of another variety or key)', async () => {
      // An older benchmark of the same profile / model / sample set, recorded for another variety under another key.
      h.db.seed('ai_model_benchmarks', [{ profile_id: profile.id, model: 'fake/dialogue-model', target_variety_id: 'ary', sample_set_id: 'default', passed: true, created_at: '2026-10-01T00:00:00.000Z' }]);
      // The first request under KEY is still running its smoke calls: its job exists, no benchmark is linked yet.
      h.db.seed('processing_jobs', [{ job_type: 'benchmark_model', idempotency_key: `benchmark_model:${KEY}`, state: 'pending', params: { profileId: profile.id }, output: null }]);
      const replay = await h.call(PATH, { token: admin, body: { targetVariety: 'fr', sampleSetId: 'default', idempotencyKey: KEY } });
      expect(replay.status).toBe(200);
      expect(replay.json.data).toEqual({ jobId: h.db.rows('processing_jobs')[0]!.id, benchmarkId: null, state: 'pending' });
      expect(h.openrouter.calls).toHaveLength(0);
      expect(h.db.rows('ai_model_benchmarks')).toHaveLength(1);
    });
  });

  it('POST /v1/admin/models/test ledgers a prompt probe as staff spend (no enrollment, admin actor, probe trace id)', async () => {
    await setup(true);
    invalidateProfileCache();
    const res = await h.call('/v1/admin/models/test', { token: admin, body: { mode: 'prompt', targetVariety: 'fr', sourceLanguage: 'en', model: 'fake/dialogue-model', prompt: 'Salut !' } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toMatchObject({ mode: 'prompt', task: 'character_dialogue', requestedModel: 'fake/dialogue-model', content: 'Bonjour ! Comment allez-vous aujourd’hui ?' });
    const [chat] = h.openrouter.callsTo('/chat/completions');
    expect(chat?.body?.model ?? (chat?.body?.models as string[] | undefined)?.[0]).toBe('fake/dialogue-model');
    await h.flush();
    const rows = h.db.rows('ai_requests');
    expect(rows).toEqual([expect.objectContaining({ task: 'character_dialogue', enrollment_id: null, user_id: ADMIN, profile_id: profile.id, trace_id: res.json.data.traceId, success: true })]);
    expect(rows[0]!.redacted_log).toMatchObject({ purpose: 'admin_model_test', actor: 'staff', templateId: 'admin.model_test' });
    expect(h.blocked).toEqual([]);
  });

  it('without an AI provider it answers capability_unsupported and records nothing (no fake failing benchmark)', async () => {
    await setup(false);
    const res = await h.call(PATH, { token: admin, body: { targetVariety: 'fr', sampleSetId: 'default', idempotencyKey: KEY } });
    expect(res.status).toBe(501);
    expect(res.json.error.code).toBe('capability_unsupported');
    expect(h.db.rows('processing_jobs')).toHaveLength(0);
    expect(h.db.rows('ai_model_benchmarks')).toHaveLength(0);
    expect(profile.benchmark_status).toBe('passing');
    expect(h.blocked).toEqual([]);
  });
});
