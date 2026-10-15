/**
 * OpenRouter pricing table. Seeded from `docs/provider-matrix/openrouter-models-snapshot-2026-10-14.json`
 * and refreshable at runtime from `GET /api/v1/models` (§12.3: never hard-code prices as truth —
 * the live `usage.cost` field wins whenever the provider reports it).
 */

/** Billing unit of the `prompt` price: chat models per token, TTS per character, most STT per audio second. */
export type PricingUnit = 'token' | 'character' | 'second';

export interface ModelPricing {
  model: string;
  /** USD per unit of input (token / character / second). */
  promptUsd: number;
  /** USD per output token (0 for most speech models). */
  completionUsd: number;
  unit: PricingUnit;
  /** Where the number came from. */
  source: 'snapshot-2026-10-14' | 'live-models-endpoint' | 'manual';
}

const snap = (model: string, promptUsd: number, completionUsd: number, unit: PricingUnit): ModelPricing => ({
  model,
  promptUsd,
  completionUsd,
  unit,
  source: 'snapshot-2026-10-14',
});

/** Pricing for every model referenced by the default profiles and voice/STT registries. */
export const DEFAULT_PRICING: readonly ModelPricing[] = [
  // chat
  snap('anthropic/claude-haiku-5.5', 0.0000001, 0.0000005, 'token'),
  snap('anthropic/claude-sonnet-5.5', 0.000002, 0.00001, 'token'),
  snap('google/gemini-3.8-flash', 0.00000075, 0.00000375, 'token'),
  snap('google/gemini-3.5-flash-lite', 0.0000003, 0.0000025, 'token'),
  snap('deepseek/deepseek-v4.1-flash', 0.00000001584, 0.000000891, 'token'),
  snap('openai/gpt-5.4-mini', 0.00000075, 0.0000045, 'token'),
  snap('openai/gpt-5.4-nano', 0.0000002, 0.00000125, 'token'),
  snap('mistralai/mistral-small-2603', 0.00000015, 0.0000006, 'token'),
  // speech-to-text
  snap('openai/whisper-large-v3', 0.0000075, 0, 'second'),
  snap('openai/whisper-large-v3-turbo', 0.00000333, 0, 'second'),
  snap('elevenlabs/scribe-v2', 0.00003055555555555, 0, 'second'),
  snap('google/gemini-3.5-transcribe', 0.000002, 0.000012, 'token'),
  snap('deepgram/nova-3', 0.0000716666666667, 0, 'second'),
  snap('mistralai/voxtral-mini-transcribe', 0.00005, 0, 'second'),
  snap('openai/gpt-4o-mini-transcribe', 0.00000125, 0.000005, 'token'),
  // text-to-speech
  snap('google/gemini-3.8-flash-lite-tts', 0.0000005, 0.000006, 'character'),
  snap('google/gemini-3.8-flash-tts', 0.0000005, 0.000009, 'character'),
  snap('elevenlabs/eleven-flash-v2.5', 0.00002, 0, 'character'),
  snap('elevenlabs/eleven-multilingual-v2', 0.00004, 0, 'character'),
  snap('elevenlabs/eleven-v3', 0.00004, 0, 'character'),
  snap('microsoft/mai-voice-2.1-flash', 0.000015, 0, 'character'),
  snap('microsoft/mai-voice-2.1', 0.000022, 0, 'character'),
  snap('hexgrad/kokoro-82m', 0.00000062, 0, 'character'),
  snap('x-ai/grok-voice-tts-1.0', 0.000015, 0, 'character'),
];

/** Minimal shape of a `/api/v1/models` row we care about. */
export interface ModelCatalogEntry {
  id: string;
  name?: string;
  pricing?: { prompt?: string | number; completion?: string | number; audio?: string | number } | null;
  architecture?: { input_modalities?: string[]; output_modalities?: string[]; modality?: string } | null;
  supported_voices?: string[] | null;
  supported_parameters?: string[] | null;
  context_length?: number | null;
}

export const inferPricingUnit = (entry: ModelCatalogEntry): PricingUnit => {
  const out = entry.architecture?.output_modalities ?? [];
  const input = entry.architecture?.input_modalities ?? [];
  if (out.includes('speech')) return 'character';
  if (out.includes('transcription') || (input.includes('audio') && !input.includes('text'))) {
    // Token-priced transcription models publish a non-zero completion price.
    const completion = Number(entry.pricing?.completion ?? 0);
    return completion > 0 ? 'token' : 'second';
  }
  return 'token';
};

/** Mutable in-memory pricing table with refresh support. */
export class PricingTable {
  private readonly byModel = new Map<string, ModelPricing>();

  constructor(seed: readonly ModelPricing[] = DEFAULT_PRICING) {
    for (const p of seed) this.byModel.set(p.model, p);
  }

  get(model: string): ModelPricing | null {
    return this.byModel.get(model) ?? this.byModel.get(model.replace(/:[a-z]+$/i, '')) ?? null;
  }

  set(pricing: ModelPricing): void {
    this.byModel.set(pricing.model, pricing);
  }

  list(): ModelPricing[] {
    return [...this.byModel.values()];
  }

  /** Merge rows from `/api/v1/models` (live values override the snapshot). */
  refreshFromCatalog(entries: readonly ModelCatalogEntry[]): number {
    let updated = 0;
    for (const entry of entries) {
      const prompt = Number(entry.pricing?.prompt ?? NaN);
      if (!Number.isFinite(prompt)) continue;
      const completion = Number(entry.pricing?.completion ?? 0);
      this.byModel.set(entry.id, {
        model: entry.id,
        promptUsd: prompt,
        completionUsd: Number.isFinite(completion) ? completion : 0,
        unit: inferPricingUnit(entry),
        source: 'live-models-endpoint',
      });
      updated += 1;
    }
    return updated;
  }

  /** Estimate for a chat completion. `null` when the model is unknown. */
  estimateChat(model: string, inputTokens: number, outputTokens: number): number | null {
    const p = this.get(model);
    if (!p || p.unit !== 'token') return null;
    return round(inputTokens * p.promptUsd + outputTokens * p.completionUsd);
  }

  /** Estimate for TTS by input characters (plus output tokens when the model bills them, e.g. Gemini TTS). */
  estimateSpeech(model: string, characters: number, outputTokens = 0): number | null {
    const p = this.get(model);
    if (!p) return null;
    return round(characters * p.promptUsd + outputTokens * p.completionUsd);
  }

  /** Estimate for STT by audio seconds (second-priced) or tokens (token-priced). */
  estimateTranscription(model: string, audioSeconds: number | null, inputTokens: number | null, outputTokens: number | null): number | null {
    const p = this.get(model);
    if (!p) return null;
    if (p.unit === 'second') return audioSeconds === null ? null : round(audioSeconds * p.promptUsd);
    if (inputTokens === null) return null;
    return round(inputTokens * p.promptUsd + (outputTokens ?? 0) * p.completionUsd);
  }
}

const round = (usd: number): number => Math.round(usd * 1e9) / 1e9;
