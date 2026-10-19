/**
 * LIVE test (paid providers): one text conversation turn in Moroccan Darija taught FROM FRENCH (A02, A12, §8.4).
 * Runs only with LANGQUEST_LIVE_TESTS=1 and OPENROUTER_API_KEY (repo `.env`), against the local stack.
 * Asserts: the character speaks Darija (language guard heuristic: Arabic script / Arabizi, no MSA/French leak),
 * a `translate` command yields French coaching text, and the session ends with ≤ 2 priority corrections.
 * Budget: text_only mode, ~4 small model calls (well under $0.05).
 */
import { LanguageGuard } from '@langquest/ai/prompts/language-guard';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createStackUser, describeWithStack, REPO_ROOT, stackApp, teardownStack, trackRow, type StackHarness, type TestUser } from '../harness';

loadDotenv({ path: resolve(REPO_ROOT, '.env'), quiet: true });
const live = process.env.LANGQUEST_LIVE_TESTS === '1' && Boolean(process.env.OPENROUTER_API_KEY);
const describeLive = live ? describeWithStack('api.live') : describe.skip;
if (!live) console.warn('[api.live] LANGQUEST_LIVE_TESTS=1 + OPENROUTER_API_KEY required; skipping live conversation test.');

const FRENCH_MARKERS = /\b(le|la|les|un|une|des|vous|tu|est|et|bonjour|salut|ça|comment|merci|je|c'est|pour|avec|dire|signifie|veut)\b/i;

describeLive('live Darija-from-French conversation turn', () => {
  let h: StackHarness;
  let learner: TestUser;
  let characterId: string;
  let enrollmentId: string;
  const guard = new LanguageGuard();

  beforeAll(async () => {
    h = stackApp({ OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, LOG_LEVEL: 'warn' });
    learner = await createStackUser(h, 'live', { defaultSourceLanguageCode: 'fr', uiLocale: 'fr-CA' });
    const character = await h.service.from('characters').insert({ character_key: `live.test.${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`, name: 'Khadija', role: 'café owner', personality: 'warm, patient, chatty', home_region: 'Casablanca', target_variety_id: 'ary', voice_profile: { synthetic: true }, storyline_facts: ['Runs a small café near the medina', 'Loves talking about mint tea'], state: 'published' }).select('id').single();
    if (character.error) throw new Error(character.error.message);
    characterId = trackRow(h, 'characters', character.data.id);
    const enrollment = await call(h.app, '/v1/me/enrollments', { token: learner.token, body: { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both' } });
    enrollmentId = enrollment.json.data.id;
  });

  // Learner first (the session references the character, ON DELETE RESTRICT), then the tracked character.
  afterAll(() => teardownStack(h));

  it('speaks Darija to the learner and coaches in French', async () => {
    const sessionId = crypto.randomUUID();
    const session = await call(h.app, '/v1/ai/conversation/session', { token: learner.token, body: { enrollmentId, characterId, clientSessionId: sessionId, mode: 'text_only' } });
    expect(session.status, JSON.stringify(session.json)).toBe(201);
    expect(session.json.data.provider.pipeline).toBe('text_only');
    expect(session.json.data.provider.clientToken).toMatch(/\./);
    expect(session.json.data.character.targetVarietyId).toBe('ary');
    const opening = session.json.data.openingTurn;
    expect(opening).not.toBeNull();
    const openingGuard = guard.checkHeuristic(opening.text, 'ary', 'both');
    expect(openingGuard.ok, `opening turn not Darija: ${opening.text} ${JSON.stringify(openingGuard.issues)}`).toBe(true);

    const turn = await call(h.app, `/v1/ai/conversation/${sessionId}/turn`, { token: learner.token, body: { clientTurnId: crypto.randomUUID(), input: { kind: 'text', text: 'Salam Khadija, labas? Bghit atay b n3na3 3afak.' }, clientState: { state: 'listening', lastSeq: 1, lastCharacterTurnId: opening.turnId } } });
    expect(turn.status, JSON.stringify(turn.json)).toBe(200);
    expect(turn.json.data.characterTurn).not.toBeNull();
    const reply = turn.json.data.characterTurn.text as string;
    const replyGuard = guard.checkHeuristic(reply, 'ary', 'both');
    expect(replyGuard.ok, `reply not Darija: ${reply} ${JSON.stringify(replyGuard.issues)}`).toBe(true);
    expect(turn.json.data.replayed).toBe(false);

    // Replay the same clientTurnId: no second model call, identical character turn.
    const replayId = crypto.randomUUID();
    const first = await call(h.app, `/v1/ai/conversation/${sessionId}/turn`, { token: learner.token, body: { clientTurnId: replayId, input: { kind: 'command', command: 'translate' }, clientState: { state: 'listening', lastSeq: 2, lastCharacterTurnId: turn.json.data.characterTurn.turnId } } });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const gloss = first.json.data.characterTurn.sourceGloss as string | null;
    expect(gloss, 'translate command must return a source-language gloss').toBeTruthy();
    expect(FRENCH_MARKERS.test(gloss!), `coaching text is not French: ${gloss}`).toBe(true);
    const replay = await call(h.app, `/v1/ai/conversation/${sessionId}/turn`, { token: learner.token, body: { clientTurnId: replayId, input: { kind: 'command', command: 'translate' }, clientState: { state: 'listening', lastSeq: 2, lastCharacterTurnId: turn.json.data.characterTurn.turnId } } });
    expect(replay.json.data.replayed).toBe(true);
    expect(replay.json.data.characterTurn.turnId).toBe(first.json.data.characterTurn.turnId);

    const end = await call(h.app, `/v1/ai/conversation/${sessionId}/end`, { token: learner.token, body: { reason: 'learner_ended', clientState: { lastSeq: 3, turnCount: 4 }, clientEventId: crypto.randomUUID() } });
    expect(end.status, JSON.stringify(end.json)).toBe(200);
    expect(end.json.data.session.state).toBe('finished');
    expect(end.json.data.evaluation.priorityCorrections.length).toBeLessThanOrEqual(2);
    expect(end.json.data.xpAwarded).toBeGreaterThan(0);
    expect(end.json.data.transcriptRetained).toBe(false);
    await h.app.flush();
    const requests = await h.service.from('ai_requests').select('task, success, model, estimated_cost_usd').eq('user_id', learner.id);
    expect((requests.data ?? []).length).toBeGreaterThanOrEqual(2);
    expect((requests.data ?? []).some((r) => r.task === 'character_dialogue' && r.success)).toBe(true);
    const spend = (requests.data ?? []).reduce((n, r) => n + Number(r.estimated_cost_usd ?? 0), 0);
    expect(spend).toBeLessThan(0.5);
  });
});
