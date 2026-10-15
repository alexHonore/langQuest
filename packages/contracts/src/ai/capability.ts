/**
 * Capability registry contracts (§8.2). Every adapter must answer `supports(...)`
 * with a structured `Capability`; fallbacks may never cross a variety boundary.
 */
import { z } from 'zod';
import { LatencyClassSchema } from '../enums';
import { UnitIntervalSchema } from '../primitives';

export const PronunciationFeatureSchema = z.enum(['word', 'phoneme', 'tone', 'prosody']);
export type PronunciationFeature = z.infer<typeof PronunciationFeatureSchema>;

export const CapabilityFeaturesSchema = z.object({
  word: z.boolean(),
  phoneme: z.boolean(),
  tone: z.boolean(),
  prosody: z.boolean(),
  streaming: z.boolean(),
  interruptible: z.boolean(),
  codeSwitch: z.boolean(),
  multiSpeaker: z.boolean(),
});
export type CapabilityFeatures = z.infer<typeof CapabilityFeaturesSchema>;

export const CAPABILITY_REASON_VALUES = [
  'locale_unsupported',
  'variety_boundary',
  'voice_unsupported',
  'feature_unsupported',
  'audio_format_unsupported',
  'provider_disabled',
  'not_benchmarked',
  'quality_below_threshold',
  'provider_unavailable',
] as const;
export const CapabilityReasonSchema = z.enum(CAPABILITY_REASON_VALUES);
export type CapabilityReason = z.infer<typeof CapabilityReasonSchema>;

/** Result of an adapter `supports(...)` call. */
export const CapabilitySchema = z.object({
  supported: z.boolean(),
  /** Reasons when unsupported or partially supported (empty when fully supported). */
  reasons: z.array(CapabilityReasonSchema),
  features: CapabilityFeaturesSchema,
  latencyClass: LatencyClassSchema,
  /** Locale the provider will actually use; must equal the requested variety/locale, never a neighbour. */
  effectiveLocale: z.string().nullable(),
  /** Benchmark-derived quality estimate [0,1] when available. */
  qualityEstimate: UnitIntervalSchema.nullable(),
  provider: z.string(),
  notes: z.array(z.string()),
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const NO_FEATURES: CapabilityFeatures = {
  word: false,
  phoneme: false,
  tone: false,
  prosody: false,
  streaming: false,
  interruptible: false,
  codeSwitch: false,
  multiSpeaker: false,
};

/** Convenience constructor for an unsupported capability. */
export const unsupportedCapability = (provider: string, reasons: CapabilityReason[], notes: string[] = []): Capability => ({
  supported: false,
  reasons,
  features: NO_FEATURES,
  latencyClass: 'batch',
  effectiveLocale: null,
  qualityEstimate: null,
  provider,
  notes,
});
