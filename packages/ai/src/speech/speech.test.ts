import { describe, expect, it } from 'vitest';
import { PronunciationAssessmentSchema, tracksForVariety, type AudioInput, type SpeechRecognizer, type TranscriptResult, VARIETY_IDS } from '@langquest/contracts';
import { resolveVariety } from '../capability/registry';
import { AiProviderUnavailableError } from '../errors';
import { OpenRouterClient } from '../openrouter/client';
import { MemoryAiRequestSink } from '../reasoner';
import { jsonResponse, mockFetch, pcmFixture } from '../test-support/fakes';
import { base64ToBytes, bytesToBase64, pcm16ToWav } from '../util';
import { resolveAudioBytes } from './audio-input';
import { AzurePronunciationAssessor, CompositeAssessor, ReferenceComparisonAssessor, azureLocaleForVariety, mapAzureResponse, type AzureDetailedResponse } from './pronunciation';
import { OpenRouterSpeechRecognizer, effectiveLanguageHint, toTranscriptResult } from './stt';
import { OpenRouterSpeechSynthesizer, ttsCacheKey } from './tts';
import { VOICE_REGISTRY, defaultVoiceFor, findVoice, voicesForVariety } from './voices';

const inline = (bytes: Uint8Array, encoding: AudioInput['encoding'] = 'wav', sampleRateHz: number | null = 16_000): AudioInput => ({ source: 'inline', base64: bytesToBase64(bytes), encoding, sampleRateHz });

const whisperBody = (text: string, language: string) => ({ text, language, duration: 2.5, usage: { seconds: 2.5, cost: 0.00002 }, segments: [{ id: 0, start: 0, end: 2.5, text, avg_logprob: -0.1, no_speech_prob: 0.01 }], words: text.split(' ').map((w, i) => ({ word: w, start: i * 0.5, end: i * 0.5 + 0.4 })) });

const makeClient = (routes: Parameters<typeof mockFetch>[0]) => {
  const { fetchImpl, calls } = mockFetch(routes);
  return { client: new OpenRouterClient({ apiKey: 'k', fetch: fetchImpl, sleep: async () => {}, maxRetries: 0 }), calls };
};

describe('audio input resolution', () => {
  it('wraps raw pcm16 in a wav container and maps encodings to provider formats', async () => {
    const r = await resolveAudioBytes(inline(pcmFixture(100), 'pcm16', 16_000));
    expect(r.format).toBe('wav');
    expect(r.bytes.byteLength).toBe(3200 + 44);
    expect((await resolveAudioBytes(inline(new Uint8Array([1]), 'webm_opus', null))).format).toBe('webm');
    await expect(resolveAudioBytes({ source: 'asset', assetId: '55555555-5555-4555-8555-555555555555', encoding: 'mp3', sampleRateHz: null })).rejects.toThrow(/AudioAssetResolver/);
  });
});

describe('OpenRouterSpeechRecognizer', () => {
  it('answers supports() from the matrix and refuses unknown locales', async () => {
    const { client } = makeClient([]);
    const stt = new OpenRouterSpeechRecognizer({ client });
    expect((await stt.supports('ar-MA')).supported).toBe(true);
    expect((await stt.supports('ar-MA')).reasons).toEqual(['not_benchmarked']);
    expect((await stt.supports('rw-RW')).supported).toBe(true);
    expect((await stt.supports('es')).supported).toBe(false);
    expect((await stt.supports('fr-FR', 'video/mp4')).reasons).toContain('audio_format_unsupported');
    expect(stt.modelsFor('rw')[0]).toBe('elevenlabs/scribe-v2');
  });

  it('sends the language hint, maps verbose_json to TranscriptResult and records telemetry', async () => {
    const { client, calls } = makeClient([{ match: (u) => u.endsWith('/audio/transcriptions'), respond: () => jsonResponse(whisperBody('صباح الخير لاباس عليك', 'ar')) }]);
    const sink = new MemoryAiRequestSink();
    const stt = new OpenRouterSpeechRecognizer({ client, sink });
    const res = await stt.transcribe(inline(pcm16ToWav(pcmFixture(200), 16_000)), 'ar-MA', { traceId: 't1' });
    expect(calls[0]?.body).toMatchObject({ model: 'openai/whisper-large-v3', language: 'ar', response_format: 'verbose_json' });
    expect(res.text).toBe('صباح الخير لاباس عليك');
    expect(res.requestedLocale).toBe('ar-MA');
    expect(res.languageMismatch).toBe(false);
    expect(res.segments[0]?.words).toHaveLength(4);
    expect(res.confidence).toBeCloseTo(Math.exp(-0.1), 3);
    expect(sink.records[0]).toMatchObject({ task: 'speech_recognition', success: true, audioSeconds: 2.5, traceId: 't1' });
  });

  it('omits the language hint with languageHint "auto" (code-switched audio) and sends explicit hints verbatim', async () => {
    const { client, calls } = makeClient([{ match: (u) => u.endsWith('/audio/transcriptions'), respond: () => jsonResponse(whisperBody('je veux un café s\'il vous plaît', 'fr')) }]);
    const sink = new MemoryAiRequestSink();
    const stt = new OpenRouterSpeechRecognizer({ client, sink });
    const res = await stt.transcribe(inline(pcm16ToWav(pcmFixture(200), 16_000)), 'ar-MA', { traceId: 't-auto', languageHint: 'auto' });
    expect(calls[0]?.body).not.toHaveProperty('language');
    expect(res.detectedLanguage?.code).toBe('fr');
    expect(res.languageMismatch).toBe(true); // honest: detected language differs from the requested variety
    expect(sink.records[0]?.redactedLog).toMatchObject({ languageHint: null });
    await stt.transcribe(inline(pcm16ToWav(pcmFixture(200), 16_000)), 'ar-MA', { languageHint: 'fr' });
    expect(calls[1]?.body).toMatchObject({ language: 'fr' });
    await stt.transcribe(inline(pcm16ToWav(pcmFixture(200), 16_000)), 'ar-MA');
    expect(calls[2]?.body).toMatchObject({ language: 'ar' });
    // Adapter-level default policy, overridable per call.
    const autoStt = new OpenRouterSpeechRecognizer({ client, languageHint: 'auto' });
    await autoStt.transcribe(inline(pcm16ToWav(pcmFixture(200), 16_000)), 'ar-MA');
    expect(calls[3]?.body).not.toHaveProperty('language');
    await autoStt.transcribe(inline(pcm16ToWav(pcmFixture(200), 16_000)), 'ar-MA', { languageHint: 'matrix' });
    expect(calls[4]?.body).toMatchObject({ language: 'ar' });
    expect(effectiveLanguageHint('yue', undefined)).toBe('yue');
    expect(effectiveLanguageHint('yue', 'auto')).toBeNull();
    const notes = (await autoStt.supports('ar-MA')).notes.join('\n');
    expect(notes).toMatch(/languageHint=auto \(policy=auto\)/);
    expect(notes).toMatch(/codeSwitch: pass languageHint "auto"/);
    expect((await stt.supports('ar-MA')).notes.join('\n')).toMatch(/languageHint=ar \(policy=matrix\)/);
  });

  it('writes injected attribution (learner id, DB profile id) to ai_requests and stays pseudonymous by default', async () => {
    const { client } = makeClient([{ match: (u) => u.endsWith('/audio/transcriptions'), respond: () => jsonResponse(whisperBody('salut', 'fr')) }]);
    const sink = new MemoryAiRequestSink();
    const anonymous = new OpenRouterSpeechRecognizer({ client, sink });
    await anonymous.transcribe(inline(pcm16ToWav(pcmFixture(200), 16_000)), 'fr-FR', { enrollmentId: 'enr-1' });
    expect(sink.records[0]).toMatchObject({ userId: null, profileId: null, enrollmentId: 'enr-1' });
    const attributed = new OpenRouterSpeechRecognizer({ client, sink, attribution: () => ({ userId: 'user-1', profileId: '99999999-9999-4999-8999-999999999999', enrollmentId: 'enr-2' }) });
    await attributed.transcribe(inline(pcm16ToWav(pcmFixture(200), 16_000)), 'fr-FR');
    expect(sink.records[1]).toMatchObject({ userId: 'user-1', profileId: '99999999-9999-4999-8999-999999999999', enrollmentId: 'enr-2' });
    await attributed.transcribe(inline(pcm16ToWav(pcmFixture(200), 16_000)), 'fr-FR', { attribution: { profileId: null }, enrollmentId: 'enr-3' });
    expect(sink.records[2]).toMatchObject({ userId: 'user-1', profileId: null, enrollmentId: 'enr-3' });
  });

  it('falls through the model chain when a model is rejected, and retries plain json on verbose_json rejection', async () => {
    let n = 0;
    const { client, calls } = makeClient([
      {
        match: (u) => u.endsWith('/audio/transcriptions'),
        respond: () => {
          n += 1;
          if (n === 1) return jsonResponse({ error: { message: 'openai/whisper-large-v3 is not a valid model ID', code: 400 } }, 400);
          if (n === 2) return jsonResponse({ error: { message: 'response_format verbose_json is not supported by this model', code: 400 } }, 400);
          return jsonResponse({ text: 'Bonjour' });
        },
      },
    ]);
    const stt = new OpenRouterSpeechRecognizer({ client });
    const res = await stt.transcribe(inline(pcm16ToWav(pcmFixture(100), 16_000)), 'fr-FR');
    expect(res.model).toBe('elevenlabs/scribe-v2');
    expect(calls).toHaveLength(3);
    expect((calls[2]?.body as Record<string, unknown>).response_format).toBe('json');
  });

  it('surfaces an exhausted operator balance (402) as provider_unavailable without credits wording', async () => {
    const { client, calls } = makeClient([{ match: (u) => u.endsWith('/audio/transcriptions'), respond: () => jsonResponse({ error: { message: 'Insufficient credits. Add more credits and retry.', code: 402 } }, 402) }]);
    const sink = new MemoryAiRequestSink();
    const stt = new OpenRouterSpeechRecognizer({ client, sink });
    const err = await stt.transcribe(inline(pcm16ToWav(pcmFixture(100), 16_000)), 'fr-FR').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderUnavailableError);
    expect(err).toMatchObject({ code: 'provider_unavailable', providerErrorKind: 'insufficient_credits' });
    expect((err as Error).message).not.toMatch(/credit/i);
    expect(calls).toHaveLength(1); // account-level failure: the model chain is not retried
    expect(sink.records[0]).toMatchObject({ task: 'speech_recognition', success: false, errorCode: 'insufficient_credits' });
  });

  it('flags a language mismatch for Cantonese vs Mandarin detections', () => {
    const base = { requestId: 'r', model: 'm', text: '你好', language: 'zh', durationSeconds: 1, confidence: null, segments: [], words: [], usage: { seconds: 1, inputTokens: null, outputTokens: null, reportedCostUsd: null }, estimatedCostUsd: null, latencyMs: 1 };
    expect(toTranscriptResult(base, 'yue', 'zh-HK', 'openrouter').languageMismatch).toBe(true);
    expect(toTranscriptResult({ ...base, language: 'yue' }, 'yue', 'zh-HK', 'openrouter').languageMismatch).toBe(false);
    expect(toTranscriptResult({ ...base, language: 'ar' }, 'ary', 'ar-MA', 'openrouter').languageMismatch).toBe(false);
    expect(toTranscriptResult({ ...base, language: 'fr' }, 'ht', 'ht-HT', 'openrouter').languageMismatch).toBe(true);
  });
});

describe('voice registry + synthesizer', () => {
  it('has an explicit entry (voices or unsupported) for every variety, all synthetic', () => {
    for (const v of VARIETY_IDS) {
      const entry = VOICE_REGISTRY[v];
      expect(entry === 'unsupported' || entry.length > 0).toBe(true);
      for (const voice of voicesForVariety(v)) {
        expect(voice.synthetic).toBe(true);
        expect(voice.varietyId).toBe(v);
        // The declared locale must denote the voice's own variety (no MSA/Egyptian locale under a Levantine or Darija voice).
        expect(resolveVariety(voice.locale), `${voice.voiceId} locale ${voice.locale}`).toBe(v);
        if (voice.model.startsWith('google/')) expect(voice.responseFormat).toBe('pcm');
      }
    }
    expect(VOICE_REGISTRY.rw).toBe('unsupported');
    expect(VOICE_REGISTRY.ln).toBe('unsupported');
    expect(defaultVoiceFor('fr', 'FR')?.status).toBe('verified');
    expect(defaultVoiceFor('en', 'GB')?.locale).toBe('en-GB');
    expect(findVoice('pt-pt-m-1')?.providerVoice).toBe('pt-PT-Rui:MAI-Voice-2.1-Flash');
  });

  it('serves every variety with voices through its own locale (Levantine, Darija and MSA included)', async () => {
    const { client } = makeClient([]);
    const tts = new OpenRouterSpeechSynthesizer({ client });
    for (const v of VARIETY_IDS) {
      const track = tracksForVariety(v)[0]!;
      for (const voice of voicesForVariety(v)) {
        const cap = await tts.supports(track.defaultLocale, voice.voiceId);
        expect(cap.supported, `${voice.voiceId} for ${track.defaultLocale}`).toBe(true);
        expect(cap.reasons).not.toContain('variety_boundary');
        expect(resolveVariety(cap.effectiveLocale ?? '')).toBe(v);
      }
    }
    expect(await tts.supports('ar-SY')).toMatchObject({ supported: true, effectiveLocale: 'ar-SY' });
    expect(await tts.supports('ar-LB')).toMatchObject({ supported: true, effectiveLocale: 'ar-SY' });
    expect(await tts.supports('ar-MA', 'ary-m-1')).toMatchObject({ supported: true, effectiveLocale: 'ar-MA' });
    expect(await tts.supports('ar', 'arb-f-1')).toMatchObject({ supported: true, effectiveLocale: 'ar' });
    expect((await tts.supports('ar-SY', 'arb-f-1')).reasons).toContain('variety_boundary');
    expect((await tts.supports('ar-MA', 'arb-m-1')).reasons).toContain('variety_boundary');
  });

  it('refuses cross-variety voices and unsupported varieties', async () => {
    const { client } = makeClient([]);
    const tts = new OpenRouterSpeechSynthesizer({ client });
    expect((await tts.supports('ar-MA', 'arz-f-1')).reasons).toContain('variety_boundary');
    expect((await tts.supports('ht-HT', 'fr-fr-f-1')).reasons).toContain('variety_boundary');
    expect((await tts.supports('rw-RW')).supported).toBe(false);
    expect((await tts.supports('ln-CD')).supported).toBe(false);
    expect((await tts.supports('pt-PT')).effectiveLocale).toBe('pt-PT');
    expect((await tts.supports('pt-PT', 'pt-br-f-1')).supported).toBe(false);
    await expect(tts.synthesize('Bonjou', 'ht-HT', 'fr-fr-f-1')).rejects.toMatchObject({ code: 'capability_unsupported' });
  });

  it('synthesises pcm, computes duration, caches shared approved content only', async () => {
    let n = 0;
    const { client, calls } = makeClient([{ match: (u) => u.endsWith('/audio/speech'), respond: () => (n += 1, new Response(new Uint8Array(48_000), { status: 200, headers: { 'content-type': 'audio/pcm;rate=24000;channels=1' } })) }]);
    const store = new Map<string, Awaited<ReturnType<OpenRouterSpeechSynthesizer['synthesize']>>>();
    const sink = new MemoryAiRequestSink();
    const tts = new OpenRouterSpeechSynthesizer({ client, sink, cache: { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) } });
    const out = await tts.synthesize('صباح الخير', 'ar-MA', 'ary-f-1', { cacheScope: 'shared_approved', rate: 0.75 });
    expect(calls[0]?.body).toMatchObject({ model: 'google/gemini-3.8-flash-lite-tts', voice: 'Kore', response_format: 'pcm' });
    expect(String((calls[0]?.body as Record<string, unknown>).instructions)).toMatch(/Darija/);
    expect(String((calls[0]?.body as Record<string, unknown>).instructions)).toMatch(/slowly/);
    expect((calls[0]?.body as Record<string, unknown>).speed).toBeUndefined();
    expect(out).toMatchObject({ encoding: 'pcm16', sampleRateHz: 24_000, durationMs: 1000, synthetic: true, cached: false, voiceId: 'ary-f-1', provider: 'openrouter' });
    expect(sink.records[0]).toMatchObject({ task: 'speech_synthesis', success: true, inputTokens: 10, userId: null, profileId: null });
    const attributedTts = new OpenRouterSpeechSynthesizer({ client, sink, attribution: { userId: 'user-9', enrollmentId: 'enr-9' } });
    await attributedTts.synthesize('مرحبا', 'ar-MA', 'ary-f-1', { attribution: { profileId: '12121212-1212-4121-8121-121212121212' } });
    expect(sink.records[1]).toMatchObject({ task: 'speech_synthesis', userId: 'user-9', enrollmentId: 'enr-9', profileId: '12121212-1212-4121-8121-121212121212' });
    n = 1;
    const again = await tts.synthesize('صباح الخير', 'ar-MA', 'ary-f-1', { cacheScope: 'shared_approved', rate: 0.75 });
    expect(again.cached).toBe(true);
    expect(n).toBe(1);
    await tts.synthesize('صباح الخير', 'ar-MA', 'ary-f-1'); // learner-personal scope: no cache
    expect(n).toBe(2);
  });

  it('surfaces an exhausted operator balance (402) as provider_unavailable without credits wording', async () => {
    const { client } = makeClient([{ match: (u) => u.endsWith('/audio/speech'), respond: () => jsonResponse({ error: { message: 'Insufficient credits. Add more credits and retry.', code: 402 } }, 402) }]);
    const sink = new MemoryAiRequestSink();
    const tts = new OpenRouterSpeechSynthesizer({ client, sink });
    const err = await tts.synthesize('Bonjour', 'fr-FR', 'fr-fr-f-2').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderUnavailableError);
    expect(err).toMatchObject({ code: 'provider_unavailable', providerErrorKind: 'insufficient_credits' });
    expect((err as Error).message).not.toMatch(/credit/i);
    expect(sink.records[0]).toMatchObject({ task: 'speech_synthesis', success: false, errorCode: 'insufficient_credits' });
  });

  it('cache keys depend on text, voice and rate', async () => {
    const a = await ttsCacheKey({ text: 'Bonjour  le monde', voiceId: 'fr-fr-f-2', rate: 1 });
    expect(a).toBe(await ttsCacheKey({ text: 'Bonjour le monde ', voiceId: 'fr-fr-f-2' }));
    expect(a).not.toBe(await ttsCacheKey({ text: 'Bonjour le monde', voiceId: 'fr-fr-f-2', rate: 0.75 }));
    expect(a).not.toBe(await ttsCacheKey({ text: 'Bonjour le monde', voiceId: 'fr-fr-m-1' }));
    expect(a).toMatch(/^v1:[a-f0-9]{64}$/);
  });
});

const fakeRecognizer = (text: string, confidence: number | null = 0.9, languageMismatch = false): SpeechRecognizer => ({
  provider: 'fake',
  supports: async (locale) => ({ supported: locale !== 'es', reasons: [], features: { word: true, phoneme: false, tone: false, prosody: false, streaming: false, interruptible: false, codeSwitch: true, multiSpeaker: false }, latencyClass: 'interactive', effectiveLocale: locale, qualityEstimate: 0.5, provider: 'fake', notes: [] }),
  transcribe: async (_a, locale): Promise<TranscriptResult> => ({ text, segments: [{ index: 0, text, startMs: 0, endMs: 1000, confidence, speakerLabel: null, language: null, words: text.split(' ').map((w, i) => ({ text: w, startMs: i * 100, endMs: i * 100 + 80, confidence: null })) }], confidence, detectedLanguage: null, requestedLocale: locale, provider: 'fake', model: 'fake', durationMs: 1000, languageMismatch }),
});

const pronInput = (locale: string, variety: 'ary' | 'arz' | 'fr' | 'ht', referenceText: string) => ({ audio: inline(pcm16ToWav(pcmFixture(100), 16_000)), targetVarietyId: variety, locale, referenceText, referencePhonemes: null, expressionId: null, requestedFeatures: ['word' as const] });

describe('pronunciation assessors', () => {
  it('Azure: disabled without credentials, never for Darija / Levantine / Creole, enabled for ar-EG', async () => {
    const off = new AzurePronunciationAssessor({ key: undefined, region: undefined });
    expect((await off.capability('ar-EG')).reasons).toEqual(['provider_disabled']);
    const on = new AzurePronunciationAssessor({ key: 'k', region: 'westeurope' });
    expect((await on.capability('ar-EG'))).toMatchObject({ supported: true, effectiveLocale: 'ar-EG', features: { phoneme: true } });
    expect(await on.supports('ar-EG', 'phoneme')).toBe(true);
    expect((await on.capability('ar-MA')).reasons).toEqual(['locale_unsupported']);
    expect((await on.capability('ar-SY')).supported).toBe(false);
    expect((await on.capability('ht-HT')).supported).toBe(false);
    expect((await on.capability('rw-RW')).supported).toBe(false);
    expect((await on.capability('zh-HK'))).toMatchObject({ supported: true, features: { tone: true } });
    expect((await on.capability('ar'))).toMatchObject({ supported: true, reasons: ['not_benchmarked'], effectiveLocale: 'ar-SA' });
    expect(azureLocaleForVariety('es-419', 'CO')).toBe('es-MX');
    expect(azureLocaleForVariety('fr', 'CA')).toBe('fr-CA');
  });

  it('Azure: real REST call shape and mapping of a detailed response (fixture)', async () => {
    const fixture: AzureDetailedResponse = {
      RecognitionStatus: 'Success',
      DisplayText: 'صباح الخير عامل إيه',
      Offset: 1_000_000,
      Duration: 20_000_000,
      NBest: [
        {
          Confidence: 0.91,
          Display: 'صباح الخير عامل إيه',
          PronunciationAssessment: { AccuracyScore: 82, FluencyScore: 90, CompletenessScore: 100, PronScore: 85.4, ProsodyScore: 70 },
          Words: [
            { Word: 'صباح', Offset: 1_000_000, Duration: 5_000_000, PronunciationAssessment: { AccuracyScore: 95, ErrorType: 'None' }, Phonemes: [{ Phoneme: 's', PronunciationAssessment: { AccuracyScore: 99 } }] },
            { Word: 'الخير', Offset: 6_000_000, Duration: 5_000_000, PronunciationAssessment: { AccuracyScore: 55, ErrorType: 'Mispronunciation' }, Phonemes: [{ Phoneme: 'x', PronunciationAssessment: { AccuracyScore: 40 } }] },
          ],
        },
      ],
    };
    const { fetchImpl, calls } = mockFetch([{ match: (u) => u.includes('stt.speech.microsoft.com'), respond: () => jsonResponse(fixture) }]);
    const azure = new AzurePronunciationAssessor({ key: 'secret', region: 'westeurope', fetch: fetchImpl });
    const res = await azure.assess(pronInput('ar-EG', 'arz', 'صباح الخير عامل إيه'));
    expect(calls[0]?.url).toBe('https://westeurope.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=ar-EG&format=detailed');
    expect(calls[0]?.headers['Ocp-Apim-Subscription-Key']).toBe('secret');
    const params = JSON.parse(new TextDecoder().decode(base64ToBytes(calls[0]?.headers['Pronunciation-Assessment'] ?? '')));
    expect(params).toMatchObject({ ReferenceText: 'صباح الخير عامل إيه', GradingSystem: 'HundredMark', Granularity: 'Phoneme' });
    expect(res.pronunciation).toMatchObject({ assessmentMode: 'acoustic-assessor', numericScore: 85.4, confidence: 'high', provider: 'azure_speech' });
    expect(res.pronunciation.wordScores[1]).toMatchObject({ word: 'الخير', accuracy: 55, errorType: 'mispronunciation', startMs: 600, endMs: 1100 });
    expect(res.pronunciation.highlightedSegment?.text).toBe('الخير');
    expect(res.pronunciation.phonemeHints[0]).toMatchObject({ phoneme: 'x', accuracy: 40 });
    expect(() => PronunciationAssessmentSchema.parse(res.pronunciation)).not.toThrow();
    // Refuses to assess a variety the locale does not denote
    await expect(azure.assess(pronInput('ar-EG', 'ary', 'x'))).rejects.toMatchObject({ code: 'capability_unsupported' });
    await expect(azure.assess(pronInput('ar-MA', 'ary', 'x'))).rejects.toMatchObject({ code: 'capability_unsupported' });
  });

  it('Azure: NoMatch yields an honest unavailable block with no score', () => {
    const res = mapAzureResponse({ RecognitionStatus: 'NoMatch' }, pronInput('fr-FR', 'fr', 'bonjour'), 'fr-FR', 10, 'azure_speech', false);
    expect(res.pronunciation).toMatchObject({ assessmentMode: 'unavailable', numericScore: null, confidence: 'none' });
  });

  it('ReferenceComparison: never emits numeric scores, gives actionable feedback and the reference pointer', async () => {
    const ref = new ReferenceComparisonAssessor({ recognizer: fakeRecognizer('صباح الخير لاباس عليك'), referenceAudio: { forExpression: async () => ({ assetId: null, url: null, phoneticTips: ['feedback.tip.darija_3ayn'], humanCalibrated: true }) } });
    const res = await ref.assess(pronInput('ar-MA', 'ary', 'صباح الخير، لاباس عليك؟'));
    expect(res.pronunciation).toMatchObject({ assessmentMode: 'human-calibrated-reference-comparison', numericScore: null, confidence: 'limited', featuresAssessed: ['word'] });
    expect(res.pronunciation.feedback).toContain('feedback.meaning_came_across');
    expect(res.pronunciation.feedback).toContain('feedback.detailed_phoneme_assessment_not_available');
    expect(res.pronunciation.feedback).toContain('feedback.tip.darija_3ayn');
    expect(res.pronunciation.wordScores.every((w) => w.accuracy === null)).toBe(true);
    expect(await ref.supports('ar-MA', 'phoneme')).toBe(false);
    expect(await ref.supports('ar-MA', 'word')).toBe(true);
    const partial = await new ReferenceComparisonAssessor({ recognizer: fakeRecognizer('صباح الخير') }).assess(pronInput('ar-MA', 'ary', 'صباح الخير لاباس عليك'));
    expect(partial.pronunciation.feedback[0]).toBe('feedback.mostly_there');
    expect(partial.pronunciation.feedback.some((f) => f.startsWith('feedback.missing_words:'))).toBe(true);
    const unclear = await new ReferenceComparisonAssessor({ recognizer: fakeRecognizer('x', 0.1) }).assess(pronInput('ar-MA', 'ary', 'صباح الخير'));
    expect(unclear.pronunciation.feedback[0]).toBe('feedback.unclear_recording_retry');
  });

  it('Composite: acoustic when supported, otherwise reference comparison — never crossing varieties', async () => {
    const { fetchImpl } = mockFetch([{ match: () => true, respond: () => jsonResponse({ RecognitionStatus: 'Success', NBest: [{ Confidence: 0.8, Display: 'bonjour', PronunciationAssessment: { PronScore: 90 }, Words: [] }] }) }]);
    const azure = new AzurePronunciationAssessor({ key: 'k', region: 'r', fetch: fetchImpl });
    const composite = new CompositeAssessor([azure], new ReferenceComparisonAssessor({ recognizer: fakeRecognizer('bonjou kijan ou ye') }));
    expect((await composite.choose('fr-FR')).assessor.provider).toBe('azure_speech');
    expect((await composite.choose('ar-MA')).assessor.provider).toBe('reference_comparison');
    expect((await composite.choose('ht-HT')).assessor.provider).toBe('reference_comparison');
    expect((await composite.choose('fr-FR', ['tone'])).assessor.provider).toBe('reference_comparison');
    const fr = await composite.assess(pronInput('fr-FR', 'fr', 'bonjour'));
    expect(fr.pronunciation.numericScore).toBe(90);
    const ht = await composite.assess(pronInput('ht-HT', 'ht', 'Bonjou, kijan ou ye?'));
    expect(ht.pronunciation.numericScore).toBeNull();
    expect(ht.pronunciation.assessmentMode).toBe('reference-comparison');
  });
});
