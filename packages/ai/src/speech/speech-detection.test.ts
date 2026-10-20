/**
 * Non-speech / hallucination gate (device QA 2026-10-19 §6.1): Whisper turned ambient noise into "اشتركوا في القناة" /
 * "subscribe to the channel" and the lesson called it "partially understood". Offline only: fixtures shaped like
 * OpenRouter verbose_json responses behind a mocked fetch, and fake contract recognizers.
 */
import { describe, expect, it } from 'vitest';
import { PronunciationAssessmentSchema, type AudioInput, type SpeechRecognizer, type TranscriptResult } from '@langquest/contracts';
import { OpenRouterClient } from '../openrouter/client';
import { MemoryAiRequestSink } from '../reasoner';
import { jsonResponse, mockFetch, pcmFixture } from '../test-support/fakes';
import { bytesToBase64, pcm16ToWav } from '../util';
import { CompositeAssessor, ReferenceComparisonAssessor } from './pronunciation';
import {
  STRONG_HALLUCINATION_PHRASES,
  WEAK_HALLUCINATION_PHRASES,
  SPEECH_GATE_MODEL,
  applySpeechScreening,
  detectSpeech,
  measureWavLevels,
  normalizeForScreening,
  phraseCoverage,
  repetitionRatio,
  speechDetectionOf,
  type DetectorSegment,
  type ScreenedTranscriptResult,
} from './speech-detection';
import { OpenRouterSpeechRecognizer } from './stt';

const seg = (text: string, noSpeechProb: number | null = 0.02, avgLogprob: number | null = -0.2): DetectorSegment => ({ text, noSpeechProb, avgLogprob });
const one = (text: string, noSpeechProb: number | null = 0.02, avgLogprob: number | null = -0.2, extra: Partial<Parameters<typeof detectSpeech>[0]> = {}) => detectSpeech({ text, segments: [seg(text, noSpeechProb, avgLogprob)], ...extra });

/** 16-bit PCM sine (mono), `amplitude` in 0..1 of full scale. */
const tone = (ms: number, amplitude = 0.3, rate = 16_000): Uint8Array => {
  const n = Math.round((ms / 1000) * rate);
  const out = new Uint8Array(n * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < n; i += 1) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * amplitude * 32767), true);
  return out;
};
const wav = (pcm: Uint8Array): AudioInput => ({ source: 'inline', base64: bytesToBase64(pcm16ToWav(pcm, 16_000)), encoding: 'wav', sampleRateHz: 16_000 });
const m4a: AudioInput = { source: 'inline', base64: bytesToBase64(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32])), encoding: 'm4a', sampleRateHz: 44_100 };

/** OpenRouter verbose_json body (Whisper shape: segments with no_speech_prob / avg_logprob). */
const whisper = (language: string, segments: Array<{ text: string; nsp?: number; lp?: number }>, duration = 2.5) => ({
  text: segments.map((s) => s.text).join(' '),
  language,
  duration,
  usage: { seconds: duration, cost: 0.00002 },
  segments: segments.map((s, i) => ({ id: i, start: (i * duration) / segments.length, end: ((i + 1) * duration) / segments.length, text: s.text, avg_logprob: s.lp ?? -0.2, no_speech_prob: s.nsp ?? 0.02 })),
  words: [],
});

const sttWith = (body: unknown) => {
  const { fetchImpl, calls } = mockFetch([{ match: (u) => u.endsWith('/audio/transcriptions'), respond: () => jsonResponse(body) }]);
  const sink = new MemoryAiRequestSink();
  return { stt: new OpenRouterSpeechRecognizer({ client: new OpenRouterClient({ apiKey: 'k', fetch: fetchImpl, sleep: async () => {}, maxRetries: 0 }), sink }), calls, sink };
};

const contractRecognizer = (text: string, confidence: number | null = 0.9): SpeechRecognizer & { calls: number } => {
  const r = {
    calls: 0,
    provider: 'fake',
    supports: async (locale: string) => ({ supported: true, reasons: [], features: { word: true, phoneme: false, tone: false, prosody: false, streaming: false, interruptible: false, codeSwitch: true, multiSpeaker: false }, latencyClass: 'interactive' as const, effectiveLocale: locale, qualityEstimate: 0.5, provider: 'fake', notes: [] }),
    transcribe: async (_a: AudioInput, locale: string): Promise<TranscriptResult> => {
      r.calls += 1;
      return { text, segments: text ? [{ index: 0, text, startMs: 0, endMs: 1000, confidence, speakerLabel: null, language: null, words: [] }] : [], confidence, detectedLanguage: null, requestedLocale: locale, provider: 'fake', model: 'fake', durationMs: 1000, languageMismatch: false };
    },
  };
  return r;
};

const pronInput = (locale: string, variety: 'ary' | 'fr' | 'ja' | 'en', referenceText: string, audio: AudioInput = m4a) => ({ audio, targetVarietyId: variety, locale, referenceText, referencePhonemes: null, expressionId: null, requestedFeatures: ['word' as const] });

describe('phrase lists and normalisation', () => {
  it('normalises spelling, case, accents, punctuation and Arabic letter variants to one form', () => {
    expect(normalizeForScreening("Sous-titres réalisés par la communauté d'Amara.org")).toBe(normalizeForScreening('sous titres realises par la communaute d amara org'));
    expect(normalizeForScreening('اشتركوا في القناة!')).toBe(normalizeForScreening('اشتركوا في القناه'));
    expect(normalizeForScreening('أنا')).toBe(normalizeForScreening('انا'));
    expect(normalizeForScreening('ご視聴ありがとうございました。')).toBe(normalizeForScreening('ご視聴ありがとうございました'));
    expect(normalizeForScreening('...!?')).toBe('');
  });

  it('never lists a one-word answer: oui / non / yes / no / نعم / لا / はい / いいえ / sí / ja / 是 / 네 stay speech', () => {
    const lists = [...STRONG_HALLUCINATION_PHRASES, ...WEAK_HALLUCINATION_PHRASES].map((p) => normalizeForScreening(p.text));
    for (const word of ['oui', 'non', 'yes', 'no', 'نعم', 'لا', 'ايه', 'はい', 'いいえ', 'sí', 'ja', 'nein', 'да', 'нет', '是', '对', '네', 'ndiyo', 'ewe']) {
      expect(lists, word).not.toContain(normalizeForScreening(word));
      expect(phraseCoverage(word, lists.map((key) => ({ key, compact: key.replace(/\s+/g, '') }))).covered, word).toBe(false);
    }
    // Every entry is documented (language family, kind, provenance) and survives normalisation.
    for (const p of [...STRONG_HALLUCINATION_PHRASES, ...WEAK_HALLUCINATION_PHRASES]) {
      expect(normalizeForScreening(p.text), p.text).not.toBe('');
      expect(['observed', 'reported', 'pattern']).toContain(p.evidence);
    }
    expect(STRONG_HALLUCINATION_PHRASES.filter((p) => p.evidence === 'observed').map((p) => p.text)).toEqual(['اشتركوا في القناة', 'subscribe to the channel']);
  });
});

describe('detectSpeech: silence hallucinations by language family', () => {
  // Decoded confidently (good log-probability, low no-speech probability): only the phrase list catches them.
  const fixtures: Array<[string, string]> = [
    ['ar', 'اشتركوا في القناة'],
    ['ar', 'ترجمة نانسي قنقر'],
    ['ar', 'شكرا للمشاهدة'],
    ['fr', "Sous-titres réalisés par la communauté d'Amara.org"],
    ['fr', "Sous-titres réalisés para la communauté d'Amara.org"],
    ['fr', "Sous-titrage ST' 501"],
    ['fr', "Merci d'avoir regardé !"],
    ['en', 'Subscribe to the channel.'],
    ['en', 'Thanks for watching!'],
    ['en', 'Thank you for watching. Please subscribe.'],
    ['en', 'Subtitles by the Amara.org community'],
    ['ja', 'ご視聴ありがとうございました'],
    ['ja', 'ご視聴ありがとうございました。チャンネル登録お願いします。'],
    ['zh', '字幕由Amara.org社区提供'],
    ['zh', '请不吝点赞 订阅 转发 打赏支持明镜与点点栏目'],
    ['ko', 'MBC 뉴스 이덕영입니다.'],
    ['de', 'Untertitel im Auftrag des ZDF für funk, 2017'],
    ['ru', 'Субтитры сделал DimaTorzok'],
    ['es', 'Subtítulos realizados por la comunidad de Amara.org'],
    ['it', 'Sottotitoli a cura di QTSS'],
  ];
  for (const [lang, text] of fixtures) {
    it(`${lang}: "${text}" is a known hallucination, not speech`, () => {
      const r = one(text, 0.05, -0.15, { detectedLanguage: lang });
      expect(r).toMatchObject({ speechDetected: false, reason: 'known_hallucination', text: '' });
      expect(r.discardedText).toBe(text);
      expect(r.matchedPhrases.length).toBeGreaterThan(0);
    });
  }

  it('also without segments (models answering plain json)', () => {
    expect(detectSpeech({ text: 'ご視聴ありがとうございました', segments: [] })).toMatchObject({ speechDetected: false, reason: 'known_hallucination' });
    expect(detectSpeech({ text: 'اشتركوا في القناة', segments: [] })).toMatchObject({ speechDetected: false, reason: 'known_hallucination' });
    expect(detectSpeech({ text: 'はい', segments: [] })).toMatchObject({ speechDetected: true, text: 'はい' });
  });

  it('a subtitle-credit marker makes a whole segment a credit line', () => {
    expect(one('Traduction et sous-titrage : communauté Amara.org')).toMatchObject({ speechDetected: false, reason: 'known_hallucination' });
  });

  it('a phrase the learner was asked to say is never a hallucination (an English lesson line)', () => {
    expect(one('Thanks for watching!', 0.05, -0.15, { expectedText: 'Thanks for watching!' })).toMatchObject({ speechDetected: true, text: 'Thanks for watching!' });
  });
});

describe('detectSpeech: the recognizer’s own no-speech signals', () => {
  // Not the device-observed 12.7 s clip ("Parfaitement compris"): that take was decoded as text the meaning check
  // matched to the reference, so at least one segment had no_speech_prob ≤ 0.8 and this rule (unchanged since
  // 2026-10-14) kept it. That case is still open (no server-side level check for compressed audio).
  it('every segment above no_speech_prob 0.8 is silence, whatever its log-probability (a long take)', () => {
    const r = detectSpeech({ text: 'Bonjour.', segments: [seg('Bonjour.', 0.93, -0.3)], durationMs: 12_700 });
    expect(r).toMatchObject({ speechDetected: false, reason: 'no_speech_probability' });
    expect(r.signals).toMatchObject({ segments: 1, silentSegments: 1, maxNoSpeechProb: 0.93, durationMs: 12_700 });
  });

  it("Whisper's own rule: no_speech_prob > 0.6 with avg_logprob ≤ −1.0 is silence; a confident decode is kept", () => {
    expect(one('Bonjour.', 0.7, -1.3)).toMatchObject({ speechDetected: false, reason: 'no_speech_probability' });
    expect(one('Bonjour.', 0.7, -0.3)).toMatchObject({ speechDetected: true, text: 'Bonjour.' });
  });

  it('a silent trailing segment or an outro tacked onto real speech is dropped; the speech is kept', () => {
    const r = detectSpeech({ text: "Bonjour. Sous-titres réalisés par la communauté d'Amara.org", segments: [seg('Bonjour.'), seg("Sous-titres réalisés par la communauté d'Amara.org", 0.4, -0.5)] });
    expect(r).toMatchObject({ speechDetected: true, text: 'Bonjour.', droppedSegments: [1] });
    const silentTail = detectSpeech({ text: 'صباح الخير شكرا', segments: [seg('صباح الخير'), seg('شكرا', 0.95, -0.4)] });
    expect(silentTail).toMatchObject({ speechDetected: true, text: 'صباح الخير', droppedSegments: [1] });
  });

  it('annotations and empty output are their own reasons', () => {
    expect(one('[Musique]')).toMatchObject({ speechDetected: false, reason: 'non_speech_annotation' });
    expect(one('♪ ♪ ♪')).toMatchObject({ speechDetected: false, reason: 'non_speech_annotation' });
    expect(detectSpeech({ text: '', segments: [] })).toMatchObject({ speechDetected: false, reason: 'empty_transcript' });
    expect(detectSpeech({ text: ' ... ', segments: [] })).toMatchObject({ speechDetected: false, reason: 'empty_transcript' });
    expect(one('(rires) Bonjour')).toMatchObject({ speechDetected: true, text: 'Bonjour' });
  });
});

describe('detectSpeech: no false positives on genuine short answers', () => {
  for (const [text, lang] of [['Oui.', 'fr'], ['oui', 'fr'], ['نعم', 'ar'], ['لا', 'ar'], ['はい', 'ja'], ['Yes.', 'en'], ['No.', 'en'], ['Sí.', 'es'], ['Ndiyo', 'sw'], ['Wi', 'ht']] as const) {
    it(`"${text}" (${lang}) with ordinary recognizer signals is speech`, () => {
      expect(one(text, 0.08, -0.35, { detectedLanguage: lang })).toMatchObject({ speechDetected: true, reason: null, text });
    });
  }

  it('a short courtesy word is speech when clearly spoken, a hallucination only with acoustic support', () => {
    expect(one('Merci.', 0.03, -0.2)).toMatchObject({ speechDetected: true, text: 'Merci.' });
    expect(one('Thank you.', 0.04, -0.25)).toMatchObject({ speechDetected: true });
    expect(one('Merci.', 0.55, -0.4)).toMatchObject({ speechDetected: false, reason: 'known_hallucination' });
    expect(one('you', 0.1, -1.2)).toMatchObject({ speechDetected: false, reason: 'known_hallucination' });
    expect(one('شكرا', 0.1, -0.3, { client: { peakLevelDb: -44 } })).toMatchObject({ speechDetected: false, reason: 'known_hallucination' });
    // …and never when the learner was asked to say it.
    expect(one('Merci.', 0.55, -0.4, { expectedText: 'Merci' })).toMatchObject({ speechDetected: true, text: 'Merci.' });
  });

  it('repetition: a decoding loop with weak acoustics is flagged, a learner repeating a word is not', () => {
    const loop = 'je suis je suis je suis je suis je suis je suis je suis';
    expect(repetitionRatio(normalizeForScreening(loop))).toBeGreaterThanOrEqual(3);
    expect(repetitionRatio(normalizeForScreening('je voudrais un café s il vous plaît'))).toBeLessThan(1.5);
    expect(one(loop, 0.4, -0.5)).toMatchObject({ speechDetected: false, reason: 'repetition_loop' });
    expect(one(loop, 0.02, -0.1)).toMatchObject({ speechDetected: true });
    expect(one('non non non', 0.4, -0.5)).toMatchObject({ speechDetected: true, text: 'non non non' });
  });
});

describe('levels: client metering and PCM/WAV peak', () => {
  it('client metering at or below −50 dBFS is silence; louder metering decides nothing on its own', () => {
    expect(one('Bonjour', 0.02, -0.2, { client: { peakLevelDb: -62 } })).toMatchObject({ speechDetected: false, reason: 'client_silence' });
    expect(one('Bonjour', 0.02, -0.2, { client: { peakLevelDb: -30 } })).toMatchObject({ speechDetected: true });
    expect(one('Bonjour', 0.02, -0.2, { client: { peakLevelDb: null } })).toMatchObject({ speechDetected: true });
  });

  it('measures 16-bit PCM WAV peak/RMS and refuses to judge anything else', () => {
    const silent = measureWavLevels(pcm16ToWav(pcmFixture(500), 16_000));
    expect(silent).toEqual({ peakDbfs: -160, rmsDbfs: -160, durationMs: 500 });
    const loud = measureWavLevels(pcm16ToWav(tone(250, 0.5), 16_000));
    expect(loud?.peakDbfs).toBeCloseTo(-6, 0);
    expect(loud?.durationMs).toBe(250);
    expect(measureWavLevels(new TextEncoder().encode('RIFF0000WAVEfmt fake-audio-bytes'))).toBeNull();
    expect(measureWavLevels(new Uint8Array(64))).toBeNull();
  });
});

describe('OpenRouterSpeechRecognizer with learner screening', () => {
  it('blanks a hallucinated take, keeps the typed reason and logs the verdict (never the text) to ai_requests', async () => {
    const { stt, sink } = sttWith(whisper('ar', [{ text: 'اشتركوا في القناة', nsp: 0.12, lp: -0.3 }]));
    const res = await stt.transcribe(wav(tone(800)), 'ar-MA', { screening: 'learner', enrollmentId: 'enr-1' });
    expect(res).toMatchObject({ text: '', segments: [], confidence: null, detectedLanguage: null, languageMismatch: false });
    expect(res.speech).toMatchObject({ speechDetected: false, reason: 'known_hallucination', discardedText: 'اشتركوا في القناة' });
    expect(sink.records[0]?.redactedLog).toMatchObject({ speechDetected: false, noSpeechReason: 'known_hallucination', matchedPhrases: 1 });
    expect(JSON.stringify(sink.records[0]?.redactedLog)).not.toContain('القناة');
  });

  it('content transcription (default annotate mode) keeps its legacy text and only attaches the verdict', async () => {
    const { stt } = sttWith(whisper('en', [{ text: 'Thanks for watching!' }]));
    const res = await stt.transcribe(wav(tone(800)), 'en-US');
    expect(res.text).toBe('Thanks for watching!');
    expect(res.speech).toMatchObject({ speechDetected: false, reason: 'known_hallucination' });
    const legacy = sttWith(whisper('fr', [{ text: 'Bonjour', nsp: 0.9, lp: -0.2 }]));
    expect((await legacy.stt.transcribe(wav(tone(800)), 'fr-FR')).text).toBe(''); // unchanged: every segment > 0.8
  });

  it('answers a silent WAV or a client-silent take without calling the provider (no cost)', async () => {
    const silentWav = sttWith(whisper('fr', [{ text: 'Bonjour' }]));
    const res = await silentWav.stt.transcribe(wav(pcmFixture(1_000)), 'fr-FR', { screening: 'learner' });
    expect(res).toMatchObject({ text: '', model: SPEECH_GATE_MODEL, durationMs: 1_000 });
    expect(res.speech).toMatchObject({ speechDetected: false, reason: 'silent_audio' });
    expect(silentWav.calls).toHaveLength(0);
    expect(silentWav.sink.records).toHaveLength(0);
    // Content transcription is never short-circuited.
    await silentWav.stt.transcribe(wav(pcmFixture(1_000)), 'fr-FR');
    expect(silentWav.calls).toHaveLength(1);

    const client = sttWith(whisper('fr', [{ text: 'Bonjour' }]));
    const quiet = await client.stt.transcribe(m4a, 'fr-FR', { screening: 'learner', clientSignals: { peakLevelDb: -70 } });
    expect(quiet.speech).toMatchObject({ speechDetected: false, reason: 'client_silence' });
    expect(client.calls).toHaveLength(0);
  });

  it('keeps genuine speech and drops only the hallucinated tail segment', async () => {
    const { stt } = sttWith(whisper('fr', [{ text: 'Bonjour.' }, { text: "Sous-titres réalisés par la communauté d'Amara.org", nsp: 0.45, lp: -0.6 }]));
    const res = await stt.transcribe(wav(tone(800)), 'fr-FR', { screening: 'learner' });
    expect(res.text).toBe('Bonjour.');
    expect(res.segments.map((s) => s.text)).toEqual(['Bonjour.']);
    expect(res.speech).toMatchObject({ speechDetected: true, reason: null, droppedSegments: [1] });
    const short = sttWith(whisper('ja', [{ text: 'はい', nsp: 0.1, lp: -0.4 }], 0.6));
    expect((await short.stt.transcribe(wav(tone(600)), 'ja-JP', { screening: 'learner' })).text).toBe('はい');
  });
});

describe('ReferenceComparisonAssessor behind the gate', () => {
  const recognizerFor = (body: unknown) => sttWith(body);

  it('a hallucinated take is "nothing assessed": unavailable mode, no score, empty transcript with the verdict', async () => {
    const { stt } = recognizerFor(whisper('ar', [{ text: 'اشتركوا في القناة' }]));
    const result = await new ReferenceComparisonAssessor({ recognizer: stt }).assess(pronInput('ar-MA', 'ary', 'صباح الخير'));
    expect(result.pronunciation).toMatchObject({ assessmentMode: 'unavailable', numericScore: null, confidence: 'none', feedback: ['feedback.no_speech_detected'], wordScores: [] });
    expect(() => PronunciationAssessmentSchema.parse(result.pronunciation)).not.toThrow();
    expect(result.transcript?.text).toBe('');
    expect(speechDetectionOf(result.transcript)).toMatchObject({ speechDetected: false, reason: 'known_hallucination' });
  });

  it('screens transcripts from recognizers that do not screen themselves (contract fakes)', async () => {
    const fake = contractRecognizer("Sous-titres réalisés par la communauté d'Amara.org");
    const result = await new ReferenceComparisonAssessor({ recognizer: fake }).assess(pronInput('fr-FR', 'fr', 'Bonjour'));
    expect(result.pronunciation.assessmentMode).toBe('unavailable');
    expect((result.transcript as ScreenedTranscriptResult).speech).toMatchObject({ speechDetected: false, reason: 'known_hallucination' });
  });

  it('a genuine one-word answer is compared as before', async () => {
    const result = await new ReferenceComparisonAssessor({ recognizer: contractRecognizer('Oui', 0.9) }).assess(pronInput('fr-FR', 'fr', 'Oui'));
    expect(result.pronunciation).toMatchObject({ assessmentMode: 'reference-comparison', numericScore: null });
    expect(result.pronunciation.feedback).toContain('feedback.meaning_came_across');
    expect(result.transcript?.text).toBe('Oui');
  });

  it('the composite passes the client metering through: a silent take never reaches the recognizer', async () => {
    const { stt, calls } = recognizerFor(whisper('fr', [{ text: 'Bonjour' }]));
    const composite = new CompositeAssessor([], new ReferenceComparisonAssessor({ recognizer: stt }));
    const result = await composite.assess(pronInput('fr-FR', 'fr', 'Bonjour'), { clientSignals: { peakLevelDb: -75 } });
    expect(calls).toHaveLength(0);
    expect(speechDetectionOf(result.transcript)).toMatchObject({ speechDetected: false, reason: 'client_silence' });
  });
});

describe('a dropped LEADING segment (regression: the verdict was applied twice on every learner path)', () => {
  /**
   * The learner-mode recognizer applies its verdict, and every consumer (reference comparison, the speech and
   * conversation routes) applies `speechDetectionOf(heard)` again. `droppedSegments` index the recognizer's original
   * segments, so a second pass over the already-reduced list removed a genuine segment whenever a dropped one was not
   * the last (confidence 0.247 instead of 0.576, word list cut, feedback "unclear recording").
   */
  const take = (lead: { text: string; nsp: number; lp: number }) => ({
    text: `${lead.text} Bonjour madame`,
    language: 'fr',
    duration: 3,
    usage: { seconds: 3, cost: 0.00002 },
    segments: [
      { id: 0, start: 0, end: 1, text: lead.text, avg_logprob: lead.lp, no_speech_prob: lead.nsp },
      { id: 1, start: 1, end: 2, text: 'Bonjour', avg_logprob: -0.1, no_speech_prob: 0.05 },
      { id: 2, start: 2, end: 3, text: 'madame', avg_logprob: -1.4, no_speech_prob: 0.05 },
    ],
    words: [
      { word: 'Sous-titres', start: 0.1, end: 0.5 },
      { word: 'Bonjour', start: 1.1, end: 1.5 },
      { word: 'madame', start: 2.1, end: 2.5 },
    ],
  });
  // mean(exp(-0.1), exp(-1.4)) over the two kept segments
  const keptConfidence = Math.round(((Math.exp(-0.1) + Math.exp(-1.4)) / 2) * 1000) / 1000;
  const leads = [
    ['a subtitle-credit line', { text: "Sous-titres réalisés par la communauté d'Amara.org", nsp: 0.05, lp: -0.2 }],
    ['a silent segment', { text: 'Merci.', nsp: 0.95, lp: -0.3 }],
  ] as const;

  for (const [label, lead] of leads) {
    it(`${label} at index 0 of 3: the recognizer + reference comparison keep both genuine segments, their confidence and words`, async () => {
      expect(keptConfidence).toBe(0.576);
      const { stt } = sttWith(take(lead));
      const result = await new ReferenceComparisonAssessor({ recognizer: stt }).assess(pronInput('fr-FR', 'fr', 'Bonjour madame', wav(tone(900))));
      expect(result.transcript).toMatchObject({ text: 'Bonjour madame', confidence: keptConfidence });
      expect(result.transcript?.segments.map((s) => s.text)).toEqual(['Bonjour', 'madame']);
      expect(result.pronunciation.wordScores.map((w) => w.word)).toEqual(['Bonjour', 'madame']);
      expect(result.pronunciation.feedback[0]).toBe('feedback.meaning_came_across');
      expect(result.pronunciation.feedback).not.toContain('feedback.unclear_recording_retry');
      expect(speechDetectionOf(result.transcript)).toMatchObject({ speechDetected: true, droppedSegments: [0] });
    });
  }

  it('applySpeechScreening is idempotent for the verdict it applied, and still screens an annotate-mode transcript', async () => {
    const learner = await sttWith(take(leads[0][1])).stt.transcribe(wav(tone(900)), 'fr-FR', { screening: 'learner' });
    const verdict = speechDetectionOf(learner);
    const again = applySpeechScreening(learner, verdict);
    expect(again).toBe(learner);
    expect(again.segments.map((s) => s.text)).toEqual(['Bonjour', 'madame']);
    expect(again.confidence).toBe(keptConfidence);

    // Annotate mode attaches the same kind of verdict WITHOUT reducing the transcript: applying it must reduce it once.
    const annotated = await sttWith(take(leads[0][1])).stt.transcribe(wav(tone(900)), 'fr-FR');
    expect(annotated.segments).toHaveLength(3);
    const screened = applySpeechScreening(annotated, speechDetectionOf(annotated));
    expect(screened.segments.map((s) => s.text)).toEqual(['Bonjour', 'madame']);
    expect(screened.confidence).toBe(keptConfidence);
    expect(applySpeechScreening(screened, speechDetectionOf(screened))).toBe(screened);
  });
});
