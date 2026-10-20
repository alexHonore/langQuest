/**
 * Conversation integrity (round-3 leftover 3, docs/evidence/test-run-2026-10-20.md). Through the REAL app
 * (`POST /v1/ai/conversation/session|:id/turn|:id/end`), the real `@langquest/ai` character agent, evaluator and
 * summariser, and the offline fakes of `route-fixtures` (nothing leaves the process):
 *
 * (a) nothing to answer is never padded: blank typed text is refused (422); a blank transcript and a device transcript
 *     hint with no words are the no-speech outcome. No learner turn, no model call, nothing credited at the end.
 * (b) every turn response carries the speech verdict, the branch where the pipeline produced no character reply included.
 * (c) the server decides the `finished` transition (compare-and-set: one evaluator run, one outcome, however many end
 *     requests race), creates sessions with the service role, and never runs a session whose variety, character or
 *     mission is not the enrollment's. A row marked finished by the learner (possible before migration 160) is replayed:
 *     nothing is recorded from it. Nothing reopens a finished session either: a turn still in flight when the end wins
 *     is answered 412 and adds no line, and the asynchronous evaluator that lands after the end records nothing.
 * (e) the variety boundary covers what a session names besides its character and mission: a scenario (through its
 *     mission, or its character) and an audio lesson (its own variety, else its collection's) of another variety are
 *     refused at create (422) and never run from a stored session (412).
 * (d) the end route never falls back to the stored rubric: no evaluator output in this request ⇒ the empty output,
 *     and no review card, objective or observation from what is stored. A replay shows the stored output filtered to
 *     the skill registry and the mission's goals.
 *
 * The database half (learners can no longer write those columns at all) is migration 160 and its pgTAP test
 * (`supabase/tests/database/conversation_session_guard.test.sql`).
 */
import type { AiServices } from '@langquest/ai';
import { ConversationEndResponseSchema, ConversationTurnResponseSchema, apiEnvelope, type EvaluatorOutput } from '@langquest/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { storedEvaluatorOutput } from '../../lib/conversation';
import { BLANK_LEARNER_TEXT_MESSAGE, TurnRequestSchema, normaliseLearnerInput, transcriptHintHasNoWords } from '../../routes/speech/conversation';
import { buildAiServices } from '../../services/ai';
import { enrollmentRow, profileRow, routeHarness, type DbRow, type FakePostgrest, type RouteHarness } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const CHARACTER_ID = '44444444-4444-4444-8444-444444444444';
const ARY_CHARACTER_ID = '55555555-5555-4555-8555-555555555555';
const MISSION_ID = '66666666-6666-4666-8666-666666666666';
const ARY_MISSION_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_FR_MISSION_ID = '88888888-8888-4888-8888-888888888888';
const NOW = () => new Date().toISOString();

const TurnEnvelope = apiEnvelope(ConversationTurnResponseSchema);
const EndEnvelope = apiEnvelope(ConversationEndResponseSchema);

const characterRow = (over: DbRow = {}): DbRow => ({ id: CHARACTER_ID, character_key: 'fr-cafe-camille', name: 'Camille', role: 'barista', home_region: 'Paris', personality: 'warm and patient', target_variety_id: 'fr', regional_option: null, relationships: {}, safety_rules: [], state: 'published', storyline_facts: ['A small café near the station'], voice_profile: {}, portrait_visual_asset_id: null, created_at: NOW(), updated_at: NOW(), ...over });
const missionRow = (over: DbRow = {}): DbRow => ({ id: MISSION_ID, template_key: 'greet_integrity', target_variety_id: 'fr', state: 'published', published_revision: 1, title_translations: { en: 'Greet' }, goals: [{ id: 'g1', skill_keys: ['greet_politely'] }], chapter_id: null, mission_type: 'conversation', level: 'beginner', recommended_minutes: 5, prerequisite_skill_keys: [], sort_order: 0, narrative_segment: null, ...over });
const sessionRow = (enrollmentId: string, over: DbRow = {}): DbRow => ({ id: crypto.randomUUID(), user_id: LEARNER, enrollment_id: enrollmentId, mission_id: null, scenario_id: null, character_id: CHARACTER_ID, target_variety_id: 'fr', source_language_code: 'en', mode: 'text_only', state: 'listening', pipeline: 'text_only', speech_retention: 'none', scope: { kind: 'free' }, started_at: NOW(), updated_at: NOW(), created_at: NOW(), ended_at: null, turn_count: 1, last_seq: 1, objectives_completed: [], summary: null, revision: 0, rubric_outcomes: null, ...over });
const turnRow = (sessionId: string, index: number, speaker: 'learner' | 'character', text: string): DbRow => ({ id: crypto.randomUUID(), session_id: sessionId, turn_index: index, speaker, client_turn_id: speaker === 'learner' ? crypto.randomUUID() : null, text, text_hash: null, audio_asset_id: null, goals: [], hints_used: 0, command: null, confidence: null, latency_ms: null, occurred_at: NOW(), expires_at: null, created_at: NOW() });

const CHARACTER_REPLY = JSON.stringify({ text: 'Bonjour ! Un café, bien sûr. Sur place ou à emporter ?', transliteration: null, sourceGloss: null, expression: 'talking', respondsToCommand: null, tentativeObjectiveIds: [], endsConversation: false });
const SUMMARY_REPLY = JSON.stringify({ turnSummary: 'Greeted and ordered a coffee.', persistedSummary: 'You greeted the barista and ordered a coffee.', relationshipMemoryUpdate: null });
const rawObs = (skillKey: string, outcome = 'success') => ({ skillKey, observationType: 'semantic_success', autonomy: 'unaided', hintsUsed: 0, outcome, uncertainty: 0.1, note: null });
/** What an honest evaluator answers for the greeting (registry key, the mission's goal). */
const HONEST_EVALUATOR = { objectivesCompleted: ['g1'], skillsExercised: ['greet_politely'], observations: [rawObs('greet_politely')], priorityCorrections: [], summary: 'The learner greeted the barista politely.', reviewTriggers: ['greet_politely'], relationshipMemoryUpdate: null, confidence: 0.8 };
const fullObs = (skillKey: string) => ({ ...rawObs(skillKey), scenarioId: 'forged', missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: null, utteranceConfidence: 1 });
/** A stored rubric no evaluator produced (a learner could write one before migration 160): invented keys, a foreign goal. */
const FORGED_RUBRIC: EvaluatorOutput = {
  objectivesCompleted: ['g1', 'g9'],
  skillsExercised: ['greet_politely', 'greetings.basic'],
  observations: [fullObs('greet_politely'), fullObs('ordering.cafe')] as EvaluatorOutput['observations'],
  priorityCorrections: [{ skillKey: 'politeness.afak', learnerUtterance: 'Salut', suggestedUtterance: 'Bonjour madame', explanation: 'More polite.', category: 'register' }] as EvaluatorOutput['priorityCorrections'],
  summary: 'Perfect.',
  reviewTriggers: ['greet_politely', 'ordering.cafe'],
  relationshipMemoryUpdate: null,
  confidence: 1,
};

const promptOf = (req: Record<string, unknown>): string => ((req.messages as Array<{ content: string }> | undefined) ?? []).map((m) => m.content).join('\n');
const isEvaluatorPrompt = (req: Record<string, unknown>) => promptOf(req).includes('You are the learning evaluator');

interface Fixture {
  h: RouteHarness;
  token: string;
  french: DbRow;
}

/** `public.award_xp`: idempotent on the key and once per (user, reason, reference), like the SQL function. */
function installAwardXp(db: FakePostgrest): void {
  db.rpcs.award_xp = (args, ctx) => {
    const ledger = ctx.db.rows('xp_ledger');
    let row = ledger.find((l) => l.idempotency_key === args.p_idempotency_key) ?? ledger.find((l) => l.user_id === args.p_user_id && l.reason === args.p_reason && l.reference_id === args.p_reference_id);
    let applied = false;
    if (!row) {
      row = { id: crypto.randomUUID(), user_id: args.p_user_id, enrollment_id: args.p_enrollment_id ?? null, amount: args.p_amount, reason: args.p_reason, reference_table: args.p_reference_table ?? null, reference_id: args.p_reference_id ?? null, idempotency_key: args.p_idempotency_key, created_at: NOW() };
      ledger.push(row);
      applied = true;
    }
    return [{ applied, ledger_id: row.id, amount: row.amount, total_xp: ledger.reduce((n, l) => n + Number(l.amount), 0) }];
  };
}

async function setup(): Promise<Fixture> {
  const h = routeHarness({ openRouter: true });
  h.db.seed('profiles', [profileRow(LEARNER)]);
  const [french] = h.db.seed('user_course_enrollments', [enrollmentRow(LEARNER, 'french', { source_language_code: 'en' })]);
  h.db.seed('characters', [characterRow(), characterRow({ id: ARY_CHARACTER_ID, character_key: 'ary-cafe-staff-nadia', name: 'Nadia', home_region: 'Casablanca', target_variety_id: 'ary' })]);
  h.db.seed('missions', [missionRow()]);
  installAwardXp(h.db);
  h.openrouter.chat = (req) => (isEvaluatorPrompt(req) ? JSON.stringify(HONEST_EVALUATOR) : promptOf(req).includes('You are Camille') ? CHARACTER_REPLY : SUMMARY_REPLY);
  return { h, token: await h.token(LEARNER), french: french! };
}

const seedSession = (f: Fixture, over: DbRow = {}): string => f.h.db.seed('conversation_sessions', [sessionRow(f.french.id as string, over)])[0]!.id as string;

/** FakePostgrest does not apply column defaults; give a session the API inserts the ones the table has. */
function applySessionDefaults(f: Fixture): void {
  const handle = f.h.db.handle.bind(f.h.db);
  f.h.db.handle = async (request: Request) => {
    if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/conversation_sessions')) return handle(request);
    const row = JSON.parse(await request.text()) as DbRow;
    const body = JSON.stringify({ started_at: NOW(), ended_at: null, summary: null, rubric_outcomes: null, objectives_completed: [], turn_count: 0, last_seq: 0, revision: 0, ...row });
    return handle(new Request(request.url, { method: 'POST', headers: request.headers, body }));
  };
}
const turnBody = (input: unknown, over: DbRow = {}) => ({ clientTurnId: crypto.randomUUID(), input, clientState: { state: 'listening', lastSeq: 1, lastCharacterTurnId: null }, bargeIn: false, ...over });
const endBody = () => ({ reason: 'learner_ended', clientState: { lastSeq: 2, turnCount: 2 }, clientEventId: crypto.randomUUID() });
const learnerRows = (f: Fixture) => f.h.db.rows('conversation_turns').filter((t) => t.speaker === 'learner');
const evaluatorCalls = (f: Fixture) => f.h.openrouter.callsTo('/chat/completions').filter((c) => isEvaluatorPrompt(c.body ?? {}));

// ---------------------------------------------------------------------------------------------------------------------

describe('(a) pure rules', () => {
  const base = { clientTurnId: '44444444-4444-4444-8444-444444444444', clientState: { state: 'listening', lastSeq: 1, lastCharacterTurnId: null }, bargeIn: false };

  it('blank typed text is refused at validation; blank transcripts and hints reach the route (it answers no-speech)', () => {
    for (const text of [' ', ' \n\t ', '\r\n', ' ']) {
      const parsed = TurnRequestSchema.safeParse({ ...base, input: { kind: 'text', text } });
      expect(parsed.success, JSON.stringify(text)).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.map((i) => i.message)).toContain(BLANK_LEARNER_TEXT_MESSAGE);
    }
    expect(TurnRequestSchema.safeParse({ ...base, input: { kind: 'text', text: 'salut' } }).success).toBe(true);
    expect(TurnRequestSchema.safeParse({ ...base, input: { kind: 'text', text: '…' } }).success).toBe(true); // a learner's own "…" is a message
    expect(TurnRequestSchema.safeParse({ ...base, input: { kind: 'transcript', text: '  ', confidence: null, provider: 'client' } }).success).toBe(true);
  });

  it('normaliseLearnerInput never invents a placeholder', () => {
    expect(normaliseLearnerInput({ kind: 'text', text: '  \n ' })).toBeNull();
    expect(normaliseLearnerInput({ kind: 'transcript', text: '\t', confidence: null, provider: 'client' })).toBeNull();
    expect(normaliseLearnerInput({ kind: 'transcript', text: ' un  café\n s’il vous plaît ', confidence: 0.9, provider: 'client' })).toEqual({ kind: 'transcript', text: 'un café s’il vous plaît', confidence: 0.9, provider: 'client' });
    expect(normaliseLearnerInput({ kind: 'audio', assetId: CHARACTER_ID, durationMs: 900, transcriptHint: '   ' })).toMatchObject({ transcriptHint: null }); // the server transcribes it instead
    expect(normaliseLearnerInput({ kind: 'command', command: 'repeat' })).toEqual({ kind: 'command', command: 'repeat' });
    expect(['…', '?', '...', ' !! ', '—'].every(transcriptHintHasNoWords)).toBe(true);
    expect(['Bonjour', 'نعم', 'はい', '42'].some(transcriptHintHasNoWords)).toBe(false);
  });
});

describe('(a) POST /v1/ai/conversation/:id/turn — nothing to answer is never padded', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  it('blank typed text: 422 before anything is written or any model is called', async () => {
    f = await setup();
    const sessionId = seedSession(f);
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody({ kind: 'text', text: '   \n  ' }) });
    expect(res.status, JSON.stringify(res.json)).toBe(422);
    expect(res.json.error.code).toBe('validation_failed');
    expect(f.h.db.rows('conversation_turns')).toHaveLength(0);
    expect(f.h.db.writes('conversation_sessions')).toHaveLength(0);
    expect(f.h.openrouter.calls).toHaveLength(0);
    expect(f.h.blocked).toEqual([]);
  });

  it('a blank transcript is the no-speech outcome: no learner turn, no model call, no XP at the end', async () => {
    f = await setup();
    const sessionId = seedSession(f);
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody({ kind: 'transcript', text: ' \n\t ', confidence: null, provider: 'client' }) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const parsed = TurnEnvelope.parse(res.json);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.data).toMatchObject({ speech: { speechDetected: false, reason: 'empty_transcript' }, characterTurn: null, learnerTranscript: null, evaluationPending: false, replayed: false });
    expect(f.h.db.rows('conversation_turns')).toHaveLength(0);
    expect(f.h.openrouter.calls).toHaveLength(0);

    const end = await f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: endBody() });
    expect(end.status, JSON.stringify(end.json)).toBe(200);
    expect(end.json.data).toMatchObject({ xpAwarded: 0, evaluation: { confidence: null, observations: [] } });
    await f.h.flush();
    expect(f.h.db.rows('xp_ledger')).toHaveLength(0);
    expect(f.h.db.rows('learning_observations')).toHaveLength(0);
    expect(evaluatorCalls(f)).toHaveLength(0);
  });

  it('a device transcript hint with no words ("…", "?") is no speech: no learner turn, no transcription, no model call', async () => {
    f = await setup();
    const sessionId = seedSession(f, { mode: 'push_to_talk', pipeline: 'stt_llm_tts' });
    for (const hint of ['…', '?', ' ... ']) {
      const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody({ kind: 'audio', assetId: crypto.randomUUID(), durationMs: 900, transcriptHint: hint }) });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data).toMatchObject({ speech: { speechDetected: false, reason: 'empty_transcript' }, characterTurn: null, learnerTranscript: null });
    }
    expect(f.h.db.rows('conversation_turns')).toHaveLength(0);
    expect(f.h.openrouter.calls).toHaveLength(0);
  });

  it('control: a real transcript is recorded as sent (normalised) and answered', async () => {
    f = await setup();
    const sessionId = seedSession(f);
    f.h.db.seed('conversation_turns', [turnRow(sessionId, 0, 'character', 'Bonjour ! Qu’est-ce que je vous sers ?')]);
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody({ kind: 'transcript', text: ' Bonjour\nmadame ', confidence: null, provider: 'client' }) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.characterTurn).not.toBeNull();
    expect(res.json.data.speech).toBeUndefined(); // typed chat: no speech evidence either way
    expect(learnerRows(f)).toEqual([expect.objectContaining({ text: 'Bonjour madame', turn_index: 1 })]);
  });
});

describe('(b) the speech verdict always reaches the client', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  /** Wrap the real AI services so `pipeline.runTurn` answers with `override` (no provider call). */
  function overrideRunTurn(fx: Fixture, override: Partial<Awaited<ReturnType<AiServices['pipeline']['runTurn']>>>): void {
    fx.h.ctx.shared.aiFactory = async (deps) => {
      const ai = await buildAiServices(deps);
      ai.pipeline.runTurn = async () => ({ transcript: null, turn: null, audio: null, playbackRate: 1, latency: { sttMs: null, llmMs: null, ttsMs: null, timeToFirstAudioMs: null, totalMs: 0, cancelled: false, cancelReason: null, fallbackUsed: false }, cancelled: false, speech: null, ...override });
      return ai;
    };
  }
  const hintTurn = (hint: string) => turnBody({ kind: 'audio', assetId: crypto.randomUUID(), durationMs: 900, transcriptHint: hint });

  it('an audio turn answered by the character carries the pipeline\'s verdict on its transcript hint', async () => {
    f = await setup();
    const sessionId = seedSession(f, { mode: 'push_to_talk', pipeline: 'stt_llm_tts' });
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: hintTurn('Bonjour madame') });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.characterTurn).not.toBeNull();
    expect(res.json.data.speech).toEqual({ speechDetected: true, reason: null });
    expect(f.h.openrouter.callsTo('/audio/transcriptions')).toHaveLength(0); // the hint is the transcript
  });

  it('the no-reply branch forwards the pipeline\'s verdict (heard, but no character line)', async () => {
    f = await setup();
    const sessionId = seedSession(f, { mode: 'push_to_talk', pipeline: 'stt_llm_tts' });
    overrideRunTurn(f, { speech: { speechDetected: true, reason: null } });
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: hintTurn('Bonjour madame') });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const parsed = TurnEnvelope.parse(res.json);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.data).toMatchObject({ characterTurn: null, speech: { speechDetected: true, reason: null } });
  });

  it('the no-reply branch forwards a no-speech verdict and never presents the take as heard', async () => {
    f = await setup();
    const sessionId = seedSession(f, { mode: 'push_to_talk', pipeline: 'stt_llm_tts' });
    overrideRunTurn(f, { transcript: { text: 'Bonjour madame', confidence: 0.4, provider: 'fake', language: 'fr', words: [], durationMs: null } as never, speech: { speechDetected: false, reason: 'known_hallucination' } });
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: hintTurn('Bonjour madame') });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toMatchObject({ characterTurn: null, learnerTranscript: null, speech: { speechDetected: false, reason: 'known_hallucination' } });
  });

  it('a cancelled turn answers without a verdict it does not have', async () => {
    f = await setup();
    const sessionId = seedSession(f);
    overrideRunTurn(f, { cancelled: true, speech: null });
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody({ kind: 'transcript', text: 'Bonjour', confidence: null, provider: 'client' }) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.characterTurn).toBeNull();
    expect(res.json.data.speech).toBeUndefined();
  });
});

describe('(c) the server decides the session row', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  it('sessions are created with the service role (migration 160 refuses learner inserts)', async () => {
    f = await setup();
    applySessionDefaults(f);
    const res = await f.h.call('/v1/ai/conversation/session', { token: f.token, body: { enrollmentId: f.french.id, clientSessionId: crypto.randomUUID(), mode: 'text_only', characterId: CHARACTER_ID } });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const inserts = f.h.db.requests.filter((r) => r.target === 'conversation_sessions' && r.method === 'POST');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.client).toBe('service');
    expect(inserts[0]!.body).toMatchObject({ user_id: LEARNER, enrollment_id: f.french.id, character_id: CHARACTER_ID, target_variety_id: 'fr', state: 'preparing' });
    expect(f.h.db.requests.filter((r) => r.target === 'conversation_sessions' && r.method !== 'GET' && r.client === 'user')).toEqual([]);
  });

  it('a session whose character speaks another variety never runs (a row written directly before migration 160)', async () => {
    f = await setup();
    const sessionId = seedSession(f, { character_id: ARY_CHARACTER_ID });
    const turn = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody({ kind: 'transcript', text: 'Bonjour', confidence: null, provider: 'client' }) });
    expect(turn.status, JSON.stringify(turn.json)).toBe(412);
    expect(turn.json.error.message).toContain('dialects are never substituted');
    const end = await f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: endBody() });
    expect(end.status).toBe(412);
    expect(f.h.db.rows('conversation_turns')).toHaveLength(0);
    expect(f.h.openrouter.calls).toHaveLength(0);
  });

  it('finish is a compare-and-set: two racing end requests run the evaluator once and record one outcome; a replay records nothing', async () => {
    f = await setup();
    const sessionId = seedSession(f, { mission_id: MISSION_ID, scope: { kind: 'mission', missionId: MISSION_ID } });
    f.h.db.seed('conversation_turns', [turnRow(sessionId, 0, 'character', 'Bonjour ! Qu’est-ce que je vous sers ?'), turnRow(sessionId, 1, 'learner', 'Bonjour madame, un café s’il vous plaît')]);
    const [a, b] = await Promise.all([f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: endBody() }), f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: endBody() })]);
    expect([a.status, b.status], JSON.stringify([a.json, b.json])).toEqual([200, 200]);
    await f.h.flush();
    expect(evaluatorCalls(f)).toHaveLength(1);
    expect(f.h.db.rows('learning_observations').map((o) => o.skill_key)).toEqual(['greet_politely']);
    expect(f.h.db.rows('xp_ledger')).toHaveLength(1);
    const winner = [a, b].find((r) => r.json.data.evaluation.confidence !== null)!;
    expect(winner.json.data.evaluation).toMatchObject({ objectivesCompleted: ['g1'], skillsExercised: ['greet_politely'] });
    const session = f.h.db.rows('conversation_sessions').find((s) => s.id === sessionId)!;
    expect(session).toMatchObject({ state: 'finished', objectives_completed: ['g1'] });
    expect(session.ended_at).not.toBeNull();

    // A retried end (same or new client event): the stored output again, nothing recorded, nothing paid twice.
    const cards = f.h.db.rows('user_expression_reviews').length;
    const replay = await f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: endBody() });
    expect(replay.status, JSON.stringify(replay.json)).toBe(200);
    const parsed = EndEnvelope.parse(replay.json);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.data.evaluation).toEqual(winner.json.data.evaluation);
    expect(parsed.data.scheduledReviews).toEqual(winner.json.data.scheduledReviews);
    expect(parsed.data.xpAwarded).toBe(0);
    await f.h.flush();
    expect(evaluatorCalls(f)).toHaveLength(1);
    expect(f.h.db.rows('learning_observations')).toHaveLength(1);
    expect(f.h.db.rows('user_expression_reviews')).toHaveLength(cards);
    expect(f.h.db.rows('xp_ledger')).toHaveLength(1);
  });

  it('a session the learner marked finished with a made-up rubric is only replayed: no evaluator, nothing recorded, the output shown is filtered', async () => {
    f = await setup();
    const sessionId = seedSession(f, { mission_id: MISSION_ID, scope: { kind: 'mission', missionId: MISSION_ID }, state: 'finished', ended_at: NOW(), rubric_outcomes: FORGED_RUBRIC, summary: 'You were perfect.' });
    // Review cards that already exist (one left by an invented key before the registry rule): listed, never created.
    f.h.db.seed('user_expression_reviews', [
      { id: crypto.randomUUID(), user_id: LEARNER, enrollment_id: f.french.id, expression_id: null, skill_key: 'greet_politely', next_due_at: '2026-10-21T10:00:00.000Z' },
      { id: crypto.randomUUID(), user_id: LEARNER, enrollment_id: f.french.id, expression_id: null, skill_key: 'ordering.cafe', next_due_at: '2026-10-21T10:00:00.000Z' },
    ]);
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: endBody() });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const parsed = EndEnvelope.parse(res.json);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.data.evaluation.skillsExercised).toEqual(['greet_politely']);
    expect(parsed.data.evaluation.observations.map((o) => o.skillKey)).toEqual(['greet_politely']);
    expect(parsed.data.evaluation.reviewTriggers).toEqual(['greet_politely']);
    expect(parsed.data.evaluation.objectivesCompleted).toEqual(['g1']); // 'g9' is not a goal of this mission
    expect(parsed.data.evaluation.priorityCorrections.map((c) => c.skillKey)).toEqual([null]);
    expect(parsed.data.scheduledReviews.map((r) => r.targetId)).toEqual(['greet_politely']);
    await f.h.flush();
    expect(f.h.openrouter.calls).toHaveLength(0); // no evaluator, no summariser: nothing was produced in this request
    expect(f.h.db.rows('user_expression_reviews')).toHaveLength(2);
    expect(f.h.db.rows('learning_observations')).toHaveLength(0);
    expect(f.h.db.rows('user_skill_mastery')).toHaveLength(0);
    expect(f.h.db.writes('conversation_sessions')).toHaveLength(0);
  });
});

describe('(d) the end route never falls back to the stored rubric', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  it('no evaluator output in this request ⇒ the empty output; nothing from the stored rubric is scheduled, claimed or kept as objectives', async () => {
    f = await setup();
    const sessionId = seedSession(f, { mission_id: MISSION_ID, scope: { kind: 'mission', missionId: MISSION_ID }, rubric_outcomes: FORGED_RUBRIC, objectives_completed: ['g9'] });
    f.h.db.seed('conversation_turns', [turnRow(sessionId, 0, 'character', 'Bonjour !'), turnRow(sessionId, 1, 'learner', 'Bonjour madame')]);
    // The evaluator call fails (provider error): `evaluateSession` answers null.
    f.h.openrouter.chat = (req) => (isEvaluatorPrompt(req) ? { status: 400, body: { error: { message: 'evaluator unavailable', code: 400 } } } : SUMMARY_REPLY);
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: endBody() });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(evaluatorCalls(f).length).toBeGreaterThan(0);
    const parsed = EndEnvelope.parse(res.json);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.data.evaluation).toMatchObject({ objectivesCompleted: [], skillsExercised: [], observations: [], reviewTriggers: [], priorityCorrections: [], confidence: null });
    expect(parsed.data.scheduledReviews).toEqual([]);
    expect(parsed.data.session.objectivesCompleted).toEqual([]); // 'g9' (not a goal of the mission) is dropped too
    expect(parsed.data.session.state).toBe('finished');
    await f.h.flush();
    expect(f.h.db.rows('user_expression_reviews')).toHaveLength(0);
    expect(f.h.db.rows('learning_observations')).toHaveLength(0);
    expect(f.h.db.rows('xp_ledger').map((x) => x.reason)).toEqual(['conversation_turns']); // the learner did take a turn
  });

  it('storedEvaluatorOutput: display-only, registry keys and mission goals only, garbage is the empty output', () => {
    const goals = new Set(['g1']);
    const shown = storedEvaluatorOutput(FORGED_RUBRIC, goals);
    expect(shown.valid).toBe(true);
    expect(shown.output).toMatchObject({ objectivesCompleted: ['g1'], skillsExercised: ['greet_politely'], reviewTriggers: ['greet_politely'] });
    expect(shown.dropped).toEqual(['greetings.basic', 'ordering.cafe', 'politeness.afak']);
    expect(storedEvaluatorOutput(FORGED_RUBRIC, new Set()).output.objectivesCompleted).toEqual([]);
    expect(storedEvaluatorOutput(null, goals)).toMatchObject({ valid: true, output: { confidence: null, observations: [] } });
    expect(storedEvaluatorOutput({ objectivesCompleted: 'g1', confidence: 2 }, goals)).toMatchObject({ valid: false, output: { confidence: null, objectivesCompleted: [] } });
  });
});

// ---------------------------------------------------------------------------------------------------------------------

const LATENCY = { sttMs: null, llmMs: null, ttsMs: null, timeToFirstAudioMs: null, totalMs: 0, cancelled: false, cancelReason: null, fallbackUsed: false };
const sessionRowOf = (f: Fixture, id: string) => f.h.db.rows('conversation_sessions').find((s) => s.id === id)!;
const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
};

describe('(c) nothing reopens a finished session', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  /** `pipeline.runTurn` held until `release` (the character is still thinking), then a reply or no reply. */
  function holdRunTurn(fx: Fixture, outcome: 'reply' | 'no_reply'): { entered: Promise<void>; release: () => void } {
    const entered = gate();
    const released = gate();
    fx.h.ctx.shared.aiFactory = async (deps) => {
      const ai = await buildAiServices(deps);
      ai.pipeline.runTurn = async () => {
        entered.open();
        await released.opened;
        const turn = { turnId: crypto.randomUUID(), characterId: CHARACTER_ID, text: 'Très bien, un café.', transliteration: null, sourceGloss: null, expression: 'talking', respondsToCommand: null, tentativeObjectiveIds: [], audio: null, endsConversation: false, model: null, latencyMs: null };
        return { transcript: null, turn: outcome === 'reply' ? turn : null, audio: null, playbackRate: 1, latency: LATENCY, cancelled: outcome === 'no_reply', speech: null } as never;
      };
      return ai;
    };
    return { entered: entered.opened, release: released.open };
  }

  it.each(['reply', 'no_reply'] as const)('a turn in flight when the end wins (%s): 412, no late line, the session stays finished, one evaluator run', async (outcome) => {
    f = await setup();
    const sessionId = seedSession(f, { mission_id: MISSION_ID, scope: { kind: 'mission', missionId: MISSION_ID }, turn_count: 2 });
    f.h.db.seed('conversation_turns', [turnRow(sessionId, 0, 'character', 'Bonjour ! Qu’est-ce que je vous sers ?'), turnRow(sessionId, 1, 'learner', 'Bonjour madame')]);
    const held = holdRunTurn(f, outcome);
    // The mobile controller aborts the in-flight turn on its side and ends right away; the server still runs the turn.
    const turnRequest = f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody({ kind: 'text', text: 'Un café, s’il vous plaît' }) });
    await held.entered;
    const end = await f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: endBody() });
    expect(end.status, JSON.stringify(end.json)).toBe(200);
    expect(end.json.data.evaluation.confidence).toBe(0.8);
    const writesAtFinish = f.h.db.writes('conversation_sessions').length;

    held.release();
    const turn = await turnRequest;
    expect(turn.status, JSON.stringify(turn.json)).toBe(412);
    expect(turn.json.error.message).toContain('This conversation has ended');
    expect(sessionRowOf(f, sessionId).state).toBe('finished');
    expect(sessionRowOf(f, sessionId).ended_at).not.toBeNull();
    expect(f.h.db.writes('conversation_sessions')).toHaveLength(writesAtFinish); // nothing written after the finish
    // The learner line was recorded before the end (it is part of the finished transcript); the late reply is not added.
    expect(f.h.db.rows('conversation_turns').map((t) => t.speaker)).toEqual(['character', 'learner', 'learner']);
    // Every write but the finishing request's own write onto the row it finished is a compare-and-set on an open row.
    const patches = f.h.db.requests.filter((r) => r.target === 'conversation_sessions' && r.method === 'PATCH');
    expect(patches[0]!.query).toMatch(/revision=eq\.0.*state=neq\.finished/);
    expect(patches).toHaveLength(2);

    // A second end replays the outcome: the evaluator ran once, one set of observations, no second payment.
    const again = await f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: endBody() });
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(again.json.data.evaluation).toEqual(end.json.data.evaluation);
    await f.h.flush();
    expect(evaluatorCalls(f)).toHaveLength(1);
    expect(f.h.db.rows('learning_observations')).toHaveLength(1);
    expect(f.h.db.rows('xp_ledger')).toHaveLength(1);
  });

  it('the asynchronous evaluator that lands after the end records nothing and overwrites nothing', async () => {
    f = await setup();
    const sessionId = seedSession(f, { mission_id: MISSION_ID, scope: { kind: 'mission', missionId: MISSION_ID }, turn_count: 7, last_seq: 7 });
    f.h.db.seed('conversation_turns', ['Bonjour !', 'Bonjour madame', 'Vous désirez ?', 'Un café', 'Sur place ?', 'Oui, sur place', 'Voilà.'].map((text, i) => turnRow(sessionId, i, i % 2 ? 'learner' : 'character', text)));
    // The first evaluator call (the turn's asynchronous run) is held; the end's own run goes straight through.
    const entered = gate();
    const released = gate();
    let evaluations = 0;
    const lateOutputs: EvaluatorOutput[] = [];
    f.h.ctx.shared.aiFactory = async (deps) => {
      const ai = await buildAiServices(deps);
      const evaluate = ai.evaluator.evaluate.bind(ai.evaluator);
      ai.evaluator.evaluate = async (input) => {
        evaluations += 1;
        if (evaluations > 1) return evaluate(input);
        entered.open();
        await released.opened;
        const late = await evaluate(input);
        lateOutputs.push(late);
        return late;
      };
      return ai;
    };
    const LATE = { ...HONEST_EVALUATOR, observations: [rawObs('greet_politely', 'fail')], summary: 'LATE', confidence: 0.3 };
    let evaluatorAnswers = 0;
    f.h.openrouter.chat = (req) => (isEvaluatorPrompt(req) ? JSON.stringify(evaluatorAnswers++ === 0 ? HONEST_EVALUATOR : LATE) : promptOf(req).includes('You are Camille') ? CHARACTER_REPLY : SUMMARY_REPLY);

    const turn = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody({ kind: 'text', text: 'Merci, au revoir' }) });
    expect(turn.status, JSON.stringify(turn.json)).toBe(200);
    expect(turn.json.data.evaluationPending).toBe(true); // the 4th learner turn
    await entered.opened;
    const end = await f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: endBody() });
    expect(end.status, JSON.stringify(end.json)).toBe(200);
    expect(end.json.data.evaluation.confidence).toBe(0.8);
    const writesAtFinish = f.h.db.writes('conversation_sessions').length;
    released.open();
    await f.h.flush();

    expect(evaluatorCalls(f)).toHaveLength(2);
    expect(lateOutputs.map((o) => o.confidence)).toEqual([0.3]); // the late run produced a valid output: it is discarded
    expect(f.h.db.rows('learning_observations').map((o) => o.outcome)).toEqual(['success']); // the end's evidence only
    expect(f.h.db.writes('conversation_sessions')).toHaveLength(writesAtFinish);
    const stored = sessionRowOf(f, sessionId);
    expect(stored).toMatchObject({ state: 'finished', summary: 'You greeted the barista and ordered a coffee.', objectives_completed: ['g1'] });
    expect((stored.rubric_outcomes as EvaluatorOutput).confidence).toBe(0.8);
  });
});

describe('(e) the variety boundary covers scenarios and audio lessons', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  const scenarioRow = (over: DbRow = {}): DbRow => ({ id: crypto.randomUUID(), mission_id: MISSION_ID, scene: 'café', learner_role: 'customer', character_id: CHARACTER_ID, min_level: 'beginner', max_level: 'beginner', expected_intent_ids: [], interruption_policy: 'allow', safety_rules: [], topic_rules: [], scene_facts: ['The terrace of a café near the station'], state: 'published', created_at: NOW(), updated_at: NOW(), ...over });
  const createBody = (over: DbRow = {}) => ({ enrollmentId: f.french.id, clientSessionId: crypto.randomUUID(), mode: 'text_only', characterId: CHARACTER_ID, ...over });
  const characterPrompts = () => f.h.openrouter.callsTo('/chat/completions').map((c) => promptOf(c.body ?? {})).filter((p) => p.includes('You are Camille'));

  async function setupWithContent(): Promise<Record<string, string>> {
    f = await setup();
    applySessionDefaults(f);
    f.h.db.seed('missions', [missionRow({ id: ARY_MISSION_ID, template_key: 'greet_ary', target_variety_id: 'ary' }), missionRow({ id: OTHER_FR_MISSION_ID, template_key: 'greet_other' })]);
    const [own, otherMission, aryMission, aryCharacter] = f.h.db.seed('dialogue_scenarios', [scenarioRow(), scenarioRow({ mission_id: OTHER_FR_MISSION_ID }), scenarioRow({ mission_id: ARY_MISSION_ID, scene_facts: ['Le souk de Casablanca'] }), scenarioRow({ mission_id: null, character_id: ARY_CHARACTER_ID, scene_facts: ['Le souk de Casablanca'] })]);
    const collection = (variety: string | null, track: string | null) => ({ id: crypto.randomUUID(), title_translations: { en: 'Library' }, target_variety_id: variety, course_track_id: track, state: 'published' });
    const [frCollection, aryCollection, bareCollection] = f.h.db.seed('audio_course_collections', [collection('fr', 'french'), collection('ary', 'arabic-moroccan'), collection(null, null)]);
    const [frChapter, aryChapter, bareChapter] = f.h.db.seed('audio_chapters', [frCollection, aryCollection, bareCollection].map((c) => ({ id: crypto.randomUUID(), collection_id: c!.id, state: 'published' })));
    const lesson = (chapter: DbRow | undefined, variety: string | null) => ({ id: crypto.randomUUID(), chapter_id: chapter!.id, title_translations: { en: 'At the bakery' }, instruction_language_code: 'en', target_variety_id: variety, state: 'published' });
    const [inherits, ary, unknown] = f.h.db.seed('audio_lessons', [lesson(frChapter, null), lesson(aryChapter, 'ary'), lesson(bareChapter, null)]);
    const transcripts = f.h.db.seed('transcripts', [inherits, ary, unknown].map((l) => ({ id: crypto.randomUUID(), lesson_id: l!.id, revision: 1 })));
    f.h.db.seed('transcript_segments', transcripts.map((t, i) => ({ id: crypto.randomUUID(), transcript_id: t.id, sort_index: 0, speaker_label: null, text: i === 0 ? 'Bonjour, je voudrais un croissant.' : 'Salam, bghit khobza.' })));
    return { own: own!.id as string, otherMission: otherMission!.id as string, aryMission: aryMission!.id as string, aryCharacter: aryCharacter!.id as string, inherits: inherits!.id as string, ary: ary!.id as string, unknown: unknown!.id as string };
  }

  it('create: a scenario of another mission or variety is refused before any session row or model call', async () => {
    const ids = await setupWithContent();
    const refused = [
      [createBody({ missionId: MISSION_ID, scenarioId: ids.otherMission }), 'Scenario belongs to another mission'],
      [createBody({ scenarioId: ids.aryMission }), 'another course variety'],
      [createBody({ scenarioId: ids.aryCharacter }), 'another course variety'],
    ] as const;
    for (const [body, message] of refused) {
      const res = await f.h.call('/v1/ai/conversation/session', { token: f.token, body });
      expect(res.status, JSON.stringify(res.json)).toBe(422);
      expect(res.json.error.message).toContain(message);
    }
    expect(f.h.db.rows('conversation_sessions')).toHaveLength(0);
    expect(f.h.openrouter.calls).toHaveLength(0);

    // Control: one of the mission's own scenarios; its scene facts ground the character.
    const ok = await f.h.call('/v1/ai/conversation/session', { token: f.token, body: createBody({ missionId: MISSION_ID, scenarioId: ids.own }) });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    expect(characterPrompts().some((p) => p.includes('The terrace of a café near the station'))).toBe(true);
  });

  it('create: an audio lesson of another variety, or of no recorded variety, is refused; one that inherits its collection\'s variety grounds the character', async () => {
    const ids = await setupWithContent();
    for (const lessonId of [ids.ary, ids.unknown]) {
      const res = await f.h.call('/v1/ai/conversation/session', { token: f.token, body: createBody({ scope: { kind: 'audio_lesson', audioLessonId: lessonId } }) });
      expect(res.status, JSON.stringify(res.json)).toBe(422);
      expect(res.json.error.message).toContain('dialects are never substituted');
    }
    expect(f.h.db.rows('conversation_sessions')).toHaveLength(0);
    expect(f.h.openrouter.calls).toHaveLength(0);

    const ok = await f.h.call('/v1/ai/conversation/session', { token: f.token, body: createBody({ scope: { kind: 'audio_lesson', audioLessonId: ids.inherits } }) });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    const prompts = characterPrompts();
    expect(prompts.some((p) => p.includes('je voudrais un croissant'))).toBe(true);
    expect(prompts.some((p) => p.includes('bghit khobza'))).toBe(false);
  });

  it('a stored session naming a scenario or an audio lesson of another variety never runs (412, nothing written, no model call)', async () => {
    const ids = await setupWithContent();
    const stored = [
      seedSession(f, { scenario_id: ids.aryMission }),
      seedSession(f, { scenario_id: ids.aryCharacter }),
      seedSession(f, { mission_id: MISSION_ID, scope: { kind: 'mission', missionId: MISSION_ID }, scenario_id: ids.otherMission }),
      seedSession(f, { scope: { kind: 'audio_lesson', audioLessonId: ids.ary } }),
    ];
    for (const sessionId of stored) {
      const turn = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody({ kind: 'text', text: 'Bonjour' }) });
      expect(turn.status, JSON.stringify(turn.json)).toBe(412);
      expect(turn.json.error.message).toContain('dialects are never substituted');
      const end = await f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: endBody() });
      expect(end.status, JSON.stringify(end.json)).toBe(412);
    }
    expect(f.h.db.rows('conversation_turns')).toHaveLength(0);
    expect(f.h.db.writes('conversation_sessions')).toHaveLength(0);
    expect(f.h.openrouter.calls).toHaveLength(0);
  });
});
