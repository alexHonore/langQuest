/**
 * Batch-oriented `TextReasoner` for the content factory.
 *
 * Cross-package gap: `@langquest/ai`'s `OpenRouterTextReasoner` always sends the profile's
 * `maxOutputTokens` (4000 for `content_generation`), and models with hidden reasoning spend most of
 * that budget before emitting JSON, so long drafts come back truncated (`finish_reason: length`).
 * This adapter reuses the package's client, profile registry, response-format builder and request
 * ledger shape, but lets the caller raise the output budget and reports truncation explicitly.
 * It is only used by batch scripts; interactive paths keep the package reasoner.
 */
import type { z } from 'zod';
import type { AiTaskName, LanguageContext, Prompt, TextReasoner, TextReasonerOptions } from '@langquest/contracts';
import { ModelProfileRegistry, StructuredOutputError, extractJson, newId, toResponseFormat, type AiRequestSink, type ChatCompletionRequest, type ChatCompletionResult, type ChatMessage } from '@langquest/ai';

export interface ChatClientLike {
  chatCompletions(req: ChatCompletionRequest, options?: { timeoutMs?: number; maxRetries?: number; tags?: Record<string, string> }): Promise<ChatCompletionResult>;
}

export interface ScriptsReasonerOptions {
  client: ChatClientLike;
  profiles?: ModelProfileRegistry;
  sink?: AiRequestSink | null;
  /** Output token budget per call (default 12000; reasoning tokens count against it). */
  maxOutputTokens?: number;
  repairRetries?: number;
  modelOverride?: string | null;
}

const formatIssues = (issues: z.ZodIssue[] | null): string => (issues ?? []).slice(0, 12).map((i) => `- ${i.path.join('.') || '$'}: ${i.message}`).join('\n') || '- output was not valid JSON';

export class ScriptsTextReasoner implements TextReasoner {
  private readonly client: ChatClientLike;
  private readonly profiles: ModelProfileRegistry;
  private readonly sink: AiRequestSink | null;
  private readonly maxOutputTokens: number;
  private readonly repairRetries: number;
  private readonly modelOverride: string | null;

  constructor(options: ScriptsReasonerOptions) {
    this.client = options.client;
    this.profiles = options.profiles ?? new ModelProfileRegistry();
    this.sink = options.sink ?? null;
    this.maxOutputTokens = options.maxOutputTokens ?? 12000;
    this.repairRetries = options.repairRetries ?? 1;
    this.modelOverride = options.modelOverride ?? null;
  }

  async generateStructured<T>(task: AiTaskName, locale: LanguageContext, prompt: Prompt, schema: z.ZodType<T>, options: TextReasonerOptions = {}): Promise<T> {
    const profile = this.profiles.resolve({ task, targetVariety: locale.targetVariety, sourceLanguage: locale.sourceLanguage });
    const models = ModelProfileRegistry.modelChain(profile, options.modelOverride ?? this.modelOverride ?? undefined);
    const traceId = options.traceId ?? newId();
    const responseFormat = toResponseFormat(`${task}_${prompt.templateId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60), schema);
    const base: ChatMessage[] = [{ role: 'system', content: prompt.system }, ...(prompt.messages ?? []).map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: prompt.user }];
    let messages = base;
    let lastError: StructuredOutputError | null = null;
    for (let attempt = 0; attempt <= this.repairRetries; attempt += 1) {
      const startedAt = Date.now();
      let result: ChatCompletionResult;
      try {
        result = await this.client.chatCompletions(
          { models, messages, responseFormat, temperature: profile.params.temperature, maxTokens: this.maxOutputTokens, topP: profile.params.topP },
          { timeoutMs: options.timeoutMs ?? Math.max(profile.params.timeoutMs ?? 60_000, 120_000), maxRetries: profile.params.maxRetries, tags: { task, traceId, templateId: prompt.templateId, templateVersion: prompt.templateVersion, reasoner: 'scripts' } },
        );
      } catch (error) {
        await this.record({ task, locale, profileId: profile.id, model: models[0] ?? profile.primaryModel, fallbackIndex: 0, latencyMs: Date.now() - startedAt, success: false, errorCode: error instanceof Error ? error.name : 'unknown', traceId, usage: null, cost: null, attempt });
        throw error;
      }
      const truncated = result.finishReason === 'length';
      const parsed = safeParse(schema, result.content);
      await this.record({ task, locale, profileId: profile.id, model: result.model, fallbackIndex: result.fallbackIndex, latencyMs: result.latencyMs, success: parsed.success, errorCode: parsed.success ? null : truncated ? 'output_truncated' : 'schema_validation_failed', traceId, usage: result.usage, cost: result.estimatedCostUsd, attempt });
      if (parsed.success) return parsed.data;
      lastError = new StructuredOutputError(truncated ? `Model output truncated at ${this.maxOutputTokens} tokens (finish_reason=length) for task ${task}` : `Model output failed schema validation for task ${task}`, parsed.issues, result.content);
      if (truncated) break; // a repair turn would truncate again; let the caller raise the budget
      messages = [...base, { role: 'assistant', content: result.content.slice(0, 6000) }, { role: 'user', content: `Your previous reply did not match the required JSON schema. Problems:\n${formatIssues(parsed.issues)}\nReturn ONLY a corrected JSON object that satisfies the schema. Keep the same language, script and variety constraints as instructed.` }];
    }
    throw lastError ?? new StructuredOutputError('Structured generation failed', null, '');
  }

  private async record(input: { task: AiTaskName; locale: LanguageContext; profileId: string; model: string; fallbackIndex: number; latencyMs: number; success: boolean; errorCode: string | null; traceId: string; usage: ChatCompletionResult['usage'] | null; cost: number | null; attempt: number }): Promise<void> {
    if (!this.sink) return;
    await this.sink.record({
      occurredAt: new Date().toISOString(),
      userId: null,
      enrollmentId: input.locale.enrollmentId,
      task: input.task,
      provider: 'openrouter',
      model: input.model,
      profileId: input.profileId,
      fallbackIndex: input.fallbackIndex,
      latencyMs: input.latencyMs,
      inputTokens: input.usage?.inputTokens ?? null,
      outputTokens: input.usage?.outputTokens ?? null,
      audioSeconds: null,
      estimatedCostUsd: input.cost,
      success: input.success,
      errorCode: input.errorCode,
      traceId: input.traceId,
      redactedLog: { attempt: input.attempt, reasoner: 'scripts', targetVariety: input.locale.targetVariety, sourceLanguage: input.locale.sourceLanguage },
    });
  }
}

type SafeParseOutcome<T> = { success: true; data: T } | { success: false; issues: z.ZodIssue[] | null };

function safeParse<T>(schema: z.ZodType<T>, content: string): SafeParseOutcome<T> {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(content));
  } catch (err) {
    return { success: false, issues: [{ code: 'custom', path: [], message: `Reply is not valid JSON: ${err instanceof Error ? err.message : String(err)}` } as z.ZodIssue] };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { success: true, data: parsed.data } : { success: false, issues: parsed.error.issues };
}
