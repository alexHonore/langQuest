/**
 * `SpeechRecognizer` over OpenRouter `/audio/transcriptions` (§8.1 task 7) with per-variety model
 * preference and language hints. `supports()` is answered from the capability matrix, never guessed.
 */
import type { AudioInput, Capability, SpeechRecognizer, TranscriptResult, TranscriptSegment, VarietyId } from '@langquest/contracts';
import { unsupportedCapability } from '@langquest/contracts';
import { capabilityForVariety } from '../capability/matrix';
import { capabilityFromStatus, providerLocaleFor, resolveVariety } from '../capability/registry';
import { AiCapabilityError, AiProviderUnavailableError, wrapOperatorError } from '../errors';
import { OpenRouterError, type OpenRouterClient, type TranscriptionResponse } from '../openrouter/client';
import { resolveAttribution, type AiAttribution, type AiAttributionSource, type AiRequestSink } from '../reasoner';
import { clamp, newId, nowIso } from '../util';
import { resolveAudioBytes, type AudioAssetResolver } from './audio-input';
import { SPEECH_GATE_MODEL, applySpeechScreening, detectSpeech, measureWavLevels, preflightSpeech, type ScreenedTranscriptResult, type SpeechScreening, type SpeechScreeningOptions } from './speech-detection';

export interface OpenRouterSpeechRecognizerOptions {
  client: OpenRouterClient;
  sink?: AiRequestSink;
  assetResolver?: AudioAssetResolver;
  fetch?: typeof fetch;
  /** Admin override of the model chain per variety (from `ai_model_profiles` speech_recognition rows). */
  modelOverrides?: Partial<Record<VarietyId, readonly string[]>>;
  /** Above this size the JSON base64 transport is used (OpenAI/Groq offload large bodies). */
  multipartMaxBytes?: number;
  /**
   * Default language-hint policy (overridable per call). `'matrix'` (default) sends the capability-matrix hint for
   * the variety; `'auto'` omits the hint so the model detects the language itself — use it for code-switched audio
   * (learner mixing source and target language) where a fixed hint forces every segment into one language; any other
   * string is sent verbatim as an ISO-639-1 hint.
   */
  languageHint?: SttLanguageHint;
  /** Attribution for `ai_requests` rows (learner id, DB profile id). Default: pseudonymous. */
  attribution?: AiAttributionSource | null;
}

/** `'matrix'` = capability-matrix hint for the variety; `'auto'` = no hint (provider detection); else an ISO-639-1 code. */
export type SttLanguageHint = 'matrix' | 'auto' | (string & {});

/**
 * Per-call options. Learner-facing callers (attempt grading, transcription of a learner take, voice turns) pass
 * `screening: 'learner'`: the non-speech gate (`./speech-detection`) then blanks a take without speech (typed verdict in
 * `result.speech`) and may answer a silent take without calling the provider. The default `annotate` keeps the legacy
 * behaviour for content transcription (text blanked only when every segment has no_speech_prob > 0.8) and only attaches
 * the verdict.
 */
export interface TranscribeOptions extends SpeechScreeningOptions {
  traceId?: string;
  enrollmentId?: string | null;
  /** See `OpenRouterSpeechRecognizerOptions.languageHint`; `'auto'` for mixed-language recordings. */
  languageHint?: SttLanguageHint;
  /** Overrides the adapter-level attribution for this call only. */
  attribution?: AiAttribution | null;
}

/** Resolve the hint actually sent for a variety under a policy (`null` = omitted). Exported for tests. */
export function effectiveLanguageHint(variety: VarietyId, policy: SttLanguageHint | undefined): string | null {
  if (policy === undefined || policy === 'matrix') return capabilityForVariety(variety).stt.languageHint;
  if (policy === 'auto') return null;
  return policy;
}

/** Whisper reports `yue` for Cantonese and `zh` for Mandarin; other varieties share their language code. */
const EXPECTED_DETECTION: Partial<Record<VarietyId, readonly string[]>> = {
  yue: ['yue', 'zh-hk', 'zh-yue'],
  cmn: ['zh', 'zh-cn', 'zh-tw', 'cmn'],
};

export class OpenRouterSpeechRecognizer implements SpeechRecognizer {
  readonly provider = 'openrouter';
  private readonly client: OpenRouterClient;
  private readonly sink: AiRequestSink | null;
  private readonly assetResolver: AudioAssetResolver | undefined;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly modelOverrides: Partial<Record<VarietyId, readonly string[]>>;
  private readonly multipartMaxBytes: number;
  private readonly languageHint: SttLanguageHint;
  private readonly attribution: AiAttributionSource | null;

  constructor(options: OpenRouterSpeechRecognizerOptions) {
    this.client = options.client;
    this.sink = options.sink ?? null;
    this.assetResolver = options.assetResolver;
    this.fetchImpl = options.fetch;
    this.modelOverrides = options.modelOverrides ?? {};
    this.multipartMaxBytes = options.multipartMaxBytes ?? 20 * 1024 * 1024;
    this.languageHint = options.languageHint ?? 'matrix';
    this.attribution = options.attribution ?? null;
  }

  modelsFor(variety: VarietyId): readonly string[] {
    return this.modelOverrides[variety] ?? capabilityForVariety(variety).stt.models;
  }

  async supports(locale: string, audioType?: string): Promise<Capability> {
    const variety = resolveVariety(locale);
    if (!variety) return unsupportedCapability(this.provider, ['locale_unsupported'], [`Unknown or ambiguous locale: ${locale}`]);
    const entry = capabilityForVariety(variety).stt;
    const cap = capabilityFromStatus({
      provider: this.provider,
      status: entry.status,
      effectiveLocale: providerLocaleFor(variety),
      latencyClass: 'interactive',
      features: { codeSwitch: entry.status !== 'unavailable', multiSpeaker: false, streaming: false },
      evidence: entry.evidence,
      notes: [
        `models=${this.modelsFor(variety).join(',')}`,
        `languageHint=${effectiveLanguageHint(variety, this.languageHint) ?? 'auto'} (policy=${this.languageHint})`,
        entry.status !== 'unavailable'
          ? 'codeSwitch: pass languageHint "auto" to omit the hint for mixed-language audio; the detected language is then reported per transcript and may differ from the target variety (languageMismatch).'
          : 'codeSwitch: unavailable',
      ],
    });
    if (audioType && !/^(audio\/)?(wav|x-wav|mpeg|mp3|flac|ogg|opus|webm|mp4|m4a|aac|pcm|pcm16)$/i.test(audioType)) {
      return { ...cap, supported: false, reasons: [...cap.reasons, 'audio_format_unsupported'], notes: [...cap.notes, `audioType ${audioType} not accepted`] };
    }
    return cap;
  }

  async transcribe(audio: AudioInput, locale: string, options: TranscribeOptions = {}): Promise<ScreenedTranscriptResult> {
    const variety = resolveVariety(locale);
    const capability = await this.supports(locale);
    if (!variety || !capability.supported) throw new AiCapabilityError(`Speech recognition is not available for ${locale}`, capability, locale);
    const languageHint = effectiveLanguageHint(variety, options.languageHint ?? this.languageHint);
    const resolved = await resolveAudioBytes(audio, { assetResolver: this.assetResolver, fetch: this.fetchImpl });
    const learner = options.screening === 'learner';
    const clientSignals = options.clientSignals ?? null;
    const audioLevels = resolved.format === 'wav' ? measureWavLevels(resolved.bytes) : null;
    if (learner) {
      // A take the recorder metering or the PCM level measure as silent is answered without a provider call (no cost).
      const silent = preflightSpeech({ audioLevels, client: clientSignals });
      if (silent) return silentTranscript(silent, providerLocaleFor(variety), this.provider, audioLevels?.durationMs ?? null);
    }
    const traceId = options.traceId ?? newId();
    const models = this.modelsFor(variety);
    const attribution = resolveAttribution(this.attribution, { ...(options.attribution ?? {}), ...(options.enrollmentId !== undefined ? { enrollmentId: options.enrollmentId } : {}) });
    let lastError: unknown = null;

    for (const model of models) {
      const startedAt = Date.now();
      try {
        const res = await this.transcribeWith(model, resolved.bytes, resolved.format, resolved.mimeType, languageHint, traceId);
        const speech = detectSpeech({ text: res.text, segments: res.segments, durationMs: res.durationSeconds !== null ? sec(res.durationSeconds) : null, detectedLanguage: res.language, expectedText: options.expectedText ?? null, audioLevels, client: clientSignals });
        await this.record({ model, traceId, attribution, languageHint, latencyMs: Date.now() - startedAt, res, success: true, errorCode: null, speech });
        const result = toTranscriptResult(res, variety, providerLocaleFor(variety), this.provider);
        return learner ? applySpeechScreening(result, speech) : { ...result, speech };
      } catch (error) {
        lastError = error;
        const code = error instanceof OpenRouterError ? error.kind : 'unknown';
        await this.record({ model, traceId, attribution, languageHint, latencyMs: Date.now() - startedAt, res: null, success: false, errorCode: code });
        // Account-level failures (revoked key, exhausted operator balance) affect every model: stop and surface
        // `provider_unavailable` with LangQuest's own wording. An oversized payload is a request problem: rethrow as is.
        if (error instanceof OpenRouterError && (error.kind === 'auth' || error.kind === 'insufficient_credits')) throw wrapOperatorError(error, 'Speech recognition', this.provider);
        if (error instanceof OpenRouterError && error.kind === 'payload_too_large') throw error;
        // invalid model / provider failure / bad request → try the next model in the chain (same variety, same language hint)
      }
    }
    throw new AiProviderUnavailableError(`All speech recognition models failed for ${locale}`, this.provider, { cause: lastError });
  }

  private async transcribeWith(model: string, bytes: Uint8Array, format: string, mimeType: string, languageHint: string | null, traceId: string): Promise<TranscriptionResponse> {
    const transport = bytes.byteLength > this.multipartMaxBytes ? 'json' : 'multipart';
    const base = { model, audio: { bytes, format, mimeType }, ...(languageHint ? { language: languageHint } : {}), transport } as const;
    try {
      return await this.client.audio.transcriptions({ ...base, responseFormat: 'verbose_json', timestampGranularities: ['segment', 'word'] }, { tags: { task: 'speech_recognition', traceId } });
    } catch (error) {
      // Some models reject verbose_json with a 400 (documented: gpt-4o-transcribe, mai-transcribe-1.5). Retry plain json once.
      if (error instanceof OpenRouterError && error.kind === 'bad_request' && /verbose_json|response_format|timestamp/i.test(error.message)) {
        return this.client.audio.transcriptions({ ...base, responseFormat: 'json' }, { tags: { task: 'speech_recognition', traceId } });
      }
      throw error;
    }
  }

  private async record(input: { model: string; traceId: string; attribution: Required<AiAttribution>; languageHint: string | null; latencyMs: number; res: TranscriptionResponse | null; success: boolean; errorCode: string | null; speech?: SpeechScreening }): Promise<void> {
    if (!this.sink) return;
    await this.sink.record({
      occurredAt: nowIso(),
      userId: input.attribution.userId,
      enrollmentId: input.attribution.enrollmentId,
      task: 'speech_recognition',
      provider: this.provider,
      model: input.model,
      profileId: input.attribution.profileId,
      fallbackIndex: 0,
      latencyMs: input.latencyMs,
      inputTokens: input.res?.usage.inputTokens ?? null,
      outputTokens: input.res?.usage.outputTokens ?? null,
      audioSeconds: input.res?.usage.seconds ?? null,
      estimatedCostUsd: input.res?.estimatedCostUsd ?? null,
      success: input.success,
      errorCode: input.errorCode,
      traceId: input.traceId,
      // The gate verdict, never the text: `speechDetected`, the reason and the matched phrase count only.
      redactedLog: input.res
        ? { requestId: input.res.requestId, chars: input.res.text.length, language: input.res.language, languageHint: input.languageHint, ...(input.speech ? { speechDetected: input.speech.speechDetected, noSpeechReason: input.speech.reason, matchedPhrases: input.speech.matchedPhrases.length, speechGate: input.speech.detectorVersion } : {}) }
        : { languageHint: input.languageHint },
    });
  }
}

const sec = (s: number): number => Math.max(0, Math.round(s * 1000));

/** Transcript for a take the gate answered before any provider call (silent by level): empty, with the verdict. */
function silentTranscript(speech: SpeechScreening, requestedLocale: string, provider: string, durationMs: number | null): ScreenedTranscriptResult {
  return { text: '', segments: [], confidence: null, detectedLanguage: null, requestedLocale, provider, model: SPEECH_GATE_MODEL, durationMs, languageMismatch: false, speech };
}

/** Map an OpenRouter transcription response onto the contract `TranscriptResult`. Exported for tests. */
export function toTranscriptResult(res: TranscriptionResponse, variety: VarietyId, requestedLocale: string, provider: string): TranscriptResult {
  const segments: TranscriptSegment[] = res.segments.map((s, index) => {
    const words = res.words.filter((w) => w.start >= s.start - 0.001 && w.end <= s.end + 0.001).map((w) => ({ text: w.word, startMs: sec(w.start), endMs: sec(w.end), confidence: w.confidence }));
    const confidence = s.avgLogprob !== null ? clamp(Math.exp(s.avgLogprob), 0, 1) : null;
    return { index, text: s.text, startMs: sec(s.start), endMs: sec(s.end), confidence, speakerLabel: s.speaker !== null ? `speaker_${s.speaker}` : null, language: res.language, words };
  });
  const segmentConfidences = segments.map((s) => s.confidence).filter((c): c is number => c !== null);
  const confidence = res.confidence ?? (segmentConfidences.length ? Math.round((segmentConfidences.reduce((a, b) => a + b, 0) / segmentConfidences.length) * 1000) / 1000 : null);
  const detected = res.language ? res.language.toLowerCase() : null;
  const expectedBase = (capabilityForVariety(variety).stt.languageHint ?? '').toLowerCase();
  const expected = EXPECTED_DETECTION[variety] ?? (expectedBase ? [expectedBase] : []);
  const languageMismatch = detected !== null && expected.length > 0 && !expected.includes(detected) && !expected.includes(detected.split('-')[0] ?? detected);
  const noSpeech = segments.length > 0 && res.segments.every((s) => (s.noSpeechProb ?? 0) > 0.8);
  return {
    text: noSpeech ? '' : res.text,
    segments,
    confidence,
    detectedLanguage: detected ? { code: detected, confidence: null } : null,
    requestedLocale,
    provider,
    model: res.model,
    durationMs: res.durationSeconds !== null ? sec(res.durationSeconds) : null,
    languageMismatch,
  };
}
