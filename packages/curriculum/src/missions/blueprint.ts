/**
 * Language-independent mission blueprints and the §3.3 "~8-minute" template engine.
 *
 * A `MissionBlueprint` describes *what* a mission does (objectives as intents/skills,
 * expression slots, scene, branching) without any target-language text. The template
 * engine expands it into ordered `BlueprintStep`s, one per phase, each tagged with a
 * `MissionStepType` and a `LessonType` from §3.2. `realise()` (see `realise.ts`) then
 * binds concrete expressions for a `LanguageContext`.
 */
import { z } from 'zod';
import {
  KeySchema,
  LESSON_TYPE_VALUES,
  LearnerLevelSchema,
  LessonTypeSchema,
  MissionStepTypeSchema,
  MissionTypeSchema,
  RegisterSchema,
  type LEARNER_LEVEL_VALUES,
  type LearningSpeed,
  type LessonType,
  type MissionStepType,
  type MissionType,
} from '@langquest/contracts';
import { isIntentKey } from '../intents';
import { SituationTagSchema, isSkillKey } from '../skills';

// ---------------------------------------------------------------------------
// Blueprint schema
// ---------------------------------------------------------------------------

export const BlueprintObjectiveSchema = z.object({
  /** Stable id within the blueprint (e.g. `greet`). Reported back in `EvaluatorOutput.objectivesCompleted`. */
  id: z.string().regex(/^[a-z0-9_]+$/),
  /** Any one of these intents (or an acceptable paraphrase) completes the objective. */
  intentKeys: z.array(KeySchema).min(1),
  skillKeys: z.array(KeySchema).min(1),
  /** Optional objectives do not block mission success. */
  required: z.boolean().default(true),
});
export type BlueprintObjective = z.infer<typeof BlueprintObjectiveSchema>;

export const ExpressionSlotSchema = z.object({
  /** Stable slot id within the blueprint (e.g. `greeting`). */
  slotId: z.string().regex(/^[a-z0-9_]+$/),
  intentKey: KeySchema,
  /** Preferred register when several expressions realise the intent. */
  register: RegisterSchema.default('polite'),
  /** Who says it: learner slots are produced, character slots are understood. */
  speaker: z.enum(['learner', 'character']).default('learner'),
  required: z.boolean().default(true),
});
export type ExpressionSlot = z.infer<typeof ExpressionSlotSchema>;

export const SceneVariantSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  /** Language-neutral scene facts the character agent must respect (never target text). */
  sceneFacts: z.array(z.string()).min(1),
  /** Language-neutral twist the character introduces so phrasing varies (§3.3). */
  twist: z.string().nullable().default(null),
});
export type SceneVariant = z.infer<typeof SceneVariantSchema>;

export const BranchRuleSchema = z.object({
  /** Objective id or `any`. */
  when: z.enum(['all_required_completed', 'partial', 'none', 'learner_asked_repair']),
  /** Step kind the flow moves to next. */
  goTo: z.enum(['next', 'retry_current', 'feedback', 'conversation_again', 'end']),
  /** Relationship memory delta applied when the branch fires (language-neutral, concise). */
  memoryNote: z.string().max(200).nullable().default(null),
});
export type BranchRule = z.infer<typeof BranchRuleSchema>;

export const MissionBlueprintSchema = z.object({
  /** Stable key (`missions.template_key`), e.g. `cafe_order_drink`. */
  key: KeySchema,
  /** i18n key for the title; realised titles come from localized seeds/catalogs. */
  titleKey: z.string().min(1),
  missionType: MissionTypeSchema,
  level: LearnerLevelSchema,
  situation: SituationTagSchema,
  /** Role the learner plays (language-neutral). */
  learnerRole: z.string().min(1),
  /** Role of the main character (language-neutral), mapped to a `characters.character_key` per track. */
  characterRole: z.string().min(1),
  objectives: z.array(BlueprintObjectiveSchema).min(1),
  slots: z.array(ExpressionSlotSchema).min(1),
  sceneVariants: z.array(SceneVariantSchema).min(1),
  /** Intents that, if produced, are flagged as inappropriate for this scene (beyond global `offensive`). */
  rejectIntentKeys: z.array(KeySchema).default([]),
  branching: z.array(BranchRuleSchema).default([]),
  prerequisiteSkillKeys: z.array(KeySchema).default([]),
  /** Target duration in minutes for the standard template (scaled by learner pace). */
  recommendedMinutes: z.number().min(2).max(30).default(8),
  /** When true, the mission also gets a script-support step on non-Latin tracks. */
  scriptSupport: z.boolean().default(true),
});
export type MissionBlueprint = z.infer<typeof MissionBlueprintSchema>;
export type MissionBlueprintInput = z.input<typeof MissionBlueprintSchema>;

/** Parse + referential validation of a blueprint. Throws with a readable message. */
export function defineBlueprint(input: MissionBlueprintInput): MissionBlueprint {
  const bp = MissionBlueprintSchema.parse(input);
  const problems = validateBlueprint(bp);
  if (problems.length) throw new Error(`Invalid blueprint ${bp.key}: ${problems.join('; ')}`);
  return bp;
}

/** Referential checks against the skill/intent registries; empty when valid. */
export function validateBlueprint(bp: MissionBlueprint): string[] {
  const problems: string[] = [];
  const slotIds = new Set<string>();
  for (const s of bp.slots) {
    if (slotIds.has(s.slotId)) problems.push(`duplicate slot ${s.slotId}`);
    slotIds.add(s.slotId);
    if (!isIntentKey(s.intentKey)) problems.push(`slot ${s.slotId}: unknown intent ${s.intentKey}`);
  }
  const objectiveIds = new Set<string>();
  for (const o of bp.objectives) {
    if (objectiveIds.has(o.id)) problems.push(`duplicate objective ${o.id}`);
    objectiveIds.add(o.id);
    for (const k of o.intentKeys) if (!isIntentKey(k)) problems.push(`objective ${o.id}: unknown intent ${k}`);
    for (const k of o.skillKeys) if (!isSkillKey(k)) problems.push(`objective ${o.id}: unknown skill ${k}`);
  }
  for (const k of bp.rejectIntentKeys) if (!isIntentKey(k)) problems.push(`unknown reject intent ${k}`);
  for (const k of bp.prerequisiteSkillKeys) if (!isSkillKey(k)) problems.push(`unknown prerequisite skill ${k}`);
  return problems;
}

/** Union of skill keys across all objectives (deduplicated, stable order). */
export const blueprintSkillKeys = (bp: MissionBlueprint): readonly string[] => [...new Set(bp.objectives.flatMap((o) => o.skillKeys))];
/** Union of intent keys across objectives and learner slots. */
export const blueprintIntentKeys = (bp: MissionBlueprint): readonly string[] =>
  [...new Set([...bp.objectives.flatMap((o) => o.intentKeys), ...bp.slots.filter((s) => s.speaker === 'learner').map((s) => s.intentKey)])];

// ---------------------------------------------------------------------------
// Template engine (§3.3)
// ---------------------------------------------------------------------------

/** The five phases of the standard template (§3.3), plus `support` for optional script steps. */
export const TEMPLATE_PHASE_VALUES = ['context', 'model', 'anticipate', 'converse', 'feedback', 'support'] as const;
export const TemplatePhaseSchema = z.enum(TEMPLATE_PHASE_VALUES);
export type TemplatePhase = z.infer<typeof TemplatePhaseSchema>;

/** Which slots a step draws expressions from. */
export const SlotSelectorSchema = z.enum(['all', 'learner', 'character', 'none']);
export type SlotSelector = z.infer<typeof SlotSelectorSchema>;

export const BlueprintStepSchema = z.object({
  phase: TemplatePhaseSchema,
  type: MissionStepTypeSchema,
  lessonType: LessonTypeSchema,
  /** Nominal seconds before pace scaling. */
  seconds: z.number().int().positive(),
  slots: SlotSelectorSchema,
  /** Whether the step requires the learner to attempt before any reveal (§14.1 A16). */
  attemptBeforeReveal: z.boolean(),
  /** Whether the step is runnable offline from pre-generated assets. */
  offlineCapable: z.boolean(),
  /** Whether hints are available during the step. */
  hintsAllowed: z.boolean(),
  /** Whether the step produces skill observations (vs. pure exposure). */
  producesObservations: z.boolean(),
});
export type BlueprintStep = z.infer<typeof BlueprintStepSchema>;

const step = (
  phase: TemplatePhase,
  type: MissionStepType,
  lessonType: LessonType,
  seconds: number,
  slots: SlotSelector,
  flags: Partial<Pick<BlueprintStep, 'attemptBeforeReveal' | 'offlineCapable' | 'hintsAllowed' | 'producesObservations'>> = {},
): BlueprintStep => ({
  phase,
  type,
  lessonType,
  seconds,
  slots,
  attemptBeforeReveal: flags.attemptBeforeReveal ?? false,
  offlineCapable: flags.offlineCapable ?? true,
  hintsAllowed: flags.hintsAllowed ?? true,
  producesObservations: flags.producesObservations ?? true,
});

/**
 * The standard ~8-minute template (§3.3), nominal seconds per step:
 *  ~1 min context · ~1.5 min modelled expressions · ~1.5 min anticipation ·
 *  ~3 min character conversation · ~1 min feedback/retry/recall.
 */
export const STANDARD_TEMPLATE: readonly BlueprintStep[] = [
  step('context', 'context_listening', 'listening_comprehension', 60, 'all', { producesObservations: true, hintsAllowed: false }),
  step('model', 'modeled_expression', 'shadowing', 60, 'learner', { producesObservations: false }),
  step('model', 'listen_identify', 'listen_identify', 30, 'all'),
  step('anticipate', 'anticipation', 'anticipate_speak', 90, 'learner', { attemptBeforeReveal: true }),
  step('converse', 'character_conversation', 'guided_roleplay', 180, 'all', { offlineCapable: false }),
  step('feedback', 'feedback_retry', 'pronunciation_drill', 30, 'learner'),
  step('feedback', 'review_recall', 'adaptive_review', 30, 'learner', { attemptBeforeReveal: true }),
];

/** Per-mission-type templates; the conversation phase changes lesson type, the frame stays. */
export const MISSION_TEMPLATES: Readonly<Record<MissionType, readonly BlueprintStep[]>> = {
  standard: STANDARD_TEMPLATE,
  situational: STANDARD_TEMPLATE.map((s) => (s.type === 'character_conversation' ? { ...s, lessonType: 'situational_task' } : s)),
  story: [
    ...STANDARD_TEMPLATE.slice(0, 4),
    step('converse', 'character_conversation', 'mission_story', 150, 'all', { offlineCapable: false }),
    step('converse', 'story_branch', 'mission_story', 30, 'none', { offlineCapable: false, hintsAllowed: false }),
    ...STANDARD_TEMPLATE.slice(5),
  ],
  review: [
    step('context', 'context_listening', 'listening_comprehension', 20, 'all', { hintsAllowed: false }),
    step('anticipate', 'review_recall', 'adaptive_review', 60, 'learner', { attemptBeforeReveal: true }),
    step('converse', 'character_conversation', 'guided_roleplay', 60, 'all', { offlineCapable: false }),
    step('feedback', 'feedback_retry', 'pronunciation_drill', 20, 'learner'),
  ],
  free_conversation: [
    step('context', 'context_listening', 'listening_comprehension', 30, 'all', { hintsAllowed: false }),
    step('converse', 'character_conversation', 'free_conversation', 300, 'all', { offlineCapable: false }),
    step('feedback', 'feedback_retry', 'adaptive_review', 60, 'learner'),
  ],
  audio_linked: [
    step('context', 'context_listening', 'audio_course_linked', 120, 'none', { hintsAllowed: false }),
    step('model', 'modeled_expression', 'shadowing', 60, 'learner', { producesObservations: false }),
    step('model', 'comprehension_check', 'listening_comprehension', 45, 'all'),
    step('anticipate', 'anticipation', 'anticipate_speak', 60, 'learner', { attemptBeforeReveal: true }),
    step('converse', 'character_conversation', 'guided_roleplay', 120, 'all', { offlineCapable: false }),
    step('feedback', 'review_recall', 'adaptive_review', 30, 'learner', { attemptBeforeReveal: true }),
  ],
  pronunciation: [
    step('model', 'modeled_expression', 'shadowing', 60, 'learner', { producesObservations: false }),
    step('model', 'pronunciation_drill', 'pronunciation_drill', 150, 'learner'),
    step('anticipate', 'anticipation', 'anticipate_speak', 60, 'learner', { attemptBeforeReveal: true }),
    step('feedback', 'feedback_retry', 'pronunciation_drill', 60, 'learner'),
  ],
};

/** Optional step appended on non-Latin tracks when the learner's script mode shows the native script. */
export const SCRIPT_SUPPORT_STEP: BlueprintStep = step('support', 'script_support', 'script_support', 45, 'learner', { producesObservations: false });

/** Audio-only / Pimsleur mode re-labels the template for hands-free use (§3.2). */
export function toAudioOnlyTemplate(template: readonly BlueprintStep[]): readonly BlueprintStep[] {
  return template
    .filter((s) => s.type !== 'listen_identify' && s.type !== 'script_support' && s.type !== 'story_branch')
    .map((s) => ({ ...s, lessonType: 'audio_only' as const, hintsAllowed: false, offlineCapable: true }));
}

/** Every lesson type from §3.2 is reachable from at least one template (or the audio-only / script-support variants). */
export function lessonTypesCoveredByTemplates(): readonly LessonType[] {
  const set = new Set<LessonType>();
  for (const t of Object.values(MISSION_TEMPLATES)) for (const s of t) set.add(s.lessonType);
  set.add(SCRIPT_SUPPORT_STEP.lessonType);
  for (const s of toAudioOnlyTemplate(STANDARD_TEMPLATE)) set.add(s.lessonType);
  return LESSON_TYPE_VALUES.filter((lt) => set.has(lt));
}

/** Pace multiplier applied to nominal step durations. */
export const PACE_FACTORS: Readonly<Record<LearningSpeed, number>> = { relaxed: 1.25, regular: 1, intensive: 0.85 };

/** Level multiplier: beginners get a little more time per step. */
const LEVEL_FACTORS: Readonly<Record<(typeof LEARNER_LEVEL_VALUES)[number], number>> = {
  beginner: 1.1,
  elementary: 1,
  intermediate: 0.95,
  upper_intermediate: 0.9,
  advanced: 0.85,
};

export interface TemplateOptions {
  pace?: LearningSpeed;
  level?: (typeof LEARNER_LEVEL_VALUES)[number];
  /** Override target minutes; the nominal template is scaled proportionally. */
  targetMinutes?: number;
  includeScriptSupport?: boolean;
  audioOnly?: boolean;
}

/** Total nominal seconds of a template. */
export const templateSeconds = (template: readonly BlueprintStep[]): number => template.reduce((a, s) => a + s.seconds, 0);

/**
 * Expand a blueprint into ordered steps with pace/level/target-minute scaling.
 * Pure and deterministic.
 */
export function expandTemplate(bp: MissionBlueprint, options: TemplateOptions = {}): readonly BlueprintStep[] {
  let template = MISSION_TEMPLATES[bp.missionType];
  if (options.audioOnly) template = toAudioOnlyTemplate(template);
  else if (options.includeScriptSupport && bp.scriptSupport) template = [...template, SCRIPT_SUPPORT_STEP];
  const nominal = templateSeconds(template);
  const targetSeconds = (options.targetMinutes ?? bp.recommendedMinutes) * 60;
  const scale = (targetSeconds / nominal) * PACE_FACTORS[options.pace ?? 'regular'] * LEVEL_FACTORS[options.level ?? 'elementary'];
  return template.map((s) => ({ ...s, seconds: Math.max(10, Math.round(s.seconds * scale)) }));
}
