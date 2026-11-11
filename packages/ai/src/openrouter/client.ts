/**
 * Fetch-based OpenRouter client usable from Cloudflare Workers and Node (§8.2, CONVENTIONS §5).
 *
 * - `chatCompletions` sends `models: [primary, ...fallbacks]` (server-side provider fallback) AND performs
 *   client-side sequential fallback: OpenRouter rejects an unknown or endpoint-incompatible model id up
 *   front with HTTP 400 (verified live 2026-10-14), so the client drops that id and retries the rest.
 * - Bounded retries with exponential backoff on 408/429/5xx and timeouts (AbortController).
 * - Usage → cost estimate via `PricingTable`; the provider-reported `usage.cost` wins when present.
 * - Learner text is redacted from every log line; every call carries a request id.
 * - `audio.transcriptions` (JSON base64 and multipart), `audio.speech` (bytes + mime), `models.list`.
 */
import { newId, sleepMs, bytesToBase64 } from '../util';
import { PricingTable, type ModelCatalogEntry } from './pricing';
import { redactChatRequest, redactErrorMessage } from './redact';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export type OpenRouterErrorKind =
  | 'invalid_model'
  | 'rate_limited'
  | 'timeout'
  | 'server_error'
  | 'auth'
  | 'insufficient_credits'
  | 'bad_request'
  | 'payload_too_large'
  | 'network'
  | 'unknown';

export class OpenRouterError extends Error {
  readonly kind: OpenRouterErrorKind;
  readonly status: number | null;
  readonly requestId: string;
  readonly retryable: boolean;
  /** Model id OpenRouter named in an invalid-model rejection, when parseable. */
  readonly modelId: string | null;

  constructor(kind: OpenRouterErrorKind, message: string, opts: { status?: number | null; requestId: string; modelId?: string | null; cause?: unknown }) {
    super(redactErrorMessage(message), { cause: opts.cause });
    this.name = 'OpenRouterError';
    this.kind = kind;
    this.status = opts.status ?? null;
    this.requestId = opts.requestId;
    this.modelId = opts.modelId ?? null;
    this.retryable = kind === 'rate_limited' || kind === 'timeout' || kind === 'server_error' || kind === 'network';
  }
}

export interface AiLogger {
  debug?(event: string, fields: Record<string, unknown>): void;
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}

export const silentLogger: AiLogger = { info() {}, warn() {}, error() {} };

export interface OpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injected for tests / custom runtimes. */
  fetch?: typeof fetch;
  /** Sent as `X-Title` / `HTTP-Referer` (OpenRouter app attribution; optional). */
  appName?: string;
  referer?: string;
  defaultTimeoutMs?: number;
  maxRetries?: number;
  logger?: AiLogger;
  pricing?: PricingTable;
  sleep?: (ms: number) => Promise<void>;
  requestIdFactory?: () => string;
  /** Base backoff in ms (doubles per retry, capped at 5 s, with jitter). */
  backoffBaseMs?: number;
  random?: () => number;
}

/** One part of a multimodal user message: text, or a recording (`input_audio`, base64; `wav` or `mp3`). */
export type ChatContentPart = { type: 'text'; text: string } | { type: 'input_audio'; input_audio: { data: string; format: 'wav' | 'mp3' } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** Plain text, or parts (text and audio) for models that listen. */
  content: string | readonly ChatContentPart[];
}

export interface JsonSchemaResponseFormat {
  type: 'json_schema';
  json_schema: { name: string; strict?: boolean; schema: Record<string, unknown> };
}

export interface ChatCompletionRequest {
  /** Ordered: primary first. Must all be real OpenRouter ids. */
  models: readonly string[];
  messages: readonly ChatMessage[];
  responseFormat?: JsonSchemaResponseFormat | { type: 'json_object' };
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: readonly string[];
  seed?: number;
  /** OpenRouter provider routing preferences (e.g. `{ zdr: true }`). */
  provider?: Record<string, unknown>;
  /** Pseudonymous end-user id for provider abuse monitoring; never an e-mail. */
  user?: string;
}

export interface CallOptions {
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  requestId?: string;
  /** Free-form tags for logs (task name, trace id). Never learner text. */
  tags?: Record<string, string>;
}

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  /** Cost as reported by OpenRouter (`usage.cost`), when present. */
  reportedCostUsd: number | null;
}

export interface ChatCompletionResult {
  requestId: string;
  generationId: string | null;
  model: string;
  provider: string | null;
  content: string;
  finishReason: string | null;
  usage: TokenUsage;
  /** Reported cost when available, otherwise estimated from the pricing table; `null` when unknown. */
  estimatedCostUsd: number | null;
  latencyMs: number;
  /** Index in the *original* `models` array of the model that answered. */
  fallbackIndex: number;
  attempts: number;
}

export interface TranscriptionRequest {
  model: string;
  audio: { base64: string; format: string } | { bytes: Uint8Array; format: string; mimeType?: string };
  /** ISO-639-1 hint (OpenRouter normalises it across providers). */
  language?: string;
  temperature?: number;
  responseFormat?: 'json' | 'verbose_json';
  timestampGranularities?: ReadonlyArray<'segment' | 'word'>;
  /** `json` = base64 body (default for base64 input), `multipart` = OpenAI-style form upload (default for bytes). */
  transport?: 'json' | 'multipart';
  provider?: Record<string, unknown>;
}

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  speaker: number | null;
  /** Whisper-style average log-probability when provided. */
  avgLogprob: number | null;
  noSpeechProb: number | null;
  /**
   * Whisper's `compression_ratio` (gzip ratio of the segment text): above 2.4 the decode is "too repetitive" by
   * Whisper's own rule (a hallucination loop). Passed through to the non-speech gate; null when not provided.
   */
  compressionRatio: number | null;
  /** Whisper's decoding `temperature` for the segment (above 0 = the decoder fell back after a failed decode). */
  temperature: number | null;
}

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  speaker: number | null;
  confidence: number | null;
}

export interface TranscriptionResponse {
  requestId: string;
  model: string;
  text: string;
  language: string | null;
  durationSeconds: number | null;
  confidence: number | null;
  segments: TranscriptionSegment[];
  words: TranscriptionWord[];
  usage: { seconds: number | null; inputTokens: number | null; outputTokens: number | null; reportedCostUsd: number | null };
  estimatedCostUsd: number | null;
  latencyMs: number;
}

export type SpeechResponseFormat = 'mp3' | 'pcm' | 'wav' | 'opus' | 'aac' | 'flac';

export interface SpeechRequest {
  model: string;
  input: string;
  voice?: string;
  responseFormat?: SpeechResponseFormat;
  /** Delivery instructions (Gemini TTS, OpenAI, Fish). Ignored elsewhere. */
  instructions?: string;
  /** Only sent when defined; many providers reject non-default values. */
  speed?: number;
  provider?: Record<string, unknown>;
}

export interface SpeechResponse {
  requestId: string;
  generationId: string | null;
  bytes: Uint8Array;
  mimeType: string;
  /** Parsed from `audio/pcm;rate=24000;channels=1` when present. */
  sampleRateHz: number | null;
  channels: number | null;
  characters: number;
  estimatedCostUsd: number | null;
  latencyMs: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  inputModalities: string[];
  outputModalities: string[];
  supportedVoices: string[];
  supportedParameters: string[];
  contextLength: number | null;
  pricing: { prompt: number | null; completion: number | null };
}

interface RawErrorBody {
  error?: { message?: string; code?: number | string; metadata?: Record<string, unknown> };
  message?: string;
}

const INVALID_MODEL_PATTERNS = [
  /^(\S+) is not a valid model ID/i,
  /^(\S+) is an? [\w-]+ model and cannot be used with/i,
  /model (\S+) (?:is )?not found/i,
  /No endpoints found for (\S+)/i,
];

/** Classify an OpenRouter error body + status. Exported for tests. */
export function classifyError(status: number, body: RawErrorBody | string | null, requestId: string): OpenRouterError {
  const message = typeof body === 'string' ? body : (body?.error?.message ?? body?.message ?? `HTTP ${status}`);
  for (const pattern of INVALID_MODEL_PATTERNS) {
    const match = pattern.exec(message);
    if (match) return new OpenRouterError('invalid_model', message, { status, requestId, modelId: match[1] ?? null });
  }
  if (status === 401 || status === 403) return new OpenRouterError('auth', message, { status, requestId });
  if (status === 402) return new OpenRouterError('insufficient_credits', message, { status, requestId });
  if (status === 408) return new OpenRouterError('timeout', message, { status, requestId });
  if (status === 413) return new OpenRouterError('payload_too_large', message, { status, requestId });
  if (status === 429) return new OpenRouterError('rate_limited', message, { status, requestId });
  if (status === 404 && /model/i.test(message)) return new OpenRouterError('invalid_model', message, { status, requestId });
  if (status >= 500) return new OpenRouterError('server_error', message, { status, requestId });
  if (status >= 400) return new OpenRouterError('bad_request', message, { status, requestId });
  return new OpenRouterError('unknown', message, { status, requestId });
}

const parsePcmContentType = (ct: string | null): { sampleRateHz: number | null; channels: number | null } => {
  if (!ct) return { sampleRateHz: null, channels: null };
  const rate = /rate=(\d+)/i.exec(ct);
  const ch = /channels=(\d+)/i.exec(ct);
  return { sampleRateHz: rate ? Number(rate[1]) : null, channels: ch ? Number(ch[1]) : null };
};

export class OpenRouterClient {
  readonly pricing: PricingTable;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: AiLogger;
  private readonly defaultTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly requestIdFactory: () => string;
  private readonly backoffBaseMs: number;
  private readonly random: () => number;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenRouterClientOptions) {
    if (!options.apiKey) throw new Error('OpenRouterClient requires an apiKey');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.logger = options.logger ?? silentLogger;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.pricing = options.pricing ?? new PricingTable();
    this.sleep = options.sleep ?? sleepMs;
    this.requestIdFactory = options.requestIdFactory ?? newId;
    this.backoffBaseMs = options.backoffBaseMs ?? 400;
    this.random = options.random ?? Math.random;
    this.extraHeaders = {
      ...(options.referer ? { 'HTTP-Referer': options.referer } : {}),
      ...(options.appName ? { 'X-Title': options.appName } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Chat completions
  // ---------------------------------------------------------------------------

  async chatCompletions(req: ChatCompletionRequest, options: CallOptions = {}): Promise<ChatCompletionResult> {
    if (req.models.length === 0) throw new Error('chatCompletions requires at least one model');
    const requestId = options.requestId ?? this.requestIdFactory();
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const original = [...req.models];
    let candidates = [...original];
    let retries = 0;
    let attempts = 0;
    const startedAt = Date.now();

    this.logger.info('openrouter.chat.request', { requestId, ...options.tags, ...redactChatRequest(req) });

    while (candidates.length > 0) {
      attempts += 1;
      const body: Record<string, unknown> = {
        messages: req.messages,
        ...(candidates.length > 1 ? { models: candidates } : { model: candidates[0] }),
        ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        ...(req.topP !== undefined ? { top_p: req.topP } : {}),
        ...(req.stop ? { stop: req.stop } : {}),
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
        ...(req.provider ? { provider: req.provider } : {}),
        ...(req.user ? { user: req.user } : {}),
      };
      try {
        const { json, headers } = await this.postJson('/chat/completions', body, requestId, options);
        const data = json as {
          id?: string;
          model?: string;
          provider?: string;
          choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } };
          error?: { message?: string; code?: number | string };
        };
        if (data.error) throw classifyError(Number(data.error.code) || 500, { error: data.error }, requestId);
        const model = data.model ?? candidates[0] ?? original[0] ?? 'unknown';
        const content = data.choices?.[0]?.message?.content ?? '';
        const inputTokens = data.usage?.prompt_tokens ?? null;
        const outputTokens = data.usage?.completion_tokens ?? null;
        const reportedCostUsd = typeof data.usage?.cost === 'number' ? data.usage.cost : null;
        const estimated = reportedCostUsd ?? (inputTokens !== null && outputTokens !== null ? this.pricing.estimateChat(model, inputTokens, outputTokens) : null);
        const baseIndex = original.indexOf(model);
        const fallbackIndex = baseIndex >= 0 ? baseIndex : original.length - candidates.length;
        const result: ChatCompletionResult = {
          requestId,
          generationId: data.id ?? headers.get('x-generation-id'),
          model,
          provider: data.provider ?? null,
          content,
          finishReason: data.choices?.[0]?.finish_reason ?? null,
          usage: { inputTokens, outputTokens, cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? null, reportedCostUsd },
          estimatedCostUsd: estimated,
          latencyMs: Date.now() - startedAt,
          fallbackIndex,
          attempts,
        };
        this.logger.info('openrouter.chat.response', { requestId, model, provider: result.provider, latencyMs: result.latencyMs, inputTokens, outputTokens, estimatedCostUsd: estimated, fallbackIndex, attempts });
        return result;
      } catch (error) {
        const err = error instanceof OpenRouterError ? error : new OpenRouterError('network', (error as Error)?.message ?? 'network error', { requestId, cause: error });
        if (err.kind === 'invalid_model') {
          const dropped = err.modelId && candidates.includes(err.modelId) ? err.modelId : candidates[0];
          candidates = candidates.filter((m) => m !== dropped);
          this.logger.warn('openrouter.chat.fallback', { requestId, dropped, remaining: candidates, reason: err.kind });
          if (candidates.length > 0) continue;
          throw err;
        }
        if (err.retryable && retries < maxRetries) {
          retries += 1;
          const delay = this.backoffDelay(retries);
          this.logger.warn('openrouter.chat.retry', { requestId, retry: retries, delayMs: delay, kind: err.kind, status: err.status });
          await this.sleep(delay);
          continue;
        }
        if (err.retryable && candidates.length > 1) {
          // Retries exhausted on this head model: advance to the next fallback once more.
          const dropped = candidates[0];
          candidates = candidates.slice(1);
          retries = 0;
          this.logger.warn('openrouter.chat.fallback', { requestId, dropped, remaining: candidates, reason: 'retries_exhausted' });
          continue;
        }
        this.logger.error('openrouter.chat.error', { requestId, kind: err.kind, status: err.status, message: err.message });
        throw err;
      }
    }
    throw new OpenRouterError('invalid_model', 'All configured models were rejected by OpenRouter', { requestId });
  }

  // ---------------------------------------------------------------------------
  // Audio
  // ---------------------------------------------------------------------------

  readonly audio = {
    transcriptions: (req: TranscriptionRequest, options: CallOptions = {}): Promise<TranscriptionResponse> => this.transcribe(req, options),
    speech: (req: SpeechRequest, options: CallOptions = {}): Promise<SpeechResponse> => this.speech(req, options),
  };

  private async transcribe(req: TranscriptionRequest, options: CallOptions): Promise<TranscriptionResponse> {
    const requestId = options.requestId ?? this.requestIdFactory();
    const transport = req.transport ?? ('bytes' in req.audio ? 'multipart' : 'json');
    const startedAt = Date.now();
    this.logger.info('openrouter.stt.request', { requestId, ...options.tags, model: req.model, transport, format: req.audio.format, language: req.language ?? null, bytes: 'bytes' in req.audio ? req.audio.bytes.byteLength : Math.floor((req.audio.base64.length * 3) / 4) });

    let json: unknown;
    if (transport === 'json') {
      const data = 'bytes' in req.audio ? bytesToBase64(req.audio.bytes) : req.audio.base64;
      const body: Record<string, unknown> = {
        model: req.model,
        input_audio: { data, format: req.audio.format },
        ...(req.language ? { language: req.language } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
        ...(req.timestampGranularities ? { timestamp_granularities: req.timestampGranularities } : {}),
        ...(req.provider ? { provider: req.provider } : {}),
      };
      json = (await this.withRetries(requestId, options, () => this.postJson('/audio/transcriptions', body, requestId, options))).json;
    } else {
      const form = new FormData();
      const bytes = 'bytes' in req.audio ? req.audio.bytes : base64ToBytesLocal(req.audio.base64);
      const mime = ('bytes' in req.audio && req.audio.mimeType) || mimeForFormat(req.audio.format);
      form.append('file', new Blob([bytes as BlobPart], { type: mime }), `audio.${req.audio.format}`);
      form.append('model', req.model);
      if (req.language) form.append('language', req.language);
      if (req.temperature !== undefined) form.append('temperature', String(req.temperature));
      if (req.responseFormat) form.append('response_format', req.responseFormat);
      for (const g of req.timestampGranularities ?? []) form.append('timestamp_granularities[]', g);
      json = (await this.withRetries(requestId, options, () => this.postForm('/audio/transcriptions', form, requestId, options))).json;
    }

    const data = json as {
      text?: string;
      language?: string;
      duration?: number;
      confidence?: number;
      segments?: Array<{ id?: number; start?: number; end?: number; text?: string; speaker?: number; avg_logprob?: number; no_speech_prob?: number; compression_ratio?: number; temperature?: number }>;
      words?: Array<{ word?: string; start?: number; end?: number; speaker?: number; confidence?: number }>;
      usage?: { seconds?: number; cost?: number; input_tokens?: number; output_tokens?: number; total_tokens?: number };
      error?: { message?: string; code?: number };
    };
    if (data.error) throw classifyError(Number(data.error.code) || 500, { error: data.error }, requestId);
    const seconds = data.usage?.seconds ?? data.duration ?? null;
    const inputTokens = data.usage?.input_tokens ?? null;
    const outputTokens = data.usage?.output_tokens ?? null;
    const reportedCostUsd = typeof data.usage?.cost === 'number' ? data.usage.cost : null;
    const result: TranscriptionResponse = {
      requestId,
      model: req.model,
      text: (data.text ?? '').trim(),
      language: data.language ?? null,
      durationSeconds: data.duration ?? seconds,
      confidence: typeof data.confidence === 'number' ? data.confidence : null,
      segments: (data.segments ?? []).map((s, i) => ({
        id: s.id ?? i,
        start: s.start ?? 0,
        end: s.end ?? 0,
        text: (s.text ?? '').trim(),
        speaker: typeof s.speaker === 'number' ? s.speaker : null,
        avgLogprob: typeof s.avg_logprob === 'number' ? s.avg_logprob : null,
        noSpeechProb: typeof s.no_speech_prob === 'number' ? s.no_speech_prob : null,
        compressionRatio: finiteOrNull(s.compression_ratio),
        temperature: finiteOrNull(s.temperature),
      })),
      words: (data.words ?? []).map((w) => ({
        word: (w.word ?? '').trim(),
        start: w.start ?? 0,
        end: w.end ?? 0,
        speaker: typeof w.speaker === 'number' ? w.speaker : null,
        confidence: typeof w.confidence === 'number' ? w.confidence : null,
      })),
      usage: { seconds, inputTokens, outputTokens, reportedCostUsd },
      estimatedCostUsd: reportedCostUsd ?? this.pricing.estimateTranscription(req.model, seconds, inputTokens, outputTokens),
      latencyMs: Date.now() - startedAt,
    };
    this.logger.info('openrouter.stt.response', { requestId, model: req.model, latencyMs: result.latencyMs, seconds, chars: result.text.length, language: result.language, estimatedCostUsd: result.estimatedCostUsd });
    return result;
  }

  private async speech(req: SpeechRequest, options: CallOptions): Promise<SpeechResponse> {
    const requestId = options.requestId ?? this.requestIdFactory();
    const startedAt = Date.now();
    this.logger.info('openrouter.tts.request', { requestId, ...options.tags, model: req.model, voice: req.voice ?? null, characters: req.input.length, responseFormat: req.responseFormat ?? null });
    const body: Record<string, unknown> = {
      model: req.model,
      input: req.input,
      ...(req.voice ? { voice: req.voice } : {}),
      ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
      ...(req.instructions ? { instructions: req.instructions } : {}),
      ...(req.speed !== undefined ? { speed: req.speed } : {}),
      ...(req.provider ? { provider: req.provider } : {}),
    };
    const { response } = await this.withRetries(requestId, options, async () => {
      const res = await this.rawPost('/audio/speech', JSON.stringify(body), { 'Content-Type': 'application/json' }, requestId, options);
      if (!res.ok) {
        const text = await res.text();
        let parsed: RawErrorBody | string = text;
        try {
          parsed = JSON.parse(text) as RawErrorBody;
        } catch {
          /* keep text */
        }
        throw classifyError(res.status, parsed, requestId);
      }
      return { response: res };
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type');
    const pcm = parsePcmContentType(contentType);
    const result: SpeechResponse = {
      requestId,
      generationId: response.headers.get('x-generation-id'),
      bytes,
      mimeType: (contentType ?? mimeForFormat(req.responseFormat ?? 'mp3')).split(';')[0]?.trim() ?? 'application/octet-stream',
      sampleRateHz: pcm.sampleRateHz,
      channels: pcm.channels,
      characters: req.input.length,
      estimatedCostUsd: this.pricing.estimateSpeech(req.model, req.input.length),
      latencyMs: Date.now() - startedAt,
    };
    this.logger.info('openrouter.tts.response', { requestId, model: req.model, latencyMs: result.latencyMs, bytes: bytes.byteLength, mimeType: result.mimeType, estimatedCostUsd: result.estimatedCostUsd });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Models
  // ---------------------------------------------------------------------------

  readonly models = {
    /** List models, optionally filtered by output modality (`speech`, `transcription`, `text`). */
    list: async (filter: { outputModality?: 'speech' | 'transcription' | 'text' } = {}, options: CallOptions = {}): Promise<ModelInfo[]> => {
      const requestId = options.requestId ?? this.requestIdFactory();
      const qs = filter.outputModality ? `?output_modalities=${filter.outputModality}` : '';
      const res = await this.rawRequest('GET', `/models${qs}`, undefined, {}, requestId, options);
      if (!res.ok) throw classifyError(res.status, await res.text(), requestId);
      const data = (await res.json()) as { data?: ModelCatalogEntry[] };
      return (data.data ?? []).map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        inputModalities: m.architecture?.input_modalities ?? [],
        outputModalities: m.architecture?.output_modalities ?? [],
        supportedVoices: m.supported_voices ?? [],
        supportedParameters: m.supported_parameters ?? [],
        contextLength: m.context_length ?? null,
        pricing: { prompt: numOrNull(m.pricing?.prompt), completion: numOrNull(m.pricing?.completion) },
      }));
    },
    /**
     * Refresh the pricing table from the live catalog; returns the number of rows updated. The unfiltered
     * `/models` listing omits speech and transcription models (verified live 2026-10-14), so three catalogs are read.
     */
    refreshPricing: async (options: CallOptions = {}): Promise<number> => {
      let updated = 0;
      for (const qs of ['', '?output_modalities=speech', '?output_modalities=transcription']) {
        const requestId = options.requestId ?? this.requestIdFactory();
        const res = await this.rawRequest('GET', `/models${qs}`, undefined, {}, requestId, options);
        if (!res.ok) throw classifyError(res.status, await res.text(), requestId);
        const data = (await res.json()) as { data?: ModelCatalogEntry[] };
        updated += this.pricing.refreshFromCatalog(data.data ?? []);
      }
      return updated;
    },
    /** True when the id is listed in the live catalog (used to validate admin profile edits). */
    exists: async (modelId: string, options: CallOptions = {}): Promise<boolean> => {
      const all = await this.models.list({}, options);
      return all.some((m) => m.id === modelId);
    },
  };

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  private backoffDelay(retry: number): number {
    const base = Math.min(5_000, this.backoffBaseMs * 2 ** (retry - 1));
    return Math.round(base + this.random() * base * 0.25);
  }

  private async withRetries<T>(requestId: string, options: CallOptions, run: () => Promise<T>): Promise<T> {
    const maxRetries = options.maxRetries ?? this.maxRetries;
    let retries = 0;
    for (;;) {
      try {
        return await run();
      } catch (error) {
        const err = error instanceof OpenRouterError ? error : new OpenRouterError('network', (error as Error)?.message ?? 'network error', { requestId, cause: error });
        if (err.retryable && retries < maxRetries) {
          retries += 1;
          const delay = this.backoffDelay(retries);
          this.logger.warn('openrouter.retry', { requestId, retry: retries, delayMs: delay, kind: err.kind });
          await this.sleep(delay);
          continue;
        }
        this.logger.error('openrouter.error', { requestId, kind: err.kind, status: err.status, message: err.message });
        throw err;
      }
    }
  }

  private async postJson(path: string, body: unknown, requestId: string, options: CallOptions): Promise<{ json: unknown; headers: Headers }> {
    const res = await this.rawPost(path, JSON.stringify(body), { 'Content-Type': 'application/json' }, requestId, options);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      if (!res.ok) throw classifyError(res.status, text, requestId);
      throw new OpenRouterError('unknown', `Non-JSON response (${res.status})`, { status: res.status, requestId });
    }
    if (!res.ok) throw classifyError(res.status, json as RawErrorBody, requestId);
    return { json, headers: res.headers };
  }

  private async postForm(path: string, form: FormData, requestId: string, options: CallOptions): Promise<{ json: unknown; headers: Headers }> {
    const res = await this.rawPost(path, form, {}, requestId, options);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw classifyError(res.status, text, requestId);
    }
    if (!res.ok) throw classifyError(res.status, json as RawErrorBody, requestId);
    return { json, headers: res.headers };
  }

  private rawPost(path: string, body: BodyInit, headers: Record<string, string>, requestId: string, options: CallOptions): Promise<Response> {
    return this.rawRequest('POST', path, body, headers, requestId, options);
  }

  private async rawRequest(method: 'GET' | 'POST', path: string, body: BodyInit | undefined, headers: Record<string, string>, requestId: string, options: CallOptions): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    const onOuterAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onOuterAbort, { once: true });
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'X-Request-Id': requestId, ...this.extraHeaders, ...headers },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason as Error | undefined;
        const isTimeout = /timeout/i.test(reason?.message ?? '');
        throw new OpenRouterError(isTimeout ? 'timeout' : 'network', reason?.message ?? 'aborted', { requestId, cause: error });
      }
      throw new OpenRouterError('network', (error as Error)?.message ?? 'fetch failed', { requestId, cause: error });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}

const numOrNull = (v: string | number | undefined | null): number | null => {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A provider number field, or null when absent / not a finite number. */
const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const mimeForFormat = (format: string): string => {
  switch (format.toLowerCase()) {
    case 'mp3':
    case 'mpeg':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
    case 'opus':
      return 'audio/ogg';
    case 'webm':
      return 'audio/webm';
    case 'm4a':
    case 'aac':
      return 'audio/mp4';
    case 'pcm':
    case 'pcm16':
      return 'audio/pcm';
    default:
      return 'application/octet-stream';
  }
};

function base64ToBytesLocal(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
