/**
 * Typed client for the LangQuest API built from `@langquest/contracts` (`ROUTES`, request and
 * response schemas). Works in the browser and on the server: the caller supplies the bearer
 * token (Supabase access token). Envelopes are validated; failures become `ApiClientError`
 * with the contract error code, network failures become `ApiUnreachableError` so screens can
 * render an honest "API unreachable" state instead of a generic crash.
 */
import { z } from 'zod';
import {
  AnalyticsCostResponseSchema,
  AnalyticsErrorsResponseSchema,
  AnalyticsQualityResponseSchema,
  AnalyticsUsageResponseSchema,
  AssetProcessResponseSchema,
  AssetsListResponseSchema,
  AssetSuggestionDecideResponseSchema,
  AssetSuggestionResponseSchema,
  AssetSuggestionsBulkDecideResponseSchema,
  AssetSuggestionsGenerateResponseSchema,
  AssetSuggestionsListResponseSchema,
  AudioLessonPatchResponseSchema,
  BulkLabelResponseSchema,
  ChapterDeleteResponseSchema,
  ChapterResponseSchema,
  CollectionDeleteResponseSchema,
  CollectionResponseSchema,
  CollectionsListResponseSchema,
  ContentGenerateResponseSchema,
  ContentPublishResponseSchema,
  ContentRequestReviewResponseSchema,
  ContentRightsListResponseSchema,
  ContentRightsResponseSchema,
  ContentRightsRevokeResponseSchema,
  ContentUnpublishResponseSchema,
  CoverageResponseSchema,
  ImportManifestResponseSchema,
  ImportR2PrefixResponseSchema,
  LessonAssetAttachResponseSchema,
  LessonAssetDetachResponseSchema,
  LessonDeleteResponseSchema,
  LessonDetailResponseSchema,
  LicensesAttributionsResponseSchema,
  ModelBenchmarkResponseSchema,
  ModelConfigPutResponseSchema,
  ModelsListResponseSchema,
  PlaybackUrlResponseSchema,
  ProcessingJobResponseSchema,
  ReorderResponseSchema,
  ROUTES,
  SpeakerDeleteResponseSchema,
  SpeakerResponseSchema,
  SpeakersListResponseSchema,
  SynthesizeResponseSchema,
  TranscribeResponseSchema,
  UploadAbortResponseSchema,
  UploadCompleteResponseSchema,
  UploadInitiateResponseSchema,
  UploadPartsSignResponseSchema,
  VisualAssetAssignResponseSchema,
  VisualAssetReplaceResponseSchema,
  VisualAssetResponseSchema,
  VisualAssetsListResponseSchema,
  VisualAssetUnassignResponseSchema,
  VisualAssetUploadInitiateResponseSchema,
  ApiFailureSchema,
  IDEMPOTENCY_KEY_HEADER,
  buildPath,
  type ApiErrorCode,
  type RouteKey,
  type RouteParams,
} from '@langquest/contracts';

/** Response schemas for the routes the admin uses; add here when a screen calls a new route. */
export const RESPONSE_SCHEMAS = {
  adminUploadInitiate: UploadInitiateResponseSchema,
  adminUploadPartsSign: UploadPartsSignResponseSchema,
  adminUploadComplete: UploadCompleteResponseSchema,
  adminUploadAbort: UploadAbortResponseSchema,
  adminImportR2Prefix: ImportR2PrefixResponseSchema,
  adminImportManifest: ImportManifestResponseSchema,
  adminAssetsBulkLabel: BulkLabelResponseSchema,
  adminAssetsList: AssetsListResponseSchema,
  adminAudioLessonPatch: AudioLessonPatchResponseSchema,
  adminAssetProcess: AssetProcessResponseSchema,
  adminProcessingJob: ProcessingJobResponseSchema,
  adminContentGenerate: ContentGenerateResponseSchema,
  adminContentRequestReview: ContentRequestReviewResponseSchema,
  adminContentPublish: ContentPublishResponseSchema,
  adminContentUnpublish: ContentUnpublishResponseSchema,
  adminLicensesAttributions: LicensesAttributionsResponseSchema,
  adminModelsList: ModelsListResponseSchema,
  adminModelConfigPut: ModelConfigPutResponseSchema,
  adminModelBenchmark: ModelBenchmarkResponseSchema,
  adminAnalyticsQuality: AnalyticsQualityResponseSchema,
  adminAnalyticsCost: AnalyticsCostResponseSchema,
  adminAnalyticsUsage: AnalyticsUsageResponseSchema,
  adminAnalyticsErrors: AnalyticsErrorsResponseSchema,
  // §7.3 speakers
  adminSpeakersList: SpeakersListResponseSchema,
  adminSpeakerCreate: SpeakerResponseSchema,
  adminSpeakerGet: SpeakerResponseSchema,
  adminSpeakerPatch: SpeakerResponseSchema,
  adminSpeakerDelete: SpeakerDeleteResponseSchema,
  // §7.3 library structure
  adminCollectionsList: CollectionsListResponseSchema,
  adminCollectionCreate: CollectionResponseSchema,
  adminCollectionGet: CollectionResponseSchema,
  adminCollectionPatch: CollectionResponseSchema,
  adminCollectionDelete: CollectionDeleteResponseSchema,
  adminChaptersReorder: ReorderResponseSchema,
  adminChapterCreate: ChapterResponseSchema,
  adminChapterGet: ChapterResponseSchema,
  adminChapterPatch: ChapterResponseSchema,
  adminChapterDelete: ChapterDeleteResponseSchema,
  adminLessonsReorder: ReorderResponseSchema,
  adminLessonCreate: LessonDetailResponseSchema,
  adminLessonGet: LessonDetailResponseSchema,
  adminLessonDelete: LessonDeleteResponseSchema,
  /** 201 on a fresh link, 200 when the asset was moved from another lesson (`movedFromLessonId` set). */
  adminLessonAssetAttach: LessonAssetAttachResponseSchema,
  adminLessonAssetDetach: LessonAssetDetachResponseSchema,
  // §7.5 content rights
  adminContentRightsList: ContentRightsListResponseSchema,
  adminContentRightsCreate: ContentRightsResponseSchema,
  adminContentRightsGet: ContentRightsResponseSchema,
  adminContentRightsPatch: ContentRightsResponseSchema,
  adminContentRightsRevoke: ContentRightsRevokeResponseSchema,
  // §10.2A visual assets
  adminVisualAssetsList: VisualAssetsListResponseSchema,
  adminVisualAssetUploadInitiate: VisualAssetUploadInitiateResponseSchema,
  adminVisualAssetRegister: VisualAssetResponseSchema,
  adminVisualAssetGet: VisualAssetResponseSchema,
  adminVisualAssetPatch: VisualAssetResponseSchema,
  adminVisualAssetReplace: VisualAssetReplaceResponseSchema,
  adminVisualAssetAssign: VisualAssetAssignResponseSchema,
  adminVisualAssetUnassign: VisualAssetUnassignResponseSchema,
  // §7.4 asset suggestions
  adminAssetSuggestionsList: AssetSuggestionsListResponseSchema,
  adminAssetSuggestionsGenerate: AssetSuggestionsGenerateResponseSchema,
  adminAssetSuggestionsBulkDecide: AssetSuggestionsBulkDecideResponseSchema,
  adminAssetSuggestionGet: AssetSuggestionResponseSchema,
  adminAssetSuggestionDecide: AssetSuggestionDecideResponseSchema,
  audioPlaybackUrl: PlaybackUrlResponseSchema,
  /** Public: per-source coverage + (with `?source=`) the live capability snapshot learners are told about (CONVENTIONS §8). */
  courseCoverage: CoverageResponseSchema,
  speechSynthesize: SynthesizeResponseSchema,
  speechTranscribe: TranscribeResponseSchema,
} satisfies Partial<Record<RouteKey, z.ZodType>>;

export type TypedRouteKey = keyof typeof RESPONSE_SCHEMAS;
export type ResponseOf<K extends RouteKey> = K extends TypedRouteKey ? z.infer<(typeof RESPONSE_SCHEMAS)[K]> : unknown;

export type QueryValue = string | number | boolean | undefined;

export interface CallOptions<K extends RouteKey> {
  params?: RouteParams<K>;
  query?: Record<string, QueryValue>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Override response validation (e.g. a narrower schema in tests). */
  schema?: z.ZodType;
}

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly traceId: string | undefined;
  constructor(code: ApiErrorCode, message: string, status: number, details?: unknown, traceId?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.traceId = traceId;
  }
}

/** The API host could not be reached (DNS, CORS, connection refused, timeout). */
export class ApiUnreachableError extends Error {
  readonly baseUrl: string;
  constructor(baseUrl: string, cause?: unknown) {
    super(`LangQuest API unreachable at ${baseUrl}`);
    this.name = 'ApiUnreachableError';
    this.baseUrl = baseUrl;
    this.cause = cause;
  }
}

export interface ApiClientOptions {
  /** Origin of the API (no trailing `/v1`). */
  baseUrl: string;
  /** Returns the current Supabase access token, or null when signed out. */
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
  /** Per-request timeout; default 30 s (uploads sign/complete are fast, analytics may be slow). */
  timeoutMs?: number;
}

export interface ApiClient {
  readonly baseUrl: string;
  call<K extends RouteKey>(key: K, options?: CallOptions<K>): Promise<ResponseOf<K>>;
  /** Absolute URL for a route (useful for links / debugging). */
  url<K extends RouteKey>(key: K, params?: RouteParams<K>, query?: Record<string, QueryValue>): string;
  /** Lightweight reachability probe: GET /v1/languages (public). */
  health(): Promise<{ reachable: boolean; latencyMs: number; status: number | null }>;
}

const stripSlash = (s: string) => s.replace(/\/+$/, '');

/** Build a client. Pure: no globals except `fetch` when not injected. */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = stripSlash(options.baseUrl);
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const timeoutMs = options.timeoutMs ?? 30_000;

  const url = <K extends RouteKey>(key: K, params?: RouteParams<K>, query?: Record<string, QueryValue>) =>
    `${baseUrl}${buildPath(key, params, query)}`;

  async function call<K extends RouteKey>(key: K, opts: CallOptions<K> = {}): Promise<ResponseOf<K>> {
    const def = ROUTES[key];
    const target = url(key, opts.params, opts.query);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (def.auth !== 'public') {
      const token = await options.getToken();
      if (!token) throw new ApiClientError('unauthorized', 'No session token', 401);
      headers.Authorization = `Bearer ${token}`;
    }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers[IDEMPOTENCY_KEY_HEADER] = opts.idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    const onOuterAbort = () => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

    let response: Response;
    try {
      response = await fetchImpl(target, {
        method: def.method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
        credentials: 'omit',
      });
    } catch (error) {
      throw new ApiUnreachableError(baseUrl, error);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onOuterAbort);
    }

    let json: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiClientError('internal', `Non-JSON response (${response.status}) from ${def.path}`, response.status, text.slice(0, 200));
      }
    }
    const failure = ApiFailureSchema.safeParse(json);
    if (failure.success) {
      const { code, message, details, traceId } = failure.data.error;
      throw new ApiClientError(code, message, response.status, details, traceId);
    }
    if (!response.ok) {
      throw new ApiClientError(
        response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 404 ? 'not_found' : 'internal',
        `HTTP ${response.status} from ${def.path}`,
        response.status,
        json,
      );
    }
    const envelope = z.object({ ok: z.literal(true), data: z.unknown() }).safeParse(json);
    if (!envelope.success) throw new ApiClientError('internal', `Malformed envelope from ${def.path}`, response.status, json);
    const schema = opts.schema ?? (RESPONSE_SCHEMAS as Partial<Record<RouteKey, z.ZodType>>)[key];
    if (!schema) return envelope.data.data as ResponseOf<K>;
    const parsed = schema.safeParse(envelope.data.data);
    if (!parsed.success) {
      throw new ApiClientError('validation_failed', `Response of ${def.path} does not match the contract`, response.status, parsed.error.issues);
    }
    return parsed.data as ResponseOf<K>;
  }

  async function health() {
    const started = Date.now();
    try {
      const res = await fetchImpl(url('languages'), { method: 'GET', headers: { Accept: 'application/json' } });
      return { reachable: res.ok, latencyMs: Date.now() - started, status: res.status };
    } catch {
      return { reachable: false, latencyMs: Date.now() - started, status: null };
    }
  }

  return { baseUrl, call, url, health };
}

/** Human-readable message for any error thrown by the client. */
export function describeApiError(error: unknown): { code: string; message: string } {
  if (error instanceof ApiClientError) return { code: error.code, message: error.message };
  if (error instanceof ApiUnreachableError) return { code: 'unreachable', message: error.message };
  if (error instanceof Error) return { code: 'error', message: error.message };
  return { code: 'error', message: String(error) };
}

export const isUnreachable = (error: unknown): error is ApiUnreachableError => error instanceof ApiUnreachableError;
