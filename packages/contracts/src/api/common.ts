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
  /**
   * `POST /v1/ai/conversation/:id/turn` replay semantics: the same `clientTurnId` is still being processed by
   * the first request (no character reply yet). The server never runs the pipeline twice for one turn id; it
   * answers 409 with a `Retry-After` header (seconds) and `details.retryAfterSeconds`, and the client retries
   * the SAME `clientTurnId` after that delay, which then replays the original character turn (`replayed: true`).
   */
  'turn_in_progress',
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
  turn_in_progress: 409,
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

/**
 * Boolean query-string flag. Query values arrive as strings, and `z.coerce.boolean()` would turn the literal
 * `"false"` into `true`; this schema accepts `true|false|1|0` (case and surrounding spaces ignored, and a bare
 * boolean for JSON bodies that reuse a query schema) and yields a real boolean.
 *
 * An EMPTY value (`?flag=`, or a bare `?flag`) is a validation error, not `false` and not "no filter": no LangQuest
 * client sends one (the mobile client and the Studio drop unset filters before building the URL, `buildPath` skips
 * `undefined`), so an empty flag is a malformed request, and guessing a meaning would silently flip a filter
 * (`?rightsVerified=` used to list the UNVERIFIED assets). Leave the parameter out to get the default.
 */
export const QueryBooleanSchema = z.preprocess(
  (v) => {
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase();
      if (t === 'true' || t === '1') return true;
      if (t === 'false' || t === '0') return false;
    }
    return v;
  },
  z.boolean({ error: 'Expected a boolean flag: true, false, 1 or 0 (an empty value is not accepted; leave the parameter out instead)' }),
);

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

/**
 * Query schema for routes that need an explicit `?confirm=<value>` before a destructive or hard-to-undo change
 * (CONVENTIONS §3 "honesty": the server never infers consent). Without the exact value the API answers
 * `precondition_failed` with `details.requiredConfirmation: <value>`; any other value is `validation_failed`.
 *
 * `confirmQuery('archive')` is `EnrollmentPatchQuerySchema`, `confirmQuery('delete')` is `EnrollmentDeleteQuerySchema`.
 */
export function confirmQuery<const V extends string>(value: V) {
  return z.object({ confirm: z.enum([value]).optional() });
}
/** Generic confirm flag (`archive` | `delete`); route-specific schemas narrow it to a single value. */
export const ConfirmQuerySchema = z.object({ confirm: z.enum(['archive', 'delete']).optional() });
export type ConfirmQuery = z.infer<typeof ConfirmQuerySchema>;

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
  /** §0.2 / §11 / A28: learner-initiated data export (JSON bundle of profile, enrollments, progress, summaries). */
  meExport: route('GET', '/v1/me/export', 'learner'),
  /** §0.2 / §11 / A28: account deletion per disclosed policy (cascades/anonymises recordings, summaries, analytics). */
  meDelete: route('DELETE', '/v1/me', 'learner'),
  languages: route('GET', '/v1/languages', 'public'),
  courses: route('GET', '/v1/courses', 'public'),
  courseCoverage: route('GET', '/v1/courses/:trackId/coverage', 'public'),
  enrollmentsCreate: route('POST', '/v1/me/enrollments', 'learner'),
  enrollmentsList: route('GET', '/v1/me/enrollments', 'learner'),
  /** Accepts `?confirm=archive` (`EnrollmentPatchQuerySchema`) when the patch sets `status: 'archived'`. */
  enrollmentPatch: route('PATCH', '/v1/me/enrollments/:id', 'learner'),
  /**
   * §15 "User removes a course": permanently deletes ONE enrollment and its scoped progress. Requires
   * `?confirm=delete` (`EnrollmentDeleteQuerySchema`); without it the API answers `precondition_failed`.
   */
  enrollmentDelete: route('DELETE', '/v1/me/enrollments/:id', 'learner'),
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
  /**
   * Idempotent on `clientTurnId`: a replay returns the original character turn (`replayed: true`). While the
   * first request is still running the API answers `turn_in_progress` (409) + `Retry-After`; the client retries
   * the same `clientTurnId` after the delay. See `ApiErrorCode` docs.
   */
  conversationTurn: route('POST', '/v1/ai/conversation/:id/turn', 'learner'),
  conversationEnd: route('POST', '/v1/ai/conversation/:id/end', 'learner'),
  speechTranscribe: route('POST', '/v1/speech/transcribe', 'learner'),
  speechPronunciationAssess: route('POST', '/v1/speech/pronunciation-assess', 'learner'),
  /** AI pronunciation feedback (a listening model's estimate; never an acoustic score, never mastery evidence). */
  speechPronunciationFeedback: route('POST', '/v1/speech/pronunciation-feedback', 'learner'),
  speechSynthesize: route('POST', '/v1/speech/synthesize', 'learner'),
  speechNarrate: route('POST', '/v1/speech/narrate', 'learner'),
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
  /**
   * §4.4 Worker-proxied media streaming. Not JWT-authenticated: the URL returned by `audioPlaybackUrl`
   * (`method: 'worker_proxy'`) carries a short-lived HMAC token in `?t=` (`MediaStreamQuerySchema`) that
   * the server verifies against the asset id. Supports `Range` / `HEAD`; clients never build this URL themselves.
   */
  mediaStream: route('GET', '/v1/media/stream/:assetId', 'public'),
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
  // §7.3 speakers (people/voices behind recordings; consent + rights live here)
  adminSpeakersList: route('GET', '/v1/admin/speakers', 'admin'),
  adminSpeakerCreate: route('POST', '/v1/admin/speakers', 'admin'),
  adminSpeakerGet: route('GET', '/v1/admin/speakers/:id', 'admin'),
  adminSpeakerPatch: route('PATCH', '/v1/admin/speakers/:id', 'admin'),
  adminSpeakerDelete: route('DELETE', '/v1/admin/speakers/:id', 'admin'),
  // §7.3 library structure: collections → chapters → lessons (reorder = full permutation, atomic in SQL)
  adminCollectionsList: route('GET', '/v1/admin/library/collections', 'admin'),
  adminCollectionCreate: route('POST', '/v1/admin/library/collections', 'admin'),
  adminCollectionGet: route('GET', '/v1/admin/library/collections/:id', 'admin'),
  adminCollectionPatch: route('PATCH', '/v1/admin/library/collections/:id', 'admin'),
  adminCollectionDelete: route('DELETE', '/v1/admin/library/collections/:id', 'admin'),
  adminChaptersReorder: route('POST', '/v1/admin/library/collections/:id/chapters/reorder', 'admin'),
  adminChapterCreate: route('POST', '/v1/admin/library/chapters', 'admin'),
  adminChapterGet: route('GET', '/v1/admin/library/chapters/:id', 'admin'),
  adminChapterPatch: route('PATCH', '/v1/admin/library/chapters/:id', 'admin'),
  adminChapterDelete: route('DELETE', '/v1/admin/library/chapters/:id', 'admin'),
  adminLessonsReorder: route('POST', '/v1/admin/library/chapters/:id/lessons/reorder', 'admin'),
  adminLessonCreate: route('POST', '/v1/admin/library/lessons', 'admin'),
  adminLessonGet: route('GET', '/v1/admin/library/lessons/:id', 'admin'),
  /** Field updates stay on `adminAudioLessonPatch` (`PATCH /v1/admin/audio/lessons/:id`). */
  adminLessonDelete: route('DELETE', '/v1/admin/library/lessons/:id', 'admin'),
  adminLessonAssetAttach: route('POST', '/v1/admin/library/lessons/:id/assets', 'admin'),
  adminLessonAssetDetach: route('DELETE', '/v1/admin/library/lessons/:id/assets/:assetId', 'admin'),
  // §7.5 content rights (one row per grant; assets/lessons/speakers point at it via contentRightsId)
  adminContentRightsList: route('GET', '/v1/admin/content-rights', 'admin'),
  adminContentRightsCreate: route('POST', '/v1/admin/content-rights', 'admin'),
  adminContentRightsGet: route('GET', '/v1/admin/content-rights/:id', 'admin'),
  adminContentRightsPatch: route('PATCH', '/v1/admin/content-rights/:id', 'admin'),
  /** One transaction (`revoke_content_rights` RPC): unpublishes dependents + revokes offline packs. */
  adminContentRightsRevoke: route('POST', '/v1/admin/content-rights/:id/revoke', 'admin'),
  // §10.2A visual assets: upload-initiate (image-only multipart) → register → assign / replace
  adminVisualAssetsList: route('GET', '/v1/admin/visual-assets', 'admin'),
  adminVisualAssetUploadInitiate: route('POST', '/v1/admin/visual-assets/upload-initiate', 'admin'),
  adminVisualAssetRegister: route('POST', '/v1/admin/visual-assets', 'admin'),
  adminVisualAssetGet: route('GET', '/v1/admin/visual-assets/:id', 'admin'),
  adminVisualAssetPatch: route('PATCH', '/v1/admin/visual-assets/:id', 'admin'),
  adminVisualAssetReplace: route('POST', '/v1/admin/visual-assets/:id/replace', 'admin'),
  adminVisualAssetAssign: route('POST', '/v1/admin/visual-assets/:id/assign', 'admin'),
  adminVisualAssetUnassign: route('POST', '/v1/admin/visual-assets/:id/unassign', 'admin'),
  // §7.4 AI-assisted organisation suggestions (review queue; nothing applies without a human decision)
  adminAssetSuggestionsList: route('GET', '/v1/admin/asset-suggestions', 'admin'),
  adminAssetSuggestionsGenerate: route('POST', '/v1/admin/asset-suggestions/generate', 'admin'),
  adminAssetSuggestionsBulkDecide: route('POST', '/v1/admin/asset-suggestions/bulk-decide', 'admin'),
  adminAssetSuggestionGet: route('GET', '/v1/admin/asset-suggestions/:id', 'admin'),
  adminAssetSuggestionDecide: route('POST', '/v1/admin/asset-suggestions/:id/decide', 'admin'),
  // §7 Studio writes formerly served by local Next route handlers (R-4.3-01; schemas in `admin-studio.ts`)
  /** Coverage editorial status of one (track × instruction language) pair; "complete" needs a native review at 100%. */
  adminCoveragePut: route('PUT', '/v1/admin/coverage', 'admin'),
  /** Saves an edited transcript as a NEW revision (segments + per-source translations). */
  adminTranscriptSave: route('PUT', '/v1/admin/transcripts/:lessonId', 'admin'),
  /** Editorial approve / reject of a draft along a legal §7.6 transition; never publishes. */
  adminContentDecision: route('POST', '/v1/admin/content/:id/decision', 'admin'),
  /** Restores a revision snapshot as a new revision (restorable columns only; nothing is deleted). */
  adminContentRollback: route('POST', '/v1/admin/content/:id/rollback', 'admin'),
  /** Re-runs a failed / review_needed job as a fresh row; refuses job types no runner serves. */
  adminProcessingJobRetry: route('POST', '/v1/admin/processing-jobs/:id/retry', 'admin'),
  /** super_admin only. */
  adminUserRoleGrant: route('POST', '/v1/admin/users/:userId/roles', 'admin'),
  /** super_admin only; never your own super_admin. */
  adminUserRoleRevoke: route('DELETE', '/v1/admin/users/:userId/roles/:role', 'admin'),
  /** AI models test harness: prompt / synthesize / transcribe probes through the Worker's adapters (logged spend). */
  adminModelTest: route('POST', '/v1/admin/models/test', 'admin'),
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

/**
 * Patch schema for a stored options object: every field optional and WITHOUT its `.default()`.
 * Zod 4 applies a field's default even inside `.partial()`, so `Options.partial().parse({ a: true })` returned
 * every other field reset to its default and the API's `{ ...stored, ...patch }` merge overwrote them
 * (device QA 2026-10-20: hiding the mascot turned "reduce motion" back off).
 */
export function patchOf<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>): z.ZodType<Partial<z.output<z.ZodObject<Shape>>>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const inner = field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : (field as z.ZodType);
    shape[key] = inner.optional();
  }
  return z.object(shape) as unknown as z.ZodType<Partial<z.output<z.ZodObject<Shape>>>>;
}
