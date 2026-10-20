/**
 * One outcome vocabulary for graded speech (HANDOFF §9 item 5). The server recorded a low-confidence recognition as an
 * `unclear` observation while answering `intelligibility: 'partially_understood'`, and mobile turned every
 * `partially_understood` into a `partial` step outcome — credit the server never gave. The canonical mapping is now
 * `speechObservationOutcome` in `@langquest/contracts`: the route records it AND returns it as `outcome`, so a client
 * reports exactly what the server recorded.
 *
 * Through the REAL app and `@langquest/ai` adapters with the offline fakes of `route-fixtures` (nothing leaves the process).
 */
import { bytesToBase64, pcm16ToWav } from '@langquest/ai/util';
import { INTELLIGIBILITY_VALUES, OBSERVATION_OUTCOME_VALUES, PronunciationAssessResponseSchema, SpeechEvaluationResultSchema, apiEnvelope, speechObservationOutcome, type Intelligibility } from '@langquest/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { enrollmentRow, profileRow, routeHarness, type DbRow, type RouteHarness, type ScriptedResponse } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const NOW = () => new Date().toISOString();

const tone = (ms: number, amplitude = 0.3, rate = 16_000): Uint8Array => {
  const n = Math.round((ms / 1000) * rate);
  const out = new Uint8Array(n * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < n; i += 1) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * amplitude * 32767), true);
  return out;
};
const TONE_WAV = bytesToBase64(pcm16ToWav(tone(900), 16_000));

const whisper = (text: string, o: { nsp?: number; lp?: number } = {}): ScriptedResponse => ({
  status: 200,
  body: { text, language: 'fr', duration: 1.4, segments: [{ id: 0, start: 0, end: 1.4, text, avg_logprob: o.lp ?? -0.2, no_speech_prob: o.nsp ?? 0.03 }], words: [], usage: { seconds: 1.4, cost: 0.0001 } },
});
const expression = (text: string): DbRow => ({ id: crypto.randomUUID(), target_variety_id: 'fr', canonical_text: text, state: 'published', intent_id: 'greet', origin: 'authored', register: 'neutral', difficulty: 1, reviewed: true, reviewer_id: null, scenario_tags: [], phonetic_annotations: {}, script_annotations: {}, content_rights_id: null, created_at: NOW(), updated_at: NOW() });

const AssessEnvelope = apiEnvelope(PronunciationAssessResponseSchema);

describe('contracts: speechObservationOutcome is the canonical vocabulary', () => {
  it('maps every intelligibility value; partially_understood is never "partial" credit', () => {
    const table: Array<[Intelligibility, boolean, boolean | undefined, string]> = [
      ['understood', true, false, 'success'],
      ['partially_understood', false, true, 'unclear'], // the recognizer was unsure: never credited, never blamed
      ['partially_understood', false, false, 'fail'], // partial word overlap: the meaning did not come across
      ['partially_understood', false, undefined, 'fail'], // an older response without `outcome`
      ['not_understood', false, false, 'fail'],
      ['no_speech_detected', false, undefined, 'unclear'],
      ['understood', false, false, 'fail'], // never success without the server's meaning match
    ];
    for (const [intelligibility, semanticIntentMatched, needsClarification, expected] of table) {
      expect(speechObservationOutcome({ intelligibility, semanticIntentMatched, needsClarification }), `${intelligibility}/${semanticIntentMatched}/${needsClarification}`).toBe(expected);
    }
    const produced = new Set(INTELLIGIBILITY_VALUES.flatMap((i) => [true, false].flatMap((m) => [true, false, undefined].map((n) => speechObservationOutcome({ intelligibility: i, semanticIntentMatched: m, needsClarification: n })))));
    expect([...produced].sort()).toEqual(['fail', 'success', 'unclear']);
    expect(OBSERVATION_OUTCOME_VALUES).toContain('partial'); // still a valid outcome (acoustic pronunciation scores), just never from this mapping
  });

  it('the response field is optional and additive (older clients and servers keep parsing)', () => {
    const base = { assessmentId: crypto.randomUUID(), targetVarietyId: 'fr', semanticIntentMatched: false, meaningConfidence: 0, intelligibility: 'no_speech_detected', pronunciation: { assessmentMode: 'unavailable', numericScore: null, confidence: 'none', feedback: [], featuresAssessed: [], wordScores: [], phonemeHints: [], toneHints: [], highlightedSegment: null, provider: null, scorerVersion: null }, shouldAdvanceConversation: false, transcript: null, matchedIntentIds: [] };
    expect(SpeechEvaluationResultSchema.safeParse(base).success).toBe(true);
    expect(SpeechEvaluationResultSchema.safeParse({ ...base, outcome: 'unclear' }).success).toBe(true);
    expect(SpeechEvaluationResultSchema.safeParse({ ...base, outcome: 'understood' }).success).toBe(false);
  });
});

describe('POST /v1/speech/pronunciation-assess returns the outcome it recorded', () => {
  let h: RouteHarness;
  afterEach(() => h.restore());

  async function setup(): Promise<{ token: string; enrollment: DbRow }> {
    h = routeHarness({ openRouter: true });
    h.db.seed('profiles', [profileRow(LEARNER)]);
    const [enrollment] = h.db.seed('user_course_enrollments', [enrollmentRow(LEARNER, 'french', { source_language_code: 'en' })]);
    h.db.seed('expressions', [expression('Bonjour'), expression('Je voudrais un café')]);
    return { token: await h.token(LEARNER), enrollment: enrollment! };
  }
  const assess = (token: string, enrollment: DbRow, referenceText: string) =>
    h.call('/v1/speech/pronunciation-assess', { token, body: { enrollmentId: enrollment.id, targetVarietyId: 'fr', referenceText, audio: { source: 'inline', base64: TONE_WAV, encoding: 'wav', sampleRateHz: 16_000 }, clientRequestId: crypto.randomUUID(), scenarioId: 'lesson-greetings' } });
  const recorded = async () => {
    await h.flush();
    return h.db.rows('learning_observations').map((o) => o.outcome);
  };

  it('understood → success, returned and recorded', async () => {
    const { token, enrollment } = await setup();
    h.openrouter.transcription = () => whisper('Bonjour', { lp: -0.1 });
    const res = await assess(token, enrollment, 'Bonjour');
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const parsed = AssessEnvelope.parse(res.json);
    if (!parsed.ok) throw new Error('expected an ok envelope');
    expect(parsed.data).toMatchObject({ intelligibility: 'understood', semanticIntentMatched: true, outcome: 'success' });
    expect(await recorded()).toEqual(['success']);
  });

  it('a low-confidence recognition says "partially understood" but its outcome is unclear (no credit, no blame), with no judge call', async () => {
    const { token, enrollment } = await setup();
    // exp(−1.6) ≈ 0.20, under the meaning matcher's 0.35 STT-confidence floor; the segment is not silent (nsp 0.03).
    h.openrouter.transcription = () => whisper('Je voudrais un thé.', { lp: -1.6 });
    const res = await assess(token, enrollment, 'Je voudrais un café');
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toMatchObject({ intelligibility: 'partially_understood', semanticIntentMatched: false, shouldAdvanceConversation: false, outcome: 'unclear' });
    expect(h.openrouter.callsTo('/chat/completions')).toHaveLength(0);
    expect(await recorded()).toEqual(['unclear']);
  });

  it('partial word overlap the judge did not accept: "partially understood", outcome fail (never partial credit)', async () => {
    const { token, enrollment } = await setup();
    h.openrouter.transcription = () => whisper('Je voudrais un thé.');
    h.openrouter.chat = () => JSON.stringify({ matched: false, confidence: 0.9, matchedIntentIds: [], paraphrase: false, reason: 'Un thé, pas un café.' });
    const res = await assess(token, enrollment, 'Je voudrais un café');
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ intelligibility: 'partially_understood', semanticIntentMatched: false, outcome: 'fail' });
    expect(await recorded()).toEqual(['fail']);
  });

  it('no speech → outcome unclear, nothing recorded and no judge call', async () => {
    const { token, enrollment } = await setup();
    h.openrouter.transcription = () => whisper("Sous-titres réalisés par la communauté d'Amara.org", { nsp: 0.3, lp: -0.4 });
    const res = await assess(token, enrollment, 'Bonjour');
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ intelligibility: 'no_speech_detected', semanticIntentMatched: false, outcome: 'unclear', transcript: null });
    expect(h.openrouter.callsTo('/chat/completions')).toHaveLength(0);
    expect(await recorded()).toEqual([]);
  });

  it('every graded response carries the outcome, and it is the one the observation recorded', async () => {
    const { token, enrollment } = await setup();
    const cases: Array<[ScriptedResponse, string]> = [
      [whisper('Bonjour'), 'Bonjour'],
      [whisper('Je voudrais un thé.', { lp: -1.6 }), 'Je voudrais un café'],
    ];
    for (const [take, reference] of cases) {
      h.openrouter.transcription = () => take;
      const before = h.db.rows('learning_observations').length;
      const res = await assess(token, enrollment, reference);
      await h.flush();
      const added = h.db.rows('learning_observations').slice(before);
      expect(added).toHaveLength(1);
      expect(res.json.data.outcome).toBe(added[0]!.outcome);
    }
  });
});
