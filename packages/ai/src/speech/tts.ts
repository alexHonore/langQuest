/**
 * `SpeechSynthesizer` over OpenRouter `/audio/speech` with the per-variety voice registry, explicit
 * unsupported entries, and a cache-key helper for shared approved content (§12.1: cache TTS once per course,
 * never per learner; learner-personal text is never cached in the shared scope).
 */
import type { AudioOutput, Capability, SpeechSynthesizer } from '@langquest/contracts';
import { unsupportedCapability } from '@langquest/contracts';
import { capabilityForVariety } from '../capability/matrix';
import { capabilityFromStatus, resolveVariety, varietyBoundaryViolation } from '../capability/registry';
import { AiCapabilityError, wrapOperatorError } from '../errors';
import type { OpenRouterClient } from '../openrouter/client';
import type { AiRequestSink } from '../reasoner';
import { bytesToBase64, mp3DurationMs, newId, nowIso, pcm16DurationMs, sha256Hex } from '../util';
import { defaultVoiceFor, findVoice, voicesForVariety, type VoiceEntry } from './voices';

export interface TtsCache {
  get(key: string): Promise<AudioOutput | null>;
  set(key: string, output: AudioOutput): Promise<void>;
}

export interface SynthesizeOptions {
  /** `shared_approved` = approved static course content (cacheable across learners). Default `none`. */
  cacheScope?: 'shared_approved' | 'none';
  /** Relative speaking rate; 1 = normal. Models without speed control receive a slow-delivery instruction instead. */
  rate?: number;
  instructions?: string;
  traceId?: string;
  enrollmentId?: string | null;
}

export interface OpenRouterSpeechSynthesizerOptions {
  client: OpenRouterClient;
  sink?: AiRequestSink;
  cache?: TtsCache;
}

export const TTS_CACHE_KEY_VERSION = 'v1';

/** Deterministic key for shared approved TTS: hash(model | voice | rate | normalised text). */
export async function ttsCacheKey(input: { text: string; voiceId: string; rate?: number; model?: string }): Promise<string> {
  const voice = findVoice(input.voiceId);
  const model = input.model ?? voice?.model ?? 'unknown';
  const rate = (input.rate ?? 1).toFixed(2);
  const text = input.text.normalize('NFC').replace(/\s+/g, ' ').trim();
  return `${TTS_CACHE_KEY_VERSION}:${await sha256Hex(`${model}|${input.voiceId}|${rate}|${text}`)}`;
}

/** Models with a documented `speed` parameter on OpenRouter (OpenAI only, per docs 2026-10-14). */
const SPEED_CAPABLE = new Set<string>(['openai/gpt-4o-mini-tts', 'openai/tts-1', 'openai/tts-1-hd']);

export class OpenRouterSpeechSynthesizer implements SpeechSynthesizer {
  readonly provider = 'openrouter';
  private readonly client: OpenRouterClient;
  private readonly sink: AiRequestSink | null;
  private readonly cache: TtsCache | null;

  constructor(options: OpenRouterSpeechSynthesizerOptions) {
    this.client = options.client;
    this.sink = options.sink ?? null;
    this.cache = options.cache ?? null;
  }

  /** Resolve the voice to use for a locale (+ optional voice id), enforcing the variety boundary. */
  resolveVoice(locale: string, voiceId?: string): { voice: VoiceEntry | null; capability: Capability } {
    const variety = resolveVariety(locale);
    if (!variety) return { voice: null, capability: unsupportedCapability(this.provider, ['locale_unsupported'], [`Unknown or ambiguous locale: ${locale}`]) };
    const entry = capabilityForVariety(variety).tts;
    const available = voicesForVariety(variety);
    if (!available.length) return { voice: null, capability: unsupportedCapability(this.provider, ['locale_unsupported'], [entry.evidence]) };
    let voice: VoiceEntry | null;
    if (voiceId) {
      voice = findVoice(voiceId);
      if (!voice) return { voice: null, capability: unsupportedCapability(this.provider, ['voice_unsupported'], [`Unknown voice ${voiceId}`]) };
      if (voice.varietyId !== variety) {
        return { voice: null, capability: unsupportedCapability(this.provider, ['variety_boundary', 'voice_unsupported'], [`Voice ${voiceId} belongs to ${voice.varietyId}, not ${variety}`]) };
      }
    } else {
      const regional = locale.toLowerCase() !== variety.toLowerCase() ? available.find((v) => v.locale.toLowerCase() === locale.toLowerCase())?.regionalOptionId ?? null : null;
      voice = defaultVoiceFor(variety, regional);
    }
    if (!voice) return { voice: null, capability: unsupportedCapability(this.provider, ['voice_unsupported']) };
    // Same rule as the capability registry: the voice's declared locale must denote the requested variety, so
    // direct `synthesize()` callers (realtime pipeline, API) can never be served a cross-variety voice silently.
    const boundary = varietyBoundaryViolation(this.provider, variety, voice.locale);
    if (boundary) return { voice: null, capability: { ...boundary, notes: [...boundary.notes, `voice=${voice.voiceId}`] } };
    const capability = capabilityFromStatus({
      provider: this.provider,
      status: voice.status,
      effectiveLocale: voice.locale,
      latencyClass: voice.model.startsWith('google/') ? 'interactive' : 'realtime',
      features: { streaming: voice.responseFormat === 'pcm' },
      evidence: voice.evidence,
      notes: [`voice=${voice.voiceId}`, `model=${voice.model}`, 'synthetic=true'],
    });
    return { voice, capability };
  }

  async supports(locale: string, voiceId?: string): Promise<Capability> {
    return this.resolveVoice(locale, voiceId).capability;
  }

  async synthesize(text: string, locale: string, voiceId: string, options: SynthesizeOptions = {}): Promise<AudioOutput> {
    const { voice, capability } = this.resolveVoice(locale, voiceId || undefined);
    if (!voice || !capability.supported) throw new AiCapabilityError(`Speech synthesis is not available for ${locale} / ${voiceId}`, capability, locale);
    const rate = options.rate ?? 1;
    const key = options.cacheScope === 'shared_approved' && this.cache ? await ttsCacheKey({ text, voiceId: voice.voiceId, rate, model: voice.model }) : null;
    if (key && this.cache) {
      const hit = await this.cache.get(key);
      if (hit) return { ...hit, cached: true };
    }

    const traceId = options.traceId ?? newId();
    const instructions = [voice.instructions, options.instructions, rate < 0.95 && !SPEED_CAPABLE.has(voice.model) ? 'Speak slowly and clearly, with short pauses between phrases.' : null].filter(Boolean).join(' ') || undefined;
    const startedAt = Date.now();
    let res;
    try {
      res = await this.client.audio.speech(
        {
          model: voice.model,
          input: text,
          voice: voice.providerVoice,
          responseFormat: voice.responseFormat,
          ...(instructions && (voice.model.startsWith('google/') || voice.model.startsWith('openai/') || voice.model.startsWith('fish-audio/')) ? { instructions } : {}),
          ...(SPEED_CAPABLE.has(voice.model) && rate !== 1 ? { speed: rate } : {}),
        },
        { tags: { task: 'speech_synthesis', traceId } },
      );
    } catch (error) {
      await this.record({ model: voice.model, traceId, enrollmentId: options.enrollmentId ?? null, latencyMs: Date.now() - startedAt, success: false, errorCode: (error as { kind?: string }).kind ?? 'unknown', cost: null, characters: text.length });
      throw wrapOperatorError(error, 'Speech synthesis', this.provider);
    }
    const sampleRateHz = res.sampleRateHz ?? voice.sampleRateHz;
    const durationMs = voice.responseFormat === 'pcm' ? pcm16DurationMs(res.bytes.byteLength, sampleRateHz, res.channels ?? 1) : (mp3DurationMs(res.bytes) ?? estimateDurationMs(text));
    await this.record({ model: voice.model, traceId, enrollmentId: options.enrollmentId ?? null, latencyMs: res.latencyMs, success: true, errorCode: null, cost: res.estimatedCostUsd, characters: text.length });
    const output: AudioOutput = {
      encoding: voice.encoding,
      sampleRateHz,
      durationMs,
      assetId: null,
      url: null,
      base64: bytesToBase64(res.bytes),
      provider: this.provider,
      voiceId: voice.voiceId,
      synthetic: true,
      cached: false,
    };
    if (key && this.cache) await this.cache.set(key, output);
    return output;
  }

  private async record(input: { model: string; traceId: string; enrollmentId: string | null; latencyMs: number; success: boolean; errorCode: string | null; cost: number | null; characters: number }): Promise<void> {
    if (!this.sink) return;
    await this.sink.record({
      occurredAt: nowIso(),
      userId: null,
      enrollmentId: input.enrollmentId,
      task: 'speech_synthesis',
      provider: this.provider,
      model: input.model,
      profileId: null,
      fallbackIndex: 0,
      latencyMs: input.latencyMs,
      inputTokens: input.characters,
      outputTokens: null,
      audioSeconds: null,
      estimatedCostUsd: input.cost,
      success: input.success,
      errorCode: input.errorCode,
      traceId: input.traceId,
      redactedLog: { characters: input.characters },
    });
  }
}

/** Rough fallback only used when a compressed stream cannot be parsed: ~14 characters per second of speech. */
export const estimateDurationMs = (text: string): number => Math.max(250, Math.round((text.length / 14) * 1000));
