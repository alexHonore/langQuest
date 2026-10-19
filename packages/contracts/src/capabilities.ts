/**
 * Course capabilities (CONVENTIONS §8, "visible means usable"): what ONE (course track × instruction language)
 * pair can actually offer a learner right now. Computed server-side from published content counts, the AI
 * capability matrix and the deployment's configured providers; never from static expectations.
 *
 * Clients use it twice:
 * - BEFORE enrolling, the wizard renders `missing[]` as a plain disclaimer (one i18n key per item).
 * - AFTER enrolling, tabs/sections/controls whose capability is unavailable are not rendered at all.
 *
 * Invariant (enforced by the API): a capability is never `available: true` while its backing resource count is 0.
 */
import { z } from 'zod';
import { CourseTrackIdSchema, RegionalOptionSchema, SourceLanguageCodeSchema, VarietyIdSchema } from './catalog';
import { CoverageMetricsSchema } from './db/identity';
import { CoverageStatusSchema, ScriptModeSchema } from './enums';
import { NonNegativeIntSchema, TimestamptzSchema } from './primitives';

export const LIVE_CONVERSATION_MODE_VALUES = ['text_and_voice', 'text_only', 'none'] as const;
export const LiveConversationModeSchema = z.enum(LIVE_CONVERSATION_MODE_VALUES);
export type LiveConversationMode = z.infer<typeof LiveConversationModeSchema>;

export const PRONUNCIATION_SCORING_MODE_VALUES = ['acoustic', 'reference_comparison', 'none'] as const;
export const PronunciationScoringModeSchema = z.enum(PRONUNCIATION_SCORING_MODE_VALUES);
export type PronunciationScoringMode = z.infer<typeof PronunciationScoringModeSchema>;

export const CAPABILITY_MISSING_SEVERITY_VALUES = ['blocking', 'info'] as const;
export const CapabilityMissingSeveritySchema = z.enum(CAPABILITY_MISSING_SEVERITY_VALUES);
export type CapabilityMissingSeverity = z.infer<typeof CapabilityMissingSeveritySchema>;

/**
 * Stable keys of the enrollment disclaimer items. Each maps to `enrollment.disclaimer.<camelCase>` in the
 * `@langquest/locales` catalogs (en + fr complete). Clients render `i18nKey`; `key` is for logic/analytics.
 */
export const CAPABILITY_MISSING_KEYS = [
  'no_missions',
  'no_audio_library',
  'no_live_conversation',
  'text_only_conversation',
  'no_pronunciation_scoring',
  'no_pronunciation_feedback',
  'no_offline_downloads',
  'instruction_language_draft',
  'instruction_language_planned',
  'instruction_language_unavailable',
  'partial_interface_language',
] as const;
export const CapabilityMissingKeySchema = z.enum(CAPABILITY_MISSING_KEYS);
export type CapabilityMissingKey = z.infer<typeof CapabilityMissingKeySchema>;

export const CAPABILITY_MISSING_I18N_KEYS: Record<CapabilityMissingKey, string> = {
  no_missions: 'enrollment.disclaimer.noMissions',
  no_audio_library: 'enrollment.disclaimer.noAudioLibrary',
  no_live_conversation: 'enrollment.disclaimer.noLiveConversation',
  text_only_conversation: 'enrollment.disclaimer.textOnlyConversation',
  no_pronunciation_scoring: 'enrollment.disclaimer.noPronunciationScoring',
  no_pronunciation_feedback: 'enrollment.disclaimer.noPronunciationFeedback',
  no_offline_downloads: 'enrollment.disclaimer.noOfflineDownloads',
  instruction_language_draft: 'enrollment.disclaimer.instructionLanguageDraft',
  instruction_language_planned: 'enrollment.disclaimer.instructionLanguagePlanned',
  instruction_language_unavailable: 'enrollment.disclaimer.instructionLanguageUnavailable',
  partial_interface_language: 'enrollment.disclaimer.partialInterfaceLanguage',
};

export const CapabilityMissingItemSchema = z.object({
  key: CapabilityMissingKeySchema,
  /** `enrollment.disclaimer.*` message key; values `{source}` / `{target}` are supplied by the client. */
  i18nKey: z.string().min(1),
  /** `blocking`: the pair has no usable learning content yet; `info`: one feature is absent, the rest works. */
  severity: CapabilityMissingSeveritySchema,
});
export type CapabilityMissingItem = z.infer<typeof CapabilityMissingItemSchema>;

export const CourseCapabilitiesSchema = z.object({
  courseTrackId: CourseTrackIdSchema,
  sourceLanguageCode: SourceLanguageCodeSchema,
  targetVarietyId: VarietyIdSchema,
  /** Mission pathway (Missions tab). `publishedCount` counts missions reachable through published courses/chapters. */
  missions: z.object({
    available: z.boolean(),
    publishedCount: NonNegativeIntSchema,
    /** Of `publishedCount`, missions that carry a localization for this instruction language. */
    localizedCount: NonNegativeIntSchema,
  }),
  /** Audio library (Audio tab): published collections of this track whose instruction language is this source. */
  audioLibrary: z.object({ available: z.boolean(), publishedCollections: NonNegativeIntSchema }),
  /** Live AI conversation (Speak tab): needs published characters for the variety and the AI text route. */
  liveConversation: z.object({ available: z.boolean(), characterCount: NonNegativeIntSchema, mode: LiveConversationModeSchema }),
  /** `acoustic`: numeric score from an acoustic assessor; `reference_comparison`: listen-and-compare only; `none`: no spoken feedback. */
  pronunciationScoring: z.object({ mode: PronunciationScoringModeSchema }),
  /** Offline download packs: media storage configured AND something downloadable exists. */
  offlineDownloads: z.object({ available: z.boolean() }),
  /** Editorial coverage of this (track, source) pair, as the coverage row states it. */
  instructionLanguage: z.object({ status: CoverageStatusSchema, nativeReviewed: z.boolean(), metrics: CoverageMetricsSchema }),
  /** Script modes the track offers (static catalog). */
  scripts: z.object({ modes: z.array(ScriptModeSchema).min(1) }),
  /** Regional options the track offers (static catalog). */
  regionalOptions: z.array(RegionalOptionSchema),
  /** Disclaimer items for the enrollment wizard, in display order (blocking first). */
  missing: z.array(CapabilityMissingItemSchema),
  /** When this snapshot was computed (short server cache; clients should not cache it beyond a session). */
  computedAt: TimestamptzSchema,
});
export type CourseCapabilities = z.infer<typeof CourseCapabilitiesSchema>;

/** Convenience for clients: whether anything at all can be learned from this pair (missions, audio or conversation). */
export const hasUsableContent = (c: Pick<CourseCapabilities, 'missions' | 'audioLibrary' | 'liveConversation'>): boolean =>
  c.missions.available || c.audioLibrary.available || c.liveConversation.available;
