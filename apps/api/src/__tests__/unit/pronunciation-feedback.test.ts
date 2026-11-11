/**
 * `POST /v1/speech/pronunciation-feedback`: a listening model's estimate of how a take of an approved phrase sounds.
 * Through the real app and the real `@langquest/ai` judge, with the offline fake OpenRouter (nothing leaves the
 * process). The take reaches the model as an audio part; the answer comes back as its own shape (never an acoustic
 * score); nothing is recorded as mastery evidence; a silent take costs nothing; only published content is judged.
 */
import { bytesToBase64, pcm16ToWav } from '@langquest/ai/util';
import { PronunciationFeedbackResponseSchema, apiEnvelope } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { enrollmentRow, profileRow, routeHarness, type DbRow } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const NOW = () => new Date().toISOString();
const tone = (ms: number, rate = 16_000): Uint8Array => {
  const n = Math.round((ms / 1000) * rate);
  const out = new Uint8Array(n * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < n; i += 1) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 0.3 * 32767), true);
  return out;
};
const TAKE = bytesToBase64(pcm16ToWav(tone(900), 16_000));
const expression = (variety: string, text: string): DbRow => ({ id: crypto.randomUUID(), target_variety_id: variety, canonical_text: text, state: 'published', intent_id: 'greet', origin: 'authored', register: 'neutral', difficulty: 1, reviewed: true, reviewer_id: null, scenario_tags: [], phonetic_annotations: {}, script_annotations: {}, content_rights_id: null, created_at: NOW(), updated_at: NOW() });

const JUDGED = {
  targetIpa: 'bɔ̃ʒuʁ',
  heardIpa: 'bɒnˈdʒʊə',
  heard: 'Bonjour',
  matchesTarget: true,
  score: 58,
  words: [{ word: 'Bonjour', status: 'mispronounced', tip: 'Nasalise the “on” and use a French r.' }],
  summary: 'Understandable, with a clear English accent.',
  tip: 'Practise the nasal “on” of “bonjour”.',
};

async function setup(options: { openRouter?: boolean } = {}) {
  const h = routeHarness({ openRouter: options.openRouter ?? true });
  h.db.seed('profiles', [profileRow(LEARNER)]);
  const [french] = h.db.seed('user_course_enrollments', [enrollmentRow(LEARNER, 'french', { source_language_code: 'en' })]);
  const [bonjour, japanese] = h.db.seed('expressions', [expression('fr', 'Bonjour'), expression('ja', 'こんにちは')]);
  return { h, token: await h.token(LEARNER), french: french!, bonjour: bonjour!, japanese: japanese! };
}

const body = (f: Awaited<ReturnType<typeof setup>>, over: Record<string, unknown> = {}) => ({
  enrollmentId: f.french.id,
  targetVarietyId: 'fr',
  expressionId: f.bonjour.id,
  audio: { source: 'inline', base64: TAKE, encoding: 'wav', sampleRateHz: 16_000 },
  recording: { peakLevelDb: -12 },
  clientRequestId: crypto.randomUUID(),
  ...over,
});
const Envelope = apiEnvelope(PronunciationFeedbackResponseSchema);

describe('POST /v1/speech/pronunciation-feedback (AI pronunciation feedback)', () => {
  it('the model listens to the take (an audio part, with the phrase and the variety); its estimate comes back; nothing is credited', async () => {
    const f = await setup();
    f.h.openrouter.chat = () => JSON.stringify(JUDGED);
    const res = await f.h.call('/v1/speech/pronunciation-feedback', { token: f.token, body: body(f) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const parsed = Envelope.parse(res.json);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.data).toMatchObject({ method: 'ai_listening', score: 58, band: 'clear_accent', matchesTarget: true, heardIpa: 'bɒnˈdʒʊə', tip: 'Practise the nasal “on” of “bonjour”.' });
    expect(parsed.data.words).toEqual([{ word: 'Bonjour', status: 'mispronounced', tip: 'Nasalise the “on” and use a French r.' }]);

    const chat = f.h.openrouter.callsTo('/chat/completions');
    expect(chat).toHaveLength(1);
    const parts = (chat[0]!.body!.messages as { content: { type: string; text?: string; input_audio?: { data: string; format: string } }[] }[])[0]!.content;
    expect(parts.map((p) => p.type)).toEqual(['text', 'input_audio']);
    expect(parts[0]!.text).toContain('"Bonjour"');
    expect(parts[0]!.text).toContain('learners whose first language is English');
    expect(parts[1]!.input_audio).toEqual({ data: TAKE, format: 'wav' });

    await f.h.flush();
    expect(f.h.db.rows('learning_observations')).toHaveLength(0);
    expect(f.h.db.rows('user_skill_mastery')).toHaveLength(0);
    expect(f.h.db.rows('xp_ledger')).toHaveLength(0);
    expect(f.h.db.rows('ai_requests').at(-1)).toMatchObject({ task: 'pronunciation_assessment', success: true });
  });

  it('a take metered as silent: no_speech, and the model is not called', async () => {
    const f = await setup();
    const res = await f.h.call('/v1/speech/pronunciation-feedback', { token: f.token, body: body(f, { recording: { peakLevelDb: -70 } }) });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ band: 'no_speech', score: null, words: [] });
    expect(f.h.openrouter.callsTo('/chat/completions')).toHaveLength(0);
  });

  it('only WAV or MP3 (what listening models hear); only published content of the enrollment\'s variety', async () => {
    const f = await setup();
    const webm = await f.h.call('/v1/speech/pronunciation-feedback', { token: f.token, body: body(f, { audio: { source: 'inline', base64: TAKE, encoding: 'webm_opus', sampleRateHz: null } }) });
    expect(webm.status).toBe(422);
    const other = await f.h.call('/v1/speech/pronunciation-feedback', { token: f.token, body: body(f, { expressionId: f.japanese.id }) });
    expect(other.status).toBe(422);
    expect(f.h.openrouter.callsTo('/chat/completions')).toHaveLength(0);
  });

  it('an unusable answer from the model is a provider error, never an invented score', async () => {
    const f = await setup();
    f.h.openrouter.chat = () => 'I could not hear it.';
    const res = await f.h.call('/v1/speech/pronunciation-feedback', { token: f.token, body: body(f) });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe('provider_unavailable');
  });

  it('without AI on the deployment: capability_unsupported', async () => {
    const f = await setup({ openRouter: false });
    const res = await f.h.call('/v1/speech/pronunciation-feedback', { token: f.token, body: body(f) });
    expect(res.status).toBe(501);
    expect(res.json.error.code).toBe('capability_unsupported');
  });
});
