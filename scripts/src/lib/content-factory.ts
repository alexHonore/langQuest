/**
 * Content factory (spec §9.8): constrained LLM generation of chapter drafts and §14.2 native-review
 * fixture suites for one (track, source language), through `@langquest/ai`'s `TextReasoner`
 * (`content_generation` task, OpenRouter) with deterministic validators.
 *
 * Honesty rules baked in:
 *  - every output is `review_needed`, `nativeReviewed: false`, `approvedForPublishing: false`;
 *  - expressions failing the language guard (wrong script / wrong variety / source-language leak) are
 *    rejected, never silently kept — dialect boundaries are not crossed;
 *  - provenance records model, prompt template id + version, trace ids and estimated cost;
 *  - nothing is published; the admin publish gate still requires native review and rights approval;
 *  - a diversity gate (`scoreDialogueDiversity`, `@langquest/curriculum`) runs before drafts are
 *    returned: a set below threshold is marked `needs_regeneration` with the reasons in the record —
 *    never dropped silently, never published. Regenerating it once with the reasons costs extra paid
 *    calls, so it runs only when the caller asks (`regenerateOnLowDiversity: true`, fixture suites and
 *    chapters alike); a retry whose dialogue text is unchanged (labels only) is never kept;
 *  - an optional second-model review (`deps.reviewer`, `content-review.ts`) annotates drafts with
 *    advisory accept / revise / reject verdicts for the native reviewer; it never approves.
 *
 * `@langquest/ai` has no content-factory module of its own (only the `content_factory` role → task
 * mapping), so the prompt builders, output schemas and validators live here (cross-package gap).
 */
import { z } from 'zod';
import { REGISTER_VALUES, buildLanguageContext, getCourseTrack, getVariety, type CourseTrackId, type LanguageContext, type Prompt, type RegisterSchema, type ScriptId, type SourceLanguageCode, type TextReasoner, type TransliterationSchemeId, type VarietyId } from '@langquest/contracts';
import { CHAPTER_1_BLUEPRINT_KEYS, DEFAULT_STORY_ARC, DIALOGUE_TURN_ACTS, INTENTS, MISSION_DIVERSITY_THRESHOLDS, defineSeedChapter, diversityRegenerationScopes, getBlueprint, getIntent, isIntentKey, scoreDialogueDiversity, type DialogueSetInput, type DiversityReport, type DiversityThresholds, type MissionBlueprint, type SeedChapter, type SeedExpressionInput, type SeedMissionInput } from '@langquest/curriculum';
import { StructuredOutputError, coachingLanguageInstruction, exemplarGloss, getPromptPack, varietyGuardInstruction, type AiRequestRecord, type GuardResult, type LanguageGuard } from '@langquest/ai';
import { SECOND_MODEL_REVIEW_TEMPLATE_VERSION, describeSecondModelReview, fixtureItemRefs, modelReviewFlags, runSecondModelReview, unreviewedState, type ItemReviewState, type ModelReviewAnnotation, type NativeVerdict, type NativeVerdictSheetRef, type NativeVerdictSummary, type ReviewItem, type SecondModelReviewSummary } from './content-review';
import { ledgerFromRecords, type GenerationLedger } from './content-ledger';
import type { ExpressionDraft } from './drafts';
import { normalizeText } from './text';

export { ledgerFromRecords, type GenerationLedger };

export const CONTENT_FACTORY_VERSION = '1.1.0';
export const PROMPT_TEMPLATE_VERSIONS = { mission: '2026-10-14.1', fixtureExpressions: '2026-10-14.1', fixtureDialogues: '2026-10-20.1', fixtureIntents: '2026-10-14.1', secondModelReview: SECOND_MODEL_REVIEW_TEMPLATE_VERSION } as const;

type Register = z.infer<typeof RegisterSchema>;

// ---------------------------------------------------------------------------
// LLM output schemas (strict-compatible: no records, no optional keys without nullable)
// ---------------------------------------------------------------------------

const FormLlmSchema = z.object({
  /** Script id for a native-script form (`Arab`, `Latn`, `Jpan`…) or null for a transliteration. */
  script: z.enum(['Arab', 'Latn', 'Hans', 'Hant', 'Cyrl', 'Grek', 'Hebr', 'Deva', 'Jpan', 'Kore']).nullable(),
  transliterationScheme: z.enum(['translit-latn', 'arabizi', 'jyutping', 'pinyin', 'romaji', 'furigana', 'revised-romanization', 'niqqud']).nullable(),
  text: z.string(),
});

const ExpressionLlmSchema = z.object({
  slotId: z.string().nullable(),
  intentKey: z.string(),
  speaker: z.enum(['learner', 'character']),
  targetText: z.string(),
  forms: z.array(FormLlmSchema),
  meaning: z.string(),
  contextNote: z.string().nullable(),
  literalGloss: z.string().nullable(),
  register: z.enum(REGISTER_VALUES),
  codeSwitchNote: z.string().nullable(),
  pronunciationNote: z.string().nullable(),
  difficulty: z.number(),
});
export type ExpressionLlm = z.infer<typeof ExpressionLlmSchema>;

export const MissionDraftLlmSchema = z.object({
  title: z.string(),
  sceneNote: z.string(),
  character: z.object({ name: z.string(), personality: z.string(), homeRegion: z.string() }),
  expressions: z.array(ExpressionLlmSchema),
  reviewerNotes: z.array(z.string()),
});
export type MissionDraftLlm = z.infer<typeof MissionDraftLlmSchema>;

export const FixtureExpressionsLlmSchema = z.object({
  expressions: z.array(z.object({ targetText: z.string(), forms: z.array(FormLlmSchema), meaning: z.string(), intentKey: z.string(), register: z.enum(REGISTER_VALUES), pronunciationNote: z.string().nullable() })),
  reviewerNotes: z.array(z.string()),
});
export const FixtureDialoguesLlmSchema = z.object({
  dialogues: z.array(
    z.object({
      title: z.string(),
      context: z.string(),
      twist: z.string(),
      turns: z.array(
        z.object({
          speaker: z.enum(['learner', 'character']),
          targetText: z.string(),
          forms: z.array(FormLlmSchema),
          meaning: z.string(),
          /** Conversational function, read by the diversity gate (defaults keep pre-2026-10-20 drafts parseable). */
          act: z.enum(DIALOGUE_TURN_ACTS).default('normal'),
          intentKey: z.string().nullable().default(null),
        }),
      ),
    }),
  ),
  reviewerNotes: z.array(z.string()),
});
export const FixtureIntentsLlmSchema = z.object({
  intents: z.array(z.object({ intentKey: z.string(), acceptablePhrasings: z.array(z.object({ targetText: z.string(), meaning: z.string(), register: z.enum(REGISTER_VALUES) })), unacceptable: z.array(z.object({ targetText: z.string(), reason: z.string() })) })),
  confusionTest: z.object({
    contrastVarietyId: z.string(),
    pairs: z.array(z.object({ meaning: z.string(), thisVariety: z.string(), contrastVariety: z.string(), note: z.string() })),
  }),
  reviewerNotes: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Briefs and prompts
// ---------------------------------------------------------------------------

export interface FactoryTarget {
  courseTrackId: CourseTrackId;
  sourceLanguage: SourceLanguageCode;
  varietyId: VarietyId;
  context: LanguageContext;
  primaryScript: ScriptId;
  transliterations: TransliterationSchemeId[];
  alternativeScripts: ScriptId[];
}

/** Resolve the generation target for a track + source (script expectations come from the catalog). */
export function resolveTarget(courseTrackId: CourseTrackId, sourceLanguage: SourceLanguageCode, enrollmentId = '00000000-0000-4000-8000-000000000000'): FactoryTarget {
  const track = getCourseTrack(courseTrackId);
  const context = buildLanguageContext({ uiLocale: sourceLanguage, enrollmentId, sourceLanguageCode: sourceLanguage, courseTrackId, scriptMode: track.scriptModeOptions.includes('both') ? 'both' : track.defaultScriptMode, learnerLevel: 'beginner' });
  return { courseTrackId, sourceLanguage, varietyId: track.targetVarietyId, context, primaryScript: track.scriptFocus ?? track.scripts.primary, transliterations: [...track.scripts.transliterations], alternativeScripts: [...track.scripts.alternatives] };
}

const formsInstruction = (t: FactoryTarget): string => {
  const parts = [`"forms" MUST contain one native-script form with script "${t.primaryScript}" and transliterationScheme null (text identical to targetText)`];
  for (const s of t.transliterations) parts.push(`one form with script "Latn" and transliterationScheme "${s}"${s === 'furigana' ? ' (reading in hiragana for every kanji, written as ruby-style "漢字(かんじ)")' : s === 'niqqud' ? ' (script "Hebr", the fully pointed spelling)' : ''}`);
  if (t.primaryScript === 'Latn' && t.transliterations.length === 0) parts.push('no transliteration forms (Latin-script language)');
  return parts.join('; ') + '.';
};

function intentLine(key: string): string {
  const i = getIntent(key);
  return `- ${key}: ${i.description} (${i.politeness} register; ≤${i.responseConstraints.typicalMaxWords} words; variants: ${i.acceptableVariants.slice(0, 3).join(' / ')})`;
}

function systemPreamble(t: FactoryTarget): string {
  const pack = getPromptPack(t.varietyId);
  const variety = getVariety(t.varietyId);
  const exemplars = pack.exemplars.slice(0, 6).map((e) => `  • ${e.target}${e.transliteration ? ` [${e.transliteration}]` : ''} — ${exemplarGloss(e, t.sourceLanguage).text}`).join('\n');
  return [
    `You are a native-speaker curriculum writer for ${pack.name} (${variety.name}; ${variety.regionalNotes}). You draft beginner material for a conversation-first language app. Everything you write will be reviewed by a native speaker before any learner sees it; write what a real local would say today, not textbook or formal language.`,
    varietyGuardInstruction(pack, t.sourceLanguage),
    `Style notes: ${pack.styleNotes.join(' ')}`,
    `Script rules: ${pack.scriptRules}`,
    `Code-switching norms: ${variety.codeSwitchNorms}`,
    `Exemplars of the expected register (imitate the tone, do not copy):\n${exemplars}`,
    coachingLanguageInstruction(t.sourceLanguage),
    `All learner-facing explanations ("meaning", "contextNote", "literalGloss", "title", "sceneNote", reviewer-independent notes) are written in the learner's source language "${t.sourceLanguage}" — never in English unless the source language is English.`,
    formsInstruction(t),
    'Return only JSON matching the schema. Do not add fields.',
  ].join('\n\n');
}

/** Prompt for one mission of the chapter. */
export function buildMissionPrompt(t: FactoryTarget, blueprint: MissionBlueprint, options: { chapterTitleKey: string; previousExpressions?: readonly string[] } = { chapterTitleKey: '' }): Prompt {
  const slots = blueprint.slots.map((s) => `- slot "${s.slotId}": intent ${s.intentKey}, spoken by the ${s.speaker}, register ${s.register}${s.required ? '' : ' (optional)'}`).join('\n');
  const intents = [...new Set(blueprint.slots.map((s) => s.intentKey))].map(intentLine).join('\n');
  const scene = blueprint.sceneVariants[0]!;
  const user = [
    `Mission blueprint "${blueprint.key}" (${blueprint.missionType}, level ${blueprint.level}, situation ${blueprint.situation}). Learner role: ${blueprint.learnerRole}. Character role: ${blueprint.characterRole}.`,
    `Scene facts: ${scene.sceneFacts.join('; ')}.${scene.twist ? ` Twist: ${scene.twist}.` : ''}`,
    `Objectives: ${blueprint.objectives.map((o) => `${o.id} (${o.intentKeys.join('|')})`).join(', ')}.`,
    `Required expression slots (one expression per slot, same slotId, same intentKey, same speaker):\n${slots}`,
    `Intent definitions:\n${intents}`,
    `Also add 1–2 extra natural variants (slotId null) for learner slots where it matters most: a casual/polite alternative, a regional wording, or a feminine/plural form. Do not invent new intents: intentKey must be one of ${[...new Set(blueprint.slots.map((s) => s.intentKey))].join(', ')}.`,
    `Never produce ${blueprint.rejectIntentKeys.length ? blueprint.rejectIntentKeys.join(', ') : 'rude or offensive'} phrasings.`,
    options.previousExpressions?.length ? `Expressions already drafted earlier in this chapter (reuse the same greeting/thanks formulas for consistency; do not duplicate): ${options.previousExpressions.slice(0, 20).join(' | ')}` : '',
    `Output JSON: {"title": mission title in ${t.sourceLanguage} (≤6 words), "sceneNote": one sentence in ${t.sourceLanguage} setting the scene for the learner, "character": {"name": a common local first name, "personality": 3–6 words, "homeRegion": city/region}, "expressions": [ {slotId, intentKey, speaker, targetText, forms, meaning (natural ${t.sourceLanguage} translation), contextNote (${t.sourceLanguage}, or null), literalGloss (word-by-word in ${t.sourceLanguage} when it helps, else null), register, codeSwitchNote (null unless a loanword/code-switch is natural), pronunciationNote (one short tip in ${t.sourceLanguage} on a hard sound, or null), difficulty 0.1–0.6} ], "reviewerNotes": [honest caveats for the native reviewer: spelling choices, gender agreement, regional alternatives]}.`,
    'Keep every learner line short (beginner), natural and useful in real life; character lines may be slightly longer but must stay beginner-comprehensible. Keep the JSON compact: contextNote/literalGloss/pronunciationNote only when they add something, reviewerNotes at most 3 short items.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { templateId: `content_factory.mission.${blueprint.key}`, templateVersion: PROMPT_TEMPLATE_VERSIONS.mission, system: systemPreamble(t), user };
}

/** Prompts for the §14.2 fixture suite (three calls). */
export function buildFixturePrompts(t: FactoryTarget): { expressions: Prompt; dialogues: Prompt; intents: Prompt } {
  const variety = getVariety(t.varietyId);
  const contrast = variety.mustNotSubstitute[0] ?? null;
  const beginnerIntents = ['greet_hello', 'thank', 'request_drink', 'ask_price', 'ask_where_is', 'ask_repeat', 'say_not_understood', 'introduce_name', 'say_goodbye', 'ask_how_are_you'].filter(isIntentKey);
  const system = systemPreamble(t);
  return {
    expressions: {
      templateId: 'content_factory.fixture.expressions',
      templateVersion: PROMPT_TEMPLATE_VERSIONS.fixtureExpressions,
      system,
      user: `Produce exactly 25 short, high-frequency beginner expressions a visitor needs in the first week (greetings, thanks, ordering, prices, directions, asking to repeat/slow down, feelings, plans). Each: {targetText, forms, meaning in ${t.sourceLanguage}, intentKey (one of: ${beginnerIntents.join(', ')}, or another key from the app's intent list if clearly better), register, pronunciationNote in ${t.sourceLanguage} or null}. Vary register and include at least 3 regional/colloquial wordings. These are an evaluation fixture: a native reviewer will mark each as correct/incorrect, so prefer the most common everyday form. Output JSON {"expressions": [...25 items], "reviewerNotes": [...]}.`,
    },
    dialogues: {
      templateId: 'content_factory.fixture.dialogues',
      templateVersion: PROMPT_TEMPLATE_VERSIONS.fixtureDialogues,
      system,
      user: `Produce exactly 10 small natural conversations (4–8 turns each) covering: an unexpected answer, regional wording, polite vs casual choice, a misunderstanding repaired, a refusal, a price negotiation, asking for help, small talk about family/work, making a plan, and a code-switch where natural. These are not quizzes: vary who opens, let the learner ask questions too, allow two turns in a row by the same speaker, and include at least two dialogues where someone misunderstands and the misunderstanding is repaired. Each dialogue: {title in ${t.sourceLanguage}, context in ${t.sourceLanguage}, twist in ${t.sourceLanguage} (what is unexpected), turns: [{speaker, targetText, forms, meaning in ${t.sourceLanguage}, act: one of ${DIALOGUE_TURN_ACTS.join(' | ')} (the turn's conversational function; "misunderstanding" for the turn that shows a misunderstanding, "repair" for the turn that fixes it), intentKey: the communicative intent key when one clearly applies (e.g. ask_repeat, say_not_understood, ask_clarification, request_drink), else null}]}. Output JSON {"dialogues": [...10], "reviewerNotes": [...]}.`,
    },
    intents: {
      templateId: 'content_factory.fixture.intents',
      templateVersion: PROMPT_TEMPLATE_VERSIONS.fixtureIntents,
      system,
      user: [
        `Produce exactly 5 beginner intents from this list: ${beginnerIntents.join(', ')}. For each: {intentKey, acceptablePhrasings: 3–5 semantically acceptable but DIFFERENT phrasings a learner might say (each {targetText, meaning in ${t.sourceLanguage}, register}), unacceptable: 1–2 phrasings that must be rejected (rude, wrong meaning, or a different intent) with the reason in ${t.sourceLanguage}}.`,
        contrast
          ? `Then one explicit confusion test between ${variety.name} (${t.varietyId}) and ${getVariety(contrast).name} (${contrast}): "confusionTest": {"contrastVarietyId": "${contrast}", "pairs": [≥5 pairs {meaning in ${t.sourceLanguage}, thisVariety: the ${variety.name} wording, contrastVariety: the ${getVariety(contrast).name} wording, note in ${t.sourceLanguage} on what differs}]}. The pairs are used to verify the app never substitutes one variety for the other.`
          : `Then one confusion test against the closest commonly confused language or register: "confusionTest": {"contrastVarietyId": "other", "pairs": [≥5 pairs {meaning in ${t.sourceLanguage}, thisVariety, contrastVariety, note in ${t.sourceLanguage}}]} (e.g. formal vs colloquial, or a neighbouring variety learners mix up).`,
        'Output JSON {"intents": [...5], "confusionTest": {...}, "reviewerNotes": [...]}.',
      ].join('\n\n'),
    },
  };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export interface ExpressionValidation {
  index: number;
  accepted: boolean;
  reasons: string[];
  warnings: string[];
  guard: GuardResult | null;
}

export interface MissionValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  expressions: ExpressionValidation[];
  missingSlots: string[];
}

const wordCount = (text: string): number => (/[぀-ヿ一-鿿]/.test(text) ? Math.ceil(text.replace(/[\s\p{P}]/gu, '').length / 2) : text.split(/\s+/).filter(Boolean).length);

/** Validate one LLM expression against the target (pure apart from the heuristic guard). */
export function validateExpression(e: Pick<ExpressionLlm, 'targetText' | 'forms' | 'meaning' | 'intentKey' | 'register'> & { speaker?: 'learner' | 'character' }, t: FactoryTarget, guard: LanguageGuard, index: number, options: { rejectIntentKeys?: readonly string[]; allowedIntentKeys?: readonly string[] } = {}): ExpressionValidation {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const text = normalizeText(e.targetText);
  if (!text) reasons.push('empty_target_text');
  if (!isIntentKey(e.intentKey)) reasons.push(`unknown_intent:${e.intentKey}`);
  else {
    const intent = getIntent(e.intentKey);
    if (intent.socialRisk === 'offensive' || intent.socialRisk === 'rude') reasons.push(`inappropriate_intent:${e.intentKey}`);
    if (options.rejectIntentKeys?.includes(e.intentKey)) reasons.push(`rejected_intent:${e.intentKey}`);
    if (options.allowedIntentKeys && !options.allowedIntentKeys.includes(e.intentKey)) reasons.push(`intent_not_in_mission:${e.intentKey}`);
    if (text && e.speaker !== 'character' && wordCount(text) > intent.responseConstraints.typicalMaxWords * 2) reasons.push('too_long_for_beginner');
    else if (text && wordCount(text) > intent.responseConstraints.typicalMaxWords) warnings.push('longer_than_typical');
  }
  if (!(REGISTER_VALUES as readonly string[]).includes(e.register)) reasons.push(`invalid_register:${e.register}`);
  if (!normalizeText(e.meaning)) reasons.push('empty_meaning');
  if (text && normalizeText(e.meaning) === text) reasons.push('meaning_equals_target');
  const native = e.forms.find((f) => f.script === t.primaryScript && f.transliterationScheme === null) ?? e.forms.find((f) => f.script && t.alternativeScripts.includes(f.script as ScriptId) && f.transliterationScheme === null);
  if (!native) reasons.push(`missing_native_form:${t.primaryScript}`);
  else if (normalizeText(native.text) !== text) warnings.push('native_form_differs_from_target');
  for (const s of t.transliterations) if (!e.forms.some((f) => f.transliterationScheme === s && f.text.trim())) reasons.push(`missing_transliteration:${s}`);
  for (const f of e.forms) if (f.script === null && f.transliterationScheme === null) reasons.push('form_without_script_or_scheme');
  let guardResult: GuardResult | null = null;
  if (text) {
    guardResult = guard.checkHeuristic(text, t.varietyId, 'native', { sourceLanguage: t.sourceLanguage, track: t.courseTrackId });
    for (const issue of guardResult.issues) {
      if (issue.kind === 'wrong_script' || issue.kind === 'wrong_variety' || issue.kind === 'source_language_leak' || issue.kind === 'wrong_han_variant') reasons.push(`guard_${issue.kind}:${issue.detail}`);
    }
    if (guardResult.ok && guardResult.positiveHits === 0 && guardResult.confidence < 0.5) warnings.push('no_variety_markers_detected');
  }
  return { index, accepted: reasons.length === 0, reasons, warnings, guard: guardResult };
}

/** Validate a mission draft against its blueprint. */
export function validateMissionDraft(draft: MissionDraftLlm, blueprint: MissionBlueprint, t: FactoryTarget, guard: LanguageGuard): MissionValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allowed = [...new Set(blueprint.slots.map((s) => s.intentKey))];
  const seen = new Set<string>();
  const expressions = draft.expressions.map((e, i) => {
    const v = validateExpression(e, t, guard, i, { rejectIntentKeys: blueprint.rejectIntentKeys, allowedIntentKeys: allowed });
    const key = normalizeText(e.targetText).toLowerCase();
    if (key && seen.has(key)) {
      v.accepted = false;
      v.reasons.push('duplicate_target_text');
    }
    seen.add(key);
    if (e.slotId) {
      const slot = blueprint.slots.find((s) => s.slotId === e.slotId);
      if (!slot) {
        v.accepted = false;
        v.reasons.push(`unknown_slot:${e.slotId}`);
      } else {
        if (slot.intentKey !== e.intentKey) {
          v.accepted = false;
          v.reasons.push(`slot_intent_mismatch:${e.slotId}`);
        }
        if (slot.speaker !== e.speaker) {
          v.accepted = false;
          v.reasons.push(`slot_speaker_mismatch:${e.slotId}`);
        }
      }
    }
    if (e.difficulty < 0 || e.difficulty > 1) warnings.push(`expression ${i}: difficulty out of range, clamped`);
    return v;
  });
  const filledSlots = new Set(draft.expressions.filter((e, i) => e.slotId && expressions[i]!.accepted).map((e) => e.slotId!));
  const missingSlots = blueprint.slots.filter((s) => s.required && !filledSlots.has(s.slotId)).map((s) => s.slotId);
  if (missingSlots.length) errors.push(`missing required slots: ${missingSlots.join(', ')}`);
  if (!normalizeText(draft.title)) errors.push('empty title');
  if (!normalizeText(draft.sceneNote)) errors.push('empty sceneNote');
  if (!draft.character.name.trim()) errors.push('empty character name');
  if (expressions.every((e) => !e.accepted)) errors.push('no expression accepted');
  return { ok: errors.length === 0, errors, warnings, expressions, missingSlots };
}

// ---------------------------------------------------------------------------
// Assembly into curriculum seed chapters and draft records
// ---------------------------------------------------------------------------

const slug = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const clamp01 = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0.3));

export interface GeneratedMission {
  blueprint: MissionBlueprint;
  draft: MissionDraftLlm;
  validation: MissionValidation;
  /** Diversity gate over the accepted learner phrasings per intent (blueprint thresholds). */
  diversity?: DiversityReport;
}

/** Seed expression key per accepted LLM expression index (the keys `assembleSeedChapter` writes). */
export function seedExpressionKeys(m: GeneratedMission): Map<number, string> {
  const used = new Set<string>();
  const keys = new Map<number, string>();
  m.draft.expressions
    .map((e, index) => ({ e, index, v: m.validation.expressions[index]! }))
    .filter(({ v }) => v.accepted)
    .forEach(({ e, index }, i) => {
      let key = e.slotId ? slug(e.slotId) : `${slug(e.intentKey)}_variant_${i + 1}`;
      while (used.has(key)) key = `${key}_x`;
      used.add(key);
      keys.set(index, key);
    });
  return keys;
}

export const seedMissionKey = (t: FactoryTarget, blueprintKey: string): string => `${t.courseTrackId.replace(/-/g, '_')}_${blueprintKey}`;

/** Build the honest `SeedChapter` from validated missions (throws if the curriculum schema rejects it). */
export function assembleSeedChapter(t: FactoryTarget, missions: readonly GeneratedMission[], generatedBy: string, notes: readonly string[]): SeedChapter {
  const trackSlug = t.courseTrackId.replace(/-/g, '_');
  const characters = new Map<string, { characterKey: string; role: string; name: string; personality: string; homeRegion: string; regionalOption: string | null }>();
  const seedMissions: SeedMissionInput[] = missions
    .filter((m) => m.validation.ok)
    .map((m) => {
      const characterKey = `${trackSlug}_${slug(m.draft.character.name) || 'character'}_${slug(m.blueprint.characterRole)}`.slice(0, 80);
      if (!characters.has(characterKey)) characters.set(characterKey, { characterKey, role: m.blueprint.characterRole, name: m.draft.character.name.trim(), personality: m.draft.character.personality.trim() || 'to be authored', homeRegion: m.draft.character.homeRegion.trim() || 'unspecified', regionalOption: null });
      const keys = seedExpressionKeys(m);
      const expressions: SeedExpressionInput[] = m.draft.expressions
        .map((e, index) => ({ e, index, v: m.validation.expressions[index]! }))
        .filter(({ v }) => v.accepted)
        .map(({ e, index }) => {
          return {
            key: keys.get(index)!,
            intentKey: e.intentKey,
            slotId: e.slotId,
            speaker: e.speaker,
            targetText: normalizeText(e.targetText),
            forms: e.forms.map((f) => ({ script: f.script, transliterationScheme: f.transliterationScheme, text: normalizeText(f.text) })).filter((f) => f.text),
            meanings: { [t.sourceLanguage]: { meaning: normalizeText(e.meaning), contextNote: e.contextNote ? normalizeText(e.contextNote) : null, literalGloss: e.literalGloss ? normalizeText(e.literalGloss) : null } },
            register: e.register as Register,
            codeSwitchNote: e.codeSwitchNote ? normalizeText(e.codeSwitchNote) : null,
            pronunciationNote: e.pronunciationNote ? normalizeText(e.pronunciationNote) : null,
            nativeReviewed: false as const,
            reviewStatus: 'review_needed' as const,
            provenance: 'ai_draft' as const,
            difficulty: clamp01(e.difficulty),
          };
        });
      return {
        key: seedMissionKey(t, m.blueprint.key),
        blueprintKey: m.blueprint.key,
        characterKey,
        titles: { [t.sourceLanguage]: normalizeText(m.draft.title) },
        sceneNotes: { [t.sourceLanguage]: normalizeText(m.draft.sceneNote) },
        expressions,
      };
    });
  return defineSeedChapter({
    key: `${trackSlug}_ch1_factory_${t.sourceLanguage}`,
    chapterIndex: 1,
    courseTrackId: t.courseTrackId,
    targetVarietyId: t.varietyId,
    sourceLanguages: [t.sourceLanguage],
    titles: { [t.sourceLanguage]: DEFAULT_STORY_ARC.chapters[0]!.titleKey },
    characters: [...characters.values()],
    missions: seedMissions,
    provenance: 'ai_draft',
    nativeReviewed: false,
    reviewStatus: 'review_needed',
    generatedBy,
    notes: [...notes],
  });
}

/** Diversity gate and second-model review results for a generated chapter (draft keys are `${missionKey}:${expressionKey}`). */
export interface ChapterQuality {
  diversity: Array<{ blueprintKey: string; missionKey: string; verdict: DiversityReport['verdict']; score: number; reasons: string[]; warnings: string[] }>;
  secondModelReview: (SecondModelReviewSummary & { annotations: Array<ModelReviewAnnotation & { draftKey: string | null }> }) | null;
}

export interface ChapterDraftRecord {
  formatVersion: 1;
  kind: 'chapter_draft';
  draftId: string;
  status: 'review_needed';
  nativeReviewed: false;
  provenance: { dataset: 'content_factory' | 'curriculum_seed'; snapshotId: string; inputs: []; evidence: string[]; importedAt: string; importer: string };
  generation: (GenerationLedger & { promptTemplateVersions: typeof PROMPT_TEMPLATE_VERSIONS; live: boolean }) | null;
  validation: Array<{ blueprintKey: string; ok: boolean; errors: string[]; warnings: string[]; accepted: number; rejected: Array<{ index: number; reasons: string[] }> }>;
  chapter: SeedChapter;
  /** Present for factory runs that carry `ChapterRunResult.quality` (absent for seed exports and older drafts). */
  quality?: ChapterQuality;
}

/** Convert an honest seed chapter into generic expression drafts (for `applyExpressionDrafts`). */
export function chapterToExpressionDrafts(record: ChapterDraftRecord): ExpressionDraft[] {
  const c = record.chapter;
  const out: ExpressionDraft[] = [];
  const reviewByKey = new Map((record.quality?.secondModelReview?.annotations ?? []).filter((a) => a.draftKey).map((a) => [a.draftKey!, a]));
  const lowDiversity = new Set((record.quality?.diversity ?? []).filter((d) => d.verdict === 'needs_regeneration').map((d) => d.missionKey));
  for (const m of c.missions) {
    for (const e of m.expressions) {
      if (e.targetText === null) continue;
      const translations = Object.entries(e.meanings).map(([code, mm]) => ({ sourceLanguageCode: code as SourceLanguageCode, text: mm!.meaning, contextNote: mm!.contextNote, literalGloss: mm!.literalGloss, upstreamId: null, rights: null, qaState: 'needs_review' as const }));
      out.push({
        formatVersion: 1,
        kind: 'expression_draft',
        draftId: `${record.draftId}:${m.key}:${e.key}`,
        status: 'review_needed',
        nativeReviewed: false,
        provenance: record.provenance,
        target: { languageCode: getCourseTrack(c.courseTrackId).languageCode, varietyId: c.targetVarietyId, varietyAssignment: 'corpus', upstreamId: `${m.key}:${e.key}`, rawText: e.targetText, text: e.targetText, script: e.forms[0]?.script ?? 'unknown' },
        forms: e.forms,
        translations,
        audio: [],
        rights: {
          licenseId: record.provenance.dataset === 'curriculum_seed' ? 'original-curriculum-draft' : 'original-ai-draft',
          licenseVersion: null,
          licenseSource: 'dataset_card',
          authors: [c.generatedBy],
          originUrl: null,
          attributionRequired: false,
          attributionText: null,
          commercialRedistribution: true,
          alterationsPermitted: true,
          aiProcessingPermitted: true,
          verified: false,
          notes: ['Original material drafted for LangQuest (AI-assisted, unreviewed). Redistribution rights are ours once a native reviewer approves; verified stays false until then.'],
        },
        curation: { intentKey: e.intentKey, intentConfidence: 1, alternativeIntentKeys: [], scenarioTags: [m.blueprintKey], register: e.register, difficulty: e.difficulty, wordCount: wordCount(e.targetText), flags: [...(e.speaker === 'character' ? ['character_line'] : []), ...(lowDiversity.has(m.key) ? ['diversity_needs_regeneration'] : []), ...modelReviewFlags(reviewByKey.get(`${m.key}:${e.key}`))] },
        checks: { languageSanity: { ok: true, reason: null }, toxicity: { toxic: false, matches: [] }, relevance: { relevant: true, reasons: [] } },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Readable failure text, including schema issues and a short raw-output excerpt for truncated JSON diagnosis. */
export function describeModelError(err: unknown): string {
  if (err instanceof StructuredOutputError) {
    const issues = (err.issues ?? []).slice(0, 5).map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; ');
    const raw = err.rawContent ?? '';
    return `${err.message}${issues ? ` [${issues}]` : ''} (raw ${raw.length} chars${raw.length ? `, ends with …${JSON.stringify(raw.slice(-80))}` : ''})`;
  }
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export interface FactoryDeps {
  reasoner: TextReasoner;
  guard: LanguageGuard;
  /** Called before each model call with the running ledger; return false to stop (budget). */
  budgetCheck?: (ledger: GenerationLedger) => boolean;
  records: () => readonly AiRequestRecord[];
  log?: (line: string) => void;
  /**
   * Second-model critic (task `language_quality_check`, routed to a different model than
   * `content_generation`). When set, drafts carry its advisory verdicts; it never approves.
   * It must have a batch output budget (e.g. `ScriptsTextReasoner`): the package-default
   * `language_quality_check` profile allows 200 output tokens / 8 s, which truncates a 20-item batch.
   */
  reviewer?: TextReasoner;
}

export interface ChapterRunResult {
  missions: GeneratedMission[];
  chapter: SeedChapter | null;
  ledger: GenerationLedger;
  aborted: string | null;
  /** Diversity gate per mission and the second-model review (set it as `ChapterDraftRecord.quality`). */
  quality: ChapterQuality;
}

export interface ChapterOptions {
  blueprintKeys?: readonly string[];
  generatedBy: string;
  retryOnValidation?: boolean;
  /** Regenerate a mission once when its diversity gate fails (default false: blueprint missions are marked, not re-run). */
  regenerateOnLowDiversity?: boolean;
  /** Overrides on top of `MISSION_DIVERSITY_THRESHOLDS`. */
  diversity?: Partial<DiversityThresholds>;
  reviewBatchSize?: number;
}

const uniqueStrings = (xs: readonly string[]): string[] => [...new Set(xs)];
const acceptedCount = (v: MissionValidation): number => v.expressions.filter((e) => e.accepted).length;
/** Fewer blocking reasons wins; on a tie, the higher score. */
const diversityImproved = (candidate: DiversityReport, current: DiversityReport): boolean => candidate.reasons.length < current.reasons.length || (candidate.reasons.length === current.reasons.length && candidate.score > current.score);

/** Diversity gate for one mission: accepted learner phrasings per intent (the blueprint fixes the turn structure). */
export function missionDiversity(draft: MissionDraftLlm, validation: MissionValidation, overrides: Partial<DiversityThresholds> = {}): DiversityReport {
  const byIntent = new Map<string, string[]>();
  draft.expressions.forEach((e, i) => {
    if (e.speaker !== 'learner' || !validation.expressions[i]?.accepted) return;
    byIntent.set(e.intentKey, [...(byIntent.get(e.intentKey) ?? []), e.targetText]);
  });
  return scoreDialogueDiversity({ dialogues: [], intents: [...byIntent].map(([intentKey, phrasings]) => ({ intentKey, phrasings })) }, { ...MISSION_DIVERSITY_THRESHOLDS, ...overrides });
}

/** Regeneration feedback naming the gate's findings for the part being re-run. */
export function diversityFeedback(report: DiversityReport, scope: 'mission' | 'intents' | 'dialogues'): string {
  const findings = report.flags.filter((f) => scope === 'mission' || f.scope === scope || f.scope === 'set').map((f) => `${f.code}${f.subject !== null ? ` (${f.subject})` : ''}: ${f.detail}`);
  const ask =
    scope === 'dialogues'
      ? 'Change the conversations themselves, not only their labels (the gate reads the text: relabelling the same lines does not pass). Vary the turn structure (who opens, questions from the learner, two turns in a row) and the words of each dialogue, include at least two dialogues where one speaker misunderstands and the other repairs it (label that turn "misunderstanding" and the reply that fixes it "repair"), and avoid question → answer drills.'
      : 'Give acceptable learner phrasings that use different words and structures: not the same sentence with one word swapped, and not punctuation, spelling or vowel-mark variants of one answer.';
  return `Your previous attempt failed the diversity gate: ${findings.join('; ')}. ${ask} Return the full JSON again.`;
}

/** Critic items for a chapter: the accepted expressions of the missions that will be assembled. */
export function chapterReviewItems(t: FactoryTarget, missions: readonly GeneratedMission[]): Array<ReviewItem & { draftKey: string }> {
  const items: Array<ReviewItem & { draftKey: string }> = [];
  for (const m of missions) {
    if (!m.validation.ok) continue;
    const keys = seedExpressionKeys(m);
    m.draft.expressions.forEach((e, i) => {
      const key = keys.get(i);
      if (!key) return;
      items.push({ ref: `missions/${m.blueprint.key}/expressions/${i}`, kind: 'expression', speaker: e.speaker, targetText: normalizeText(e.targetText), meaning: normalizeText(e.meaning), context: `${m.blueprint.situation}; ${e.slotId ? `slot ${e.slotId}` : 'extra variant'}; intent ${e.intentKey}; register ${e.register}`, draftKey: `${seedMissionKey(t, m.blueprint.key)}:${key}` });
    });
  }
  return items;
}

/** Generate chapter 1 for a target: one model call per blueprint, validated, diversity-gated, optionally critic-reviewed, assembled. */
export async function generateChapter(t: FactoryTarget, deps: FactoryDeps, options: ChapterOptions): Promise<ChapterRunResult> {
  const keys = options.blueprintKeys ?? CHAPTER_1_BLUEPRINT_KEYS;
  const missions: GeneratedMission[] = [];
  const previous: string[] = [];
  let aborted: string | null = null;
  for (const key of keys) {
    const blueprint = getBlueprint(key);
    const ledger = ledgerFromRecords(deps.records());
    if (deps.budgetCheck && !deps.budgetCheck(ledger)) {
      aborted = `budget exhausted before ${key} (spent ≈ $${ledger.estimatedCostUsd.toFixed(4)})`;
      break;
    }
    let prompt = buildMissionPrompt(t, blueprint, { chapterTitleKey: DEFAULT_STORY_ARC.chapters[0]!.titleKey, previousExpressions: previous });
    let draft: MissionDraftLlm;
    try {
      draft = await deps.reasoner.generateStructured('content_generation', t.context, prompt, MissionDraftLlmSchema);
    } catch (err) {
      aborted = `model call failed for ${key}: ${describeModelError(err)}`;
      break;
    }
    let validation = validateMissionDraft(draft, blueprint, t, deps.guard);
    let diversity = missionDiversity(draft, validation, options.diversity);
    const lowDiversity = diversity.verdict === 'needs_regeneration';
    const retryForValidation = !validation.ok && options.retryOnValidation !== false;
    const retryForDiversity = validation.ok && lowDiversity && options.regenerateOnLowDiversity === true;
    if (retryForValidation || retryForDiversity) {
      const ledger2 = ledgerFromRecords(deps.records());
      if (!deps.budgetCheck || deps.budgetCheck(ledger2)) {
        const feedback = [...validation.errors, ...validation.expressions.filter((e) => !e.accepted).map((e) => `expression ${e.index}: ${e.reasons.join(', ')}`)].join('; ');
        const parts = [prompt.user];
        if (feedback) parts.push(`Your previous attempt was rejected by the validator: ${feedback}. Fix every point and return the full JSON again.`);
        if (lowDiversity) parts.push(diversityFeedback(diversity, 'mission'));
        prompt = { ...prompt, user: parts.join('\n\n') };
        try {
          const retry = await deps.reasoner.generateStructured('content_generation', t.context, prompt, MissionDraftLlmSchema);
          const retryValidation = validateMissionDraft(retry, blueprint, t, deps.guard);
          const retryDiversity = missionDiversity(retry, retryValidation, options.diversity);
          const keep = validation.ok ? retryValidation.ok && diversityImproved(retryDiversity, diversity) : retryValidation.ok || acceptedCount(retryValidation) > acceptedCount(validation);
          if (keep) {
            draft = retry;
            validation = retryValidation;
            diversity = retryDiversity;
          }
        } catch (err) {
          deps.log?.(`retry failed for ${key}: ${describeModelError(err)}`);
        }
      }
    }
    if (diversity.verdict === 'needs_regeneration') validation.warnings.push(`diversity_gate:needs_regeneration:${diversity.reasons.join(',')}`);
    deps.log?.(`${key}: ${validation.ok ? 'ok' : 'INVALID'} — ${acceptedCount(validation)}/${validation.expressions.length} expressions accepted${validation.errors.length ? `; ${validation.errors.join('; ')}` : ''}; diversity ${diversity.verdict} (${diversity.score})`);
    missions.push({ blueprint, draft, validation, diversity });
    for (const [i, e] of draft.expressions.entries()) if (validation.expressions[i]?.accepted && e.speaker === 'learner') previous.push(e.targetText);
  }

  // Second-model review (advisory) of what will be assembled.
  let secondModelReview: ChapterQuality['secondModelReview'] = null;
  const reviewItems = deps.reviewer ? chapterReviewItems(t, missions) : [];
  if (deps.reviewer && reviewItems.length) {
    const result = await runSecondModelReview(t, reviewItems, { reviewer: deps.reviewer, guard: deps.guard, records: deps.records, budgetCheck: deps.budgetCheck, log: deps.log }, { batchSize: options.reviewBatchSize });
    const draftKeyByRef = new Map(reviewItems.map((i) => [i.ref, i.draftKey]));
    secondModelReview = { ...result.summary, annotations: result.annotations.map((a) => ({ ...a, draftKey: draftKeyByRef.get(a.ref) ?? null })) };
    for (const a of result.annotations) {
      if (a.verdict === 'accept') continue;
      const [, blueprintKey, , index] = a.ref.split('/');
      missions.find((m) => m.blueprint.key === blueprintKey)?.validation.warnings.push(`second_model_${a.verdict}:expressions/${index}:${uniqueStrings(a.issues.map((i) => i.kind)).join('+') || 'unspecified'}`);
    }
    deps.log?.(describeSecondModelReview(result.summary));
  }

  const quality: ChapterQuality = {
    diversity: missions.map((m) => ({ blueprintKey: m.blueprint.key, missionKey: seedMissionKey(t, m.blueprint.key), verdict: m.diversity!.verdict, score: m.diversity!.score, reasons: m.diversity!.reasons, warnings: m.diversity!.flags.filter((f) => f.severity === 'warn').map((f) => `${f.code}${f.subject !== null ? `:${f.subject}` : ''}`) })),
    secondModelReview,
  };
  const ledger = ledgerFromRecords(deps.records());
  let chapter: SeedChapter | null = null;
  if (missions.some((m) => m.validation.ok)) {
    const generatorModels = uniqueStrings(deps.records().filter((r) => r.task === 'content_generation').map((r) => r.model));
    try {
      chapter = assembleSeedChapter(t, missions, options.generatedBy, [
        `AI draft generated ${new Date().toISOString()} with ${generatorModels.join(', ')}; validator accepted ${missions.reduce((s, m) => s + acceptedCount(m.validation), 0)} expressions; native review required before publishing.`,
        ...missions.filter((m) => m.validation.ok && m.diversity?.verdict === 'needs_regeneration').map((m) => `${m.blueprint.key}: diversity gate marked this mission for regeneration (${m.diversity!.reasons.join(', ')}); learner intents have too few distinct phrasings.`),
        ...(secondModelReview ? [describeSecondModelReview(secondModelReview)] : []),
        ...missions.flatMap((m) => m.draft.reviewerNotes.map((n) => `${m.blueprint.key}: ${n}`)),
      ]);
    } catch (err) {
      aborted = `${aborted ? aborted + '; ' : ''}seed chapter rejected by curriculum schema: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return { missions, chapter, ledger, aborted, quality };
}

type FixtureExpressionLlm = z.infer<typeof FixtureExpressionsLlmSchema>['expressions'][number];
type FixtureDialogueLlm = z.infer<typeof FixtureDialoguesLlmSchema>['dialogues'][number];
type FixtureIntentLlm = z.infer<typeof FixtureIntentsLlmSchema>['intents'][number];
type FixtureConfusionLlm = z.infer<typeof FixtureIntentsLlmSchema>['confusionTest'];

/** Diversity gate result stored on the suite record. */
export interface FixtureDiversityGate extends DiversityReport {
  /** Calls re-run with the gate's reasons whose result was kept (it scored better and its dialogue text changed). */
  regenerated: Array<'intents' | 'dialogues'>;
  regenerationAttempts: number;
  /** Why regeneration did not run although the gate failed (not requested, or budget). */
  regenerationSkipped: string | null;
}

export interface FixtureSuiteRecord {
  formatVersion: 1;
  kind: 'fixture_suite';
  draftId: string;
  status: 'review_needed';
  nativeReviewed: false;
  courseTrackId: CourseTrackId;
  targetVarietyId: VarietyId;
  sourceLanguage: SourceLanguageCode;
  spec: '§14.2';
  requirements: { expressions: 25; dialogues: 10; intents: 5; confusionTests: 1 };
  counts: { expressions: number; dialogues: number; intents: number; confusionPairs: number };
  expressions: Array<FixtureExpressionLlm & { validation: { accepted: boolean; reasons: string[]; warnings: string[] } } & ItemReviewState>;
  dialogues: Array<FixtureDialogueLlm & { turnsFlagged: Array<{ index: number; reasons: string[] }> } & ItemReviewState>;
  intents: Array<Omit<FixtureIntentLlm, 'acceptablePhrasings' | 'unacceptable'> & { acceptablePhrasings: Array<FixtureIntentLlm['acceptablePhrasings'][number] & ItemReviewState>; unacceptable: Array<FixtureIntentLlm['unacceptable'][number] & ItemReviewState> }>;
  confusionTest: Omit<FixtureConfusionLlm, 'pairs'> & { pairs: Array<FixtureConfusionLlm['pairs'][number] & ItemReviewState>; reviewed: boolean; verdict: NativeVerdict | null };
  reviewerNotes: string[];
  gaps: string[];
  /** Diversity gate (§9.8): `needs_regeneration` sets are kept for review with the reasons, never dropped. */
  diversityGate: FixtureDiversityGate | null;
  /** Second-model review summary; per-item verdicts sit on each item's `modelReview`. */
  secondModelReview: SecondModelReviewSummary | null;
  /** Native verdict sheets ingested so far (`ingestNativeVerdicts`); the suite itself stays review_needed. */
  nativeVerdictSheets: NativeVerdictSheetRef[];
  nativeVerdictSummary: NativeVerdictSummary | null;
  /** The `content_generation` calls of this run only (incl. regeneration); the critic's calls are in `secondModelReview.ledger`. */
  generation: (GenerationLedger & { promptTemplateVersions: typeof PROMPT_TEMPLATE_VERSIONS; live: true }) | null;
  provenance: ChapterDraftRecord['provenance'];
}

export interface FixtureSuiteOptions {
  /** Overrides on top of `DEFAULT_DIVERSITY_THRESHOLDS`. */
  diversity?: Partial<DiversityThresholds>;
  /**
   * Re-run the dialogues and/or intents call once with the gate's reasons (budget-checked). Default
   * false: up to 2 extra paid calls, so a caller turns it on explicitly and plans "up to 5 model calls".
   */
  regenerateOnLowDiversity?: boolean;
  reviewBatchSize?: number;
}

const knownIntents = (intents: { intents: FixtureIntentLlm[] } | null): FixtureIntentLlm[] => (intents?.intents ?? []).filter((i) => isIntentKey(i.intentKey));

/** Diversity-gate input for a fixture suite: the dialogues plus the acceptable phrasings per known intent. */
export function fixtureDiversityInput(dialogues: readonly FixtureDialogueLlm[], intents: readonly FixtureIntentLlm[]): DialogueSetInput {
  return {
    dialogues: dialogues.map((d, i) => ({ id: `dialogues/${i}`, turns: d.turns.map((turn) => ({ speaker: turn.speaker, text: turn.targetText, act: turn.act, intentKey: turn.intentKey })) })),
    intents: intents.map((i) => ({ intentKey: i.intentKey, phrasings: i.acceptablePhrasings.map((p) => p.targetText) })),
  };
}

/** Critic items for a suite: accepted expressions, acceptable phrasings, dialogues and confusion pairs. */
export function fixtureReviewItems(suite: FixtureSuiteRecord): ReviewItem[] {
  const items: ReviewItem[] = [];
  suite.expressions.forEach((e, i) => {
    if (e.validation.accepted) items.push({ ref: `expressions/${i}`, kind: 'expression', speaker: null, targetText: normalizeText(e.targetText), meaning: normalizeText(e.meaning), context: `intent ${e.intentKey}; register ${e.register}` });
  });
  suite.intents.forEach((intent, i) => intent.acceptablePhrasings.forEach((p, j) => items.push({ ref: `intents/${i}/acceptablePhrasings/${j}`, kind: 'phrasing', speaker: 'learner', targetText: normalizeText(p.targetText), meaning: normalizeText(p.meaning), context: `acceptable phrasing for intent ${intent.intentKey}; register ${p.register}` })));
  suite.dialogues.forEach((d, i) => items.push({ ref: `dialogues/${i}`, kind: 'dialogue', speaker: null, targetText: d.turns.map((turn) => `${turn.speaker === 'learner' ? 'L' : 'C'}: ${normalizeText(turn.targetText)}`).join('\n'), meaning: d.turns.map((turn) => normalizeText(turn.meaning)).join('\n'), context: `${normalizeText(d.title)}: ${normalizeText(d.context)}; twist: ${normalizeText(d.twist)}` }));
  suite.confusionTest.pairs.forEach((p, k) => items.push({ ref: `confusionTest/pairs/${k}`, kind: 'confusion_pair', speaker: null, targetText: normalizeText(p.thisVariety), meaning: normalizeText(p.meaning), context: `must differ from ${suite.confusionTest.contrastVarietyId}: ${normalizeText(p.contrastVariety)}; ${normalizeText(p.note)}` }));
  return items;
}

/** Dialogue text only (speaker + normalised target text), to tell a real rewrite from a relabelled copy. */
const dialogueText = (dialogues: readonly FixtureDialogueLlm[]): string => JSON.stringify(dialogues.map((d) => d.turns.map((turn) => [turn.speaker, normalizeText(turn.targetText)])));

/**
 * Generate the §14.2 fixture suite (3 calls; up to 5 with `regenerateOnLowDiversity`), gate it for
 * diversity, optionally critic-review it, and validate it.
 */
export async function generateFixtureSuite(t: FactoryTarget, deps: FactoryDeps, generatedBy: string, options: FixtureSuiteOptions = {}): Promise<{ suite: FixtureSuiteRecord | null; ledger: GenerationLedger; aborted: string | null }> {
  const prompts = buildFixturePrompts(t);
  const firstRecord = deps.records().length;
  const check = (): string | null => {
    const ledger = ledgerFromRecords(deps.records());
    return deps.budgetCheck && !deps.budgetCheck(ledger) ? `budget exhausted (≈ $${ledger.estimatedCostUsd.toFixed(4)})` : null;
  };
  let aborted = check();
  let expressions: z.infer<typeof FixtureExpressionsLlmSchema> | null = null;
  let dialogues: z.infer<typeof FixtureDialoguesLlmSchema> | null = null;
  let intents: z.infer<typeof FixtureIntentsLlmSchema> | null = null;
  try {
    if (!aborted) expressions = await deps.reasoner.generateStructured('content_generation', t.context, prompts.expressions, FixtureExpressionsLlmSchema);
    aborted = aborted ?? check();
    if (!aborted) dialogues = await deps.reasoner.generateStructured('content_generation', t.context, prompts.dialogues, FixtureDialoguesLlmSchema);
    aborted = aborted ?? check();
    if (!aborted) intents = await deps.reasoner.generateStructured('content_generation', t.context, prompts.intents, FixtureIntentsLlmSchema);
  } catch (err) {
    aborted = `model call failed: ${describeModelError(err)}`;
  }
  if (!expressions && !dialogues && !intents) return { suite: null, ledger: ledgerFromRecords(deps.records()), aborted };

  // --- diversity gate, before the draft is returned/written ----------------------------------
  let diversity = scoreDialogueDiversity(fixtureDiversityInput(dialogues?.dialogues ?? [], knownIntents(intents)), options.diversity);
  const regenerated: Array<'intents' | 'dialogues'> = [];
  let regenerationAttempts = 0;
  let regenerationSkipped: string | null = null;
  if (diversity.verdict === 'needs_regeneration' && options.regenerateOnLowDiversity !== true && !aborted) regenerationSkipped = 'not requested (regenerateOnLowDiversity is off)';
  if (diversity.verdict === 'needs_regeneration' && options.regenerateOnLowDiversity === true && !aborted) {
    for (const scope of diversityRegenerationScopes(diversity)) {
      if ((scope === 'dialogues' && !dialogues) || (scope === 'intents' && !intents)) continue;
      const stop = check();
      if (stop) {
        regenerationSkipped = stop;
        break;
      }
      const base = scope === 'dialogues' ? prompts.dialogues : prompts.intents;
      const prompt = { ...base, user: `${base.user}\n\n${diversityFeedback(diversity, scope)}` };
      regenerationAttempts += 1;
      try {
        if (scope === 'dialogues') {
          const retry = await deps.reasoner.generateStructured('content_generation', t.context, prompt, FixtureDialoguesLlmSchema);
          const candidate = scoreDialogueDiversity(fixtureDiversityInput(retry.dialogues, knownIntents(intents)), options.diversity);
          // Labels are self-reported: a retry with the same lines (only `act` / `intentKey` changed) is never kept.
          const rewritten = dialogueText(retry.dialogues) !== dialogueText(dialogues?.dialogues ?? []);
          if (!rewritten) deps.log?.('diversity regeneration (dialogues): same dialogue text, labels only; kept the original');
          if (rewritten && retry.dialogues.length >= (dialogues?.dialogues.length ?? 0) && diversityImproved(candidate, diversity)) {
            dialogues = retry;
            diversity = candidate;
            regenerated.push('dialogues');
          }
        } else {
          const retry = await deps.reasoner.generateStructured('content_generation', t.context, prompt, FixtureIntentsLlmSchema);
          const candidate = scoreDialogueDiversity(fixtureDiversityInput(dialogues?.dialogues ?? [], knownIntents(retry)), options.diversity);
          if (knownIntents(retry).length >= knownIntents(intents).length && retry.confusionTest.pairs.length >= (intents?.confusionTest.pairs.length ?? 0) && diversityImproved(candidate, diversity)) {
            intents = retry;
            diversity = candidate;
            regenerated.push('intents');
          }
        }
      } catch (err) {
        deps.log?.(`diversity regeneration (${scope}) failed: ${describeModelError(err)}`);
      }
    }
  }
  deps.log?.(`diversity gate: ${diversity.verdict} (score ${diversity.score})${diversity.reasons.length ? ` — ${diversity.reasons.join(', ')}` : ''}${regenerated.length ? `; regenerated ${regenerated.join(', ')}` : ''}`);

  const gaps: string[] = [];
  const exprOut = (expressions?.expressions ?? []).map((e, i) => {
    const v = validateExpression({ ...e }, t, deps.guard, i);
    return { ...e, validation: { accepted: v.accepted, reasons: v.reasons, warnings: v.warnings }, ...unreviewedState() };
  });
  const dlgOut = (dialogues?.dialogues ?? []).map((d) => ({
    ...d,
    turnsFlagged: d.turns.map((turn, i) => ({ index: i, reasons: validateExpression({ targetText: turn.targetText, forms: turn.forms, meaning: turn.meaning, intentKey: 'greet_hello', register: 'neutral', speaker: turn.speaker }, t, deps.guard, i).reasons.filter((r) => r.startsWith('guard_') || r.startsWith('missing_')) })).filter((f) => f.reasons.length),
    ...unreviewedState(),
  }));
  const intentList = knownIntents(intents).map((i) => ({ ...i, acceptablePhrasings: i.acceptablePhrasings.map((p) => ({ ...p, ...unreviewedState() })), unacceptable: i.unacceptable.map((u) => ({ ...u, ...unreviewedState() })) }));
  for (const i of intents?.intents ?? []) if (!isIntentKey(i.intentKey)) gaps.push(`unknown intent ${i.intentKey} dropped`);
  const accepted = exprOut.filter((e) => e.validation.accepted).length;
  if (accepted < 25) gaps.push(`only ${accepted}/25 expressions passed validation`);
  if (dlgOut.length < 10) gaps.push(`only ${dlgOut.length}/10 dialogues`);
  if (intentList.length < 5) gaps.push(`only ${intentList.length}/5 intents`);
  const confusion = intents?.confusionTest ?? { contrastVarietyId: 'other', pairs: [] };
  if (confusion.pairs.length < 1) gaps.push('confusion test missing');
  if (!expressions) gaps.push('expressions call did not run');
  if (!dialogues) gaps.push('dialogues call did not run');
  if (!intents) gaps.push('intents/confusion call did not run');
  if (diversity.verdict === 'needs_regeneration') gaps.push(`diversity gate: needs regeneration (${diversity.reasons.join(', ')})`);
  if (regenerationSkipped) gaps.push(`diversity regeneration skipped: ${regenerationSkipped}`);
  const suite: FixtureSuiteRecord = {
    formatVersion: 1,
    kind: 'fixture_suite',
    draftId: `fixture:${t.courseTrackId}:${t.sourceLanguage}:${new Date().toISOString()}`,
    status: 'review_needed',
    nativeReviewed: false,
    courseTrackId: t.courseTrackId,
    targetVarietyId: t.varietyId,
    sourceLanguage: t.sourceLanguage,
    spec: '§14.2',
    requirements: { expressions: 25, dialogues: 10, intents: 5, confusionTests: 1 },
    counts: { expressions: accepted, dialogues: dlgOut.length, intents: intentList.length, confusionPairs: confusion.pairs.length },
    expressions: exprOut,
    dialogues: dlgOut,
    intents: intentList,
    confusionTest: { ...confusion, pairs: confusion.pairs.map((p) => ({ ...p, ...unreviewedState() })), reviewed: false, verdict: null },
    reviewerNotes: [...(expressions?.reviewerNotes ?? []), ...(dialogues?.reviewerNotes ?? []), ...(intents?.reviewerNotes ?? [])],
    gaps,
    diversityGate: { ...diversity, regenerated, regenerationAttempts, regenerationSkipped },
    secondModelReview: null,
    nativeVerdictSheets: [],
    nativeVerdictSummary: null,
    generation: null,
    provenance: { dataset: 'content_factory', snapshotId: `${generatedBy}`, inputs: [], evidence: [], importedAt: new Date().toISOString(), importer: `scripts/content-factory@${CONTENT_FACTORY_VERSION}` },
  };

  // --- second-model review (advisory) -----------------------------------------------------------
  const generationRecords = deps.records().slice(firstRecord);
  if (deps.reviewer) {
    const result = await runSecondModelReview(t, fixtureReviewItems(suite), { reviewer: deps.reviewer, guard: deps.guard, records: deps.records, budgetCheck: deps.budgetCheck, log: deps.log }, { batchSize: options.reviewBatchSize });
    const refs = fixtureItemRefs(suite);
    for (const a of result.annotations) {
      const item = refs.get(a.ref);
      if (item) item.modelReview = a;
    }
    suite.secondModelReview = result.summary;
    if (result.summary.status !== 'complete') gaps.push(`second-model review ${result.summary.status}: ${result.summary.unreviewedRefs.length} item(s) unreviewed${result.summary.aborted ? ` (${result.summary.aborted})` : ''}`);
    deps.log?.(describeSecondModelReview(result.summary));
  }
  // Generator calls only: the benchmark row for the generating model (`nativeVerdictBenchmarkRow`) reads this.
  suite.generation = { ...ledgerFromRecords(generationRecords), promptTemplateVersions: PROMPT_TEMPLATE_VERSIONS, live: true };
  return { suite, ledger: ledgerFromRecords(deps.records()), aborted };
}

/** The intents a fixture suite may reference (exported for tests/docs). */
export const FIXTURE_INTENT_KEYS = INTENTS.map((i) => i.intentKey);
