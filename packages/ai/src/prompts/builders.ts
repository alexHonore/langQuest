/**
 * Prompt builders for the character agent, evaluator, explanation overlay and session summariser.
 * Every prompt: compact context (§8.3), variety guard block, source-language coaching instruction.
 * Templates carry ids/versions for `ai_requests` logs; raw prompts never reach clients.
 */
import { z } from 'zod';
import {
  AutonomyLevelSchema,
  CharacterTurnGenerationSchema,
  ObservationOutcomeSchema,
  ObservationTypeSchema,
  PriorityCorrectionSchema,
  UnitIntervalSchema,
  getCourseTrack,
  tracksForVariety,
  type ConversationCommand,
  type ConversationContext,
  type Prompt,
  type VarietyId,
} from '@langquest/contracts';
import { coachingLanguageInstruction, getPromptPack, resolveRegionalPreference, varietyGuardInstruction } from './packs';

export const PROMPT_VERSIONS = {
  character: '2026-10-14.1',
  explanation: '2026-10-14.1',
  evaluator: '2026-10-14.1',
  summary: '2026-10-14.1',
} as const;

export interface CharacterPersona {
  id: string;
  name: string;
  role: string;
  region: string | null;
  personality: string;
  voiceId: string | null;
  speechSpeed: 'slow' | 'normal' | 'fast';
}

export interface TurnRecord {
  role: 'learner' | 'character';
  text: string;
  /** ASR confidence for learner turns (null for typed text). */
  confidence?: number | null;
  command?: ConversationCommand | null;
}

const levelGuidance: Record<ConversationContext['language']['learnerLevel'], string> = {
  beginner: 'Use very short sentences (max ~8 words), high-frequency words, one idea per turn. Ask one simple question at a time.',
  elementary: 'Short sentences, everyday vocabulary, occasional new word with context.',
  intermediate: 'Natural sentence length; idioms allowed when common; keep turns under 3 sentences.',
  upper_intermediate: 'Natural speech with regional colour; still keep turns under 4 sentences.',
  advanced: 'Fully natural speech, nuance and humour welcome; keep turns conversational, not monologues.',
};

const transliterationInstruction = (variety: VarietyId, scriptMode: ConversationContext['language']['targetScriptMode']): string => {
  const track = tracksForVariety(variety)[0] ?? getCourseTrack('english');
  const schemes = track.scripts.transliterations;
  if (!schemes.length || scriptMode === 'native') return 'Set "transliteration" to null.';
  return `Provide "transliteration" in ${schemes[0]} for the full line (learner script mode: ${scriptMode}).`;
};

/**
 * Regional instruction derived from the enrollment's `regionalPreference` (spec A09: Levantine SY/LB/PS/JO,
 * fr-CA, es-MX…, zh-TW, sw-KE/TZ, vi north/south). Null when no preference was chosen, so nothing
 * region-specific reaches the model in that case and the track baseline applies.
 */
export function regionalInstruction(lang: ConversationContext['language']): string | null {
  const region = resolveRegionalPreference(lang.targetTrack, lang.regionalPreference);
  if (!region) return null;
  const baseline = region.baseline ? ` ${region.baseline} baseline wording applies where ${region.option?.label ?? 'the region'} has no distinct form.` : '';
  return `REGION: ${region.label} — prefer ${region.option?.label ?? region.label} wording, idioms and pronunciation notes; never flatten them to a neutral or other regional form.${baseline}`;
}

function compactContext(context: ConversationContext): string {
  const objectives = context.objectives.map((o) => `- [${o.completed ? 'done' : 'open'}] ${o.id}: ${o.description}`).join('\n');
  return [
    `Scene facts:\n${context.sceneFacts.map((f) => `- ${f}`).join('\n') || '- (none)'}`,
    `Objectives:\n${objectives || '- (free conversation)'}`,
    context.recentWeaknessSkillKeys.length ? `Learner recently struggled with: ${context.recentWeaknessSkillKeys.join(', ')} (weave gentle practice in; never lecture).` : null,
    `Conversation so far (summary): ${context.turnSummary || '(start of conversation)'}`,
    context.relationshipSummary ? `Relationship memory: ${context.relationshipSummary}` : null,
    `Register: ${context.register}. Learner level: ${context.language.learnerLevel}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildCharacterPrompt(input: {
  context: ConversationContext;
  persona: CharacterPersona;
  learnerText: string | null;
  command: ConversationCommand | null;
  lastCharacterText: string | null;
  repairHint?: string | null;
}): Prompt {
  const { context, persona } = input;
  const lang = context.language;
  const pack = getPromptPack(lang.targetVariety);
  const system = [
    `You are ${persona.name}, ${persona.role}${persona.region ? ` from ${persona.region}` : ''}. Personality: ${persona.personality}.`,
    'You are a natural, engaging conversation partner in a language-learning app. You are NOT a grammar teacher: never correct the learner mid-conversation, never explain grammar unless asked, react naturally to unexpected answers, hesitations and mistakes, and keep the scene alive without scripted dead ends.',
    levelGuidance[lang.learnerLevel],
    varietyGuardInstruction(pack, lang.sourceLanguage),
    regionalInstruction(lang),
    coachingLanguageInstruction(lang.sourceLanguage),
    `Output JSON with: "text" (your spoken line in ${pack.name}, 1–3 sentences), "transliteration", "sourceGloss" (a short translation of your line in the learner's source language ${lang.sourceLanguage}, or null when the line is trivial), "expression" (neutral|greeting|listening|talking|surprise|confusion|friendly_success|follow_up_question), "respondsToCommand" (null unless answering a learner command), "tentativeObjectiveIds" (objective ids you believe the learner just completed), "endsConversation" (true only when the scene naturally closes).`,
    transliterationInstruction(lang.targetVariety, lang.targetScriptMode),
    'Safety: supportive, never manipulative or dependency-forming; no romance, no personal data requests, no medical/legal advice. Stay in the scene.',
  ]
    .filter((p): p is string => p !== null)
    .join('\n\n');

  const userParts = [compactContext(context)];
  if (input.lastCharacterText) userParts.push(`Your previous line: """${input.lastCharacterText}"""`);
  if (input.command === 'skip') userParts.push('The learner chose to skip the current objective. Acknowledge lightly in character and move the scene forward to the next open objective (or wrap up if none).');
  else if (input.learnerText !== null) userParts.push(`Learner just said: """${input.learnerText}"""`);
  else userParts.push('The learner has just joined the scene. Open the conversation in character with a greeting and one easy question.');
  if (input.repairHint) userParts.push(`IMPORTANT — your previous attempt was rejected by the language guard: ${input.repairHint}. Rewrite strictly in ${pack.name} following the HARD RULES.`);

  return { templateId: 'character.turn', templateVersion: PROMPT_VERSIONS.character, system, user: userParts.join('\n\n') };
}

export const CharacterGenerationSchema = CharacterTurnGenerationSchema;

export const ExplanationSchema = z.object({
  /** Explanation in the learner's source language (1–3 short sentences). */
  explanation: z.string().min(1).max(600),
  /** Optional example or suggested line in the target variety. */
  example: z.object({ target: z.string().min(1).max(300), transliteration: z.string().max(300).nullable(), gloss: z.string().max(300) }).nullable(),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

export function buildExplanationPrompt(input: {
  context: ConversationContext;
  persona: CharacterPersona;
  command: Extract<ConversationCommand, 'translate' | 'example' | 'meaning' | 'hint'>;
  lastCharacterText: string | null;
  learnerText: string | null;
}): Prompt {
  const lang = input.context.language;
  const pack = getPromptPack(lang.targetVariety);
  const task = {
    translate: `Translate the character's last line into the learner's source language (${lang.sourceLanguage}). Keep it natural; set "example" to null.`,
    meaning: `Explain in the learner's source language (${lang.sourceLanguage}) what the character's last line means and when it is used, in max 3 short sentences. Set "example" to null.`,
    example: `Give one additional natural example sentence in ${pack.name} that uses the key expression from the character's last line, with transliteration (or null) and a gloss in ${lang.sourceLanguage}. "explanation" = one short sentence in ${lang.sourceLanguage}.`,
    hint: `Suggest one natural line the learner could say next in ${pack.name} to move the scene forward (put it in "example.target" with transliteration or null and a gloss in ${lang.sourceLanguage}). "explanation" = one short encouraging sentence in ${lang.sourceLanguage}.`,
  }[input.command];
  const system = [
    `You are a patient language coach helping a learner of ${pack.name}.`,
    varietyGuardInstruction(pack, lang.sourceLanguage),
    regionalInstruction(lang),
    coachingLanguageInstruction(lang.sourceLanguage),
    transliterationInstruction(lang.targetVariety, lang.targetScriptMode).replace('"transliteration"', '"example.transliteration"'),
    'Return JSON only.',
  ]
    .filter((p): p is string => p !== null)
    .join('\n\n');
  const user = [
    task,
    compactContext(input.context),
    input.lastCharacterText ? `Character's last line: """${input.lastCharacterText}"""` : 'The character has not spoken yet.',
    input.learnerText ? `Learner's last attempt: """${input.learnerText}"""` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { templateId: `explanation.${input.command}`, templateVersion: PROMPT_VERSIONS.explanation, system, user };
}

/** What the evaluator LLM emits; ids and provenance are attached by `Evaluator` afterwards. */
export const EvaluatorLlmSchema = z.object({
  objectivesCompleted: z.array(z.string()),
  skillsExercised: z.array(z.string()),
  observations: z.array(
    z.object({
      skillKey: z.string(),
      // Contract enums; `pronunciation` is excluded on purpose: only acoustic assessors may emit it (§8.5).
      observationType: ObservationTypeSchema.exclude(['pronunciation']),
      autonomy: AutonomyLevelSchema,
      hintsUsed: z.number().int().min(0),
      outcome: ObservationOutcomeSchema,
      uncertainty: UnitIntervalSchema,
      note: z.string().max(300).nullable(),
    }),
  ),
  priorityCorrections: z.array(PriorityCorrectionSchema).max(2),
  summary: z.string().max(1500),
  reviewTriggers: z.array(z.string()),
  relationshipMemoryUpdate: z.string().max(500).nullable(),
  confidence: UnitIntervalSchema,
});
export type EvaluatorLlmOutput = z.infer<typeof EvaluatorLlmSchema>;

export function buildEvaluatorPrompt(input: { context: ConversationContext; transcriptWindow: readonly TurnRecord[]; skillCatalog?: readonly string[] }): Prompt {
  const lang = input.context.language;
  const pack = getPromptPack(lang.targetVariety);
  const system = [
    `You are the learning evaluator for a ${pack.name} conversation. You run after the turn; you never interrupt the learner.`,
    'Extract: which objectives were communicatively completed (meaning over exact words, A11), which skills were exercised, structured observations, and at most TWO priority corrections that would help most (§3.6). Prefer meaning, register and intelligibility over nitpicks. Never penalise low-confidence transcripts: mark outcome "unclear" with high uncertainty instead.',
    `Do not fabricate pronunciation judgements from text: use observationType "pronunciation" never (it is reserved for acoustic scorers).`,
    varietyGuardInstruction(pack, lang.sourceLanguage),
    regionalInstruction(lang),
    coachingLanguageInstruction(lang.sourceLanguage),
    `Dialect fidelity: the learner is learning ${pack.name}; a correct ${pack.name} form is never "wrong" because it differs from ${pack.guard.negative.map((n) => n.label).join('/') || 'another variety'}${lang.regionalPreference ? ', and regional wording matching the learner\'s REGION is never "wrong" either' : ''}.`,
    'skillKey values: lowercase snake_case or dotted keys from the catalog when provided (e.g. "greetings.basic", "ordering.cafe"); invent only when nothing fits, with the same format.',
    '"summary": a concise, safe learning/story summary (no personal data, no full transcript). "relationshipMemoryUpdate": one sentence a character could remember (or null).',
    'Return JSON only.',
  ]
    .filter((p): p is string => p !== null)
    .join('\n\n');
  const transcript = input.transcriptWindow.map((t) => `${t.role === 'learner' ? 'LEARNER' : 'CHARACTER'}${t.command ? ` (command: ${t.command})` : ''}${t.confidence !== undefined && t.confidence !== null ? ` [asr confidence ${t.confidence.toFixed(2)}]` : ''}: ${t.text}`).join('\n');
  const user = [compactContext(input.context), input.skillCatalog?.length ? `Skill catalog: ${input.skillCatalog.join(', ')}` : null, `Recent turns:\n${transcript || '(no turns)'}`].filter(Boolean).join('\n\n');
  return { templateId: 'evaluator.checkpoint', templateVersion: PROMPT_VERSIONS.evaluator, system, user };
}

export const SessionSummarySchema = z.object({
  /** Rolling summary fed back into the next turn's context (compact, ≤ 2000 chars). */
  turnSummary: z.string().max(2000),
  /** Safe, concise summary persisted after the chat (source language, ≤ 1500 chars). */
  persistedSummary: z.string().max(1500),
  relationshipMemoryUpdate: z.string().max(500).nullable(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export function buildSummaryPrompt(input: { context: ConversationContext; previousTurnSummary: string | null; turns: readonly TurnRecord[] }): Prompt {
  const lang = input.context.language;
  const system = [
    'You write compact, safe memory for a language-learning conversation.',
    '"turnSummary": what happened in the scene so far, in the target variety or the source language, max 6 short sentences, no verbatim transcript.',
    `"persistedSummary": a concise learning/story summary in ${lang.sourceLanguage} that a learner would be comfortable seeing later: objectives, what went well, one thing to practise. No personal data (names of real people, places of residence, phone numbers, health, finances).`,
    '"relationshipMemoryUpdate": one sentence the character could remember about the learner in-story, or null.',
    coachingLanguageInstruction(lang.sourceLanguage),
    'Return JSON only.',
  ].join('\n\n');
  const user = [
    input.previousTurnSummary ? `Previous summary: ${input.previousTurnSummary}` : null,
    `Turns:\n${input.turns.map((t) => `${t.role === 'learner' ? 'LEARNER' : 'CHARACTER'}: ${t.text}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { templateId: 'summary.session', templateVersion: PROMPT_VERSIONS.summary, system, user };
}
