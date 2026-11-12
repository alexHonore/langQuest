/**
 * Model choices an admin can change: `GET /v1/admin/models` lists the defaults in effect (every task, the new
 * `pronunciation_feedback` included) and the synthetic voices per variety; a variety's `speech_synthesis` profile with
 * `params.voiceId` (saved from the admin screen) picks the server voice of the course's lines and of the narrator; the
 * AI listener uses the `pronunciation_feedback` profile. Through the real app and the fake OpenRouter.
 */
import { bytesToBase64, pcm16ToWav } from '@langquest/ai/util';
import { describe, expect, it } from 'vitest';
import { invalidateProfileCache } from '../../services/ai';
import { enrollmentRow, modelProfileRow, profileRow, routeHarness, type DbRow } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '66666666-6666-4666-8666-666666666666';
const NOW = () => new Date().toISOString();
const expression = (variety: string, text: string): DbRow => ({ id: crypto.randomUUID(), target_variety_id: variety, canonical_text: text, state: 'published', intent_id: 'greet', origin: 'authored', register: 'neutral', difficulty: 1, reviewed: true, reviewer_id: null, scenario_tags: [], phonetic_annotations: {}, script_annotations: {}, content_rights_id: null, created_at: NOW(), updated_at: NOW() });

async function setup(profiles: DbRow[] = []) {
  invalidateProfileCache();
  const h = routeHarness({ openRouter: true, roles: { [ADMIN]: ['admin' as const] } });
  h.db.seed('profiles', [profileRow(LEARNER)]);
  const [french] = h.db.seed('user_course_enrollments', [enrollmentRow(LEARNER, 'french', { source_language_code: 'en' })]);
  const [bonjour] = h.db.seed('expressions', [expression('fr', 'Bonjour')]);
  if (profiles.length) h.db.seed('ai_model_profiles', profiles);
  return { h, learner: await h.token(LEARNER), admin: await h.token(ADMIN), french: french!, bonjour: bonjour! };
}

describe('model choices an admin can change', () => {
  it('the models list shows the defaults in effect for every task and the voices of each variety', async () => {
    const f = await setup();
    const res = await f.h.call('/v1/admin/models', { token: f.admin });
    expect(res.status).toBe(200);
    const tasks = new Set((res.json.data.defaults as { task: string }[]).map((p) => p.task));
    for (const task of ['character_dialogue', 'learner_evaluation', 'speech_recognition', 'speech_synthesis', 'pronunciation_feedback']) expect(tasks.has(task), task).toBe(true);
    const voices = res.json.data.voices as { voiceId: string; varietyId: string }[];
    expect(voices.some((v) => v.varietyId === 'es-ES')).toBe(true);
    expect((await f.h.call('/v1/admin/models', { token: f.learner })).status).toBe(403);
    f.h.restore();
  });

  it('a variety\'s speech_synthesis profile with a voice picks the server voice of the course\'s lines', async () => {
    const f = await setup([modelProfileRow({ task: 'speech_synthesis', target_variety_id: 'fr', primary_model: 'google/gemini-3.8-flash-lite-tts', params: { voiceId: 'fr-fr-m-1' } })]);
    const res = await f.h.call('/v1/speech/synthesize', { token: f.learner, body: { enrollmentId: f.french.id, targetVarietyId: 'fr', expressionId: f.bonjour.id } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.audio.voiceId).toBe('fr-fr-m-1');
    f.h.restore();
  });

  it('a voice of another variety is ignored (the registry\'s default speaks)', async () => {
    const f = await setup([modelProfileRow({ task: 'speech_synthesis', target_variety_id: 'fr', primary_model: 'google/gemini-3.8-flash-lite-tts', params: { voiceId: 'es-es-f-2' } })]);
    const res = await f.h.call('/v1/speech/synthesize', { token: f.learner, body: { enrollmentId: f.french.id, targetVarietyId: 'fr', expressionId: f.bonjour.id } });
    expect(res.status).toBe(200);
    expect(res.json.data.audio.voiceId).not.toBe('es-es-f-2');
    f.h.restore();
  });

  it('the AI listener uses the pronunciation_feedback profile of the course\'s variety', async () => {
    const f = await setup([modelProfileRow({ task: 'pronunciation_feedback', target_variety_id: 'fr', primary_model: 'fake/listener', fallback_models: [] })]);
    f.h.openrouter.chat = () => JSON.stringify({ targetIpa: 'bɔ̃ʒuʁ', heardIpa: 'bɔ̃ʒuʁ', heard: 'Bonjour', matchesTarget: true, score: 95, words: [], summary: 'ok', tip: 'ok' });
    const take = bytesToBase64(pcm16ToWav(new Uint8Array(16_000), 16_000));
    const res = await f.h.call('/v1/speech/pronunciation-feedback', { token: f.learner, body: { enrollmentId: f.french.id, targetVarietyId: 'fr', expressionId: f.bonjour.id, audio: { source: 'inline', base64: take, encoding: 'wav', sampleRateHz: 16_000 }, recording: { peakLevelDb: -10 }, clientRequestId: crypto.randomUUID() } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const chat = f.h.openrouter.callsTo('/chat/completions');
    expect(chat.length, JSON.stringify(res.json.data)).toBeGreaterThan(0);
    const body = chat[0]!.body as { model?: string; models?: string[] };
    expect(body.models?.[0] ?? body.model).toBe('fake/listener');
    f.h.restore();
  });
});
