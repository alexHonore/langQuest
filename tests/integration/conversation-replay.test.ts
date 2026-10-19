/**
 * §6.2 / §8.6 conversation turn idempotency from the CLIENT's point of view (A27 for speech):
 *   - while the first request for a `clientTurnId` is still running, a retry answers `turn_in_progress` (409) with
 *     `Retry-After` and `details.retryAfterSeconds`, and the pipeline is never run a second time;
 *   - the client's correct reaction is to retry the SAME `clientTurnId`: once the original has landed its character
 *     row the retry is replayed (`replayed: true`, the original character turn, no new rows);
 *   - a different `clientTurnId` is a new turn, which this harness (no OpenRouter key) refuses honestly instead of
 *     fabricating a reply; another learner never reaches the session at all.
 */
import { ConversationTurnResponseSchema } from '@langquest/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TURN_RETRY_WAIT_MS } from '../../apps/api/src/routes/speech/conversation';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, enrol, Seeder, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('integration.conversation-replay');

describeStack('conversation turn: 409 turn_in_progress → retry the same clientTurnId → replay', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let learner: TestUser;
  let stranger: TestUser;
  let enrollmentId: string;
  let characterId: string;
  let sessionId: string;
  const clientTurnId = crypto.randomUUID();

  const turnBody = (id: string) => ({ clientTurnId: id, input: { kind: 'text', text: 'Salam, labas?' }, clientState: { state: 'listening', lastSeq: 1, lastCharacterTurnId: null }, bargeIn: false });
  const turnRows = async () => (await h.service.from('conversation_turns').select('id, speaker, turn_index, client_turn_id').eq('session_id', sessionId).order('turn_index')).data ?? [];

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    [learner, stranger] = await Promise.all([createTestUser(h, 'turn-learner'), createTestUser(h, 'turn-stranger')]);
    enrollmentId = (await enrol(h, learner, { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'en' })).id;
    await enrol(h, stranger, { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'en' });
    characterId = (await seeder.character('ary')).id;
    // A live text-only session whose learner turn is in flight: the learner row exists, the character row does not yet.
    const session = await seeder.insert('conversation_sessions', { user_id: learner.id, enrollment_id: enrollmentId, mission_id: null, scenario_id: null, character_id: characterId, target_variety_id: 'ary', source_language_code: 'en', mode: 'text_only', state: 'listening', pipeline: 'text_only', speech_retention: 'none', last_seq: 1, turn_count: 1 });
    sessionId = session.id;
    await seeder.insert('conversation_turns', { session_id: sessionId, turn_index: 0, speaker: 'character', text: 'Salam!', occurred_at: new Date(Date.now() - 2_000).toISOString() });
    await seeder.insert('conversation_turns', { session_id: sessionId, turn_index: 1, speaker: 'learner', client_turn_id: clientTurnId, text: 'Salam, labas?', occurred_at: new Date(Date.now() - 1_000).toISOString() });
  });

  afterAll(async () => {
    await h.app.flush();
    await deleteTestUsers(h, [learner, stranger]);
    await seeder.cleanup();
  });

  it('a retry while the original is still in flight answers 409 turn_in_progress with Retry-After, and never runs the pipeline again', async () => {
    const res = await call(h, `/v1/ai/conversation/${sessionId}/turn`, { token: learner.token, body: turnBody(clientTurnId) });
    expect(res.status, JSON.stringify(res.json)).toBe(409);
    expect(res.json).toMatchObject({ ok: false, error: { code: 'turn_in_progress', details: { clientTurnId } } });
    const retryAfterSeconds = res.json.error.details.retryAfterSeconds as number;
    expect(Number.isInteger(retryAfterSeconds) && retryAfterSeconds >= 1).toBe(true);
    const header = Number(res.headers.get('retry-after'));
    expect(header).toBeGreaterThanOrEqual(1);
    expect(header).toBeLessThanOrEqual(Math.min(retryAfterSeconds, 30));
    // No second learner row, no fabricated character row.
    const rows = await turnRows();
    expect(rows.map((r) => r.speaker)).toEqual(['character', 'learner']);
  }, TURN_RETRY_WAIT_MS + 30_000);

  it('retrying the SAME clientTurnId once the original landed replays the original character turn (idempotent, no new rows)', async () => {
    // The original request lands its reply.
    const reply = await seeder.insert('conversation_turns', { session_id: sessionId, turn_index: 2, speaker: 'character', text: 'Labas, hamdullah!', occurred_at: new Date().toISOString(), latency_ms: 900 });
    const first = await call(h, `/v1/ai/conversation/${sessionId}/turn`, { token: learner.token, body: turnBody(clientTurnId) });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const data = ConversationTurnResponseSchema.parse(first.json.data);
    expect(data.replayed).toBe(true);
    expect(data.characterTurn).toMatchObject({ turnId: reply.id, characterId, text: 'Labas, hamdullah!', model: null });
    expect(data.learnerTranscript?.text).toBe('Salam, labas?');
    expect(data.session.sessionId).toBe(sessionId);
    // A second replay is byte-for-byte the same turn.
    const second = await call(h, `/v1/ai/conversation/${sessionId}/turn`, { token: learner.token, body: turnBody(clientTurnId) });
    expect(second.status).toBe(200);
    expect(second.json.data.characterTurn.turnId).toBe(reply.id);
    expect(second.json.data.replayed).toBe(true);
    expect((await turnRows()).map((r) => r.speaker)).toEqual(['character', 'learner', 'character']);
  });

  it('a different clientTurnId is a new turn: without an AI provider it is refused honestly, nothing is fabricated or persisted', async () => {
    const res = await call(h, `/v1/ai/conversation/${sessionId}/turn`, { token: learner.token, body: turnBody(crypto.randomUUID()) });
    expect(res.status).toBe(501);
    expect(res.json.error.code).toBe('capability_unsupported');
    expect((await turnRows()).map((r) => r.speaker)).toEqual(['character', 'learner', 'character']);
  });

  it('another learner cannot replay or probe the session with the same clientTurnId', async () => {
    const res = await call(h, `/v1/ai/conversation/${sessionId}/turn`, { token: stranger.token, body: turnBody(clientTurnId) });
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('not_found');
    expect((await call(h, `/v1/ai/conversation/${sessionId}/turn`, { body: turnBody(clientTurnId) })).status).toBe(401);
  });
});
