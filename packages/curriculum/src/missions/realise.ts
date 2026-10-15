/**
 * `realise(blueprint, languageContext, expressions)` — bind a language-independent
 * blueprint to a concrete `LanguageContext` and a pool of candidate expressions.
 *
 * Invariants (CONVENTIONS §5, spec §2.3, §8.4):
 *  - expressions from another variety are never used (no ary→arb, yue→cmn, ht→fr…);
 *  - source-language meanings come only from the enrollment's source language;
 *  - missing material is reported honestly (`complete: false`, `missingSlots`), never faked.
 */
import { z } from 'zod';
import {
  ScriptIdSchema,
  SourceLanguageCodeSchema,
  TransliterationSchemeIdSchema,
  VarietyIdSchema,
  RegisterSchema,
  UnitIntervalSchema,
  deriveScriptOptions,
  getVariety,
  isForbiddenSubstitution,
  type LanguageContext,
  type LessonType,
  type MissionStepType,
  type MissionType,
  type Register,
  type ScriptMode,
} from '@langquest/contracts';
import { getIntent } from '../intents';
import { fnv1a32, Seeded } from '../planner/random';
import { blueprintIntentKeys, blueprintSkillKeys, expandTemplate, type BlueprintStep, type MissionBlueprint, type TemplateOptions } from './blueprint';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const ExpressionFormSchema = z.object({
  script: ScriptIdSchema.nullable(),
  transliterationScheme: TransliterationSchemeIdSchema.nullable(),
  text: z.string().min(1),
});
export type ExpressionForm = z.infer<typeof ExpressionFormSchema>;

export const ExpressionAudioRefSchema = z.object({
  assetId: z.string().min(1),
  speechRate: z.enum(['slow', 'normal', 'fast']),
  synthetic: z.boolean(),
  regionalOption: z.string().nullable().default(null),
});
export type ExpressionAudioRef = z.infer<typeof ExpressionAudioRefSchema>;

export const SourceMeaningSchema = z.object({
  meaning: z.string().min(1),
  contextNote: z.string().nullable().default(null),
  literalGloss: z.string().nullable().default(null),
});
export type SourceMeaning = z.infer<typeof SourceMeaningSchema>;

/** A candidate expression as loaded from the DB (or seed content) for realisation. */
export const ExpressionCandidateSchema = z.object({
  id: z.string().min(1),
  intentKey: z.string().min(1),
  targetVarietyId: VarietyIdSchema,
  canonicalText: z.string().min(1),
  forms: z.array(ExpressionFormSchema).default([]),
  /** Meanings keyed by source language; realisation only uses the enrollment's source. */
  meanings: z.partialRecord(SourceLanguageCodeSchema, SourceMeaningSchema),
  register: RegisterSchema,
  difficulty: UnitIntervalSchema.default(0.3),
  audio: z.array(ExpressionAudioRefSchema).default([]),
  scenarioTags: z.array(z.string()).default([]),
  /** Honest provenance/QA flags; drafts are allowed in previews but surfaced. */
  nativeReviewed: z.boolean().default(false),
});
export type ExpressionCandidate = z.infer<typeof ExpressionCandidateSchema>;
export type ExpressionCandidateInput = z.input<typeof ExpressionCandidateSchema>;

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface RealisedExpression {
  id: string;
  slotId: string;
  intentKey: string;
  speaker: 'learner' | 'character';
  canonicalText: string;
  /** Forms filtered to the learner's script mode (native first). */
  displayForms: ExpressionForm[];
  meaning: string;
  contextNote: string | null;
  register: Register;
  audio: ExpressionAudioRef[];
  nativeReviewed: boolean;
}

export interface Hint {
  level: 1 | 2 | 3;
  kind: 'meaning' | 'first_word' | 'reveal';
  /** Learner-facing text (source-language meaning or target text). */
  text: string;
  /** Autonomy recorded if this hint was used before success. */
  autonomy: 'hinted' | 'heavily_hinted' | 'revealed';
}

export interface SuccessConditions {
  /** Observation outcome needed to mark the step successful. */
  minOutcome: 'success' | 'partial';
  /** Intent keys (or acceptable paraphrases) that satisfy the step. */
  acceptedIntentKeys: string[];
  /** Objectives the conversation step must complete (ids from the blueprint). */
  requiredObjectiveIds: string[];
  /** The learner must attempt (or explicitly choose reveal) before the model answer plays. */
  requiresAttemptBeforeReveal: boolean;
  /** Hints allowed before the attempt counts as `revealed`. */
  maxHintsForAutonomy: number;
  /** Intents that fail the step for inappropriate meaning/register. */
  rejectIntentKeys: string[];
}

export interface StepBranching {
  rules: { when: 'all_required_completed' | 'partial' | 'none' | 'learner_asked_repair'; goTo: 'next' | 'retry_current' | 'feedback' | 'conversation_again' | 'end'; memoryNote: string | null }[];
  /** Max times the conversation step can be re-entered. */
  maxRetries: number;
}

export interface RealisedStep {
  /** Deterministic id: `<missionKey>.<order>.<type>`. */
  id: string;
  order: number;
  phase: BlueprintStep['phase'];
  type: MissionStepType;
  lessonType: LessonType;
  estimatedSeconds: number;
  prompt: {
    /** i18n key under the locales package (`curriculum.step.<type>.instruction`). */
    instructionKey: string;
    params: Record<string, string>;
  };
  expressions: RealisedExpression[];
  expectedIntentKeys: string[];
  successConditions: SuccessConditions;
  hintScaffold: Hint[];
  branching: StepBranching | null;
  offlineCapable: boolean;
  producesObservations: boolean;
}

export interface RejectedCandidate {
  expressionId: string;
  reason: 'wrong_variety' | 'forbidden_substitution' | 'missing_source_meaning' | 'unused_intent';
}

export interface RealisedMission {
  /** `<blueprintKey>@<variety>/<source>` — stable per (blueprint, variety, source). */
  missionKey: string;
  blueprintKey: string;
  titleKey: string;
  type: MissionType;
  level: MissionBlueprint['level'];
  targetTrack: LanguageContext['targetTrack'];
  targetVariety: LanguageContext['targetVariety'];
  sourceLanguage: LanguageContext['sourceLanguage'];
  scriptMode: ScriptMode;
  rtl: boolean;
  situation: MissionBlueprint['situation'];
  learnerRole: string;
  characterRole: string;
  objectives: { id: string; intentKeys: string[]; skillKeys: string[]; required: boolean }[];
  skillKeys: string[];
  intentKeys: string[];
  /** Scene variant chosen for this realisation (seeded, so retries vary). */
  scene: { variantId: string; sceneFacts: string[]; twist: string | null; codeSwitchNorms: string };
  steps: RealisedStep[];
  recommendedMinutes: number;
  estimatedSeconds: number;
  /** False when a required slot could not be filled; never silently substituted. */
  complete: boolean;
  missingSlots: string[];
  rejectedCandidates: RejectedCandidate[];
  /** True when every learner-facing expression is native-reviewed. */
  nativeReviewed: boolean;
}

export interface RealiseOptions extends TemplateOptions {
  /** Seed for scene-variant choice (e.g. enrollmentId + attempt count). Defaults to the mission key. */
  variantSeed?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Select the forms to display for a script mode; native script forms come first. */
export function selectDisplayForms(forms: readonly ExpressionForm[], mode: ScriptMode): ExpressionForm[] {
  const native = forms.filter((f) => f.script !== null && f.transliterationScheme === null);
  const latin = forms.filter((f) => f.transliterationScheme !== null);
  if (mode === 'native') return native.length ? native : latin;
  if (mode === 'latin') return latin.length ? latin : native;
  return [...native, ...latin];
}

const firstWord = (text: string): string => {
  const words = text.trim().split(/\s+/);
  return words[0] ?? text;
};

/** Build the 3-level hint scaffold for an expression (meaning → first word → reveal). */
export function buildHintScaffold(expression: RealisedExpression): Hint[] {
  const primary = expression.displayForms[0]?.text ?? expression.canonicalText;
  return [
    { level: 1, kind: 'meaning', text: expression.meaning, autonomy: 'hinted' },
    { level: 2, kind: 'first_word', text: firstWord(primary), autonomy: 'heavily_hinted' },
    { level: 3, kind: 'reveal', text: expression.displayForms.map((f) => f.text).join(' · ') || expression.canonicalText, autonomy: 'revealed' },
  ];
}

const registerDistance = (a: Register, b: Register): number => {
  const order: Register[] = ['formal', 'polite', 'neutral', 'casual', 'intimate', 'slang'];
  return Math.abs(order.indexOf(a) - order.indexOf(b));
};

// ---------------------------------------------------------------------------
// realise()
// ---------------------------------------------------------------------------

/**
 * Realise a blueprint for a language context from candidate expressions.
 *
 * Deterministic for identical inputs. Throws only on structurally invalid input;
 * missing or mismatched content is reported, not thrown.
 */
export function realise(
  blueprint: MissionBlueprint,
  ctx: LanguageContext,
  candidates: readonly ExpressionCandidateInput[],
  options: RealiseOptions = {},
): RealisedMission {
  const pool = candidates.map((c) => ExpressionCandidateSchema.parse(c));
  const scriptOptions = deriveScriptOptions(ctx.targetTrack);
  const variety = getVariety(ctx.targetVariety);
  const missionKey = `${blueprint.key}@${ctx.targetVariety}/${ctx.sourceLanguage}`;
  const rejected: RejectedCandidate[] = [];
  const wantedIntents = new Set(blueprint.slots.map((s) => s.intentKey));

  // 1. Filter candidates: variety boundary + source meaning present.
  const usable: ExpressionCandidate[] = [];
  for (const c of pool) {
    if (c.targetVarietyId !== ctx.targetVariety) {
      rejected.push({ expressionId: c.id, reason: isForbiddenSubstitution(ctx.targetVariety, c.targetVarietyId) ? 'forbidden_substitution' : 'wrong_variety' });
      continue;
    }
    if (!c.meanings[ctx.sourceLanguage]) {
      rejected.push({ expressionId: c.id, reason: 'missing_source_meaning' });
      continue;
    }
    if (!wantedIntents.has(c.intentKey)) {
      rejected.push({ expressionId: c.id, reason: 'unused_intent' });
      continue;
    }
    usable.push(c);
  }

  // 2. Fill slots (best register match, then lowest difficulty, then stable id order).
  const bound: RealisedExpression[] = [];
  const missingSlots: string[] = [];
  const used = new Set<string>();
  for (const slot of blueprint.slots) {
    const matches = usable
      .filter((c) => c.intentKey === slot.intentKey && !used.has(c.id))
      .sort((a, b) => registerDistance(a.register, slot.register) - registerDistance(b.register, slot.register) || a.difficulty - b.difficulty || a.id.localeCompare(b.id));
    const pick = matches[0];
    if (!pick) {
      if (slot.required) missingSlots.push(slot.slotId);
      continue;
    }
    used.add(pick.id);
    const meaning = pick.meanings[ctx.sourceLanguage]!;
    bound.push({
      id: pick.id,
      slotId: slot.slotId,
      intentKey: slot.intentKey,
      speaker: slot.speaker,
      canonicalText: pick.canonicalText,
      displayForms: selectDisplayForms(pick.forms, ctx.targetScriptMode),
      meaning: meaning.meaning,
      contextNote: meaning.contextNote,
      register: pick.register,
      audio: pick.audio,
      nativeReviewed: pick.nativeReviewed,
    });
  }

  // 3. Scene variant (seeded).
  const seed = fnv1a32(options.variantSeed ?? missionKey);
  const variant = blueprint.sceneVariants[new Seeded(seed).int(blueprint.sceneVariants.length)]!;

  // 4. Steps.
  const includeScriptSupport = options.includeScriptSupport ?? (scriptOptions.hasTransliteration && ctx.targetScriptMode !== 'latin');
  const template = expandTemplate(blueprint, { ...options, includeScriptSupport, level: options.level ?? ctx.learnerLevel });
  const learnerIntents = blueprint.slots.filter((s) => s.speaker === 'learner').map((s) => s.intentKey);
  const requiredObjectiveIds = blueprint.objectives.filter((o) => o.required).map((o) => o.id);
  const rejectIntentKeys = [...new Set([...blueprint.rejectIntentKeys, 'insult'])];
  const steps: RealisedStep[] = template.map((t, order) => {
    const expressions = t.slots === 'none' ? [] : bound.filter((e) => t.slots === 'all' || e.speaker === t.slots);
    const expected = t.type === 'character_conversation' || t.type === 'story_branch' ? [...new Set(blueprint.objectives.flatMap((o) => o.intentKeys))] : [...new Set(expressions.filter((e) => e.speaker === 'learner').map((e) => e.intentKey))];
    const hintScaffold = t.hintsAllowed ? expressions.filter((e) => e.speaker === 'learner').flatMap((e) => buildHintScaffold(e)) : [];
    const isConversation = t.type === 'character_conversation' || t.type === 'story_branch';
    return {
      id: `${missionKey}.${order}.${t.type}`,
      order,
      phase: t.phase,
      type: t.type,
      lessonType: t.lessonType,
      estimatedSeconds: t.seconds,
      prompt: {
        instructionKey: `curriculum.step.${t.type}.instruction`,
        params: {
          learnerRole: blueprint.learnerRole,
          characterRole: blueprint.characterRole,
          situation: blueprint.situation,
          sceneVariant: variant.id,
          expressionCount: String(expressions.length),
        },
      },
      expressions,
      expectedIntentKeys: expected.length ? expected : learnerIntents,
      successConditions: {
        minOutcome: isConversation || t.type === 'anticipation' ? 'success' : 'partial',
        acceptedIntentKeys: expected.length ? expected : learnerIntents,
        requiredObjectiveIds: isConversation ? requiredObjectiveIds : [],
        requiresAttemptBeforeReveal: t.attemptBeforeReveal,
        maxHintsForAutonomy: t.hintsAllowed ? 1 : 0,
        rejectIntentKeys,
      },
      hintScaffold,
      branching: isConversation
        ? {
            rules: blueprint.branching.length
              ? blueprint.branching
              : [
                  { when: 'all_required_completed', goTo: 'next', memoryNote: null },
                  { when: 'partial', goTo: 'feedback', memoryNote: null },
                  { when: 'none', goTo: 'conversation_again', memoryNote: null },
                  { when: 'learner_asked_repair', goTo: 'retry_current', memoryNote: null },
                ],
            maxRetries: 2,
          }
        : null,
      offlineCapable: t.offlineCapable && expressions.every((e) => e.audio.length > 0),
      producesObservations: t.producesObservations,
    };
  });

  const learnerExpressions = bound.filter((e) => e.speaker === 'learner');
  return {
    missionKey,
    blueprintKey: blueprint.key,
    titleKey: blueprint.titleKey,
    type: blueprint.missionType,
    level: blueprint.level,
    targetTrack: ctx.targetTrack,
    targetVariety: ctx.targetVariety,
    sourceLanguage: ctx.sourceLanguage,
    scriptMode: ctx.targetScriptMode,
    rtl: scriptOptions.rtl,
    situation: blueprint.situation,
    learnerRole: blueprint.learnerRole,
    characterRole: blueprint.characterRole,
    objectives: blueprint.objectives.map((o) => ({ id: o.id, intentKeys: [...o.intentKeys], skillKeys: [...o.skillKeys], required: o.required })),
    skillKeys: [...blueprintSkillKeys(blueprint)],
    intentKeys: [...blueprintIntentKeys(blueprint)],
    scene: { variantId: variant.id, sceneFacts: [...variant.sceneFacts], twist: variant.twist, codeSwitchNorms: variety.codeSwitchNorms },
    steps,
    recommendedMinutes: blueprint.recommendedMinutes,
    estimatedSeconds: steps.reduce((a, s) => a + s.estimatedSeconds, 0),
    complete: missingSlots.length === 0,
    missingSlots,
    rejectedCandidates: rejected,
    nativeReviewed: learnerExpressions.length > 0 && learnerExpressions.every((e) => e.nativeReviewed),
  };
}

/** Intent descriptions for a realised step (for prompt builders in `@langquest/ai`). */
export const describeExpectedIntents = (step: RealisedStep): { intentKey: string; description: string; variants: string[] }[] =>
  step.expectedIntentKeys.map((k) => {
    const i = getIntent(k);
    return { intentKey: k, description: i.description, variants: [...i.acceptableVariants] };
  });
