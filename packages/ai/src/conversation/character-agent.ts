/**
 * Character agent (§3.7, §8.3): natural in-dialect replies from a compact, safe context; handles the learner
 * commands slower / repeat / translate / example / meaning / hint / skip; every generated line passes the
 * language guard (re-prompt once, then native recovery line + quality incident — never silent mislabeling).
 */
import { CharacterTurnSchema, type CharacterTurn, type ConversationCommand, type ConversationContext, type LearnerTurnInput, type TextReasoner } from '@langquest/contracts';
import { CharacterGenerationSchema, ExplanationSchema, buildCharacterPrompt, buildExplanationPrompt, type CharacterPersona } from '../prompts/builders';
import { LanguageGuard, type GuardResult } from '../prompts/language-guard';
import { getPromptPack } from '../prompts/packs';
import { newId } from '../util';

export interface CharacterRespondInput {
  context: ConversationContext;
  persona: CharacterPersona;
  learnerInput: LearnerTurnInput | null;
  lastCharacterText: string | null;
  traceId?: string;
  /** Abort signal for barge-in cancellation. */
  signal?: AbortSignal;
}

export interface CharacterAgentResult {
  turn: CharacterTurn;
  guard: GuardResult | null;
  usedRecoveryLine: boolean;
  /** `slower`/`repeat` replay the previous line; the API applies the slow TTS rate. */
  playbackRate: number;
  model: string | null;
}

export interface CharacterResponder {
  respond(input: CharacterRespondInput): Promise<CharacterAgentResult>;
}

export interface CharacterAgentOptions {
  reasoner: TextReasoner;
  guard?: LanguageGuard;
  idFactory?: () => string;
  clock?: () => number;
}

const SLOW_RATE = 0.75;

export class CharacterAgent implements CharacterResponder {
  private readonly reasoner: TextReasoner;
  private readonly guard: LanguageGuard;
  private readonly idFactory: () => string;
  private readonly clock: () => number;

  constructor(options: CharacterAgentOptions) {
    this.reasoner = options.reasoner;
    this.guard = options.guard ?? new LanguageGuard();
    this.idFactory = options.idFactory ?? newId;
    this.clock = options.clock ?? Date.now;
  }

  async respond(input: CharacterRespondInput): Promise<CharacterAgentResult> {
    const startedAt = this.clock();
    const command = input.learnerInput?.kind === 'command' ? input.learnerInput.command : null;
    if (command === 'slower' || command === 'repeat') return this.replay(input, command, startedAt);
    if (command === 'translate' || command === 'meaning' || command === 'example' || command === 'hint') return this.explain(input, command, startedAt);
    return this.generate(input, command, startedAt);
  }

  private async replay(input: CharacterRespondInput, command: 'slower' | 'repeat', startedAt: number): Promise<CharacterAgentResult> {
    const pack = getPromptPack(input.context.language.targetVariety);
    const text = input.lastCharacterText ?? pack.recoveryLine.text;
    const turn = this.makeTurn(input, { text, transliteration: input.lastCharacterText ? null : pack.recoveryLine.transliteration, sourceGloss: null, expression: 'talking', respondsToCommand: command, tentativeObjectiveIds: [], endsConversation: false }, null, startedAt);
    return { turn, guard: null, usedRecoveryLine: !input.lastCharacterText, playbackRate: command === 'slower' ? SLOW_RATE : 1, model: null };
  }

  private async explain(input: CharacterRespondInput, command: 'translate' | 'meaning' | 'example' | 'hint', startedAt: number): Promise<CharacterAgentResult> {
    const learnerText = null;
    const prompt = buildExplanationPrompt({ context: input.context, persona: input.persona, command, lastCharacterText: input.lastCharacterText, learnerText });
    const explanation = await this.reasoner.generateStructured('source_explanation', input.context.language, prompt, ExplanationSchema, { traceId: input.traceId });
    const pack = getPromptPack(input.context.language.targetVariety);
    const spoken = explanation.example?.target ?? input.lastCharacterText ?? pack.recoveryLine.text;
    let guard: GuardResult | null = null;
    let text = spoken;
    let transliteration = explanation.example?.transliteration ?? null;
    let usedRecoveryLine = false;
    if (explanation.example) {
      guard = await this.guard.check(explanation.example.target, input.context.language, { task: 'source_explanation', allowTransliterationOnly: false });
      if (!guard.ok) {
        text = input.lastCharacterText ?? pack.recoveryLine.text;
        transliteration = input.lastCharacterText ? null : pack.recoveryLine.transliteration;
        usedRecoveryLine = !input.lastCharacterText;
      }
    }
    const turn = this.makeTurn(input, { text, transliteration, sourceGloss: explanation.explanation, expression: command === 'hint' ? 'friendly_success' : 'talking', respondsToCommand: command, tentativeObjectiveIds: [], endsConversation: false }, null, startedAt);
    return { turn, guard, usedRecoveryLine, playbackRate: 1, model: null };
  }

  private async generate(input: CharacterRespondInput, command: ConversationCommand | null, startedAt: number): Promise<CharacterAgentResult> {
    const learnerText = learnerTextOf(input.learnerInput);
    if (input.learnerInput?.kind === 'audio' && learnerText === null) {
      throw new Error('Audio learner turns must be transcribed before the character agent runs (transcriptHint missing)');
    }
    const pack = getPromptPack(input.context.language.targetVariety);
    let repairHint: string | null = null;
    let lastGuard: GuardResult | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      input.signal?.throwIfAborted();
      const prompt = buildCharacterPrompt({ context: input.context, persona: input.persona, learnerText, command, lastCharacterText: input.lastCharacterText, repairHint });
      const generated = await this.reasoner.generateStructured('character_dialogue', input.context.language, prompt, CharacterGenerationSchema, { traceId: input.traceId });
      input.signal?.throwIfAborted();
      const guard = await this.guard.check(generated.text, input.context.language, { task: 'character_dialogue' });
      lastGuard = guard;
      if (guard.ok) {
        const turn = this.makeTurn(input, { ...generated, respondsToCommand: command === 'skip' ? 'skip' : generated.respondsToCommand }, null, startedAt);
        return { turn, guard, usedRecoveryLine: false, playbackRate: 1, model: null };
      }
      repairHint = guard.issues.map((i) => `${i.kind}: ${i.detail}`).join('; ');
    }
    // Two failures: honest in-variety recovery line (incident already recorded by the guard).
    const turn = this.makeTurn(input, { text: pack.recoveryLine.text, transliteration: pack.recoveryLine.transliteration, sourceGloss: null, expression: 'confusion', respondsToCommand: null, tentativeObjectiveIds: [], endsConversation: false }, null, startedAt);
    return { turn, guard: lastGuard, usedRecoveryLine: true, playbackRate: 1, model: null };
  }

  private makeTurn(
    input: CharacterRespondInput,
    gen: { text: string; transliteration: string | null; sourceGloss: string | null; expression: CharacterTurn['expression']; respondsToCommand: ConversationCommand | null; tentativeObjectiveIds: string[]; endsConversation: boolean },
    model: string | null,
    startedAt: number,
  ): CharacterTurn {
    return CharacterTurnSchema.parse({
      turnId: this.idFactory(),
      characterId: input.persona.id,
      text: gen.text.slice(0, 1200),
      transliteration: gen.transliteration,
      sourceGloss: gen.sourceGloss,
      expression: gen.expression,
      respondsToCommand: gen.respondsToCommand,
      tentativeObjectiveIds: gen.tentativeObjectiveIds,
      audio: null,
      endsConversation: gen.endsConversation,
      model,
      latencyMs: Math.max(0, this.clock() - startedAt),
    });
  }
}

export const learnerTextOf = (input: LearnerTurnInput | null): string | null => {
  if (!input) return null;
  switch (input.kind) {
    case 'text':
      return input.text;
    case 'transcript':
      return input.text;
    case 'audio':
      return input.transcriptHint;
    default:
      return null;
  }
};
