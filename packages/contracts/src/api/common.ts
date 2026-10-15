/**
 * API conventions shared by `apps/api` and every client (CONVENTIONS §3):
 * error codes, envelope helpers, pagination and route constants.
 */
import { z } from 'zod';
import { JsonValueSchema, NonNegativeIntSchema } from '../primitives';

export const API_BASE_PATH = '/v1' as const;

export const API_ERROR_CODE_VALUES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'rate_limited',
  'conflict',
  'provider_unavailable',
  'capability_unsupported',
  'rights_blocked',
  'idempotent_replay',
  'payload_too_large',
  'unsupported_media_type',
  'precondition_failed',
  'internal',
] as const;
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODE_VALUES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** HTTP status mirrored from the error code class. */
export const API_ERROR_HTTP_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  rate_limited: 429,
  conflict: 409,
  provider_unavailable: 503,
  capability_unsupported: 501,
  rights_blocked: 451,
  idempotent_replay: 200,
  payload_too_large: 413,
  unsupported_media_type: 415,
  precondition_failed: 412,
  internal: 500,
};

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  /** Human-readable, localized where possible; never provider secrets or raw prompts. */
  message: z.string(),
  details: JsonValueSchema.optional(),
  /** Request/trace id for support. */
  traceId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiFailureSchema = z.object({ ok: z.literal(false), error: ApiErrorSchema });
export type ApiFailure = z.infer<typeof ApiFailureSchema>;

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** Build the Zod schema for an envelope wrapping `data`. */
export function apiEnvelope<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), data }), ApiFailureSchema]);
}

export const ok = <T>(data: T): ApiSuccess<T> => ({ ok: true, data });

export const err = (code: ApiErrorCode, message: string, details?: z.infer<typeof JsonValueSchema>, traceId?: string): ApiFailure => ({
  ok: false,
  error: { code, message, ...(details !== undefined ? { details } : {}), ...(traceId ? { traceId } : {}) },
});

export const isOk = <T>(envelope: ApiEnvelope<T>): envelope is ApiSuccess<T> => envelope.ok === true;

/** Thrown by API handlers/clients; carries a typed code. */
export class ApiProblem extends Error {
  readonly code: ApiErrorCode;
  readonly details: z.infer<typeof JsonValueSchema> | undefined;
  readonly status: number;
  constructor(code: ApiErrorCode, message: string, details?: z.infer<typeof JsonValueSchema>) {
    super(message);
    this.name = 'ApiProblem';
    this.code = code;
    this.details = details;
    this.status = API_ERROR_HTTP_STATUS[code];
  }
  toFailure(traceId?: string): ApiFailure {
    return err(this.code, this.message, this.details, traceId);
  }
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const PaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    /** Total when cheap to compute; null otherwise. */
    total: NonNegativeIntSchema.nullable(),
  });
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number | null;
}

/** Standard idempotency header for mutating learner/admin calls. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key' as const;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface RouteDef<Path extends string = string> {
  method: HttpMethod;
  path: Path;
  /** `learner` routes require a Supabase JWT; `admin` additionally require a staff role; `public` need no auth. */
  auth: 'public' | 'learner' | 'admin';
}
const route = <const P extends string>(method: HttpMethod, path: P, auth: RouteDef['auth']): RouteDef<P> => ({ method, path, auth });

/** All routes from spec §6.1–6.4. Paths include the `/v1` base and `:param` placeholders. */
export const ROUTES = {
  // §6.1 learner account & catalog
  authSessionRefresh: route('POST', '/v1/auth/session/refresh', 'learner'),
  me: route('GET', '/v1/me', 'learner'),
  meSettingsPatch: route('PATCH', '/v1/me/settings', 'learner'),
  languages: route('GET', '/v1/languages', 'public'),
  courses: route('GET', '/v1/courses', 'public'),
  courseCoverage: route('GET', '/v1/courses/:trackId/coverage', 'public'),
  enrollmentsCreate: route('POST', '/v1/me/enrollments', 'learner'),
  enrollmentsList: route('GET', '/v1/me/enrollments', 'learner'),
  enrollmentPatch: route('PATCH', '/v1/me/enrollments/:id', 'learner'),
  courseManifest: route('GET', '/v1/courses/:trackId/manifest', 'learner'),
  missionDetail: route('GET', '/v1/missions/:id', 'learner'),
  missionAttemptCreate: route('POST', '/v1/missions/:id/attempts', 'learner'),
  missionEvaluate: route('POST', '/v1/missions/:id/evaluate', 'learner'),
  reviewsDue: route('GET', '/v1/me/reviews/due', 'learner'),
  progressSync: route('POST', '/v1/me/progress/sync', 'learner'),
  meSkills: route('GET', '/v1/me/skills', 'learner'),
  meProgress: route('GET', '/v1/me/progress', 'learner'),
  // §6.2 speaking & AI
  conversationSessionCreate: route('POST', '/v1/ai/conversation/session', 'learner'),
  conversationTurn: route('POST', '/v1/ai/conversation/:id/turn', 'learner'),
  conversationEnd: route('POST', '/v1/ai/conversation/:id/end', 'learner'),
  speechTranscribe: route('POST', '/v1/speech/transcribe', 'learner'),
  speechPronunciationAssess: route('POST', '/v1/speech/pronunciation-assess', 'learner'),
  speechSynthesize: route('POST', '/v1/speech/synthesize', 'learner'),
  modelCapabilities: route('GET', '/v1/ai/model-capabilities', 'learner'),
  // §6.3 audio library
  audioCollections: route('GET', '/v1/audio/collections', 'learner'),
  audioCollectionChapters: route('GET', '/v1/audio/collections/:id/chapters', 'learner'),
  audioLesson: route('GET', '/v1/audio/lessons/:id', 'learner'),
  audioPlaybackUrl: route('POST', '/v1/audio/assets/:id/playback-url', 'learner'),
  audioLessonTranscript: route('GET', '/v1/audio/lessons/:id/transcript', 'learner'),
  audioProgressPut: route('PUT', '/v1/me/audio-progress/:lessonId', 'learner'),
  audioBookmarkCreate: route('POST', '/v1/me/audio-bookmarks', 'learner'),
  audioDownloadPack: route('GET', '/v1/me/audio-download-pack/:lessonId', 'learner'),
  // §6.4 admin
  adminUploadInitiate: route('POST', '/v1/admin/uploads/initiate', 'admin'),
  adminUploadPartsSign: route('POST', '/v1/admin/uploads/:id/parts/sign', 'admin'),
  adminUploadComplete: route('POST', '/v1/admin/uploads/:id/complete', 'admin'),
  adminUploadAbort: route('POST', '/v1/admin/uploads/:id/abort', 'admin'),
  adminImportR2Prefix: route('POST', '/v1/admin/library/import-r2-prefix', 'admin'),
  adminImportManifest: route('POST', '/v1/admin/library/import-manifest', 'admin'),
  adminAssetsBulkLabel: route('POST', '/v1/admin/assets/bulk-label', 'admin'),
  adminAssetsList: route('GET', '/v1/admin/assets', 'admin'),
  adminAudioLessonPatch: route('PATCH', '/v1/admin/audio/lessons/:id', 'admin'),
  adminAssetProcess: route('POST', '/v1/admin/assets/:id/process', 'admin'),
  adminProcessingJob: route('GET', '/v1/admin/processing-jobs/:id', 'admin'),
  adminContentGenerate: route('POST', '/v1/admin/content/generate', 'admin'),
  adminContentRequestReview: route('POST', '/v1/admin/content/:id/request-review', 'admin'),
  adminContentPublish: route('POST', '/v1/admin/content/:id/publish', 'admin'),
  adminContentUnpublish: route('POST', '/v1/admin/content/:id/unpublish', 'admin'),
  adminLicensesAttributions: route('GET', '/v1/admin/licenses/attributions', 'admin'),
  adminModelsList: route('GET', '/v1/admin/models', 'admin'),
  adminModelConfigPut: route('PUT', '/v1/admin/models/:task/config', 'admin'),
  adminModelBenchmark: route('POST', '/v1/admin/models/:task/benchmark', 'admin'),
  adminAnalyticsQuality: route('GET', '/v1/admin/analytics/quality', 'admin'),
  adminAnalyticsCost: route('GET', '/v1/admin/analytics/cost', 'admin'),
  adminAnalyticsUsage: route('GET', '/v1/admin/analytics/usage', 'admin'),
  adminAnalyticsErrors: route('GET', '/v1/admin/analytics/errors', 'admin'),
} as const satisfies Record<string, RouteDef>;
export type RouteKey = keyof typeof ROUTES;

type ExtractParams<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? Param | ExtractParams<`/${Rest}`>
  : P extends `${string}:${infer Param}`
    ? Param
    : never;
export type RouteParams<K extends RouteKey> = Record<ExtractParams<(typeof ROUTES)[K]['path']>, string>;

/** Substitute `:params` in a route path; throws if a param is missing. */
export function buildPath<K extends RouteKey>(key: K, params?: RouteParams<K>, query?: Record<string, string | number | boolean | undefined>): string {
  const def = ROUTES[key];
  const path = def.path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = (params as Record<string, string> | undefined)?.[name];
    if (value === undefined || value === '') throw new Error(`Missing route param "${name}" for ${String(key)}`);
    return encodeURIComponent(value);
  });
  if (!query) return path;
  const qs = Object.entries(query)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}
