/**
 * Provider adapter interfaces (§8.2). `@langquest/ai` implements them; everything else
 * only depends on these boundaries so providers stay replaceable.
 */
import type { z } from 'zod';
import type { LanguageContext } from '../language-context';
import type { Capability, PronunciationFeature } from './capability';
import type { AudioInput, AudioOutput, PronunciationInput, PronunciationResult, TranscriptResult } from './io';
import type { ShortLivedSession, VoiceSessionConfig } from './conversation';
import type { AiTaskName } from './model-profile';

/** A prompt handed to the text reasoner. Learner-personal content stays out of cacheable parts. */
export interface Prompt {
  /** Stable, cacheable instructions (may be cached by provider). */
  system: string;
  /** Per-call user content. */
  user: string;
  /** Prompt template id + version for logging (never the raw template to clients). */
  templateId: string;
  templateVersion: string;
  /** Few-shot or prior messages when needed; keep compact (§8.3). */
  messages?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
}

export interface TextReasonerOptions {
  /** Override the profile's primary model (admin test harness only). */
  modelOverride?: string;
  timeoutMs?: number;
  /** Trace id propagated to `ai_requests`. */
  traceId?: string;
}

/** All text-based language reasoning goes through here (OpenRouter-backed). */
export interface TextReasoner {
  generateStructured<T>(task: AiTaskName, locale: LanguageContext, prompt: Prompt, schema: z.ZodType<T>, options?: TextReasonerOptions): Promise<T>;
}

export interface SpeechRecognizer {
  readonly provider: string;
  supports(locale: string, audioType?: string): Promise<Capability>;
  transcribe(audio: AudioInput, locale: string): Promise<TranscriptResult>;
}

export interface SpeechSynthesizer {
  readonly provider: string;
  supports(locale: string, voiceId?: string): Promise<Capability>;
  synthesize(text: string, locale: string, voiceId: string): Promise<AudioOutput>;
}

export interface RealtimeConversationProvider {
  readonly provider: string;
  supports(locale: string, interruptible: boolean): Promise<Capability>;
  createSession(config: VoiceSessionConfig): Promise<ShortLivedSession>;
}

export interface PronunciationAssessor {
  readonly provider: string;
  supports(locale: string, feature: PronunciationFeature): Promise<boolean>;
  /** Full capability detail (preferred over the boolean form when choosing a route). */
  capability(locale: string): Promise<Capability>;
  assess(input: PronunciationInput): Promise<PronunciationResult>;
}

/** Registry that resolves adapters per task and locale with capability checks (no variety crossing). */
export interface CapabilityRegistry {
  recognizerFor(locale: string): Promise<{ adapter: SpeechRecognizer; capability: Capability } | null>;
  synthesizerFor(locale: string, voiceId?: string): Promise<{ adapter: SpeechSynthesizer; capability: Capability } | null>;
  realtimeFor(locale: string, interruptible: boolean): Promise<{ adapter: RealtimeConversationProvider; capability: Capability } | null>;
  assessorFor(locale: string, features: readonly PronunciationFeature[]): Promise<{ adapter: PronunciationAssessor; capability: Capability } | null>;
}
