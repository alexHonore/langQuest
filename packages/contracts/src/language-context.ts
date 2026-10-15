/**
 * `LanguageContext` — CONVENTIONS §2.3 / spec §10.1.
 *
 * Passed to every mission, AI, audio and scoring call. It carries the three
 * independent variables (UI locale, per-enrollment source language, target
 * variety + script mode) so no package ever has to guess them.
 */
import { z } from 'zod';
import {
  CourseTrackIdSchema,
  SourceLanguageCodeSchema,
  VarietyIdSchema,
  getCourseTrack,
  isRtlScript,
  type CourseTrackId,
  type ScriptId,
  type TransliterationSchemeId,
} from './catalog';
import { LearnerLevelSchema, type ScriptMode, ScriptModeSchema } from './enums';
import { Bcp47Schema, UuidSchema } from './primitives';

export const LanguageContextSchema = z
  .object({
    /** UI chrome locale (e.g. `fr-CA`). Independent of the source language. */
    uiLocale: Bcp47Schema,
    enrollmentId: UuidSchema,
    /** Instruction language for this enrollment only. */
    sourceLanguage: SourceLanguageCodeSchema,
    targetTrack: CourseTrackIdSchema,
    targetVariety: VarietyIdSchema,
    targetScriptMode: ScriptModeSchema,
    /** Regional option id or free-text preference (e.g. `Casablanca`, `SY`, `north`). */
    regionalPreference: z.string().min(1).optional(),
    learnerLevel: LearnerLevelSchema,
  })
  .superRefine((ctx, issues) => {
    const track = getCourseTrack(ctx.targetTrack);
    if (track.targetVarietyId !== ctx.targetVariety) {
      issues.addIssue({
        code: 'custom',
        path: ['targetVariety'],
        message: `Track ${ctx.targetTrack} teaches variety ${track.targetVarietyId}, not ${ctx.targetVariety}`,
      });
    }
    if (!(track.scriptModeOptions as readonly ScriptMode[]).includes(ctx.targetScriptMode)) {
      issues.addIssue({
        code: 'custom',
        path: ['targetScriptMode'],
        message: `Script mode ${ctx.targetScriptMode} is not available for ${ctx.targetTrack}`,
      });
    }
  });
export type LanguageContext = z.infer<typeof LanguageContextSchema>;

/** Script options a track supports, derived from the catalog. */
export interface ScriptOptions {
  primaryScript: ScriptId;
  alternativeScripts: readonly ScriptId[];
  transliterations: readonly TransliterationSchemeId[];
  scriptModeOptions: readonly ScriptMode[];
  defaultScriptMode: ScriptMode;
  rtl: boolean;
  /** `true` when the primary script is non-Latin, i.e. a `latin`/`both` mode is meaningful. */
  hasTransliteration: boolean;
}

/** Derive the script choices a UI may offer for a track. */
export function deriveScriptOptions(trackId: CourseTrackId): ScriptOptions {
  const track = getCourseTrack(trackId);
  return {
    primaryScript: track.scripts.primary,
    alternativeScripts: track.scripts.alternatives,
    transliterations: track.scripts.transliterations,
    scriptModeOptions: track.scriptModeOptions,
    defaultScriptMode: track.defaultScriptMode,
    rtl: isRtlScript(track.scripts.primary),
    hasTransliteration: track.scripts.transliterations.length > 0,
  };
}

/** True when the target text of this context renders right-to-left. */
export const isRtlContext = (ctx: Pick<LanguageContext, 'targetTrack'>): boolean =>
  isRtlScript(getCourseTrack(ctx.targetTrack).scripts.primary);

/** Resolve the script-mode the learner asked for to one the track supports (falls back to the track default). */
export function resolveScriptMode(trackId: CourseTrackId, requested: ScriptMode | null | undefined): ScriptMode {
  const track = getCourseTrack(trackId);
  if (requested && (track.scriptModeOptions as readonly ScriptMode[]).includes(requested)) return requested;
  return track.defaultScriptMode;
}

/**
 * Build a LanguageContext from an enrollment-like record. The target variety is always
 * taken from the catalog so callers cannot accidentally pair a track with the wrong variety.
 */
export function buildLanguageContext(input: {
  uiLocale: string;
  enrollmentId: string;
  sourceLanguageCode: string;
  courseTrackId: CourseTrackId;
  scriptMode?: ScriptMode | null;
  regionalPreference?: string | null;
  learnerLevel?: LanguageContext['learnerLevel'] | null;
}): LanguageContext {
  const track = getCourseTrack(input.courseTrackId);
  return LanguageContextSchema.parse({
    uiLocale: input.uiLocale,
    enrollmentId: input.enrollmentId,
    sourceLanguage: input.sourceLanguageCode,
    targetTrack: track.id,
    targetVariety: track.targetVarietyId,
    targetScriptMode: resolveScriptMode(track.id, input.scriptMode),
    ...(input.regionalPreference ? { regionalPreference: input.regionalPreference } : {}),
    learnerLevel: input.learnerLevel ?? 'beginner',
  });
}

/** Stable cache-key fragment for context-dependent caches (manifests, TTS, prompts). */
export const languageContextCacheKey = (ctx: LanguageContext): string =>
  [ctx.targetTrack, ctx.targetVariety, ctx.sourceLanguage, ctx.targetScriptMode, ctx.regionalPreference ?? '-', ctx.learnerLevel].join('|');
