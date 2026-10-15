# Proposed admin routes (ready-to-apply block)

Status: **proposal, not yet in `ROUTES`.** The API's route-coverage test runs against the current `ROUTES`
map, so these entries are parked here until `apps/api` implements them; applying this block and the
route handlers must land in the same change. Source of the requirements: `docs/reference/cross-package-gaps.md`
(“From @langquest/admin”), currently worked around by the Next route handlers under
`apps/admin/app/api/admin/**` with schemas in `apps/admin/src/lib/local-api/schemas.ts`.

Conventions recap (CONVENTIONS §3): `/v1` base, `auth: 'admin'` for everything under `/v1/admin/`, bodies
validated with Zod from `@langquest/contracts`, `Idempotency-Key` on mutating calls, optimistic concurrency via
`expectedRevision`/`expectedVersion`, every write recorded in `content_revisions` + `audit_log`. No paywall or
credit concepts anywhere. Honesty rules: no silent dialect/source-language substitution (speakers, lessons and
collections keep their own `targetVarietyId`; a `null` is “unknown”, never an inferred neighbour).

## 1. Block to paste into `ROUTES` (`packages/contracts/src/api/common.ts`)

Insert after `adminAnalyticsErrors` (keys sorted by resource; paths are stable once published).

```ts
  // §7.3 speakers (people/voices behind recordings; consent + rights live here)
  adminSpeakersList: route('GET', '/v1/admin/speakers', 'admin'),
  adminSpeakerCreate: route('POST', '/v1/admin/speakers', 'admin'),
  adminSpeakerGet: route('GET', '/v1/admin/speakers/:id', 'admin'),
  adminSpeakerPatch: route('PATCH', '/v1/admin/speakers/:id', 'admin'),
  adminSpeakerDelete: route('DELETE', '/v1/admin/speakers/:id', 'admin'),
  // §7.3 library structure: collections → chapters → lessons
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
  adminLessonDelete: route('DELETE', '/v1/admin/library/lessons/:id', 'admin'),
  adminLessonAssetAttach: route('POST', '/v1/admin/library/lessons/:id/assets', 'admin'),
  adminLessonAssetDetach: route('DELETE', '/v1/admin/library/lessons/:id/assets/:assetId', 'admin'),
  // §7.5 content rights (one row per grant; assets/lessons point at it via contentRightsId)
  adminContentRightsList: route('GET', '/v1/admin/content-rights', 'admin'),
  adminContentRightsCreate: route('POST', '/v1/admin/content-rights', 'admin'),
  adminContentRightsGet: route('GET', '/v1/admin/content-rights/:id', 'admin'),
  adminContentRightsPatch: route('PATCH', '/v1/admin/content-rights/:id', 'admin'),
  adminContentRightsRevoke: route('POST', '/v1/admin/content-rights/:id/revoke', 'admin'),
  // §10.2A visual assets (upload goes through the multipart upload lifecycle with kind 'visual')
  adminVisualAssetsList: route('GET', '/v1/admin/visual-assets', 'admin'),
  adminVisualAssetRegister: route('POST', '/v1/admin/visual-assets', 'admin'),
  adminVisualAssetGet: route('GET', '/v1/admin/visual-assets/:id', 'admin'),
  adminVisualAssetPatch: route('PATCH', '/v1/admin/visual-assets/:id', 'admin'),
  adminVisualAssetReplace: route('POST', '/v1/admin/visual-assets/:id/replace', 'admin'),
  adminVisualAssetAssign: route('POST', '/v1/admin/visual-assets/:id/assign', 'admin'),
  adminVisualAssetUnassign: route('DELETE', '/v1/admin/visual-assets/:id/assignments/:assignmentId', 'admin'),
  // §7.4 AI-assisted organisation suggestions (review queue; nothing applies without a human decision)
  adminAssetSuggestionsList: route('GET', '/v1/admin/asset-suggestions', 'admin'),
  adminAssetSuggestionsGenerate: route('POST', '/v1/admin/asset-suggestions/generate', 'admin'),
  adminAssetSuggestionGet: route('GET', '/v1/admin/asset-suggestions/:id', 'admin'),
  adminAssetSuggestionReview: route('POST', '/v1/admin/asset-suggestions/:id/review', 'admin'),
  adminAssetSuggestionsBulkReview: route('POST', '/v1/admin/asset-suggestions/bulk-review', 'admin'),
```

When this lands, bump the `expect(Object.keys(ROUTES).length).toBeGreaterThanOrEqual(53)` assertion in
`api.test.ts` to `94`.

## 2. Request/response schemas to add to `packages/contracts/src/api/admin.ts`

All schemas reuse existing primitives/enums (`UuidSchema`, `TimestamptzSchema`, `VarietyIdSchema`,
`SourceLanguageCodeSchema`, `ContentStateSchema`, `SpeakerConsentStateSchema`, `LearnerLevelSchema`,
`AssetKindSchema`, `VisualAssetTypeSchema`, `ReviewStatusSchema`, `FocalPointSchema`, `VisualAssetSchema`,
`pageOf`, `PaginationQuerySchema`). `Localized` = `z.record(z.string().min(2).max(10), z.string().max(2000))`
keyed by source-language code (never a single untagged string, so localization stays honest).

### 2.1 Speakers

```ts
export const SpeakerDtoSchema = z.object({
  id: UuidSchema,
  displayName: z.string(),
  pseudonymous: z.boolean(),
  targetVarietyId: VarietyIdSchema.nullable(),
  region: z.string().nullable(),
  consentState: SpeakerConsentStateSchema,
  contentRightsId: UuidSchema.nullable(),
  voiceDescription: z.string().nullable(),
  /** Synthetic voices must be surfaced as such everywhere (§8.6). */
  synthetic: z.boolean(),
  lessonCount: NonNegativeIntSchema,
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export const SpeakersListQuerySchema = z.object({ q: z.string().max(100).optional(), targetVarietyId: VarietyIdSchema.optional(), consentState: SpeakerConsentStateSchema.optional(), synthetic: z.coerce.boolean().optional() }).extend(PaginationQuerySchema.shape);
export const SpeakersListResponseSchema = pageOf(SpeakerDtoSchema);
export const SpeakerCreateRequestSchema = z.object({
  displayName: z.string().min(1).max(200),
  pseudonymous: z.boolean().default(true),
  targetVarietyId: VarietyIdSchema.nullable().default(null),
  region: z.string().max(200).nullable().default(null),
  consentState: SpeakerConsentStateSchema.default('unknown'),
  contentRightsId: UuidSchema.nullable().default(null),
  voiceDescription: z.string().max(2000).nullable().default(null),
  synthetic: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(128),
});
export const SpeakerPatchRequestSchema = SpeakerCreateRequestSchema.omit({ idempotencyKey: true }).partial().extend({ expectedRevision: NonNegativeIntSchema.optional() }).refine((v) => Object.keys(v).some((k) => k !== 'expectedRevision'), { message: 'At least one field must be provided' });
export const SpeakerResponseSchema = SpeakerDtoSchema;
/** Deleting a speaker still referenced by lessons is refused (`conflict`) unless `reassignToSpeakerId` is given. */
export const SpeakerDeleteRequestSchema = z.object({ reassignToSpeakerId: UuidSchema.optional(), reason: z.string().max(500).optional() });
export const SpeakerDeleteResponseSchema = z.object({ id: UuidSchema, deleted: z.boolean(), reassignedLessons: NonNegativeIntSchema });
```

### 2.2 Collections / chapters / lessons

```ts
export const CollectionDtoSchema = z.object({
  id: UuidSchema,
  titleTranslations: Localized,
  descriptionTranslations: Localized,
  courseTrackId: CourseTrackIdSchema.nullable(),
  targetVarietyId: VarietyIdSchema.nullable(),
  instructionLanguageCode: SourceLanguageCodeSchema.nullable(),
  region: z.string().nullable(),
  instructorSpeakerId: UuidSchema.nullable(),
  coverVisualAssetId: UuidSchema.nullable(),
  contentRightsId: UuidSchema.nullable(),
  state: ContentStateSchema,
  sortOrder: NonNegativeIntSchema,
  chapterCount: NonNegativeIntSchema,
  lessonCount: NonNegativeIntSchema,
  revision: NonNegativeIntSchema,
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export const CollectionsListQuerySchema = z.object({ q: z.string().max(100).optional(), trackId: CourseTrackIdSchema.optional(), state: ContentStateSchema.optional() }).extend(PaginationQuerySchema.shape);
export const CollectionsListResponseSchema = pageOf(CollectionDtoSchema);
export const CollectionCreateRequestSchema = z.object({
  titleTranslations: Localized,
  descriptionTranslations: Localized.default({}),
  courseTrackId: CourseTrackIdSchema.nullable().default(null),
  targetVarietyId: VarietyIdSchema.nullable().default(null),
  instructionLanguageCode: SourceLanguageCodeSchema.nullable().default(null),
  region: z.string().max(200).nullable().default(null),
  instructorSpeakerId: UuidSchema.nullable().default(null),
  coverVisualAssetId: UuidSchema.nullable().default(null),
  contentRightsId: UuidSchema.nullable().default(null),
  sortOrder: NonNegativeIntSchema.default(0),
  idempotencyKey: z.string().min(8).max(128),
});
export const CollectionPatchRequestSchema = CollectionCreateRequestSchema.omit({ idempotencyKey: true }).partial().extend({ expectedRevision: NonNegativeIntSchema.optional() });
export const CollectionResponseSchema = CollectionDtoSchema.extend({ chapters: z.array(z.object({ id: UuidSchema, sortOrder: NonNegativeIntSchema, titleTranslations: Localized, lessonCount: NonNegativeIntSchema, state: ContentStateSchema })) });
/** Deletion is refused (`conflict`) while any child is `published`. */
export const CollectionDeleteResponseSchema = z.object({ id: UuidSchema, deleted: z.boolean(), orphanedAssetIds: z.array(UuidSchema) });

export const ChapterDtoSchema = z.object({
  id: UuidSchema,
  collectionId: UuidSchema,
  titleTranslations: Localized,
  summaryTranslations: Localized,
  sortOrder: NonNegativeIntSchema,
  scene: z.string().nullable(),
  coverVisualAssetId: UuidSchema.nullable(),
  state: ContentStateSchema,
  lessonCount: NonNegativeIntSchema,
  revision: NonNegativeIntSchema,
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export const ChapterCreateRequestSchema = z.object({
  collectionId: UuidSchema,
  titleTranslations: Localized,
  summaryTranslations: Localized.default({}),
  sortOrder: NonNegativeIntSchema.default(0),
  scene: z.string().max(120).nullable().default(null),
  coverVisualAssetId: UuidSchema.nullable().default(null),
  idempotencyKey: z.string().min(8).max(128),
});
export const ChapterPatchRequestSchema = ChapterCreateRequestSchema.omit({ idempotencyKey: true, collectionId: true }).partial().extend({ collectionId: UuidSchema.optional(), expectedRevision: NonNegativeIntSchema.optional() });
export const ChapterResponseSchema = ChapterDtoSchema.extend({ lessons: z.array(z.object({ id: UuidSchema, sortOrder: NonNegativeIntSchema, titleTranslations: Localized, state: ContentStateSchema, durationMs: MillisSchema.nullable() })) });
export const ChapterDeleteResponseSchema = z.object({ id: UuidSchema, deleted: z.boolean(), movedLessonIds: z.array(UuidSchema) });

/** Reorder is a full permutation of the parent's children (ids must match exactly, no gaps). */
export const ReorderRequestSchema = z.object({ orderedIds: z.array(UuidSchema).min(1).max(5000), expectedRevision: NonNegativeIntSchema.optional(), idempotencyKey: z.string().min(8).max(128) });
export const ReorderResponseSchema = z.object({ parentId: UuidSchema, revision: NonNegativeIntSchema, items: z.array(z.object({ id: UuidSchema, sortOrder: NonNegativeIntSchema })) });

export const LessonCreateRequestSchema = z.object({
  chapterId: UuidSchema,
  titleTranslations: Localized,
  descriptionTranslations: Localized.default({}),
  sortOrder: NonNegativeIntSchema.default(0),
  level: LearnerLevelSchema.nullable().default(null),
  targetVarietyId: VarietyIdSchema.nullable().default(null),
  instructionLanguageCode: SourceLanguageCodeSchema.nullable().default(null),
  speakerIds: z.array(UuidSchema).default([]),
  /** Optional initial master asset; equivalent to a follow-up attach. */
  assetId: UuidSchema.optional(),
  idempotencyKey: z.string().min(8).max(128),
});
export const LessonDetailResponseSchema = z.object({
  id: UuidSchema,
  chapterId: UuidSchema,
  collectionId: UuidSchema,
  titleTranslations: Localized,
  descriptionTranslations: Localized,
  sortOrder: NonNegativeIntSchema,
  level: LearnerLevelSchema.nullable(),
  targetVarietyId: VarietyIdSchema.nullable(),
  instructionLanguageCode: SourceLanguageCodeSchema.nullable(),
  speakerIds: z.array(UuidSchema),
  state: ContentStateSchema,
  revision: NonNegativeIntSchema,
  assets: z.array(z.object({ assetId: UuidSchema, assetType: AudioAssetTypeSchema, sortOrder: NonNegativeIntSchema, state: ContentStateSchema, durationMs: MillisSchema.nullable() })),
  transcriptStatus: TranscriptStatusSchema,
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export const LessonDeleteResponseSchema = z.object({ id: UuidSchema, deleted: z.boolean(), detachedAssetIds: z.array(UuidSchema) });
export const LessonAssetAttachRequestSchema = z.object({ assetId: UuidSchema, assetType: AudioAssetTypeSchema.default('master'), sortOrder: NonNegativeIntSchema.default(0), expectedRevision: NonNegativeIntSchema.optional() });
export const LessonAssetAttachResponseSchema = z.object({ lessonId: UuidSchema, assetId: UuidSchema, assetType: AudioAssetTypeSchema, revision: NonNegativeIntSchema, /** True when the asset was moved from another lesson (recorded as a revision on both). */ movedFromLessonId: UuidSchema.nullable() });
export const LessonAssetDetachResponseSchema = z.object({ lessonId: UuidSchema, assetId: UuidSchema, revision: NonNegativeIntSchema, /** Detached assets return to `imported_draft`, never deleted. */ assetState: ContentStateSchema });
```

### 2.3 Content rights

```ts
export const ContentRightsDtoSchema = z.object({
  id: UuidSchema,
  originUrl: UrlSchema.nullable(),
  authors: z.array(z.string()),
  speakers: z.array(z.string()),
  permissionGrant: z.string(),
  licenseId: z.string(),
  licenseVersion: z.string().nullable(),
  commercialRedistribution: z.boolean(),
  attributionRequired: z.boolean(),
  attributionText: z.string().nullable(),
  alterationsPermitted: z.boolean(),
  aiProcessingPermitted: z.boolean(),
  voiceRights: z.enum(['none', 'playback_only', 'synthesis_permitted']),
  expiresAt: TimestamptzSchema.nullable(),
  revokedAt: TimestamptzSchema.nullable(),
  evidenceAssetId: UuidSchema.nullable(),
  verified: z.boolean(),
  verifiedBy: UuidSchema.nullable(),
  verifiedAt: TimestamptzSchema.nullable(),
  usedBy: z.array(z.object({ entityTable: z.string(), entityId: UuidSchema, state: ContentStateSchema })),
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export const ContentRightsListQuerySchema = z.object({ q: z.string().max(100).optional(), verified: z.coerce.boolean().optional(), expiringBefore: TimestamptzSchema.optional(), licenseId: z.string().optional() }).extend(PaginationQuerySchema.shape);
export const ContentRightsListResponseSchema = pageOf(ContentRightsDtoSchema);
export const ContentRightsCreateRequestSchema = z.object({
  originUrl: UrlSchema.nullable().default(null),
  authors: z.array(z.string().min(1).max(200)).default([]),
  speakers: z.array(z.string().min(1).max(200)).default([]),
  permissionGrant: z.string().min(1).max(4000),
  licenseId: z.string().min(1).max(120),
  licenseVersion: z.string().max(40).nullable().default(null),
  commercialRedistribution: z.boolean().default(false),
  attributionRequired: z.boolean().default(true),
  attributionText: z.string().max(2000).nullable().default(null),
  alterationsPermitted: z.boolean().default(false),
  aiProcessingPermitted: z.boolean().default(false),
  voiceRights: z.enum(['none', 'playback_only', 'synthesis_permitted']).default('none'),
  expiresAt: TimestamptzSchema.nullable().default(null),
  evidenceAssetId: UuidSchema.nullable().default(null),
  /** Only `admin`/`super_admin` may set `verified: true`; editors create unverified rows. */
  verified: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(128),
});
export const ContentRightsPatchRequestSchema = ContentRightsCreateRequestSchema.omit({ idempotencyKey: true }).partial().extend({ expectedRevision: NonNegativeIntSchema.optional() });
export const ContentRightsResponseSchema = ContentRightsDtoSchema;
/** Revoking unpublishes every dependent published entity and revokes offline eligibility (§7.5). */
export const ContentRightsRevokeRequestSchema = z.object({ reason: z.enum(['rights_revoked', 'takedown', 'expired', 'other']), note: z.string().max(1000).optional(), idempotencyKey: z.string().min(8).max(128) });
export const ContentRightsRevokeResponseSchema = z.object({ id: UuidSchema, revokedAt: TimestamptzSchema, unpublished: z.array(z.object({ entityTable: z.string(), entityId: UuidSchema })), manifestInvalidated: z.boolean() });
```

### 2.4 Visual assets (upload → register → assign)

Upload bytes through the existing multipart lifecycle (`adminUploadInitiate` with `kind: 'visual'` and an
image MIME type). `adminVisualAssetRegister` then turns the verified upload into a `visual_assets` row;
storage keys are immutable, so `replace` creates a new row/key and re-points assignments (old key is kept
until no manifest references it).

```ts
export const VisualAssetAssignmentTargetSchema = z.object({
  entityTable: z.enum(['missions', 'lesson_courses', 'audio_chapters', 'audio_course_collections', 'characters', 'course_tracks', 'scenes']),
  entityId: UuidSchema,
  /** Which slot on the entity this asset fills. */
  slot: z.enum(['cover', 'scene', 'map', 'portrait', 'story_panel', 'celebration', 'context_object']),
});
export const VisualAssetAssignmentSchema = VisualAssetAssignmentTargetSchema.extend({ id: UuidSchema, assignedAt: TimestamptzSchema, assignedBy: UuidSchema.nullable() });
export const VisualAssetDtoSchema = VisualAssetSchema.extend({
  altTextTranslations: Localized,
  assignments: z.array(VisualAssetAssignmentSchema),
  contentRightsId: UuidSchema.nullable(),
  state: ContentStateSchema,
  revision: NonNegativeIntSchema,
  updatedAt: TimestamptzSchema,
});
export const VisualAssetsListQuerySchema = z.object({ type: VisualAssetTypeSchema.optional(), reviewStatus: ReviewStatusSchema.optional(), entityTable: VisualAssetAssignmentTargetSchema.shape.entityTable.optional(), entityId: UuidSchema.optional(), unassigned: z.coerce.boolean().optional(), q: z.string().max(100).optional() }).extend(PaginationQuerySchema.shape);
export const VisualAssetsListResponseSchema = pageOf(VisualAssetDtoSchema);
export const VisualAssetRegisterRequestSchema = z.object({
  /** Completed upload (status `verified`) with an image MIME type. */
  uploadId: UuidSchema,
  type: VisualAssetTypeSchema,
  styleVersion: z.string().min(1).max(40),
  /** Alt text per source language; `en` required (accessibility checklist item). */
  altTextTranslations: Localized.refine((m) => typeof m.en === 'string' && m.en.length > 0, { message: 'altTextTranslations.en is required' }),
  focalPoint: FocalPointSchema.nullable().default(null),
  /** Normalised crop rectangle (0–1) applied before variants are derived. */
  crop: z.object({ x: UnitIntervalSchema, y: UnitIntervalSchema, width: UnitIntervalSchema, height: UnitIntervalSchema }).nullable().default(null),
  localeNeutral: z.boolean().default(true),
  origin: ContentOriginSchema,
  contentRightsId: UuidSchema.nullable().default(null),
  generationBrief: JsonObjectSchema.nullable().default(null),
  idempotencyKey: z.string().min(8).max(128),
});
export const VisualAssetPatchRequestSchema = VisualAssetRegisterRequestSchema.omit({ uploadId: true, idempotencyKey: true, origin: true }).partial().extend({ reviewStatus: ReviewStatusSchema.optional(), expectedRevision: NonNegativeIntSchema.optional() });
export const VisualAssetResponseSchema = VisualAssetDtoSchema;
/** New bytes under a NEW immutable key; assignments move to the new asset id, the old one is unpublished. */
export const VisualAssetReplaceRequestSchema = z.object({ uploadId: UuidSchema, keepFocalPoint: z.boolean().default(true), keepCrop: z.boolean().default(false), note: z.string().max(500).optional(), expectedRevision: NonNegativeIntSchema.optional(), idempotencyKey: z.string().min(8).max(128) });
export const VisualAssetReplaceResponseSchema = z.object({ previousAssetId: UuidSchema, asset: VisualAssetDtoSchema, movedAssignments: NonNegativeIntSchema, manifestInvalidated: z.boolean() });
export const VisualAssetAssignRequestSchema = VisualAssetAssignmentTargetSchema.extend({ /** Replace an existing asset in the same slot instead of failing with `conflict`. */ replaceExisting: z.boolean().default(false), expectedRevision: NonNegativeIntSchema.optional(), idempotencyKey: z.string().min(8).max(128) });
export const VisualAssetAssignResponseSchema = z.object({ assignment: VisualAssetAssignmentSchema, replacedAssetId: UuidSchema.nullable(), manifestInvalidated: z.boolean() });
export const VisualAssetUnassignResponseSchema = z.object({ assignmentId: UuidSchema, removed: z.boolean(), manifestInvalidated: z.boolean() });
```

### 2.5 Asset suggestions (§7.4 AI-assisted organisation, human-reviewed)

Suggestions are produced by the `describe` job family and stored in an `asset_suggestions` table
(proposed in `db/*`, owned by the db agent): one row per (asset, field) with the model's proposal, its
confidence and an honest provenance. Nothing is applied until a reviewer accepts it; accepting writes a
`content_revisions` row like any manual edit.

```ts
export const AssetSuggestionFieldSchema = z.enum(['title', 'description', 'collection', 'chapter', 'lessonOrder', 'targetVarietyId', 'instructionLanguageCode', 'spokenLanguageCodes', 'level', 'topic', 'tags', 'scene', 'speaker', 'coverVisualAssetId']);
export const AssetSuggestionDtoSchema = z.object({
  id: UuidSchema,
  assetId: UuidSchema,
  lessonId: UuidSchema.nullable(),
  field: AssetSuggestionFieldSchema,
  /** Current value and proposed value, both as JSON so the UI can diff them. */
  currentValue: JsonValueSchema.nullable(),
  proposedValue: JsonValueSchema,
  /** Model self-reported confidence; shown as-is, never turned into a fake quality score. */
  confidence: UnitIntervalSchema.nullable(),
  rationale: z.string().nullable(),
  /** Where the proposal came from (job id, model profile version, transcript excerpt ids). */
  provenance: z.object({ jobId: UuidSchema.nullable(), profileVersion: NonNegativeIntSchema.nullable(), evidence: z.array(z.string()).max(10) }),
  status: z.enum(['pending', 'accepted', 'rejected', 'superseded']),
  reviewedBy: UuidSchema.nullable(),
  reviewedAt: TimestamptzSchema.nullable(),
  reviewNote: z.string().nullable(),
  createdAt: TimestamptzSchema,
});
export const AssetSuggestionsListQuerySchema = z.object({ status: AssetSuggestionDtoSchema.shape.status.optional(), field: AssetSuggestionFieldSchema.optional(), assetId: UuidSchema.optional(), collectionId: UuidSchema.optional(), minConfidence: z.coerce.number().min(0).max(1).optional() }).extend(PaginationQuerySchema.shape);
export const AssetSuggestionsListResponseSchema = pageOf(AssetSuggestionDtoSchema);
export const AssetSuggestionsGenerateRequestSchema = z.object({
  assetIds: z.array(UuidSchema).max(500).optional(),
  filter: AssetsListQuerySchema.omit({ cursor: true, limit: true, sort: true }).optional(),
  fields: z.array(AssetSuggestionFieldSchema).min(1).default(['title', 'collection', 'chapter', 'level', 'topic', 'tags']),
  /** Re-run for assets that already have pending suggestions. */
  force: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(128),
}).refine((v) => v.assetIds || v.filter, { message: 'assetIds or filter is required', path: ['assetIds'] });
export const AssetSuggestionsGenerateResponseSchema = z.object({ jobIds: z.array(UuidSchema), queuedAssets: NonNegativeIntSchema, skipped: z.array(z.object({ assetId: UuidSchema, reason: z.string() })).max(200) });
export const AssetSuggestionResponseSchema = AssetSuggestionDtoSchema;
export const AssetSuggestionReviewRequestSchema = z.object({
  decision: z.enum(['accept', 'reject']),
  /** Reviewer may edit the proposal before accepting; stored as the applied value. */
  overrideValue: JsonValueSchema.optional(),
  note: z.string().max(500).optional(),
  expectedRevision: NonNegativeIntSchema.optional(),
  idempotencyKey: z.string().min(8).max(128),
});
export const AssetSuggestionReviewResponseSchema = z.object({ suggestion: AssetSuggestionDtoSchema, applied: z.boolean(), revision: ContentRevisionRefSchema.nullable() });
export const AssetSuggestionsBulkReviewRequestSchema = z.object({ suggestionIds: z.array(UuidSchema).min(1).max(500), decision: z.enum(['accept', 'reject']), note: z.string().max(500).optional(), idempotencyKey: z.string().min(8).max(128) });
export const AssetSuggestionsBulkReviewResponseSchema = z.object({ accepted: NonNegativeIntSchema, rejected: NonNegativeIntSchema, skipped: z.array(z.object({ id: UuidSchema, reason: z.string() })).max(200), revisions: z.array(ContentRevisionRefSchema) });
```

## 3. Still needed elsewhere (out of this file's scope)

- `db/*`: `asset_suggestions` table (+ RLS: editors read/write, learners none), `visual_asset_assignments`
  table (or the equivalent `*_visual_asset_id` columns per slot), `speakers` CRUD RPCs are plain table
  writes; a `content_rights.revoke` RPC that unpublishes dependents in one transaction.
- `apps/api`: handlers for every route above, each writing `content_revisions` + `audit_log`, and the
  route-coverage test updated in the same change.
- Remaining admin gaps not covered by this block (coverage editorial update, transcript replace, job
  retry/cancel, user_roles grant/revoke, revision rollback, approve/reject decisions, model test probes,
  draft profile saves, audit/revision listing) follow the same pattern and can be appended here.
