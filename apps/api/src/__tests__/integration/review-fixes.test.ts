/**
 * Integration coverage (local Supabase stack) for the review fixes on the learner/admin/speech routes:
 * - mission detail: authored source-language instructions and hints win, the language-less `hint_scaffold` never
 *   leaks, goal descriptions are per-source only (A04, §2.1/§10.1);
 * - mission evaluate: no evaluator ⇒ `evaluatorRan: false` and `evaluation.confidence: null` (§16.3);
 * - request-review answers a contract `ReviewStatus` and validates the variety BEFORE writing anything;
 * - model capabilities resolve profiles for the enrollment's source language (never a hard-coded `en`);
 * - conversation turn: an in-flight `clientTurnId` is replayed once the character row lands, otherwise `turn_in_progress`
 *   + `Retry-After` (never a second pipeline run), and the contract's inline clip is accepted by validation.
 */
import { ContentRequestReviewResponseSchema, MissionDetailResponseSchema } from '@langquest/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MissionEvaluateApiResponseSchema } from '../../routes/learner/missions';
import { TURN_RETRY_WAIT_MS } from '../../routes/speech/conversation';
import { call, createStackUser, deleteStackUsers, describeWithStack, stackApp, type StackHarness, type TestUser } from '../harness';

const describeStack = describeWithStack('api.review-fixes');

const FR = { instructions: 'Écoute la scène puis salue le marchand.', hints: ['Indice : commence par « salam »', 'Indice : termine par « labas ? »'] };
const EN = { instructions: 'Listen to the scene, then greet the vendor.', hints: ['Hint: start with "salam"'] };
const SCAFFOLD = 'scaffold-meaning-in-an-unknown-language';

describeStack('review fixes against the local stack', () => {
  let h: StackHarness;
  let alice: TestUser;
  let admin: TestUser;
  let enrollmentId: string;
  let missionId: string;
  let stepIds: string[];
  let characterId: string;
  const missionIds: string[] = [];
  const sessionIds: string[] = [];

  const stepResult = (stepId: string) => ({ stepId, outcome: 'success', hintsUsed: 0, replays: 0, durationMs: 30_000, speechAssessmentIds: [], attemptedBeforeReveal: null, selectedIntentId: null, conversationSessionId: null });
  const templateKey = () => `api_fix_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  beforeAll(async () => {
    // A syntactically valid but unusable key: adapters are wired (profiles resolve) while no provider is ever reached.
    h = stackApp({ OPENROUTER_API_KEY: 'sk-or-v1-not-a-real-key-for-tests' });
    [alice, admin] = await Promise.all([createStackUser(h, 'fix-alice', { defaultSourceLanguageCode: 'fr' }), createStackUser(h, 'fix-admin', { role: 'admin' })]);
    const enrol = await call(h.app, '/v1/me/enrollments', { token: alice.token, body: { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both' } });
    expect(enrol.status, JSON.stringify(enrol.json)).toBe(201);
    enrollmentId = enrol.json.data.id;

    const mission = await h.service
      .from('missions')
      .insert({ template_key: templateKey(), target_variety_id: 'ary', state: 'published', published_revision: 1, title_translations: { fr: 'Saluer au souk', en: 'Greet at the souk' }, goals: [{ id: 'g_localized', skill_keys: ['greet.basic'], description: { fr: 'Saluer poliment le marchand', en: 'Greet the vendor politely' } }, { id: 'g_unlabelled', skill_keys: ['greet.basic'], description: 'Editor free text with no language tag' }] })
      .select('id')
      .single();
    if (mission.error) throw new Error(mission.error.message);
    missionId = mission.data.id;
    missionIds.push(missionId);
    const steps = await h.service
      .from('mission_steps')
      .insert([0, 1, 2].map((i) => ({ mission_id: missionId, sort_order: i, step_type: (['context_listening', 'modeled_expression', 'anticipation'] as const)[i]!, estimated_seconds: 30, hint_scaffold: [SCAFFOLD], offline_capable: true })))
      .select('id, sort_order');
    if (steps.error) throw new Error(steps.error.message);
    stepIds = steps.data.sort((a, b) => a.sort_order - b.sort_order).map((s) => s.id);
    const locs = await h.service.from('mission_localizations').insert([
      { mission_id: missionId, source_language_code: 'fr', title: 'Saluer au souk', instructions: FR.instructions, hints: FR.hints, qa_state: 'reviewed' },
      { mission_id: missionId, source_language_code: 'en', title: 'Greet at the souk', instructions: EN.instructions, hints: EN.hints, qa_state: 'machine_draft' },
    ]);
    if (locs.error) throw new Error(locs.error.message);
    const character = await h.service.from('characters').insert({ character_key: `fix.${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`, name: 'Youssef', role: 'vendor', personality: 'cheerful', home_region: 'Marrakech', target_variety_id: 'ary', voice_profile: { synthetic: true }, storyline_facts: ['Sells spices'], state: 'published' }).select('id').single();
    if (character.error) throw new Error(character.error.message);
    characterId = character.data.id;
  });

  afterAll(async () => {
    await h.app.flush();
    if (sessionIds.length) await h.service.from('conversation_sessions').delete().in('id', sessionIds);
    if (characterId) await h.service.from('characters').delete().eq('id', characterId);
    if (missionIds.length) await h.service.from('missions').delete().in('id', missionIds);
    await deleteStackUsers(h, [alice.id, admin.id]);
  });

  it('mission detail: authored source-language instructions/hints win and the language-less scaffold never leaks', async () => {
    const fr = await call(h.app, `/v1/missions/${missionId}?source=fr&enrollmentId=${enrollmentId}`, { token: alice.token });
    expect(fr.status, JSON.stringify(fr.json)).toBe(200);
    const detail = MissionDetailResponseSchema.parse(fr.json.data);
    expect(detail.steps).toHaveLength(3);
    for (const st of detail.steps) {
      expect(st.instruction).toBe(FR.instructions);
      expect(st.hints).toEqual(FR.hints);
      expect([st.instruction, ...st.hints]).not.toContain(SCAFFOLD);
    }
    expect(detail.goals.find((g) => g.id === 'g_localized')?.description).toBe('Saluer poliment le marchand');
    // A bare string has no language: never shown, and the mission is honestly reported as not fully localized.
    expect(detail.goals.find((g) => g.id === 'g_unlabelled')?.description).toBe('');
    expect(detail.localizationComplete).toBe(false);

    const en = await call(h.app, `/v1/missions/${missionId}?source=en`, { token: alice.token });
    const enDetail = MissionDetailResponseSchema.parse(en.json.data);
    expect(enDetail.steps.map((s) => s.instruction)).toEqual([EN.instructions, EN.instructions, EN.instructions]);
    expect(enDetail.steps[0]!.hints).toEqual(EN.hints);
    expect(enDetail.goals.find((g) => g.id === 'g_localized')?.description).toBe('Greet the vendor politely');

    // No overlay for Swahili ⇒ empty instruction/hints (no catalog label either), never another language's text.
    const sw = await call(h.app, `/v1/missions/${missionId}?source=sw`, { token: alice.token });
    const swDetail = MissionDetailResponseSchema.parse(sw.json.data);
    for (const st of swDetail.steps) {
      expect(st.instruction).toBe('');
      expect(st.hints).toEqual([]);
    }
    expect(swDetail.localizationComplete).toBe(false);
  });

  it('mission evaluate without a conversation evaluator reports evaluatorRan=false and a null confidence', async () => {
    const attempt = await call(h.app, `/v1/missions/${missionId}/attempts`, { token: alice.token, body: { enrollmentId, clientAttemptId: crypto.randomUUID(), missionRevision: 1, startedAt: new Date().toISOString() } });
    expect(attempt.status, JSON.stringify(attempt.json)).toBe(201);
    const res = await call(h.app, `/v1/missions/${missionId}/evaluate`, { token: alice.token, body: { attemptId: attempt.json.data.attemptId, enrollmentId, completedAt: new Date().toISOString(), clientEventId: crypto.randomUUID(), stepResults: stepIds.map(stepResult) } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const data = MissionEvaluateApiResponseSchema.parse(res.json.data);
    expect(data.evaluatorRan).toBe(false);
    expect(data.evaluation.confidence).toBeNull();
    expect(data.evaluation.objectivesCompleted).toEqual(expect.arrayContaining(['g_localized', 'g_unlabelled']));
    const stored = await h.service.from('mission_attempts').select('evaluation').eq('id', attempt.json.data.attemptId).single();
    expect((stored.data?.evaluation as { evaluatorRan?: boolean; evaluator?: { confidence: unknown } }).evaluatorRan).toBe(false);
    expect((stored.data?.evaluation as { evaluator?: { confidence: unknown } }).evaluator?.confidence).toBeNull();
  });

  it('request-review answers a contract ReviewStatus and rejects a variety mismatch before any write', async () => {
    const draft = await h.service.from('missions').insert({ template_key: templateKey(), target_variety_id: 'ary', state: 'imported_draft', title_translations: { fr: 'Brouillon' }, goals: [] }).select('id').single();
    if (draft.error) throw new Error(draft.error.message);
    missionIds.push(draft.data.id);

    const mismatch = await call(h.app, `/v1/admin/content/${draft.data.id}/request-review`, { token: admin.token, body: { targetVarietyId: 'yue' } });
    expect(mismatch.status).toBe(422);
    expect(mismatch.json.error.code).toBe('validation_failed');
    const untouched = await h.service.from('missions').select('state').eq('id', draft.data.id).single();
    expect(untouched.data?.state).toBe('imported_draft');
    const events = await h.service.from('publication_events').select('id').eq('entity_id', draft.data.id);
    expect(events.data).toEqual([]);

    const requested = await call(h.app, `/v1/admin/content/${draft.data.id}/request-review`, { token: admin.token, body: { note: 'please review', reviewerId: admin.id } });
    expect(requested.status, JSON.stringify(requested.json)).toBe(200);
    const parsed = ContentRequestReviewResponseSchema.parse(requested.json.data);
    expect(parsed).toEqual({ contentId: draft.data.id, state: 'review_needed', reviewStatus: 'in_review' });

    const again = await call(h.app, `/v1/admin/content/${draft.data.id}/request-review`, { token: admin.token, body: {} });
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(ContentRequestReviewResponseSchema.parse(again.json.data).reviewStatus).toBe('review_needed');
  });

  it('publishing a mission is refused while a goal has only a language-less description', async () => {
    const approved = await h.service.from('missions').insert({ template_key: templateKey(), target_variety_id: 'ary', state: 'approved', title_translations: { fr: 'Approuvé' }, goals: [{ id: 'g1', skill_keys: ['greet.basic'], description: 'no language' }] }).select('id').single();
    if (approved.error) throw new Error(approved.error.message);
    missionIds.push(approved.data.id);
    const res = await call(h.app, `/v1/admin/content/${approved.data.id}/publish`, { token: admin.token, body: { entityTable: 'missions', expectedRevision: 0 } });
    expect(res.status).toBe(422);
    expect(res.json.error.details).toEqual({ goalIds: ['g1'] });
  });

  it('model capabilities resolve text-task profiles for the enrollment source language, never a hard-coded en', async () => {
    const res = await call(h.app, `/v1/ai/model-capabilities?trackId=arabic-moroccan&enrollmentId=${enrollmentId}`, { token: alice.token });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const dialogue = res.json.data.tasks.find((t: { task: string }) => t.task === 'character_dialogue');
    expect(dialogue.capability.notes.join(' ')).toContain('source language fr');
    const scoped = await call(h.app, '/v1/ai/model-capabilities?trackId=arabic-moroccan', { token: alice.token });
    const scopedDialogue = scoped.json.data.tasks.find((t: { task: string }) => t.task === 'character_dialogue');
    expect(scopedDialogue.capability.notes.join(' ')).toContain('variety/global scope only');
    const wrongTrack = await call(h.app, `/v1/ai/model-capabilities?trackId=japanese&enrollmentId=${enrollmentId}`, { token: alice.token });
    expect(wrongTrack.status).toBe(422);
  });

  async function seedSession(options: { learnerAgeMs: number }): Promise<{ sessionId: string; clientTurnId: string }> {
    const sessionId = crypto.randomUUID();
    const ins = await h.service.from('conversation_sessions').insert({ id: sessionId, user_id: alice.id, enrollment_id: enrollmentId, mission_id: null, scenario_id: null, character_id: characterId, target_variety_id: 'ary', source_language_code: 'fr', mode: 'text_only', state: 'listening', pipeline: 'text_only', speech_retention: 'none', last_seq: 1, turn_count: 1 });
    if (ins.error) throw new Error(ins.error.message);
    sessionIds.push(sessionId);
    const clientTurnId = crypto.randomUUID();
    const occurredAt = new Date(Date.now() - options.learnerAgeMs).toISOString();
    const turns = await h.service.from('conversation_turns').insert([
      { session_id: sessionId, turn_index: 0, speaker: 'character', text: 'Salam!', occurred_at: occurredAt },
      { session_id: sessionId, turn_index: 1, speaker: 'learner', client_turn_id: clientTurnId, text: 'Salam, labas?', occurred_at: occurredAt },
    ]);
    if (turns.error) throw new Error(turns.error.message);
    return { sessionId, clientTurnId };
  }
  const turnBody = (clientTurnId: string) => ({ clientTurnId, input: { kind: 'text', text: 'Salam, labas?' }, clientState: { state: 'listening', lastSeq: 1, lastCharacterTurnId: null } });

  it('an in-flight clientTurnId is replayed as soon as the original request lands its character row', async () => {
    const { sessionId, clientTurnId } = await seedSession({ learnerAgeMs: 2_000 });
    // Simulates the original request landing its reply while the retry is waiting (supabase-js builders run on `then`).
    setTimeout(() => {
      h.service.from('conversation_turns').insert({ session_id: sessionId, turn_index: 2, speaker: 'character', text: 'Labas, hamdullah!', occurred_at: new Date().toISOString(), latency_ms: 1200 }).then(() => undefined, () => undefined);
    }, 1_500);
    const started = Date.now();
    const res = await call(h.app, `/v1/ai/conversation/${sessionId}/turn`, { token: alice.token, body: turnBody(clientTurnId) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.replayed).toBe(true);
    expect(res.json.data.characterTurn.text).toBe('Labas, hamdullah!');
    expect(Date.now() - started).toBeLessThan(TURN_RETRY_WAIT_MS);
    const rows = await h.service.from('conversation_turns').select('speaker').eq('session_id', sessionId);
    expect(rows.data).toHaveLength(3); // no second learner row, no second character row
  });

  it('an in-flight clientTurnId with no reply yet answers turn_in_progress (409) + Retry-After instead of running the pipeline again', async () => {
    const { sessionId, clientTurnId } = await seedSession({ learnerAgeMs: 1_000 });
    const res = await call(h.app, `/v1/ai/conversation/${sessionId}/turn`, { token: alice.token, body: turnBody(clientTurnId) });
    expect(res.status, JSON.stringify(res.json)).toBe(409);
    expect(res.json.error.code).toBe('turn_in_progress');
    expect(res.json.error.details.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(res.json.error.details.clientTurnId).toBe(clientTurnId);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    const rows = await h.service.from('conversation_turns').select('speaker').eq('session_id', sessionId);
    expect(rows.data).toHaveLength(2);
  }, TURN_RETRY_WAIT_MS + 30_000);

  it('a learner row older than the in-flight window is treated as abandoned (the retry may process it)', async () => {
    const { sessionId, clientTurnId } = await seedSession({ learnerAgeMs: 90_000 });
    const res = await call(h.app, `/v1/ai/conversation/${sessionId}/turn`, { token: alice.token, body: turnBody(clientTurnId) });
    // The pipeline is attempted (and fails against the unusable key); what matters is that it is NOT a 409.
    expect(res.status).not.toBe(409);
    expect(res.json.data?.replayed ?? false).toBe(false);
  });

  it('accepts the contract inline clip shape on a turn (no 422 from validation)', async () => {
    const { sessionId } = await seedSession({ learnerAgeMs: 90_000 });
    const res = await call(h.app, `/v1/ai/conversation/${sessionId}/turn`, { token: alice.token, body: { clientTurnId: crypto.randomUUID(), input: { kind: 'audio', assetId: crypto.randomUUID(), durationMs: 400, transcriptHint: null }, audio: { base64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=', mime: 'audio/wav', durationMs: 400 }, clientState: { state: 'listening', lastSeq: 1, lastCharacterTurnId: null } } });
    expect(res.json.error?.code).not.toBe('validation_failed');
  });
});
