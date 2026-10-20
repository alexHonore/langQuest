#!/usr/bin/env tsx
/**
 * generate-openapi — builds the OpenAPI 3.1 document of the LangQuest HTTP API (`apps/api`, spec §6) from the
 * `ROUTES` table and the Zod v4 schemas of `@langquest/contracts`, and writes `docs/api/openapi.json`.
 *
 * Sources, in order of authority:
 * - `ROUTES` (`packages/contracts/src/api/common.ts`): every operation's method, path and contract auth class. The
 *   document has exactly one operation per entry, plus the two un-versioned ops endpoints `GET /` and `GET /healthz`
 *   that `apps/api/src/app.ts` registers outside `ROUTES`.
 * - `ROUTE_SCHEMAS` (below): which contracts schema each handler parses its query/body with and returns, its success
 *   statuses and any role check the handler adds on top of the route gate. `ROUTES` carries no schemas; the pairing
 *   lives in the handlers under `apps/api/src/routes/**`, and this table was read off them. `generate-openapi.test.ts`
 *   requires an entry for every `ROUTES` key, re-reads the handlers and fails when the table and a handler disagree
 *   (parsed schemas, `respondOk` statuses, `roles.includes(...)` guards).
 * - The handlers' `define('<key>', { ... })` options (scanned from source): admin role set, auth-class override,
 *   rate-limit class and the `Idempotency-Key` layer. Role-set membership is read from `ROLE_SETS`
 *   (`apps/api/src/middleware/auth.ts`).
 * A route that is in `ROUTES` but not in the table falls back to the scanned schema names (`handler-scan`), or to a
 * generic envelope with `x-langquest-schema-source: "none"`, so new routes are never silently missing; the test then
 * fails until the route gets a table entry.
 *
 * Output is deterministic: keys sorted recursively, no timestamps, `info.version` = the contracts package version.
 *
 * Usage (no package.json entry): pnpm --filter @langquest/scripts exec tsx src/generate-openapi.ts [--out <path>] [--check] [--dry-run]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as contracts from '@langquest/contracts';
import { AiTaskNameSchema, CourseTrackIdSchema, ROUTES, RoleSchema, UuidSchema, type Role, type RouteDef, type RouteKey } from '@langquest/contracts';
import { z } from 'zod';
import { flagBool, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { fileExists, repoRoot, writeTextFileSync } from './lib/io';

// ---------------------------------------------------------------------------
// Route → schema table (read off apps/api/src/routes/**; checked by the test)
// ---------------------------------------------------------------------------

/** Names of the Zod schemas exported by `@langquest/contracts` (typos fail the typecheck). */
export type ContractSchemaName = {
  [K in keyof typeof contracts]: K extends `${string}Schema` ? ((typeof contracts)[K] extends z.ZodType ? K : never) : never;
}[keyof typeof contracts];

export interface RouteSchemas {
  query?: ContractSchemaName;
  body?: ContractSchemaName;
  /** JSON `data` payload of the success envelope, or `binary` for a raw media stream. */
  response?: ContractSchemaName | 'binary';
  /** Success statuses the handler can return (default `[200]`); the first one carries the documented payload. */
  success?: readonly number[];
  /**
   * Roles the handler itself requires on top of the route gate (a `roles.includes('<role>')` guard that throws
   * `forbidden`). Documented as `x-langquest-roles`; the gate's own set stays in `x-langquest-gate-roles`.
   */
  requiredRoles?: readonly Role[];
  /** Where the handler's own (local) schema differs from the published contract schema named here. */
  note?: string;
}

export const ROUTE_SCHEMAS: Partial<Record<RouteKey, RouteSchemas>> = {
  // §6.1 learner account & catalog (apps/api/src/routes/learner/*)
  authSessionRefresh: { body: 'SessionRefreshRequestSchema', response: 'SessionRefreshResponseSchema' },
  me: { response: 'MeResponseSchema', note: 'The handler returns `defaultSourceLanguageCode` as nullable (onboarding fills it; `MeResponseNullableSchema` in apps/api/src/routes/learner/account.ts).' },
  meSettingsPatch: { body: 'PatchSettingsRequestSchema', response: 'PatchSettingsResponseSchema', note: 'Returns the same payload as GET /v1/me (nullable `defaultSourceLanguageCode`).' },
  meExport: { response: 'MeExportResponseSchema', note: 'Served with `Content-Disposition: attachment; filename="langquest-export.json"` and `Cache-Control: no-store`.' },
  meDelete: { body: 'MeDeleteRequestSchema', response: 'MeDeleteResponseSchema' },
  languages: { response: 'LanguagesResponseSchema' },
  courses: { query: 'CoursesQuerySchema', response: 'CoursesResponseSchema' },
  courseCoverage: { query: 'CoverageQuerySchema', response: 'CoverageResponseSchema' },
  enrollmentsCreate: { body: 'EnrollmentCreateRequestSchema', response: 'EnrollmentCreateResponseSchema', success: [201] },
  enrollmentsList: { query: 'EnrollmentsListQuerySchema', response: 'EnrollmentsListResponseSchema' },
  enrollmentPatch: { query: 'EnrollmentPatchQuerySchema', body: 'EnrollmentPatchRequestSchema', response: 'EnrollmentPatchResponseSchema' },
  enrollmentDelete: { query: 'EnrollmentDeleteQuerySchema', response: 'EnrollmentDeleteResponseSchema' },
  courseManifest: { query: 'ManifestQuerySchema', response: 'ManifestResponseSchema', note: 'Sent with `ETag`, `Cache-Control: private` and `X-Manifest-Source`; answers 304 with no body when `If-None-Match` matches the ETag.' },
  missionDetail: { query: 'MissionDetailQuerySchema', response: 'MissionDetailResponseSchema' },
  missionAttemptCreate: { body: 'MissionAttemptCreateRequestSchema', response: 'MissionAttemptCreateResponseSchema', success: [201, 200], note: '200 is the replay of an existing attempt (`replayed: true`).' },
  missionEvaluate: {
    body: 'MissionEvaluateRequestSchema',
    response: 'MissionEvaluateResponseSchema',
    note: 'The handler bounds `stepResults` to 1..100 items and `selectedIntentId` to 200 chars (`MissionEvaluateBoundedSchema`), and extends the response (`MissionEvaluateApiResponseSchema`) in apps/api/src/routes/learner/missions.ts.',
  },
  reviewsDue: { query: 'ReviewsDueQuerySchema', response: 'ReviewsDueResponseSchema' },
  progressSync: { body: 'ProgressSyncRequestSchema', response: 'ProgressSyncResponseSchema' },
  meSkills: { query: 'SkillsQuerySchema', response: 'SkillsResponseSchema' },
  meProgress: { response: 'ProgressResponseSchema' },
  // §6.2 speaking & AI (apps/api/src/routes/speech/*)
  conversationSessionCreate: {
    body: 'ConversationSessionCreateRequestSchema',
    response: 'ConversationSessionCreateResponseSchema',
    success: [201, 200],
    note: 'The handler widens `characterId` to a character reference (`SessionCreateRequestSchema` in apps/api/src/routes/speech/conversation.ts). 200 is the replay of an existing `clientSessionId`.',
  },
  conversationTurn: { body: 'ConversationTurnRequestSchema', response: 'ConversationTurnResponseSchema', note: 'Idempotent on `clientTurnId`; while the first request runs the API answers 409 `turn_in_progress` with `Retry-After`.' },
  conversationEnd: { body: 'ConversationEndRequestSchema', response: 'ConversationEndResponseSchema' },
  speechTranscribe: { body: 'TranscribeRequestSchema', response: 'TranscribeResponseSchema' },
  speechPronunciationAssess: { body: 'PronunciationAssessRequestSchema', response: 'PronunciationAssessResponseSchema', note: 'ADR-006: `numericScore` is null unless the assessment mode is an acoustic assessor.' },
  speechSynthesize: { body: 'SynthesizeRequestSchema', response: 'SynthesizeResponseSchema' },
  modelCapabilities: { query: 'ModelCapabilitiesQuerySchema', response: 'ModelCapabilitiesResponseSchema' },
  // §6.3 audio library (apps/api/src/routes/audio/index.ts, media-proxy.ts)
  audioCollections: { query: 'AudioCollectionsQuerySchema', response: 'AudioCollectionsResponseSchema' },
  audioCollectionChapters: { response: 'AudioChaptersResponseSchema' },
  audioLesson: { response: 'AudioLessonResponseSchema' },
  audioPlaybackUrl: { body: 'PlaybackUrlRequestSchema', response: 'PlaybackUrlResponseSchema' },
  audioLessonTranscript: { query: 'TranscriptQuerySchema', response: 'TranscriptResponseSchema' },
  audioProgressPut: { body: 'AudioProgressPutRequestSchema', response: 'AudioProgressPutResponseSchema' },
  audioBookmarkCreate: { body: 'AudioBookmarkCreateRequestSchema', response: 'AudioBookmarkResponseSchema', success: [201, 200], note: '200 is the replay of an existing bookmark.' },
  audioDownloadPack: { query: 'DownloadPackQuerySchema', response: 'DownloadPackResponseSchema' },
  mediaStream: {
    query: 'MediaStreamQuerySchema',
    response: 'binary',
    success: [200, 206],
    note: 'Raw audio bytes (not the JSON envelope). Supports `Range` (206) and `HEAD`. `t` is the short-lived HMAC token from `audioPlaybackUrl`; 501 `capability_unsupported` while R2 is not bound.',
  },
  // §6.4 admin (apps/api/src/routes/admin/*)
  adminUploadInitiate: { body: 'UploadInitiateRequestSchema', response: 'UploadInitiateResponseSchema', success: [201, 200], note: '200 when an existing upload session is resumed.' },
  adminUploadPartsSign: { body: 'UploadPartsSignRequestSchema', response: 'UploadPartsSignResponseSchema' },
  adminUploadComplete: { body: 'UploadCompleteRequestSchema', response: 'UploadCompleteResponseSchema' },
  adminUploadAbort: { body: 'UploadAbortRequestSchema', response: 'UploadAbortResponseSchema' },
  adminImportR2Prefix: { body: 'ImportR2PrefixRequestSchema', response: 'ImportR2PrefixResponseSchema', success: [202, 200], note: '200 for a dry run (`dryRun: true`): nothing is enqueued.' },
  adminImportManifest: { body: 'ImportManifestRequestSchema', response: 'ImportManifestResponseSchema', success: [202, 200], note: '200 for a dry run (`dryRun: true`): nothing is enqueued.' },
  adminAssetsBulkLabel: { body: 'BulkLabelRequestSchema', response: 'BulkLabelResponseSchema' },
  adminAssetsList: { query: 'AssetsListQuerySchema', response: 'AssetsListResponseSchema' },
  adminAudioLessonPatch: { body: 'AudioLessonPatchRequestSchema', response: 'AudioLessonPatchResponseSchema' },
  adminAssetProcess: { body: 'AssetProcessRequestSchema', response: 'AssetProcessResponseSchema', success: [202] },
  adminProcessingJob: { response: 'ProcessingJobResponseSchema' },
  adminContentGenerate: { body: 'ContentGenerateRequestSchema', response: 'ContentGenerateResponseSchema', success: [202, 200], note: '200 is the replay of the same `idempotencyKey` (`replayed: true`, no new job).' },
  adminContentRequestReview: { body: 'ContentRequestReviewRequestSchema', response: 'ContentRequestReviewResponseSchema' },
  adminContentPublish: { body: 'ContentPublishRequestSchema', response: 'ContentPublishResponseSchema' },
  adminContentUnpublish: { body: 'ContentUnpublishRequestSchema', response: 'ContentUnpublishResponseSchema' },
  adminLicensesAttributions: { query: 'LicensesAttributionsQuerySchema', response: 'LicensesAttributionsResponseSchema' },
  adminModelsList: { query: 'ModelsListQuerySchema', response: 'ModelsListResponseSchema' },
  adminModelConfigPut: { body: 'ModelConfigPutRequestSchema', response: 'ModelConfigPutResponseSchema' },
  adminModelBenchmark: { body: 'ModelBenchmarkRequestSchema', response: 'ModelBenchmarkResponseSchema', success: [202, 200], note: '200 is the replay of the same `idempotencyKey`: no new smoke run, and `benchmarkId` is null while the first run is still in flight.' },
  adminAnalyticsQuality: { query: 'AnalyticsQuerySchema', response: 'AnalyticsQualityResponseSchema' },
  adminAnalyticsCost: { query: 'AnalyticsQuerySchema', response: 'AnalyticsCostResponseSchema' },
  adminAnalyticsUsage: { query: 'AnalyticsQuerySchema', response: 'AnalyticsUsageResponseSchema' },
  adminAnalyticsErrors: { query: 'AnalyticsQuerySchema', response: 'AnalyticsErrorsResponseSchema' },
  adminSpeakersList: { query: 'SpeakersListQuerySchema', response: 'SpeakersListResponseSchema' },
  adminSpeakerCreate: { body: 'SpeakerCreateRequestSchema', response: 'SpeakerResponseSchema', success: [201, 200], note: '200 is the replay of the same `idempotencyKey`.' },
  adminSpeakerGet: { response: 'SpeakerResponseSchema' },
  adminSpeakerPatch: { body: 'SpeakerPatchRequestSchema', response: 'SpeakerResponseSchema' },
  adminSpeakerDelete: { body: 'SpeakerDeleteRequestSchema', response: 'SpeakerDeleteResponseSchema' },
  adminCollectionsList: { query: 'CollectionsListQuerySchema', response: 'CollectionsListResponseSchema' },
  adminCollectionCreate: { body: 'CollectionCreateRequestSchema', response: 'CollectionResponseSchema', success: [201, 200], note: '200 is the replay of the same `idempotencyKey`.' },
  adminCollectionGet: { response: 'CollectionResponseSchema' },
  adminCollectionPatch: { body: 'CollectionPatchRequestSchema', response: 'CollectionResponseSchema' },
  adminCollectionDelete: { response: 'CollectionDeleteResponseSchema' },
  adminChaptersReorder: { body: 'ReorderRequestSchema', response: 'ReorderResponseSchema' },
  adminChapterCreate: { body: 'ChapterCreateRequestSchema', response: 'ChapterResponseSchema', success: [201, 200], note: '200 is the replay of the same `idempotencyKey`.' },
  adminChapterGet: { response: 'ChapterResponseSchema' },
  adminChapterPatch: { body: 'ChapterPatchRequestSchema', response: 'ChapterResponseSchema' },
  adminChapterDelete: { body: 'ChapterDeleteRequestSchema', response: 'ChapterDeleteResponseSchema' },
  adminLessonsReorder: { body: 'ReorderRequestSchema', response: 'ReorderResponseSchema' },
  adminLessonCreate: { body: 'LessonCreateRequestSchema', response: 'LessonDetailResponseSchema', success: [201, 200], note: '200 is the replay of the same `idempotencyKey`.' },
  adminLessonGet: { response: 'LessonDetailResponseSchema' },
  adminLessonDelete: { response: 'LessonDeleteResponseSchema' },
  adminLessonAssetAttach: { body: 'LessonAssetAttachRequestSchema', response: 'LessonAssetAttachResponseSchema', success: [201, 200], note: '200 when the asset moved from another lesson.' },
  adminLessonAssetDetach: { response: 'LessonAssetDetachResponseSchema' },
  adminContentRightsList: { query: 'ContentRightsListQuerySchema', response: 'ContentRightsListResponseSchema' },
  adminContentRightsCreate: { body: 'ContentRightsCreateRequestSchema', response: 'ContentRightsResponseSchema', success: [201, 200], note: '200 is the replay of the same `idempotencyKey`.' },
  adminContentRightsGet: { response: 'ContentRightsResponseSchema' },
  adminContentRightsPatch: { body: 'ContentRightsPatchRequestSchema', response: 'ContentRightsResponseSchema' },
  adminContentRightsRevoke: { body: 'ContentRightsRevokeRequestSchema', response: 'ContentRightsRevokeResponseSchema' },
  adminVisualAssetsList: { query: 'VisualAssetsListQuerySchema', response: 'VisualAssetsListResponseSchema' },
  adminVisualAssetUploadInitiate: { body: 'VisualAssetUploadInitiateRequestSchema', response: 'VisualAssetUploadInitiateResponseSchema', success: [201, 200], note: '200 when an existing upload session is resumed.' },
  adminVisualAssetRegister: { body: 'VisualAssetRegisterRequestSchema', response: 'VisualAssetResponseSchema', success: [201, 200], note: '200 when the same upload was already registered.' },
  adminVisualAssetGet: { response: 'VisualAssetResponseSchema' },
  adminVisualAssetPatch: { body: 'VisualAssetPatchRequestSchema', response: 'VisualAssetResponseSchema' },
  adminVisualAssetReplace: { body: 'VisualAssetReplaceRequestSchema', response: 'VisualAssetReplaceResponseSchema', success: [201, 200], note: '200 when the replacement already exists.' },
  adminVisualAssetAssign: { body: 'VisualAssetAssignRequestSchema', response: 'VisualAssetAssignResponseSchema', success: [201, 200], note: '200 when the slot already holds this asset.' },
  adminVisualAssetUnassign: { body: 'VisualAssetUnassignRequestSchema', response: 'VisualAssetUnassignResponseSchema' },
  adminAssetSuggestionsList: { query: 'AssetSuggestionsListQuerySchema', response: 'AssetSuggestionsListResponseSchema' },
  adminAssetSuggestionsGenerate: { body: 'AssetSuggestionsGenerateRequestSchema', response: 'AssetSuggestionsGenerateResponseSchema', success: [202, 200], note: '200 when every job for this `idempotencyKey` already existed (`replayed: true`, nothing new enqueued).' },
  adminAssetSuggestionsBulkDecide: { body: 'AssetSuggestionsBulkDecideRequestSchema', response: 'AssetSuggestionsBulkDecideResponseSchema' },
  adminAssetSuggestionGet: { response: 'AssetSuggestionResponseSchema' },
  adminAssetSuggestionDecide: { body: 'AssetSuggestionDecideRequestSchema', response: 'AssetSuggestionDecideResponseSchema' },
  // §7 Studio writes formerly served by local Next route handlers (apps/api/src/routes/admin/editorial.ts, jobs.ts,
  // users.ts, model-test.ts; schemas in packages/contracts/src/api/admin-studio.ts)
  adminCoveragePut: {
    body: 'CoverageUpdateRequestSchema',
    response: 'CoverageUpdateResponseSchema',
    note: 'Sets the editorial status of one (track, instruction language) pair. `"complete"` requires `nativeReviewed` and every metric at 100%, and no fallback language (`coverageUpdateViolation`, 422). 404 `not_found` when the catalog seed has no row for the pair.',
  },
  adminTranscriptSave: {
    body: 'TranscriptSaveRequestSchema',
    response: 'TranscriptSaveResponseSchema',
    success: [201],
    note: 'Saves the transcript as a NEW revision; earlier revisions stay. Body limit 16 MiB (`TRANSCRIPT_BODY_LIMIT_BYTES`), handler timeout 55 s. 404 `not_found` for an unknown lesson.',
  },
  adminContentDecision: {
    body: 'ContentDecisionRequestSchema',
    response: 'ContentDecisionResponseSchema',
    note: 'Approve / reject along a legal §7.6 transition (`planDecision`); never publishes. A repeated decision answers `noop: true`. Published content and illegal transitions answer 412 `precondition_failed`.',
  },
  adminContentRollback: {
    body: 'ContentRollbackRequestSchema',
    response: 'ContentRollbackResponseSchema',
    note: 'Restores a revision snapshot as a NEW revision (restorable columns only, `rollbackPatch`; state flags never). 412 `precondition_failed` when the revision has no snapshot or no restorable column; 404 for an unknown revision or entity.',
  },
  adminProcessingJobRetry: {
    body: 'ProcessingJobRetryRequestSchema',
    response: 'ProcessingJobRetryResponseSchema',
    success: [202],
    note: 'Enqueues a fresh job with the same parameters; the failed row stays (`planJobRetry`). 412 `precondition_failed` for pending / running jobs and job types no runner serves.',
  },
  adminUserRoleGrant: {
    body: 'UserRoleGrantRequestSchema',
    response: 'UserRoleGrantResponseSchema',
    success: [201, 200],
    requiredRoles: ['super_admin'],
    note: 'The super_admin check is `requireSuperAdmin` (apps/api/src/routes/admin/users.ts); it runs before any parsing or query. 200 when the user already held the role (its expiry is updated). Audit action `users.role_grant`.',
  },
  adminUserRoleRevoke: {
    response: 'UserRoleRevokeResponseSchema',
    requiredRoles: ['super_admin'],
    note: 'The super_admin check is `requireSuperAdmin` (apps/api/src/routes/admin/users.ts); it runs before any parsing or query. Nobody can revoke their own `super_admin` (412 `precondition_failed`). `revoked` is the number of rows removed (0 when the user did not hold the role). Audit action `users.role_revoke`.',
  },
  adminModelTest: {
    body: 'ModelTestRequestSchema',
    response: 'ModelTestResponseSchema',
    note: 'Prompt / synthesize / transcribe probes run inside the Worker through the same AI adapters learner calls use, so each call is a real provider call with logged spend. Body limit 12 MiB (`MODEL_TEST_BODY_LIMIT_BYTES`); no `Idempotency-Key` layer. A variety the capability cannot serve answers 501 `capability_unsupported`; nothing is substituted.',
  },
};

/**
 * Path parameter validators, as the handlers parse them (`IdParams`, `LessonParams`, `LessonAssetParams`, `TaskParams`,
 * track id, `GrantParams` / `RevokeParams`). The test requires an entry for every `:param` in `ROUTES`.
 */
export const PATH_PARAM_SCHEMAS: Record<string, z.ZodType> = {
  id: UuidSchema,
  assetId: UuidSchema,
  lessonId: UuidSchema,
  trackId: CourseTrackIdSchema,
  task: AiTaskNameSchema,
  userId: UuidSchema,
  role: RoleSchema,
};

// ---------------------------------------------------------------------------
// Handler scan (apps/api source → per-route options and schema names)
// ---------------------------------------------------------------------------

export interface ScannedRoute {
  key: string;
  file: string;
  /** `role:` option (admin role set). */
  role?: string;
  /** `auth:` option overriding the contract auth class. */
  auth?: string;
  /** `rate:` option. */
  rate?: string;
  /** `idempotent: false` turns the `Idempotency-Key` layer off. */
  idempotent: boolean;
  /** `parseBody(c, <Name>)` / `parseQuery(c, <Name>)` identifiers inside the handler block. */
  bodySchemas: string[];
  querySchemas: string[];
  /** Query parameters read directly with `c.req.query('<name>')` (no schema). */
  rawQueryParams: string[];
  /** `<Name>.parse(` identifiers ending in `ResponseSchema` inside the handler block. */
  responseSchemas: string[];
  /** 2xx statuses the handler block answers with (`successStatusesOf`), sorted. */
  successStatuses: number[];
  /** True when some `respondOk` status argument holds no literal (e.g. a `status` variable from a helper). */
  dynamicStatus: boolean;
  /** Roles of `roles.includes('<role>')) throw problem.forbidden` guards in the block or a module helper it calls. */
  requiredRoles: string[];
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

const BODY_RE = /parseBody\(c,\s*([A-Za-z0-9_]+)\b/g;
const QUERY_RE = /parseQuery\(c,\s*([A-Za-z0-9_]+)\b/g;

/** A whole-route role guard: `if (!principal.roles.includes('<role>')) throw problem.forbidden(...)`. */
const ROLE_GUARD_RE = /\broles\.includes\('([a-z_]+)'\)\)\s*throw problem\.forbidden\(/g;

interface ModuleHelper {
  /** Declared as `function <name>(c...`: it parses the Hono context itself. */
  takesContext: boolean;
  body: string[];
  query: string[];
  roles: string[];
}

/**
 * Module-level helpers: those that take the Hono context and parse it themselves (e.g. `parseAnalyticsQuery(c)`,
 * body/query schema names), and those that hold a role guard (e.g. `requireSuperAdmin(s)`). A helper runs from its
 * `function <name>(` to the next top-level `function` / `export` / `const` / `define(` line.
 */
function scanModuleHelpers(source: string): Map<string, ModuleHelper> {
  const helpers = new Map<string, ModuleHelper>();
  const decls = [...source.matchAll(/^(?:export )?(?:async )?function ([A-Za-z0-9_]+)\((c\b)?/gm)];
  for (const d of decls) {
    const rest = source.slice(d.index + d[0].length);
    const end = rest.search(/^(?:export |async |function |const |\s*define\(')/m);
    const text = end >= 0 ? rest.slice(0, end) : rest;
    const takesContext = d[2] !== undefined;
    const helper: ModuleHelper = {
      takesContext,
      body: takesContext ? uniq([...text.matchAll(BODY_RE)].map((x) => x[1]!)) : [],
      query: takesContext ? uniq([...text.matchAll(QUERY_RE)].map((x) => x[1]!)) : [],
      roles: uniq([...text.matchAll(ROLE_GUARD_RE)].map((x) => x[1]!)),
    };
    if (helper.body.length || helper.query.length || helper.roles.length) helpers.set(d[1]!, helper);
  }
  return helpers;
}

/**
 * Top-level arguments of the call whose opening `(` is at `open` (string and template literals skipped, nesting
 * respected, a trailing comma ignored); `null` when the call is not closed.
 */
export function callArguments(source: string, open: number): string[] | null {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i += 1; i < source.length && source[i] !== ch; i += 1) if (source[i] === '\\') i += 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const last = source.slice(start, i).trim();
        if (last) args.push(last);
        return args;
      }
    } else if (ch === ',' && depth === 1) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}

/**
 * 2xx statuses a handler block can answer: every `respondOk(c, data[, status[, headers]])` call (200 without a
 * status) and every raw `new Response(body, { status })` (200 without one; non-2xx literals such as a 304 are not
 * success statuses). `dynamic` is true when a status argument holds no literal (e.g. a `status` variable).
 */
export function successStatusesOf(block: string): { statuses: number[]; dynamic: boolean } {
  const statuses = new Set<number>();
  let dynamic = false;
  for (const m of block.matchAll(/\brespondOk\(/g)) {
    const status = callArguments(block, m.index + m[0].length - 1)?.[2];
    if (status === undefined) {
      statuses.add(200);
      continue;
    }
    const literals = [...status.matchAll(/\b(2\d\d)\b/g)].map((x) => Number(x[1]));
    if (literals.length === 0) dynamic = true;
    for (const s of literals) statuses.add(s);
  }
  for (const m of block.matchAll(/\bnew Response\(/g)) {
    const init = callArguments(block, m.index + m[0].length - 1)?.[1];
    const status = init ? /\bstatus:\s*([^,}]+)/.exec(init)?.[1]?.trim() : undefined;
    if (status === undefined) statuses.add(200);
    else if (!/^\d{3}$/.test(status)) dynamic = true;
    else if (status.startsWith('2')) statuses.add(Number(status));
  }
  return { statuses: [...statuses].sort((a, b) => a - b), dynamic };
}

/**
 * Scan one route module. A handler block runs from its `define('<key>'` to the next `define('` (or end of file),
 * so helpers declared between two handlers are attributed to the earlier one; the test only relies on names that
 * the handler itself parses. Calls to module-level context helpers (`helper(c)`) contribute the helper's schemas,
 * and calls to module-level role-guard helpers (`helper(...)`) contribute the guarded roles.
 */
export function scanRouteSource(source: string, file = '<source>'): ScannedRoute[] {
  const helpers = scanModuleHelpers(source);
  const starts = [...source.matchAll(/\bdefine\('([A-Za-z0-9]+)',\s*\{([^}]*)\}/g)];
  return starts.map((m, i) => {
    const block = source.slice(m.index, i + 1 < starts.length ? starts[i + 1]!.index : source.length);
    const opts = m[2] ?? '';
    const pick = (re: RegExp): string | undefined => re.exec(opts)?.[1];
    const all = (re: RegExp): string[] => uniq([...block.matchAll(re)].map((x) => x[1]!));
    const called = uniq([...block.matchAll(/\b([A-Za-z0-9_]+)\(c\b/g)].map((x) => x[1]!)).filter((n) => helpers.get(n)?.takesContext);
    const guards = uniq([...block.matchAll(/\b([A-Za-z0-9_]+)\(/g)].map((x) => x[1]!)).filter((n) => helpers.get(n)?.roles.length);
    const { statuses, dynamic } = successStatusesOf(block);
    return {
      key: m[1]!,
      file,
      role: pick(/\brole:\s*'([A-Za-z]+)'/),
      auth: pick(/\bauth:\s*'([A-Za-z]+)'/),
      rate: pick(/\brate:\s*'([A-Za-z]+)'/),
      idempotent: !/\bidempotent:\s*false\b/.test(opts),
      bodySchemas: uniq([...all(BODY_RE), ...called.flatMap((n) => helpers.get(n)!.body)]),
      querySchemas: uniq([...all(QUERY_RE), ...called.flatMap((n) => helpers.get(n)!.query)]),
      rawQueryParams: all(/c\.req\.query\('([A-Za-z0-9_]+)'\)/g),
      responseSchemas: all(/\b([A-Za-z0-9_]+ResponseSchema)\.parse\(/g),
      successStatuses: statuses,
      dynamicStatus: dynamic,
      requiredRoles: uniq([...all(ROLE_GUARD_RE), ...guards.flatMap((n) => helpers.get(n)!.roles)]).sort(),
    };
  });
}

/** Parse `ROLE_SETS = { name: ['role', ...], ... }` from apps/api/src/middleware/auth.ts. */
export function parseRoleSets(source: string): Record<string, string[]> {
  const block = /export const ROLE_SETS = \{([\s\S]*?)\}\s*as const/.exec(source)?.[1];
  if (!block) throw new Error('ROLE_SETS not found in the auth middleware source');
  const out: Record<string, string[]> = {};
  for (const m of block.matchAll(/([A-Za-z]+):\s*\[([^\]]*)\]/g)) out[m[1]!] = [...m[2]!.matchAll(/'([a-z_]+)'/g)].map((r) => r[1]!);
  return out;
}

/** The role set `apps/api/src/app.ts` applies to `auth: 'admin'` routes without a `role` option. */
export function parseDefaultRoleSet(appSource: string): string {
  const m = /requireRoles\(opts\.role \?\? '([A-Za-z]+)'\)/.exec(appSource);
  if (!m) throw new Error('default admin role set not found in apps/api/src/app.ts');
  return m[1]!;
}

/** Rate-limit buckets from `RATE_POLICIES` (apps/api/src/middleware/rate-limit.ts). */
export function parseRatePolicies(source: string): Record<string, { perMinute: number; burst: number }> {
  const out: Record<string, { perMinute: number; burst: number }> = {};
  for (const m of source.matchAll(/\b([a-z]+): \{ perMinute: (\d+), burst: (\d+) \}/g)) out[m[1]!] = { perMinute: Number(m[2]), burst: Number(m[3]) };
  return out;
}

export interface ApiSources {
  routes: ScannedRoute[];
  roleSets: Record<string, string[]>;
  defaultRoleSet: string;
  ratePolicies: Record<string, { perMinute: number; burst: number }>;
}

const listTs = (dir: string): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return listTs(p);
      return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [p] : [];
    });

/** Read the API sources the document is derived from (read-only). */
export function readApiSources(root = repoRoot()): ApiSources {
  const api = resolve(root, 'apps/api/src');
  const routes = listTs(join(api, 'routes')).flatMap((f) => scanRouteSource(readFileSync(f, 'utf8'), relative(root, f)));
  return {
    routes,
    roleSets: parseRoleSets(readFileSync(join(api, 'middleware/auth.ts'), 'utf8')),
    defaultRoleSet: parseDefaultRoleSet(readFileSync(join(api, 'app.ts'), 'utf8')),
    ratePolicies: parseRatePolicies(readFileSync(join(api, 'middleware/rate-limit.ts'), 'utf8')),
  };
}

// ---------------------------------------------------------------------------
// Document builder
// ---------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const COMPONENT_REF = '#/components/schemas/';
const componentName = (exportName: string): string => exportName.replace(/Schema$/, '');

const isZod = (v: unknown): v is z.ZodType => v instanceof z.ZodType;
const contractSchema = (name: string): z.ZodType | undefined => {
  const v = (contracts as Record<string, unknown>)[name];
  return isZod(v) ? v : undefined;
};

/** Strip draft keywords OpenAPI tooling does not need inside components (`$schema`, empty `$defs`). */
function cleanSchema(schema: JsonObject): JsonObject {
  const { $schema: _s, ...rest } = schema;
  return rest;
}

/**
 * Every Zod schema exported by `@langquest/contracts`, one name per schema object: names the routes use first
 * (sorted), then every other export (sorted), so aliases such as `EnrollmentCreateResponseSchema = EnrollmentDtoSchema`
 * resolve to one component deterministically.
 */
function namedContractSchemas(preferred: readonly string[]): { entries: [string, z.ZodType][]; idFor: Map<string, string> } {
  const all = Object.keys(contracts)
    .filter((k) => k.endsWith('Schema') && contractSchema(k) !== undefined)
    .sort();
  const order = [...new Set([...[...preferred].sort(), ...all])];
  const byObject = new Map<z.ZodType, string>();
  const entries: [string, z.ZodType][] = [];
  const idFor = new Map<string, string>();
  for (const name of order) {
    const schema = contractSchema(name);
    if (!schema) throw new Error(`${name} is not a Zod schema exported by @langquest/contracts`);
    const existing = byObject.get(schema);
    if (existing) {
      idFor.set(name, existing);
      continue;
    }
    const id = componentName(name);
    byObject.set(schema, id);
    entries.push([id, schema]);
    idFor.set(name, id);
  }
  return { entries, idFor };
}

/**
 * Emit one registry conversion. Nested registered schemas become `$ref: #/components/schemas/<id>`; recursive
 * unregistered ones land in Zod's `__shared.$defs` and are hoisted to `<Io>Shared_<n>` components.
 */
function emitRegistry(entries: [string, z.ZodType][], io: 'input' | 'output'): Record<string, JsonObject> {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of entries) registry.add(schema, { id });
  const raw = z.toJSONSchema(registry, { target: 'draft-2020-12', unrepresentable: 'any', io, uri: (id) => `${COMPONENT_REF}${id}` }) as { schemas: Record<string, JsonObject> };
  const sharedPrefix = `${io === 'input' ? 'Input' : 'Output'}Shared_`;
  const text = JSON.stringify(raw.schemas).replace(/#\/components\/schemas\/__shared#\/\$defs\/([A-Za-z0-9_]+)/g, (_m, def: string) => `${COMPONENT_REF}${sharedPrefix}${def}`);
  const out: Record<string, JsonObject> = {};
  for (const [id, schema] of Object.entries(JSON.parse(text) as Record<string, JsonObject>)) {
    if (id === '__shared') {
      for (const [def, s] of Object.entries((schema.$defs ?? {}) as Record<string, JsonObject>)) out[`${sharedPrefix}${def}`] = s;
      continue;
    }
    const { $id: _id, ...rest } = cleanSchema(schema);
    out[id] = rest;
  }
  return out;
}

const refsOf = (schema: Json): string[] => [...JSON.stringify(schema).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]!);

/**
 * Components for request bodies (Zod input view: defaults make fields optional) and responses (output view).
 * A schema whose input view differs from its output view, or that references one that does, gets a separate
 * `<Name>Input` component; everything else is shared. Unreachable components are pruned by the caller.
 */
function buildComponents(preferred: readonly string[]): { schemas: Record<string, JsonObject>; outputId: (name: string) => string; inputId: (name: string) => string; inputVariants: Map<string, string> } {
  const { entries, idFor } = namedContractSchemas(preferred);
  const output = emitRegistry(entries, 'output');
  const input = emitRegistry(entries, 'input');
  const differs = new Set(Object.keys(input).filter((id) => !(id in output) || JSON.stringify(input[id]) !== JSON.stringify(output[id])));
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, schema] of Object.entries(input)) {
      if (!differs.has(id) && refsOf(schema).some((r) => differs.has(r))) {
        differs.add(id);
        changed = true;
      }
    }
  }
  const inputName = (id: string): string => (differs.has(id) && !id.startsWith('InputShared_') ? `${id}Input` : id);
  const schemas: Record<string, JsonObject> = { ...output };
  const inputVariants = new Map<string, string>();
  for (const id of differs) {
    if (inputName(id) !== id) inputVariants.set(inputName(id), id);
    const text = JSON.stringify(input[id]).replace(/"#\/components\/schemas\/([^"]+)"/g, (_m, ref: string) => `"${COMPONENT_REF}${inputName(ref)}"`);
    schemas[inputName(id)] = JSON.parse(text) as JsonObject;
  }
  const lookup = (name: string): string => {
    const id = idFor.get(name);
    if (!id) throw new Error(`${name} is not a Zod schema exported by @langquest/contracts`);
    return id;
  };
  return { schemas, outputId: lookup, inputId: (name) => inputName(lookup(name)), inputVariants };
}

/** Keep only the components reachable from `roots` (the paths and shared responses). */
function pruneComponents(schemas: Record<string, JsonObject>, roots: Json): Record<string, JsonObject> {
  const keep = new Set<string>();
  const queue = refsOf(roots);
  while (queue.length) {
    const id = queue.pop()!;
    if (keep.has(id)) continue;
    if (!schemas[id]) throw new Error(`dangling $ref to component ${id}`);
    keep.add(id);
    queue.push(...refsOf(schemas[id]!));
  }
  return Object.fromEntries([...keep].sort().map((id) => [id, schemas[id]!]));
}

function inlineSchema(schema: z.ZodType, io: 'input' | 'output'): JsonObject {
  return cleanSchema(z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io }) as JsonObject);
}

/** `:param` → `{param}`. */
export const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const pathParams = (path: string): string[] => [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!);

/** Tag = the resource segment after `/v1` (`admin/<segment>` for admin routes). */
export function tagFor(path: string): string {
  const seg = path.split('/').filter(Boolean);
  if (seg[1] === 'admin') return `admin/${seg[2] ?? 'root'}`;
  return seg[1] ?? 'root';
}

export interface BuildOptions {
  routes?: Readonly<Record<string, RouteDef>>;
  table?: Partial<Record<string, RouteSchemas>>;
  sources: ApiSources;
  version?: string;
}

/** Build the OpenAPI 3.1 document (plain JSON, unsorted; `stableStringify` sorts it). */
export function buildOpenApi(options: BuildOptions): JsonObject {
  const routes = options.routes ?? (ROUTES as Readonly<Record<string, RouteDef>>);
  const table = options.table ?? (ROUTE_SCHEMAS as Partial<Record<string, RouteSchemas>>);
  const scanned = new Map(options.sources.routes.map((r) => [r.key, r]));

  // Resolve each route's schema names: the table first, else names the handler parses that contracts exports.
  const resolved = new Map<string, { query?: string; body?: string; response?: string; source: 'table' | 'handler-scan' | 'none'; entry?: RouteSchemas }>();
  for (const key of Object.keys(routes)) {
    const entry = table[key];
    if (entry) {
      resolved.set(key, { query: entry.query, body: entry.body, response: entry.response, source: 'table', entry });
      continue;
    }
    const scan = scanned.get(key);
    const firstContract = (names: string[] | undefined): string | undefined => names?.find((n) => contractSchema(n) !== undefined);
    const fromScan = scan ? { query: firstContract(scan.querySchemas), body: firstContract(scan.bodySchemas), response: firstContract(scan.responseSchemas) } : {};
    const any = Boolean(fromScan.query || fromScan.body || fromScan.response);
    resolved.set(key, { ...fromScan, source: any ? 'handler-scan' : 'none' });
  }

  const requestNames = [...resolved.values()].map((r) => r.body).filter((n): n is string => Boolean(n));
  const responseNames = [...resolved.values()].map((r) => r.response).filter((n): n is string => Boolean(n) && n !== 'binary');
  const built = buildComponents([...responseNames, ...requestNames, 'ApiFailureSchema']);

  const errorCodes = [...contracts.API_ERROR_CODE_VALUES];
  const components: JsonObject = {
    schemas: {},
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Supabase access token. The Worker verifies it (JWKS or SUPABASE_JWT_SECRET) and forwards it to Supabase so RLS applies.' },
    },
    responses: {
      Error: { description: 'Failure envelope `{ ok: false, error: { code, message, details?, traceId? } }`. HTTP status mirrors `API_ERROR_HTTP_STATUS`.', content: { 'application/json': { schema: { $ref: `${COMPONENT_REF}ApiFailure` } } } },
      NotConfigured: {
        description: 'Fail-closed configuration error (apps/api/src/index.ts): `provider_unavailable` with "API is not configured yet", `Retry-After: 300`. Also used for provider outages and timeouts.',
        content: { 'application/json': { schema: { $ref: `${COMPONENT_REF}ApiFailure` } } },
      },
    },
    parameters: {
      IdempotencyKey: { name: contracts.IDEMPOTENCY_KEY_HEADER, in: 'header', required: false, schema: { type: 'string' }, description: 'Optional. A resent request with the same key replays the first stored response (KV when bound, else in-memory).' },
    },
  };

  const paths: Record<string, JsonObject> = {};
  const add = (path: string, method: string, op: JsonObject): void => {
    const p = toOpenApiPath(path);
    paths[p] ??= {};
    paths[p]![method.toLowerCase()] = op;
  };

  const errRef = { $ref: '#/components/responses/Error' };
  for (const [key, def] of Object.entries(routes)) {
    const r = resolved.get(key)!;
    const scan = scanned.get(key);
    const effectiveAuth = (scan?.auth as RouteDef['auth'] | undefined) ?? def.auth;
    const roleSet = effectiveAuth === 'admin' ? (scan?.role ?? options.sources.defaultRoleSet) : undefined;
    const rateClass = scan?.rate ?? (effectiveAuth === 'public' ? 'public' : effectiveAuth === 'admin' ? 'admin' : 'learner');
    const idempotencyLayer = def.method !== 'GET' && (scan?.idempotent ?? true);

    const parameters: Json[] = pathParams(def.path).map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: PATH_PARAM_SCHEMAS[name] ? inlineSchema(PATH_PARAM_SCHEMAS[name]!, 'input') : { type: 'string' },
    }));
    if (r.query) {
      const q = inlineSchema(contractSchema(r.query)!, 'input');
      const props = (q.properties ?? {}) as Record<string, JsonObject>;
      const required = new Set((q.required ?? []) as string[]);
      for (const name of Object.keys(props).sort()) parameters.push({ name, in: 'query', required: required.has(name), schema: props[name]! });
    }
    if (idempotencyLayer) parameters.push({ $ref: '#/components/parameters/IdempotencyKey' });

    const success = r.entry?.success ?? [200];
    const responsesObj: JsonObject = {};
    success.forEach((status, i) => {
      if (r.response === 'binary') {
        responsesObj[String(status)] = { description: status === 206 ? 'Partial content (Range request).' : 'Media bytes.', content: { 'application/octet-stream': { schema: { type: 'string', contentMediaType: 'application/octet-stream' } } } };
        return;
      }
      const data: Json = r.response ? { $ref: `${COMPONENT_REF}${built.outputId(r.response)}` } : { description: 'Payload schema not mapped yet (add the route to ROUTE_SCHEMAS in scripts/src/generate-openapi.ts).' };
      responsesObj[String(status)] = {
        description: i === 0 ? 'Success envelope `{ ok: true, data }`.' : 'Success envelope (alternate status; see the operation description).',
        content: { 'application/json': { schema: { type: 'object', required: ['ok', 'data'], properties: { ok: { const: true }, data } } } },
      };
    });
    if (effectiveAuth !== 'public' || key === 'mediaStream') responsesObj['401'] = errRef;
    if (effectiveAuth === 'admin') responsesObj['403'] = errRef;
    if (parameters.length || r.body) responsesObj['422'] = errRef;
    responsesObj['429'] = errRef;
    responsesObj['503'] = { $ref: '#/components/responses/NotConfigured' };
    responsesObj.default = errRef;

    const gateRoles = roleSet ? (options.sources.roleSets[roleSet] ?? []) : [];
    const handlerRoles = roleSet ? r.entry?.requiredRoles : undefined;
    const roleText = !roleSet
      ? ''
      : handlerRoles?.length
        ? `Requires one of: ${handlerRoles.join(', ')}. The route gate (role set \`${roleSet}\`: ${gateRoles.join(', ')}) admits more roles; the handler then answers 403 to the others.`
        : `Requires one of: ${gateRoles.join(', ')} (role set \`${roleSet}\`).`;
    const description = [
      `Contract auth class: \`${def.auth}\`${effectiveAuth !== def.auth ? ` (handler overrides it to \`${effectiveAuth}\`)` : ''}.`,
      roleText,
      `Rate-limit class: \`${rateClass}\`${options.sources.ratePolicies[rateClass] ? ` (${options.sources.ratePolicies[rateClass]!.perMinute}/min, burst ${options.sources.ratePolicies[rateClass]!.burst})` : ''}, after the per-client \`ingress\` bucket.`,
      r.entry?.note ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    const op: JsonObject = {
      operationId: key,
      tags: [tagFor(def.path)],
      summary: `${def.method} ${def.path}`,
      description,
      security: effectiveAuth === 'public' ? [] : [{ bearerAuth: [] }],
      parameters,
      responses: responsesObj,
      'x-langquest-route-key': key,
      'x-langquest-auth': def.auth,
      'x-langquest-schema-source': r.source,
      'x-langquest-rate-class': rateClass,
    };
    if (effectiveAuth !== def.auth) op['x-langquest-effective-auth'] = effectiveAuth;
    if (roleSet) {
      op['x-langquest-role-set'] = roleSet;
      op['x-langquest-roles'] = handlerRoles?.length ? [...handlerRoles] : gateRoles;
      if (handlerRoles?.length) op['x-langquest-gate-roles'] = gateRoles;
    }
    if (scan) op['x-langquest-handler'] = scan.file;
    if (r.body) op.requestBody = { required: true, content: { 'application/json': { schema: { $ref: `${COMPONENT_REF}${built.inputId(r.body)}` } } } };
    add(def.path, def.method, op);
  }

  // Un-versioned ops endpoints registered directly in apps/api/src/app.ts (not part of ROUTES).
  add('/healthz', 'GET', {
    operationId: 'healthz',
    tags: ['ops'],
    summary: 'GET /healthz',
    description: 'Liveness: `{ ok: true, data: { status: "ok", media: <r2 binding mode>, time } }`. Not in ROUTES (registered in apps/api/src/app.ts). Answers the 503 configuration envelope when Worker secrets are missing.',
    security: [],
    responses: { '200': { description: 'Alive.' }, '503': { $ref: '#/components/responses/NotConfigured' } },
    'x-langquest-route-key': null,
  });
  add('/', 'GET', {
    operationId: 'root',
    tags: ['ops'],
    summary: 'GET /',
    description: 'Service banner: `{ ok: true, data: { service: "langquest-api", env, routes: <registered route count> } }`. Not in ROUTES (registered in apps/api/src/app.ts).',
    security: [],
    responses: { '200': { description: 'Service banner.' }, '503': { $ref: '#/components/responses/NotConfigured' } },
    'x-langquest-route-key': null,
  });

  const kept = pruneComponents(built.schemas, [paths, components.responses ?? null]);
  components.schemas = kept;

  const doc: JsonObject = {
    openapi: '3.1.0',
    info: {
      title: 'LangQuest API',
      version: options.version ?? '0.0.0',
      description: [
        'Generated by scripts/src/generate-openapi.ts from the ROUTES table and Zod schemas of @langquest/contracts. Do not edit by hand; regenerate (docs/api/README.md).',
        'Every JSON response uses the envelope `{ ok: true, data }` / `{ ok: false, error }` (CONVENTIONS §3).',
        `Error codes: ${errorCodes.join(', ')}.`,
        'Rate limits are operator abuse guards, never learner quotas (CONVENTIONS §6).',
      ].join(' '),
    },
    servers: [
      { url: 'http://127.0.0.1:8787', description: 'Local `wrangler dev` (apps/api).' },
      { url: 'https://langquest-api.langquest-nsh.workers.dev', description: 'Deployed Worker (answers the 503 configuration envelope until its secrets exist).' },
    ],
    paths,
    components,
  };
  // An `<Name>Input` variant whose output view is not used anywhere takes the plain name (request-only schemas).
  const renames = [...built.inputVariants].filter(([variant, base]) => variant in kept && !(base in kept));
  if (!renames.length) return doc;
  let text = JSON.stringify(doc);
  for (const [variant, base] of renames) text = text.split(`"${COMPONENT_REF}${variant}"`).join(`"${COMPONENT_REF}${base}"`);
  const renamed = JSON.parse(text) as JsonObject & { components: { schemas: Record<string, JsonObject> } };
  for (const [variant, base] of renames) {
    renamed.components.schemas[base] = renamed.components.schemas[variant]!;
    delete renamed.components.schemas[variant];
  }
  return renamed;
}

/** JSON with recursively sorted object keys, 2-space indent and a trailing newline (arrays keep their order). */
export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sort((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** Version of @langquest/contracts (keeps the document free of timestamps). */
export function contractsVersion(root = repoRoot()): string {
  return (JSON.parse(readFileSync(resolve(root, 'packages/contracts/package.json'), 'utf8')) as { version: string }).version;
}

/** Render the document text for the current repository state. */
export function renderOpenApi(root = repoRoot()): string {
  return stableStringify(buildOpenApi({ sources: readApiSources(root), version: contractsVersion(root) }));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const DEFAULT_OUT = 'docs/api/openapi.json';

export const spec: CliSpec = {
  name: 'generate-openapi',
  summary: 'Build the OpenAPI 3.1 document of apps/api from ROUTES + @langquest/contracts Zod schemas.',
  description: 'Run with: pnpm --filter @langquest/scripts exec tsx src/generate-openapi.ts [flags]. Reads apps/api/src (handlers, ROLE_SETS, RATE_POLICIES) read-only; no network, no database.',
  flags: [
    { name: 'out', type: 'string', description: 'Output path, relative to the repo root.', default: DEFAULT_OUT },
    { name: 'check', type: 'boolean', description: 'Do not write; exit 1 when the file on disk differs from a fresh build.' },
  ],
  examples: ['tsx src/generate-openapi.ts', 'tsx src/generate-openapi.ts --check', 'tsx src/generate-openapi.ts --dry-run'],
};

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  const root = repoRoot();
  const out = resolve(root, flagString(args, 'out') ?? DEFAULT_OUT);
  const text = renderOpenApi(root);
  const doc = JSON.parse(text) as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, unknown> } };
  const ops = Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0);
  io.log(`openapi: ${Object.keys(doc.paths).length} paths, ${ops} operations (${Object.keys(ROUTES).length} ROUTES + 2 ops endpoints), ${Object.keys(doc.components.schemas).length} component schemas`);
  if (flagBool(args, 'check')) {
    const current = fileExists(out) ? readFileSync(out, 'utf8') : '';
    if (current !== text) {
      io.error(`${relative(root, out)} is stale; regenerate with: pnpm --filter @langquest/scripts exec tsx src/generate-openapi.ts`);
      return 1;
    }
    io.log(`${relative(root, out)} is up to date`);
    return 0;
  }
  if (args.dryRun) {
    io.log(`dry-run: would write ${relative(root, out)} (${text.length} bytes)`);
    return 0;
  }
  writeTextFileSync(out, text);
  io.log(`wrote ${relative(root, out)}`);
  return 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
