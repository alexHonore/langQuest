/**
 * Session summariser (§3.7): safe, concise learning/story memory. Raw transcripts are never persisted here;
 * outputs are PII-redacted and length-capped.
 */
import type { ConversationContext, TextReasoner } from '@langquest/contracts';
import { SessionSummarySchema, buildSummaryPrompt, type SessionSummary, type TurnRecord } from '../prompts/builders';
import { redactPii } from '../util';

export interface SummariseInput {
  context: ConversationContext;
  previousTurnSummary: string | null;
  turns: readonly TurnRecord[];
  traceId?: string;
}

export class SessionSummariser {
  constructor(private readonly reasoner: TextReasoner) {}

  async summarise(input: SummariseInput): Promise<SessionSummary> {
    if (!input.turns.length) {
      return { turnSummary: input.previousTurnSummary ?? '', persistedSummary: '', relationshipMemoryUpdate: null };
    }
    const prompt = buildSummaryPrompt({ context: input.context, previousTurnSummary: input.previousTurnSummary, turns: input.turns });
    const raw = await this.reasoner.generateStructured('learner_evaluation', input.context.language, prompt, SessionSummarySchema, { traceId: input.traceId });
    return sanitiseSummary(raw);
  }
}

export const sanitiseSummary = (raw: SessionSummary): SessionSummary => ({
  turnSummary: redactPii(raw.turnSummary).slice(0, 2000),
  persistedSummary: redactPii(raw.persistedSummary).slice(0, 1500),
  relationshipMemoryUpdate: raw.relationshipMemoryUpdate ? redactPii(raw.relationshipMemoryUpdate).slice(0, 500) : null,
});

/** Deterministic fallback when the model is unavailable: keeps the last few turns as a terse summary. */
export function fallbackTurnSummary(previous: string | null, turns: readonly TurnRecord[], maxChars = 2000): string {
  const tail = turns.slice(-6).map((t) => `${t.role === 'learner' ? 'L' : 'C'}: ${redactPii(t.text).slice(0, 120)}`).join(' | ');
  const combined = [previous, tail].filter(Boolean).join(' || ');
  return combined.length > maxChars ? combined.slice(combined.length - maxChars) : combined;
}
