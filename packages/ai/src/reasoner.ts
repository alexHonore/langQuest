/**
 * `TextReasoner` over OpenRouter (CONVENTIONS §5): every LLM text call goes through
 * `generateStructured(task, languageContext, prompt, schema)`. The Zod schema is converted to JSON schema for
 * `response_format`, the reply is validated with Zod, one repair retry is attempted on schema failure, and an
 * `ai_requests`-style record is emitted to an injectable sink for each attempt.
 */
import { z } from 'zod';
import type { AiTaskName, LanguageContext, Prompt, TextReasoner, TextReasonerOptions } from '@langquest/contracts';
import { OpenRouterError, type ChatMessage, type OpenRouterClient, type JsonSchemaResponseFormat } from './openrouter/client';
import { wrapOperatorError } from './errors';
import { redactMessages } from './openrouter/redact';
import { ModelProfileRegistry } from './profiles';
import { newId, nowIso } from './util';

/** Mirrors `ai_requests` insert columns (camelCase) — the API maps it to the ledger row. */
export interface AiRequestRecord {
  occurredAt: string;
  userId: string | null;
  enrollmentId: string | null;
  task: AiTaskName;
  provider: string;
  model: string;
  profileId: string | null;
  fallbackIndex: number;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  audioSeconds: number | null;
  estimatedCostUsd: number | null;
  success: boolean;
  errorCode: string | null;
  traceId: string;
  /** Redacted metadata only (template ids, message fingerprints, attempt). */
  redactedLog: Record<string, unknown> | null;
}

export interface AiRequestSink {
  record(entry: AiRequestRecord): void | Promise<void>;
}

/** Collects records in memory (tests, local dev). */
export class MemoryAiRequestSink implements AiRequestSink {
  readonly records: AiRequestRecord[] = [];
  record(entry: AiRequestRecord): void {
    this.records.push(entry);
  }
}

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[] | null,
    readonly rawContent: string,
  ) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}

export interface OpenRouterTextReasonerOptions {
  client: OpenRouterClient;
  profiles?: ModelProfileRegistry;
  sink?: AiRequestSink;
  /** How many repair retries after a schema failure (default 1). */
  repairRetries?: number;
  /** Pseudonymous user id for provider abuse monitoring; never an e-mail. */
  userHash?: string | null;
}

/** Convert a Zod schema to the JSON schema OpenRouter expects and decide whether `strict` can be enabled. */
export function toResponseFormat(name: string, schema: z.ZodType): JsonSchemaResponseFormat {
  const json = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  delete json.$schema;
  return { type: 'json_schema', json_schema: { name, strict: isStrictCompatible(json), schema: json } };
}

/** OpenAI-style strict mode requires every property to be required and no additionalProperties anywhere. */
export function isStrictCompatible(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(isStrictCompatible);
  if (!node || typeof node !== 'object') return true;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
    const keys = Object.keys(obj.properties as Record<string, unknown>);
    const required = Array.isArray(obj.required) ? (obj.required as string[]) : [];
    if (keys.length !== required.length || obj.additionalProperties !== false) return false;
  }
  return Object.values(obj).every(isStrictCompatible);
}

/** Extract the first JSON object/array from a reply that may contain code fences or prose. */
export function extractJson(content: string): string {
  const trimmed = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.search(/[[{]/);
  if (start < 0) return candidate;
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(close);
  return end > start ? candidate.slice(start, end + 1) : candidate.slice(start);
}

export class OpenRouterTextReasoner implements TextReasoner {
  private readonly client: OpenRouterClient;
  private readonly profiles: ModelProfileRegistry;
  private readonly sink: AiRequestSink | null;
  private readonly repairRetries: number;
  private readonly userHash: string | null;

  constructor(options: OpenRouterTextReasonerOptions) {
    this.client = options.client;
    this.profiles = options.profiles ?? new ModelProfileRegistry();
    this.sink = options.sink ?? null;
    this.repairRetries = options.repairRetries ?? 1;
    this.userHash = options.userHash ?? null;
  }

  async generateStructured<T>(task: AiTaskName, locale: LanguageContext, prompt: Prompt, schema: z.ZodType<T>, options: TextReasonerOptions = {}): Promise<T> {
    const profile = this.profiles.resolve({ task, targetVariety: locale.targetVariety, sourceLanguage: locale.sourceLanguage });
    const models = ModelProfileRegistry.modelChain(profile, options.modelOverride);
    const traceId = options.traceId ?? newId();
    const responseFormat = toResponseFormat(`${task}_${prompt.templateId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60), schema);
    const baseMessages: ChatMessage[] = [{ role: 'system', content: prompt.system }, ...(prompt.messages ?? []).map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: prompt.user }];

    let messages = baseMessages;
    let lastError: StructuredOutputError | null = null;
    for (let attempt = 0; attempt <= this.repairRetries; attempt += 1) {
      const startedAt = Date.now();
      let result;
      try {
        result = await this.client.chatCompletions(
          {
            models,
            messages,
            responseFormat,
            temperature: profile.params.temperature,
            maxTokens: profile.params.maxOutputTokens,
            topP: profile.params.topP,
            ...(this.userHash ? { user: this.userHash } : {}),
          },
          {
            timeoutMs: options.timeoutMs ?? profile.params.timeoutMs,
            maxRetries: profile.params.maxRetries,
            tags: { task, traceId, templateId: prompt.templateId, templateVersion: prompt.templateVersion },
          },
        );
      } catch (error) {
        const err = error as OpenRouterError;
        await this.emit({
          task,
          locale,
          profileId: profile.id,
          model: models[0] ?? profile.primaryModel,
          fallbackIndex: 0,
          latencyMs: Date.now() - startedAt,
          success: false,
          errorCode: err instanceof OpenRouterError ? err.kind : 'unknown',
          traceId,
          usage: null,
          cost: null,
          log: { attempt, templateId: prompt.templateId, templateVersion: prompt.templateVersion, messages: redactMessages(messages) },
        });
        throw wrapOperatorError(error, 'Text generation', 'openrouter');
      }

      const parsed = safeParse(schema, result.content);
      await this.emit({
        task,
        locale,
        profileId: profile.id,
        model: result.model,
        fallbackIndex: result.fallbackIndex,
        latencyMs: result.latencyMs,
        success: parsed.success,
        errorCode: parsed.success ? null : 'schema_validation_failed',
        traceId,
        usage: result.usage,
        cost: result.estimatedCostUsd,
        log: { attempt, templateId: prompt.templateId, templateVersion: prompt.templateVersion, requestId: result.requestId, generationId: result.generationId, provider: result.provider, finishReason: result.finishReason, messages: redactMessages(messages), strict: responseFormat.json_schema.strict ?? false },
      });
      if (parsed.success) return parsed.data;

      lastError = new StructuredOutputError(`Model output failed schema validation for task ${task}`, parsed.issues, result.content);
      // Repair instruction: show the raw output and the validation issues; ask for corrected JSON only.
      messages = [
        ...baseMessages,
        { role: 'assistant', content: result.content.slice(0, 6000) },
        {
          role: 'user',
          content: `Your previous reply did not match the required JSON schema. Problems:\n${formatIssues(parsed.issues)}\nReturn ONLY a corrected JSON object that satisfies the schema. Keep the same language, script and variety constraints as instructed.`,
        },
      ];
    }
    throw lastError ?? new StructuredOutputError('Structured generation failed', null, '');
  }

  private async emit(input: {
    task: AiTaskName;
    locale: LanguageContext;
    profileId: string;
    model: string;
    fallbackIndex: number;
    latencyMs: number;
    success: boolean;
    errorCode: string | null;
    traceId: string;
    usage: { inputTokens: number | null; outputTokens: number | null } | null;
    cost: number | null;
    log: Record<string, unknown>;
  }): Promise<void> {
    if (!this.sink) return;
    await this.sink.record({
      occurredAt: nowIso(),
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
      redactedLog: { ...input.log, targetVariety: input.locale.targetVariety, sourceLanguage: input.locale.sourceLanguage, learnerLevel: input.locale.learnerLevel },
    });
  }
}

type SafeParseOutcome<T> = { success: true; data: T } | { success: false; issues: z.ZodIssue[] | null };

function safeParse<T>(schema: z.ZodType<T>, content: string): SafeParseOutcome<T> {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(content));
  } catch (error) {
    return { success: false, issues: [{ code: 'custom', path: [], message: `Reply is not valid JSON: ${(error as Error).message}`, input: content } as z.ZodIssue] };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { success: true, data: parsed.data };
  return { success: false, issues: parsed.error.issues as z.ZodIssue[] };
}

const formatIssues = (issues: z.ZodIssue[] | null): string =>
  (issues ?? [])
    .slice(0, 12)
    .map((i) => `- ${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('\n') || '- (no details)';
