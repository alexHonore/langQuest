/**
 * Zod schemas for the remaining local adapter routes (shared by handlers and client forms).
 * Speakers, collections / chapters / lessons, lesson assets and content rights moved to the
 * LangQuest API (`@langquest/contracts` `adminSpeaker*`, `adminCollection*`, `adminChapter*`,
 * `adminLesson*`, `adminContentRights*`); the schemas below are the cross-package gaps still
 * served locally (coverage editorial status, transcript segments, job retry, role grants,
 * revision rollback, model probes, profile upserts).
 */
import { z } from 'zod';
import { CourseTrackIdSchema, CoverageStatusSchema, LanguageCodeSchema, PROCESSING_JOB_TYPE_VALUES_ALL, RoleSchema, TranslationQaStateSchema, UuidSchema, VarietyIdSchema } from '@langquest/contracts';

export const CoverageMetricsSchema = z.object({
  mission_instructions_pct: z.number().min(0).max(100),
  explanations_pct: z.number().min(0).max(100),
  ui_pct: z.number().min(0).max(100),
  subtitles_pct: z.number().min(0).max(100),
  audio_overlays_pct: z.number().min(0).max(100),
});
export type CoverageMetrics = z.infer<typeof CoverageMetricsSchema>;

export const CoverageUpdateSchema = z.object({
  courseTrackId: CourseTrackIdSchema,
  sourceLanguageCode: LanguageCodeSchema,
  status: CoverageStatusSchema,
  metrics: CoverageMetricsSchema,
  nativeReviewed: z.boolean(),
  editorialNoteKey: z.string().max(200).nullable().default(null),
  fallbackSourceLanguageCode: LanguageCodeSchema.nullable().default(null),
});
export type CoverageUpdate = z.infer<typeof CoverageUpdateSchema>;

export const TranscriptSegmentInputSchema = z.object({
  sortIndex: z.number().int().min(0),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  text: z.string().max(5000),
  speakerLabel: z.string().max(120).nullable().default(null),
  speakerId: UuidSchema.nullable().default(null),
  languageCode: z.string().max(12).nullable().default(null),
  targetVarietyId: VarietyIdSchema.nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
  reviewed: z.boolean().default(false),
  translations: z.array(z.object({ languageCode: LanguageCodeSchema, text: z.string().max(5000), qaState: TranslationQaStateSchema.default('needs_review') })).default([]),
});
export type TranscriptSegmentInput = z.infer<typeof TranscriptSegmentInputSchema>;

export const TranscriptReplaceSchema = z.object({
  primaryLanguageCode: z.string().min(2).max(12),
  languageMode: z.enum(['source', 'target', 'mixed']).default('mixed'),
  status: z.enum(['edited', 'reviewed']).default('edited'),
  qaState: TranslationQaStateSchema.default('needs_review'),
  accessRights: z.enum(['internal_only', 'learners', 'public']).default('internal_only'),
  durationMs: z.number().int().min(0).nullable().default(null),
  segments: z.array(TranscriptSegmentInputSchema).max(20000),
  note: z.string().max(500).optional(),
});
export type TranscriptReplace = z.infer<typeof TranscriptReplaceSchema>;

export const JobRetrySchema = z.object({ priority: z.number().int().min(0).max(10).optional() });

export const RoleGrantSchema = z.object({ userId: UuidSchema, role: RoleSchema, expiresAt: z.string().datetime({ offset: true }).nullable().default(null) });
export const RoleRevokeSchema = z.object({ userId: UuidSchema, role: RoleSchema });

export const RollbackSchema = z.object({
  entityTable: z.enum(['audio_lessons', 'audio_course_collections', 'audio_chapters', 'missions', 'lesson_courses', 'expressions', 'characters', 'visual_assets']),
  entityId: UuidSchema,
  revision: z.number().int().min(0),
  note: z.string().max(500).optional(),
});

export const ModelTestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('prompt'),
    models: z.array(z.string().min(1)).min(1).max(5),
    prompt: z.string().min(1).max(4000),
    system: z.string().max(4000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(4096).optional(),
  }),
  z.object({ mode: z.literal('synthesize'), model: z.string().min(1), text: z.string().min(1).max(1000), voice: z.string().max(120).optional() }),
  z.object({ mode: z.literal('transcribe'), model: z.string().min(1), audioBase64: z.string().min(1), format: z.string().min(1).max(10), language: z.string().max(12).optional() }),
]);
export type ModelTest = z.infer<typeof ModelTestSchema>;

export const ProfileLocalUpsertSchema = z.object({
  id: UuidSchema.optional(),
  task: z.string(),
  targetVariety: VarietyIdSchema.nullable(),
  sourceLanguage: LanguageCodeSchema.nullable(),
  provider: z.string(),
  primaryModel: z.string().min(1),
  fallbackModels: z.array(z.string().min(1)),
  params: z.record(z.string(), z.unknown()),
  latencyClass: z.enum(['realtime', 'interactive', 'batch']),
  dailyBudgetUsd: z.number().min(0).nullable(),
  expectedVersion: z.number().int().min(0).optional(),
});

/** Every job type the DB domain accepts (base ∪ migration-100 extension); filters must offer all of them. */
export const JOB_TYPES = PROCESSING_JOB_TYPE_VALUES_ALL;
