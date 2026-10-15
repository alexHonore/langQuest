/**
 * Honestly-labelled seed content (§9.8 content factory, §9.9 DON'Ts).
 *
 * Seeds are *drafts*: `nativeReviewed` is literally `false`, `reviewStatus` is
 * `review_needed` (drafts) or `draft` (planned skeletons), provenance is explicit, and a
 * planned skeleton never carries target text. Nothing here is publishable as-is; the
 * publication gate in the API/admin must enforce native review and rights approval.
 */
import { z } from 'zod';
import {
  CourseTrackIdSchema,
  KeySchema,
  RegisterSchema,
  ReviewStatusSchema,
  SourceLanguageCodeSchema,
  VarietyIdSchema,
  getCourseTrack,
  type DraftContent,
  type SourceLanguageCode,
} from '@langquest/contracts';
import { isIntentKey } from '../intents';
import { findBlueprint } from '../missions/scenarios';
import { ExpressionFormSchema, SourceMeaningSchema, type ExpressionCandidateInput } from '../missions/realise';

export const SeedProvenanceSchema = z.enum(['ai_draft', 'planned_skeleton']);
export type SeedProvenance = z.infer<typeof SeedProvenanceSchema>;

export const SeedExpressionSchema = z
  .object({
    /** Key unique within the mission. */
    key: KeySchema,
    intentKey: KeySchema,
    /** Blueprint slot this expression fills; `null` for extra variants. */
    slotId: z.string().nullable().default(null),
    speaker: z.enum(['learner', 'character']).default('learner'),
    /** Canonical target text; `null` ONLY for planned skeletons (never a placeholder string). */
    targetText: z.string().min(1).nullable(),
    forms: z.array(ExpressionFormSchema).default([]),
    /** Source-language overlays; each chapter source language must be present on drafts. */
    meanings: z.partialRecord(SourceLanguageCodeSchema, SourceMeaningSchema).default({}),
    register: RegisterSchema,
    codeSwitchNote: z.string().nullable().default(null),
    pronunciationNote: z.string().nullable().default(null),
    nativeReviewed: z.literal(false),
    reviewStatus: ReviewStatusSchema,
    provenance: SeedProvenanceSchema,
    difficulty: z.number().min(0).max(1).default(0.25),
  })
  .superRefine((e, issues) => {
    if (e.provenance === 'planned_skeleton' && e.targetText !== null) issues.addIssue({ code: 'custom', path: ['targetText'], message: 'planned skeletons must not carry target text' });
    if (e.provenance === 'ai_draft' && e.targetText === null) issues.addIssue({ code: 'custom', path: ['targetText'], message: 'ai drafts must carry target text' });
    if (e.provenance === 'planned_skeleton' && e.forms.length > 0) issues.addIssue({ code: 'custom', path: ['forms'], message: 'planned skeletons must not carry forms' });
    if (e.provenance === 'ai_draft' && e.reviewStatus !== 'review_needed') issues.addIssue({ code: 'custom', path: ['reviewStatus'], message: 'ai drafts must be review_needed' });
  });
export type SeedExpression = z.infer<typeof SeedExpressionSchema>;
export type SeedExpressionInput = z.input<typeof SeedExpressionSchema>;

export const SeedCharacterSchema = z.object({
  characterKey: KeySchema,
  /** Language-neutral role matching the blueprint's `characterRole`. */
  role: z.string().min(1),
  name: z.string().min(1),
  personality: z.string().min(1),
  homeRegion: z.string().min(1),
  regionalOption: z.string().nullable().default(null),
});
export type SeedCharacter = z.infer<typeof SeedCharacterSchema>;

export const SeedMissionSchema = z.object({
  key: KeySchema,
  blueprintKey: KeySchema,
  titles: z.partialRecord(SourceLanguageCodeSchema, z.string().min(1)),
  sceneNotes: z.partialRecord(SourceLanguageCodeSchema, z.string().min(1)).default({}),
  characterKey: KeySchema,
  expressions: z.array(SeedExpressionSchema),
});
export type SeedMission = z.infer<typeof SeedMissionSchema>;
export type SeedMissionInput = z.input<typeof SeedMissionSchema>;

export const SeedChapterSchema = z
  .object({
    key: KeySchema,
    chapterIndex: z.number().int().min(1),
    courseTrackId: CourseTrackIdSchema,
    targetVarietyId: VarietyIdSchema,
    sourceLanguages: z.array(SourceLanguageCodeSchema).min(1),
    titles: z.partialRecord(SourceLanguageCodeSchema, z.string().min(1)),
    characters: z.array(SeedCharacterSchema),
    missions: z.array(SeedMissionSchema).min(1),
    provenance: SeedProvenanceSchema,
    nativeReviewed: z.literal(false),
    reviewStatus: ReviewStatusSchema,
    /** Generator identity + version for provenance (§9.8). */
    generatedBy: z.string().min(1),
    /** Honest caveats shown to editors (e.g. "gender agreement to verify"). */
    notes: z.array(z.string()).default([]),
  })
  .superRefine((c, issues) => {
    const track = getCourseTrack(c.courseTrackId);
    if (track.targetVarietyId !== c.targetVarietyId) issues.addIssue({ code: 'custom', path: ['targetVarietyId'], message: `track ${c.courseTrackId} teaches ${track.targetVarietyId}` });
    for (const src of c.sourceLanguages) if (!c.titles[src]) issues.addIssue({ code: 'custom', path: ['titles', src], message: `missing chapter title for ${src}` });
    for (const [mi, m] of c.missions.entries()) {
      if (!findBlueprint(m.blueprintKey)) issues.addIssue({ code: 'custom', path: ['missions', mi, 'blueprintKey'], message: `unknown blueprint ${m.blueprintKey}` });
      if (!c.characters.some((ch) => ch.characterKey === m.characterKey)) issues.addIssue({ code: 'custom', path: ['missions', mi, 'characterKey'], message: `unknown character ${m.characterKey}` });
      for (const src of c.sourceLanguages) if (!m.titles[src]) issues.addIssue({ code: 'custom', path: ['missions', mi, 'titles', src], message: `missing mission title for ${src}` });
      const keys = new Set<string>();
      for (const [ei, e] of m.expressions.entries()) {
        if (keys.has(e.key)) issues.addIssue({ code: 'custom', path: ['missions', mi, 'expressions', ei, 'key'], message: `duplicate expression key ${e.key}` });
        keys.add(e.key);
        if (!isIntentKey(e.intentKey)) issues.addIssue({ code: 'custom', path: ['missions', mi, 'expressions', ei, 'intentKey'], message: `unknown intent ${e.intentKey}` });
        if (e.provenance === 'ai_draft') for (const src of c.sourceLanguages) if (!e.meanings[src]) issues.addIssue({ code: 'custom', path: ['missions', mi, 'expressions', ei, 'meanings', src], message: `missing ${src} meaning` });
        if (e.provenance !== c.provenance && c.provenance === 'planned_skeleton') issues.addIssue({ code: 'custom', path: ['missions', mi, 'expressions', ei, 'provenance'], message: 'skeleton chapters only hold skeleton expressions' });
      }
    }
  });
export type SeedChapter = z.infer<typeof SeedChapterSchema>;
export type SeedChapterInput = z.input<typeof SeedChapterSchema>;

/** Parse + validate a seed chapter (throws on honesty violations). */
export const defineSeedChapter = (input: SeedChapterInput): SeedChapter => SeedChapterSchema.parse(input);

/** Stable candidate id for a seed expression. */
export const seedExpressionId = (chapter: Pick<SeedChapter, 'key'>, mission: Pick<SeedMission, 'key'>, expression: Pick<SeedExpression, 'key'>): string => `${chapter.key}:${mission.key}:${expression.key}`;

/**
 * Convert a seed mission's draft expressions into `realise()` candidates. Skeleton
 * expressions (no target text) are skipped — a mission realised from a skeleton is
 * honestly `complete: false`.
 */
export function seedExpressionsToCandidates(chapter: SeedChapter, mission: SeedMission): ExpressionCandidateInput[] {
  return mission.expressions
    .filter((e) => e.targetText !== null)
    .map((e) => ({
      id: seedExpressionId(chapter, mission, e),
      intentKey: e.intentKey,
      targetVarietyId: chapter.targetVarietyId,
      canonicalText: e.targetText!,
      forms: e.forms,
      meanings: e.meanings,
      register: e.register,
      difficulty: e.difficulty,
      audio: [],
      scenarioTags: [mission.blueprintKey],
      nativeReviewed: false,
    }));
}

/**
 * A §9.8 draft projected for one source language, plus the honest list of fields that
 * still lack text in that source language (`missingSourceFields`, JSON-pointer-like
 * paths such as `mission.title` or `expressions.2.sourceMeaning`). The content factory
 * / QA queue uses it to show what still needs translating. The extra field is ignored
 * by `DraftContentSchema` (unknown keys are stripped on parse), so a `SeedDraftContent`
 * is always a valid `DraftContent`.
 */
export type SeedDraftContent = DraftContent & { missingSourceFields: string[] };

/**
 * Project a seed mission into the §9.8 draft content schema for one source language.
 *
 * Source-language overlays are keyed strictly by the requested `sourceLanguage` (spec
 * §2.1/§2.2): when a title, scene note or meaning is absent for that language the draft
 * falls back to a language-neutral key (`mission.key`, the blueprint scene-variant id)
 * or an empty string, records the path in `missingSourceFields`, and never substitutes
 * text from another source language (so a French title is never served as English).
 */
export function toDraftContent(chapter: SeedChapter, mission: SeedMission, sourceLanguage: SourceLanguageCode): SeedDraftContent {
  const bp = findBlueprint(mission.blueprintKey);
  const learnerExpressions = mission.expressions.filter((e) => e.speaker === 'learner');
  const missingSourceFields: string[] = [];

  const title = mission.titles[sourceLanguage];
  if (title === undefined) missingSourceFields.push('mission.title');
  const scene = mission.sceneNotes[sourceLanguage];
  if (scene === undefined) missingSourceFields.push('mission.scene');

  const expressions = learnerExpressions.map((e, i) => {
    const sourceMeaning = e.meanings[sourceLanguage]?.meaning;
    if (sourceMeaning === undefined) missingSourceFields.push(`expressions.${i}.sourceMeaning`);
    return {
      targetText: e.targetText ?? '',
      sourceMeaning: sourceMeaning ?? '',
      register: e.register,
      nativeReviewed: false,
      approvedForPublishing: false,
    };
  });

  return {
    intentId: bp?.objectives[0]?.intentKeys[0] ?? learnerExpressions[0]?.intentKey ?? 'greet_hello',
    targetTrack: chapter.courseTrackId,
    targetVariety: chapter.targetVarietyId,
    sourceLanguage,
    mission: {
      title: title ?? mission.key,
      level: bp?.level ?? 'beginner',
      objectiveIds: bp?.objectives.map((o) => o.id) ?? [],
      scene: scene ?? bp?.sceneVariants[0]?.id ?? '',
      characterId: mission.characterKey,
    },
    expressions,
    publication: { status: 'draft', requiresVerifiedSourceRights: true, requiresNativeReview: true },
    missingSourceFields,
  };
}
