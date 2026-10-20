/**
 * Speech honesty end to end (device QA 2026-10-19, lesson feedback row and §6.1): Whisper turned ambient noise into
 * "اشتركوا في القناة" / "subscribe to the channel", the evaluator answered `partially_understood` with meaning confidence
 * 0.99 ("Globalement compris"), a 12.7 s near-silent clip became "Parfaitement compris", and Progress credited
 * `speaking.intelligibility`. Through the REAL app, the real `@langquest/ai` adapters (OpenRouter STT, reference
 * comparison, meaning matcher, character agent) and the offline fakes of `route-fixtures` (nothing leaves the process):
 *
 * - every consumer (lesson attempt grading = `POST /v1/speech/pronunciation-assess`, `POST /v1/speech/transcribe`,
 *   conversation voice turns) answers a take without speech as its own outcome — no "understood", no meaning judge call,
 *   no observation, no mastery row, no XP, no retained recording;
 * - genuine one-word answers ("Oui", "نعم", "はい") are still graded and credited;
 * - a confident "not that meaning" verdict (0.99) is `not_understood`, never "partially understood";
 * - conversation voice turns refuse caller-supplied audio URLs (422, nothing fetched), like the speech routes;
 * - the gate's verdict is applied once: a dropped LEADING credit-line segment leaves the genuine segments, their
 *   confidence and word timings intact on every consumer.
 *
 * NOT covered (still open): the device's 12.7 s near-silent clip ("Parfaitement compris"; Arabic, a compressed iOS
 * recording). It was decoded as text the meaning check matched to the reference, so at least one segment had
 * no_speech_prob ≤ 0.8, and compressed audio gets no server-side level check: such a take is still credited until the
 * client sends its recorder metering (`recording.peakLevelDb`) or the server gains a level / VAD check for it.
 */
import { bytesToBase64, pcm16ToWav } from '@langquest/ai/util';
import { ConversationTurnRequestSchema, ConversationTurnResponseSchema, NO_SPEECH_REASON_VALUES, PronunciationAssessRequestSchema, PronunciationAssessResponseSchema, RecordingSignalsSchema, SpeechDetectionSchema, TranscribeRequestSchema, TranscribeResponseSchema, apiEnvelope } from '@langquest/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { isCreditedLearnerTurn } from '../../lib/conversation';
import { FAKE_OPENROUTER_BASE, enrollmentRow, profileRow, routeHarness, type DbRow, type RouteHarness, type ScriptedResponse } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const NOW = () => new Date().toISOString();

/** 16-bit PCM sine wave (not silent: the server-side level gate lets it through to the recognizer). */
const tone = (ms: number, amplitude = 0.3, rate = 16_000): Uint8Array => {
  const n = Math.round((ms / 1000) * rate);
  const out = new Uint8Array(n * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < n; i += 1) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * amplitude * 32767), true);
  return out;
};
const TONE_WAV = bytesToBase64(pcm16ToWav(tone(900), 16_000));
const SILENT_WAV = bytesToBase64(pcm16ToWav(new Uint8Array(32_000), 16_000));

/** Scripted OpenRouter verbose_json answer (Whisper shape). */
const whisper = (text: string, language: string, o: { nsp?: number; lp?: number; duration?: number } = {}): ScriptedResponse => {
  const duration = o.duration ?? 1.4;
  return { status: 200, body: { text, language, duration, segments: [{ id: 0, start: 0, end: duration, text, avg_logprob: o.lp ?? -0.2, no_speech_prob: o.nsp ?? 0.03 }], words: [], usage: { seconds: duration, cost: 0.0001 } } };
};

/**
 * Whisper answer whose FIRST segment is dropped by the gate (a subtitle-credit line), followed by two genuine segments:
 * "Bonjour" (avg_logprob −0.1) and "madame" (−1.4). Screened once, the kept confidence is mean(e^−0.1, e^−1.4) = 0.576;
 * screened twice (the regression), "Bonjour" was dropped as well and the confidence fell to 0.247.
 */
const LEADING_CREDIT_TAKE: ScriptedResponse = {
  status: 200,
  body: {
    text: "Sous-titres réalisés par la communauté d'Amara.org Bonjour madame",
    language: 'fr',
    duration: 3,
    segments: [
      { id: 0, start: 0, end: 1, text: "Sous-titres réalisés par la communauté d'Amara.org", avg_logprob: -0.2, no_speech_prob: 0.05 },
      { id: 1, start: 1, end: 2, text: 'Bonjour', avg_logprob: -0.1, no_speech_prob: 0.05 },
      { id: 2, start: 2, end: 3, text: 'madame', avg_logprob: -1.4, no_speech_prob: 0.05 },
    ],
    words: [
      { word: 'Sous-titres', start: 0.1, end: 0.5 },
      { word: 'Bonjour', start: 1.1, end: 1.5 },
      { word: 'madame', start: 2.1, end: 2.5 },
    ],
    usage: { seconds: 3, cost: 0.0001 },
  },
};
const LEADING_CREDIT_KEPT_CONFIDENCE = 0.576;

const expression = (variety: string, text: string): DbRow => ({ id: crypto.randomUUID(), target_variety_id: variety, canonical_text: text, state: 'published', intent_id: 'greet', origin: 'authored', register: 'neutral', difficulty: 1, reviewed: true, reviewer_id: null, scenario_tags: [], phonetic_annotations: {}, script_annotations: {}, content_rights_id: null, created_at: NOW(), updated_at: NOW() });

interface Fixture {
  h: RouteHarness;
  token: string;
  darija: DbRow;
  french: DbRow;
  english: DbRow;
  japanese: DbRow;
}

async function setup(options: { media?: boolean; privacy?: DbRow } = {}): Promise<Fixture> {
  const h = routeHarness({ openRouter: true, media: options.media });
  h.db.seed('profiles', [profileRow(LEARNER, { privacy_options: options.privacy ?? {} })]);
  const [darija, french, english, japanese] = h.db.seed('user_course_enrollments', [
    enrollmentRow(LEARNER, 'arabic-moroccan', { source_language_code: 'fr', script_mode: 'both' }),
    enrollmentRow(LEARNER, 'french', { source_language_code: 'en' }),
    enrollmentRow(LEARNER, 'english', { source_language_code: 'fr' }),
    enrollmentRow(LEARNER, 'japanese', { source_language_code: 'en' }),
  ]);
  h.db.seed('expressions', [expression('ary', 'صباح الخير'), expression('ary', 'نعم'), expression('fr', 'Bonjour'), expression('fr', 'Bonjour madame'), expression('fr', 'Oui'), expression('fr', 'Je voudrais un café'), expression('en', 'Good morning'), expression('ja', 'おはようございます'), expression('ja', 'はい')]);
  return { h, token: await h.token(LEARNER), darija: darija!, french: french!, english: english!, japanese: japanese! };
}

const assessBody = (enrollment: DbRow, referenceText: string, over: DbRow = {}) => ({
  enrollmentId: enrollment.id,
  targetVarietyId: varietyOf(enrollment),
  referenceText,
  audio: { source: 'inline', base64: TONE_WAV, encoding: 'wav', sampleRateHz: 16_000 },
  clientRequestId: crypto.randomUUID(),
  scenarioId: 'lesson-greetings',
  ...over,
});
const varietyOf = (e: DbRow): string => ({ 'arabic-moroccan': 'ary', french: 'fr', english: 'en', japanese: 'ja' })[e.course_track_id as string]!;

const AssessEnvelope = apiEnvelope(PronunciationAssessResponseSchema);
const TranscribeEnvelope = apiEnvelope(TranscribeResponseSchema);
const TurnEnvelope = apiEnvelope(ConversationTurnResponseSchema);

/** Nothing graded, nothing credited: no meaning-judge call, no observation, no mastery, no XP. */
async function expectNothingCredited(f: Fixture): Promise<void> {
  await f.h.flush();
  expect(f.h.openrouter.callsTo('/chat/completions')).toHaveLength(0);
  expect(f.h.db.rows('learning_observations')).toHaveLength(0);
  expect(f.h.db.rows('user_skill_mastery')).toHaveLength(0);
  expect(f.h.db.rows('xp_ledger')).toHaveLength(0);
  expect(f.h.blocked).toEqual([]);
}

describe('contracts: the honest no-speech outcome is typed', () => {
  it('a verdict carries a reason exactly when no speech was detected; recorder metering is bounded and optional', () => {
    expect(SpeechDetectionSchema.safeParse({ speechDetected: false, reason: 'known_hallucination' }).success).toBe(true);
    expect(SpeechDetectionSchema.safeParse({ speechDetected: true, reason: null }).success).toBe(true);
    expect(SpeechDetectionSchema.safeParse({ speechDetected: false, reason: null }).success).toBe(false);
    expect(SpeechDetectionSchema.safeParse({ speechDetected: true, reason: 'silent_audio' }).success).toBe(false);
    expect(NO_SPEECH_REASON_VALUES).toEqual(['empty_transcript', 'silent_audio', 'client_silence', 'no_speech_probability', 'known_hallucination', 'non_speech_annotation', 'repetition_loop']);
    expect(RecordingSignalsSchema.safeParse({ peakLevelDb: -42.5 }).success).toBe(true);
    expect(RecordingSignalsSchema.safeParse({ peakLevelDb: null }).success).toBe(true);
    expect(RecordingSignalsSchema.safeParse({ peakLevelDb: 'loud' }).success).toBe(false);
    const audio = { source: 'inline', base64: 'AAAA', encoding: 'm4a', sampleRateHz: null };
    expect(TranscribeRequestSchema.safeParse({ enrollmentId: LEARNER, targetVarietyId: 'fr', audio, clientRequestId: LEARNER, recording: { peakLevelDb: -30 } }).success).toBe(true);
    expect(PronunciationAssessRequestSchema.safeParse({ enrollmentId: LEARNER, targetVarietyId: 'fr', referenceText: 'Oui', audio, clientRequestId: LEARNER, recording: { peakLevelDb: -30 } }).success).toBe(true);
    expect(ConversationTurnRequestSchema.safeParse({ clientTurnId: LEARNER, input: { kind: 'audio', assetId: LEARNER, durationMs: 900, transcriptHint: null }, recording: { peakLevelDb: -61 }, clientState: { state: 'listening', lastSeq: 0, lastCharacterTurnId: null } }).success).toBe(true);
  });
});

describe('POST /v1/speech/pronunciation-assess (lesson attempt grading)', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  const hallucinations: Array<[keyof Omit<Fixture, 'h' | 'token'>, string, string, string]> = [
    ['darija', 'ar', 'اشتركوا في القناة', 'صباح الخير'],
    ['french', 'fr', "Sous-titres réalisés par la communauté d'Amara.org", 'Bonjour'],
    ['english', 'en', 'Subscribe to the channel.', 'Good morning'],
    ['japanese', 'ja', 'ご視聴ありがとうございました', 'おはようございます'],
  ];
  for (const [course, lang, heard, reference] of hallucinations) {
    it(`${course}: "${heard}" on ambient noise is "no speech detected" — not understood, not judged, not credited`, async () => {
      f = await setup();
      f.h.openrouter.transcription = () => whisper(heard, lang, { nsp: 0.12, lp: -0.25 });
      const res = await f.h.call('/v1/speech/pronunciation-assess', { token: f.token, body: assessBody(f[course], reference) });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      const parsed = AssessEnvelope.parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      expect(parsed.data).toMatchObject({ intelligibility: 'no_speech_detected', semanticIntentMatched: false, meaningConfidence: 0, transcript: null, shouldAdvanceConversation: false, matchedIntentIds: [] });
      expect(parsed.data.pronunciation).toMatchObject({ assessmentMode: 'unavailable', numericScore: null, confidence: 'none', feedback: ['feedback.no_speech_detected'] });
      expect(JSON.stringify(res.json)).not.toContain(heard);
      expect(f.h.openrouter.callsTo('/audio/transcriptions')).toHaveLength(1);
      await expectNothingCredited(f);
      // The STT call is still costed, with the verdict and never the text.
      const [ledger] = f.h.db.rows('ai_requests');
      expect(ledger).toMatchObject({ task: 'speech_recognition', success: true, enrollment_id: f[course].id });
      expect(ledger?.redacted_log).toMatchObject({ speechDetected: false, noSpeechReason: 'known_hallucination' });
    });
  }

  it('every segment above no_speech_prob 0.8 (a long take): no_speech_detected and, unlike before, no "unclear" observation', async () => {
    f = await setup();
    f.h.openrouter.transcription = () => whisper('Bonjour.', 'fr', { nsp: 0.92, lp: -0.35, duration: 8 });
    const res = await f.h.call('/v1/speech/pronunciation-assess', { token: f.token, body: assessBody(f.french, 'Bonjour') });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ intelligibility: 'no_speech_detected', semanticIntentMatched: false, transcript: null });
    await expectNothingCredited(f);
    expect(f.h.db.rows('ai_requests')[0]?.redacted_log).toMatchObject({ speechDetected: false, noSpeechReason: 'no_speech_probability' });
  });

  it('a silent WAV take or silent recorder metering is answered without any recognizer call (no cost)', async () => {
    f = await setup();
    const silent = await f.h.call('/v1/speech/pronunciation-assess', { token: f.token, body: assessBody(f.french, 'Bonjour', { audio: { source: 'inline', base64: SILENT_WAV, encoding: 'wav', sampleRateHz: 16_000 } }) });
    expect(silent.status).toBe(200);
    expect(silent.json.data.intelligibility).toBe('no_speech_detected');
    const metered = await f.h.call('/v1/speech/pronunciation-assess', { token: f.token, body: assessBody(f.darija, 'صباح الخير', { audio: { source: 'inline', base64: 'AAAAGGZ0eXBNNEEg', encoding: 'm4a', sampleRateHz: 44_100 }, recording: { peakLevelDb: -64 } }) });
    expect(metered.status).toBe(200);
    expect(metered.json.data.intelligibility).toBe('no_speech_detected');
    expect(f.h.openrouter.calls).toHaveLength(0);
    await expectNothingCredited(f);
    expect(f.h.db.rows('ai_requests')).toHaveLength(0);
  });

  const genuine: Array<[keyof Omit<Fixture, 'h' | 'token'>, string, string, string]> = [
    ['french', 'fr', 'Oui.', 'Oui'],
    ['darija', 'ar', 'نعم', 'نعم'],
    ['japanese', 'ja', 'はい', 'はい'],
  ];
  for (const [course, lang, heard, reference] of genuine) {
    it(`${course}: the genuine one-word answer "${heard}" is understood and credited (no false positive)`, async () => {
      f = await setup();
      f.h.openrouter.transcription = () => whisper(heard, lang, { nsp: 0.06, lp: -0.3, duration: 0.7 });
      const res = await f.h.call('/v1/speech/pronunciation-assess', { token: f.token, body: assessBody(f[course], reference) });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data).toMatchObject({ intelligibility: 'understood', semanticIntentMatched: true, transcript: heard, shouldAdvanceConversation: true });
      expect(res.json.data.pronunciation).toMatchObject({ assessmentMode: 'reference-comparison', numericScore: null });
      await f.h.flush();
      expect(f.h.db.rows('learning_observations')).toEqual([expect.objectContaining({ skill_key: 'speaking.intelligibility', outcome: 'success', enrollment_id: f[course].id })]);
    });
  }

  it('a confident "not that meaning" verdict (0.99) is not_understood, never "partially understood"', async () => {
    f = await setup();
    f.h.openrouter.transcription = () => whisper("J'aime le fromage.", 'fr');
    f.h.openrouter.chat = () => JSON.stringify({ matched: false, confidence: 0.99, matchedIntentIds: [], paraphrase: false, reason: 'Ce n’est pas une salutation.' });
    const res = await f.h.call('/v1/speech/pronunciation-assess', { token: f.token, body: assessBody(f.french, 'Bonjour') });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ intelligibility: 'not_understood', semanticIntentMatched: false, meaningConfidence: 0.99, shouldAdvanceConversation: false, transcript: "J'aime le fromage." });
    expect(f.h.openrouter.callsTo('/chat/completions')).toHaveLength(1);
    await f.h.flush();
    expect(f.h.db.rows('learning_observations')).toEqual([expect.objectContaining({ skill_key: 'speaking.intelligibility', outcome: 'fail' })]);
  });

  it('partial lexical evidence (a substituted word) stays partially_understood', async () => {
    f = await setup();
    f.h.openrouter.transcription = () => whisper('Je voudrais un thé.', 'fr');
    f.h.openrouter.chat = () => JSON.stringify({ matched: false, confidence: 0.9, matchedIntentIds: [], paraphrase: false, reason: 'Un thé, pas un café.' });
    const res = await f.h.call('/v1/speech/pronunciation-assess', { token: f.token, body: assessBody(f.french, 'Je voudrais un café') });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ intelligibility: 'partially_understood', semanticIntentMatched: false, shouldAdvanceConversation: false });
  });

  it('a dropped leading credit line is screened once: both genuine words graded, confidence and feedback intact', async () => {
    f = await setup();
    f.h.openrouter.transcription = () => LEADING_CREDIT_TAKE;
    const res = await f.h.call('/v1/speech/pronunciation-assess', { token: f.token, body: assessBody(f.french, 'Bonjour madame') });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toMatchObject({ intelligibility: 'understood', semanticIntentMatched: true, transcript: 'Bonjour madame' });
    expect(res.json.data.pronunciation.wordScores.map((w: { word: string }) => w.word)).toEqual(['Bonjour', 'madame']);
    expect(res.json.data.pronunciation.feedback[0]).toBe('feedback.meaning_came_across');
    expect(res.json.data.pronunciation.feedback).not.toContain('feedback.unclear_recording_retry');
    await f.h.flush();
    expect(f.h.db.rows('learning_observations')).toEqual([expect.objectContaining({ skill_key: 'speaking.intelligibility', outcome: 'success', utterance_confidence: LEADING_CREDIT_KEPT_CONFIDENCE })]);
  });
});

describe('POST /v1/speech/transcribe (learner take)', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());
  const body = (enrollment: DbRow, over: DbRow = {}) => ({ enrollmentId: enrollment.id, targetVarietyId: varietyOf(enrollment), audio: { source: 'inline', base64: TONE_WAV, encoding: 'wav', sampleRateHz: 16_000 }, clientRequestId: crypto.randomUUID(), ...over });

  it('a hallucinated take answers an empty transcript with the typed reason and is never retained', async () => {
    f = await setup({ media: true, privacy: { store_speech_recordings: 'opt_in_30_days' } });
    f.h.openrouter.transcription = () => whisper('اشتركوا في القناة', 'ar');
    const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: body(f.darija) });
    expect(res.status).toBe(200);
    const parsed = TranscribeEnvelope.parse(res.json);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.data.transcript).toMatchObject({ text: '', segments: [], confidence: null, languageMismatch: false });
    expect(parsed.data.speech).toEqual({ speechDetected: false, reason: 'known_hallucination' });
    expect(parsed.data.recordingAssetId).toBeNull();
    expect(f.h.db.rows('media_assets')).toHaveLength(0);
    expect(f.h.bucket?.objects.size).toBe(0);
  });

  it('a genuine take keeps its transcript and says speech was detected', async () => {
    f = await setup();
    f.h.openrouter.transcription = () => whisper('はい', 'ja', { duration: 0.6 });
    const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: body(f.japanese) });
    expect(res.status).toBe(200);
    expect(res.json.data.transcript.text).toBe('はい');
    expect(res.json.data.speech).toEqual({ speechDetected: true, reason: null });
  });

  it('silent recorder metering short-circuits the recognizer', async () => {
    f = await setup();
    const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: body(f.french, { recording: { peakLevelDb: -70 } }) });
    expect(res.status).toBe(200);
    expect(res.json.data.speech).toEqual({ speechDetected: false, reason: 'client_silence' });
    expect(res.json.data.transcript).toMatchObject({ text: '', model: 'langquest/speech-gate' });
    expect(f.h.openrouter.calls).toHaveLength(0);
  });

  it('a dropped leading credit line is screened once: the response keeps both genuine segments and their confidence', async () => {
    f = await setup();
    f.h.openrouter.transcription = () => LEADING_CREDIT_TAKE;
    const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: body(f.french, { expectedText: 'Bonjour madame' }) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const parsed = TranscribeEnvelope.parse(res.json);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.data.speech).toEqual({ speechDetected: true, reason: null });
    expect(parsed.data.transcript).toMatchObject({ text: 'Bonjour madame', confidence: LEADING_CREDIT_KEPT_CONFIDENCE });
    expect(parsed.data.transcript.segments.map((seg) => seg.text)).toEqual(['Bonjour', 'madame']);
    expect(parsed.data.transcript.segments.flatMap((seg) => seg.words).map((w) => w.text)).toEqual(['Bonjour', 'madame']);
    expect(JSON.stringify(res.json)).not.toContain('Amara');
  });
});

describe('conversation voice turns', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());
  const CHARACTER_ID = '44444444-4444-4444-8444-444444444444';

  function seedSession(enrollment: DbRow): string {
    f.h.db.seed('characters', [{ id: CHARACTER_ID, character_key: 'fr-cafe-camille', name: 'Camille', role: 'barista', home_region: 'Paris', personality: 'warm and patient', target_variety_id: 'fr', regional_option: null, relationships: {}, safety_rules: [], state: 'published', storyline_facts: ['A small café near the station'], voice_profile: {}, portrait_visual_asset_id: null, created_at: NOW(), updated_at: NOW() }]);
    const [session] = f.h.db.seed('conversation_sessions', [{ id: crypto.randomUUID(), user_id: LEARNER, enrollment_id: enrollment.id, mission_id: null, scenario_id: null, character_id: CHARACTER_ID, target_variety_id: 'fr', source_language_code: enrollment.source_language_code, mode: 'push_to_talk', state: 'listening', pipeline: 'stt_llm_tts', speech_retention: 'none', scope: { kind: 'free' }, started_at: NOW(), updated_at: NOW(), created_at: NOW(), ended_at: null, turn_count: 0, last_seq: 0, objectives_completed: [], summary: null, revision: 0, rubric_outcomes: null }]);
    return session!.id as string;
  }
  const turnBody = (audio: unknown, over: DbRow = {}) => ({ clientTurnId: crypto.randomUUID(), input: { kind: 'audio', assetId: crypto.randomUUID(), durationMs: 1_400, transcriptHint: null }, audio, clientState: { state: 'listening', lastSeq: 0, lastCharacterTurnId: null }, bargeIn: false, ...over });
  const clip = { base64: TONE_WAV, mime: 'audio/wav', durationMs: 900 };

  it('refuses caller-supplied audio URLs (422) before anything is read, fetched or transcribed', async () => {
    f = await setup();
    const sessionId = seedSession(f.french);
    for (const url of ['https://attacker.example/big.wav', 'http://169.254.169.254/latest/meta-data', `${FAKE_OPENROUTER_BASE}/models`]) {
      const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody({ source: 'url', url, encoding: 'wav', sampleRateHz: null }) });
      expect(res.status, url).toBe(422);
      expect(res.json.error.code).toBe('validation_failed');
      expect(res.json.error.message).toContain('audio.source');
    }
    expect(f.h.openrouter.calls).toHaveLength(0);
    expect(f.h.blocked).toEqual([]);
    expect(f.h.db.rows('conversation_turns')).toHaveLength(0);
  });

  it('a hallucinated take: "I didn\'t hear you" — no learner turn, no character reply, no LLM/TTS call, no XP at the end', async () => {
    f = await setup();
    const sessionId = seedSession(f.french);
    f.h.openrouter.transcription = () => whisper("Merci d'avoir regardé !", 'fr');
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody(clip) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const parsed = TurnEnvelope.parse(res.json);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.data).toMatchObject({ speech: { speechDetected: false, reason: 'known_hallucination' }, characterTurn: null, learnerTranscript: null, evaluationPending: false, replayed: false });
    expect(f.h.openrouter.callsTo('/audio/transcriptions')).toHaveLength(1);
    expect(f.h.openrouter.callsTo('/chat/completions')).toHaveLength(0);
    expect(f.h.openrouter.callsTo('/audio/speech')).toHaveLength(0);
    expect(f.h.db.rows('conversation_turns')).toHaveLength(0);

    const end = await f.h.call(`/v1/ai/conversation/${sessionId}/end`, { token: f.token, body: { reason: 'learner_ended', clientState: { lastSeq: 0, turnCount: 0 }, clientEventId: crypto.randomUUID() } });
    expect(end.status, JSON.stringify(end.json)).toBe(200);
    expect(end.json.data.xpAwarded).toBe(0);
    await f.h.flush();
    expect(f.h.db.rows('xp_ledger')).toHaveLength(0);
    expect(f.h.db.rows('learning_observations')).toHaveLength(0);
  });

  it('a genuine take is transcribed once, recorded WITH its transcript, and answered by the character', async () => {
    f = await setup();
    const sessionId = seedSession(f.french);
    f.h.openrouter.transcription = () => whisper('Bonjour, je voudrais un café.', 'fr', { nsp: 0.04, lp: -0.25 });
    f.h.openrouter.chat = () => JSON.stringify({ text: 'Bonjour ! Un café, bien sûr. Sur place ou à emporter ?', transliteration: null, sourceGloss: null, expression: 'talking', respondsToCommand: null, tentativeObjectiveIds: [], endsConversation: false });
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody(clip) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.speech).toEqual({ speechDetected: true, reason: null });
    expect(res.json.data.learnerTranscript).toMatchObject({ text: 'Bonjour, je voudrais un café.' });
    expect(res.json.data.characterTurn).not.toBeNull();
    expect(f.h.openrouter.callsTo('/audio/transcriptions')).toHaveLength(1); // the pipeline does not transcribe it again
    const learnerRows = f.h.db.rows('conversation_turns').filter((t) => t.speaker === 'learner');
    expect(learnerRows).toEqual([expect.objectContaining({ text: 'Bonjour, je voudrais un café.', audio_asset_id: null })]);
    expect(isCreditedLearnerTurn(learnerRows[0] as never)).toBe(true);
  });

  it('a dropped leading credit line is screened once: the learner row keeps the genuine text and its confidence', async () => {
    f = await setup();
    const sessionId = seedSession(f.french);
    f.h.openrouter.transcription = () => LEADING_CREDIT_TAKE;
    f.h.openrouter.chat = () => JSON.stringify({ text: 'Bonjour ! Que puis-je vous servir ?', transliteration: null, sourceGloss: null, expression: 'talking', respondsToCommand: null, tentativeObjectiveIds: [], endsConversation: false });
    const res = await f.h.call(`/v1/ai/conversation/${sessionId}/turn`, { token: f.token, body: turnBody(clip) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.speech).toEqual({ speechDetected: true, reason: null });
    expect(res.json.data.learnerTranscript).toMatchObject({ text: 'Bonjour madame' });
    const learnerRows = f.h.db.rows('conversation_turns').filter((t) => t.speaker === 'learner');
    expect(learnerRows).toEqual([expect.objectContaining({ text: 'Bonjour madame', confidence: LEADING_CREDIT_KEPT_CONFIDENCE })]);
  });

  it('conversation XP never counts a learner row without text or command', () => {
    expect(isCreditedLearnerTurn({ speaker: 'learner', text: null, command: null })).toBe(false);
    expect(isCreditedLearnerTurn({ speaker: 'learner', text: '   ', command: null })).toBe(false);
    expect(isCreditedLearnerTurn({ speaker: 'learner', text: null, command: 'repeat' })).toBe(true);
    expect(isCreditedLearnerTurn({ speaker: 'learner', text: 'Bonjour', command: null })).toBe(true);
    expect(isCreditedLearnerTurn({ speaker: 'character', text: 'Bonjour !', command: null })).toBe(false);
  });
});
