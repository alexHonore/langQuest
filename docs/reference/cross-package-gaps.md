# Cross-package gaps reported by the app builders (2026-10-15)

Each app listed what it needed from shared packages and could not get; apps worked around them locally. Close these upstream, then remove the local workarounds.


## From @langquest/mobile (apps/mobile)

- @langquest/ui label sets are typed `as const` (literal strings), so localized overrides from @langquest/locales cannot be passed without a cast; apps/mobile/src/lib/labels.ts wraps them with a `loc<T>()` cast. Recommend widening the component `labels` prop types to `Partial<Record<keyof typeof X, string>>`-style shapes.
- @langquest/contracts exports schemas but not inferred types for TranscribeResponse, SynthesizeResponse, ConversationEndRequest, PlaybackUrlRequest, CoursesResponse; the app defines them locally via z.infer.
- @langquest/contracts MeResponseSchema requires defaultSourceLanguageCode but profiles.default_source_language_code is nullable (and apps/api returns null); the app uses a lenient schema (src/lib/api/me-schema.ts). Contracts should make it nullable.
- Missions in @langquest/contracts carry no scene id; the pathway infers a SceneArtwork scene from chapter.scene / title keywords (src/features/missions/story.ts). A `sceneId` on ManifestMission/MissionDetail would remove the heuristic.
- Audio tab + long-form player are left to the audio agent: apps/mobile/src/app/(tabs)/audio/index.tsx and src/features/audio/placeholder.ts are the replace-me seams; Home's 'Continue audio' button stays disabled until AUDIO_TAB_PLACEHOLDER.available flips.
- apps/mobile now depends on @langquest/ai (only the pure `@langquest/ai/conversation/machine` reducer) and zod; pnpm-lock.yaml was synced with `pnpm install --lockfile-only` and the workspace symlink added.

Blockers (external):
- No learner-facing data export or account-deletion route exists in @langquest/contracts ROUTES; the Account › danger screen does the local part (wipe caches/outbox, sign out) and states honestly that the server-side request is not available in this build.
- Native-only behaviour (expo-audio recorder metering, expo-sqlite, mic permission prompts, I18nManager RTL restart) could not be exercised without a development build/simulator run in this session; web build and unit tests cover the logic.
- A single non-blocking React #418 (hydration text mismatch) console error appears at first paint of the web export; the app continues and all screens render.

## From @langquest/scripts (/Volumes/SSD-1tb/LangQuest/scripts)

- @langquest/ai has no content_factory module (only the content_factory role→content_generation task mapping); prompt builders, LLM output schemas and validators live in scripts/src/lib/content-factory.ts and should move into packages/ai when the admin Content Factory UI needs them.
- @langquest/ai OpenRouterTextReasoner cannot raise max_tokens or disable hidden reasoning (profile maxOutputTokens 4000 is spent by reasoning tokens → truncated JSON on sonnet/haiku); scripts/src/lib/reasoner.ts is a local TextReasoner adapter reusing the package client/profiles/response-format/ledger with a 12k output budget and explicit `output_truncated` reporting. Suggest adding `maxOutputTokens`/`reasoning` to TextReasonerOptions or ChatCompletionRequest.
- Catalog seed (packages/db buildCatalogSeedSql / migration 080) does not seed communicative_intents or skills, so expressions.intent_id has nothing to reference; scripts/src/lib/seed-sql.ts + lib/db.ts ensureIntents/ensureSkills fill the gap (candidates for packages/db seed).
- @langquest/db has no repository for expression_forms inserts or idempotent expression lookup by provenance; lib/expression-apply.ts writes expression_forms directly and dedupes via script_annotations->provenance->draftId (JSONB contains).
- Tatoeba plain `<lang>_sentences.tsv` exports carry no username/license per row; attribution per contributor needs `sentences_detailed.tsv` (supported if present) — drafts record licenseSource 'export_default' honestly.
- Intent keyword heuristics only exist for eng/fra/spa (other languages are curated through their English translation); match rate ≈10–15% of linked sentences, so Tatoeba is a curation aid, not a curriculum source.

## From @langquest/jobs (apps/jobs) + docs/runbooks/jobs.md

- contracts/db: `processing_job_type` domain + PROCESSING_JOB_TYPE_VALUES lack `translate_transcript`, `regenerate_manifest`, `cleanup_orphan_uploads`; they run under carrier type `describe` + params.handler (admin UI will show `describe`). Adding the three enum values (000_extensions.sql + enums.ts) lets HANDLER_PRIMARY_JOB_TYPE in apps/jobs/src/queue/types.ts drop the carrier.
- db: no table for stored manifests (ADR-004); regenerate_manifest stores JSON in the object store under `manifests/course/{track}/{source}/v{n}.json|latest.json` and `manifests/audio/{collectionId}/{lang}/...` and emits manifest.invalidated. API should read `latest.json` (or a manifests table should be added).
- db: no column for AI metadata suggestions / content provenance; infer_metadata stores suggestions in job output + asset_provenance_events(event_type 'edited', details.action='ai_metadata_suggested') + lesson_topics(provenance='ai_suggested'); generate_content stores provenance in missions.scoring_rubric.provenance, expressions.script_annotations.provenance and audit_logs('content_factory.draft_created'). content_revisions needs a non-null editor_id so jobs cannot write revisions.
- db repositories lacked explicit-column queries the runner needs (full media_assets rows incl. owner_id/legacy_path for the service role, transcripts by lesson/asset, segment/translation/word-alignment writes, lesson_topics upsert, communicative_intents lookup, mission_localizations/expression_forms/expression_translations inserts, audit ledger lookup `import_r2_prefix.object`); implemented locally in apps/jobs/src/db.ts (createSupabaseJobsDb). Worth promoting into @langquest/db.
- media_assets.storage_key is UNIQUE, so a duplicate blob cannot become a second logical asset (§7.2 'distinguish physical blob and logical asset'); import_r2_prefix links the existing asset to the new lesson instead and keeps idempotency through the audit ledger.
- @langquest/ui: `./art` re-exports react-native renderers and no `./art/*` subpath is exported, so Node cannot import the pure cover renderer via the package; render-cover.ts imports `packages/ui/src/art/covers.ts` and `manifest.ts` by relative path. Exporting `./art/covers` (or a Node-safe `./art/strings`) would remove that.
- @langquest/ai OpenRouterSpeechRecognizer always sends the capability-matrix language hint; there is no option to drop it for code-switched audio, so mixed-language recordings are flagged (language_mode 'mixed', per-segment target_variety_id left null) rather than transcribed with an explicit mixed hint.
- @langquest/media has no ffmpeg segment (chunking) builder; apps/jobs/src/ffmpeg.ts adds `buildSegmentCommand` and `buildToneCommand` (fixtures).
- packages/db generated types: `requeue_expired_jobs` was absent at session start and appeared mid-session as `processingJobs.requeueExpired()` — runner now uses it; CONTRACT consumers should regenerate database.types.ts when functions change.
- ui/contracts: no alt-text keys exist for covers; render_cover uses `catalog.cover.<track_with_underscores>` which locales should add.

Blockers (external):
- Cloudflare R2 is not enabled on the account: production object storage could not be verified end-to-end; runner falls back to the dev-only LocalFsObjectStore and logs a warning.
- Cloudflare Queues requires Workers Paid: the cloudflare_queues backend (push consumer + HTTP pull loop) is implemented and unit-tested with fakes but not run against a real queue.
- Hosted Supabase is not provisioned; integration coverage is against the local Docker stack only.

## From @langquest/api (apps/api) + infra/cloudflare

- supabase: append-only triggers (learning_observations, xp_ledger, device_sync_events, conversation_turns, audit_logs, ai_requests) reject UPDATE/DELETE for every role, so `auth.admin.deleteUser` cascades fail for any learner with evidence/ledger rows. The API falls back to immediate deactivation (ban + anonymised email + profiles.deleted_at, status 'scheduled'); a SECURITY DEFINER `delete_account(user_id)` RPC (or retention job) is needed in supabase/migrations for the hard delete. Test-user cleanup in the local DB hits the same wall.
- supabase seed + @langquest/ai: every seeded `ai_model_profiles` row is `enabled=false` and `ModelProfileRegistry.refresh` overwrites the package defaults for the same scope, which would disable all AI tasks. The API overlays only ENABLED DB rows (services/ai.ts `overlayProfiles`); decide whether a disabled global row should mean 'off' and adjust the seed/registry accordingly.
- @langquest/ai PipelineRealtimeProvider.createSession returns pipeline 'stt_llm_tts' even when the session mode is text_only (when speech is supported); the API re-signs the ticket with pipeline 'text_only' to honour the learner's choice.
- @langquest/ai adapters log ai_requests with userId null (pseudonymous by design) and profileId set to package-default ids that are not DB uuids; the API fills user_id from the principal and nulls unknown profile ids before inserting.
- @langquest/contracts: ConversationTurnRequest only references audio by assetId; the API accepts an optional `audio: AudioInput` extension so short clips can be sent inline. BulkLabelResponse.revisionIds expects uuids but content_revisions are (table,id,revision) tuples — the API returns the touched lesson ids. ImportR2Prefix/ImportManifest require a jobId even for dryRun — the API returns a deterministic plan id and enqueues nothing on dry runs.
- @langquest/telemetry SupabaseTableSink expects a `daily_learning_metrics` shape (metric_date, track_id, source_language_code, metric_key, value) that differs from the DB table (per user/enrollment counters); the API does not use that sink and computes analytics directly from rows.
- @langquest/db repositories: audio_lessons/content_revisions have no per-row revision column; the API derives revisions from content_revisions (max revision) for optimistic concurrency.
- Mission steps carry no per-step localized instruction text (only mission-level instructions/hints); the API uses `lesson.stepTypes.<type>` catalog labels + mission localization, and flags localizationComplete=false when translations are missing.

Blockers (external):
- Cloudflare R2 is not enabled on the account, so presigned playback/download URLs, multipart uploads, prefix imports and the TTS object cache are implemented but could only be exercised in code review and offline tests (every such endpoint returns capability_unsupported with a clear message until R2_* secrets/MEDIA binding exist).
- Hosted Supabase is not provisioned; all verification used the local Docker stack (HS256 JWTs). ES256/JWKS verification is covered by a unit test with a generated key pair, not against a hosted project.
- Docker Desktop was down at session start (containers 500); restarting it brought the stack back and all suites ran.

## From @langquest/admin (apps/admin)

- @langquest/contracts lacks admin routes for: speakers CRUD, collections/chapters/lesson structure (create, reorder, attach/detach assets), content_rights CRUD, course_source_localizations editorial update, transcript segment/translation replace (new revision), processing job retry AND cancel (no JWT-accessible cancel RPC either), user_roles grant/revoke, content_revisions rollback, editorial approve/reject decisions, model test-harness probes, draft (disabled) model profile saves, audit log/revision listing. Implemented as local Next route handlers under apps/admin/app/api/admin/** with schemas in apps/admin/src/lib/local-api/schemas.ts; these should move into contracts + apps/api.
- @langquest/locales: the shared `admin` namespace covers sections/roles/states but not the editor UI; apps/admin/src/lib/i18n/extra.ts holds ~330 `admin.ui.*` keys (en + fr) that belong in packages/locales/src/catalogs/{en,fr}.json.
- @langquest/ui: the `./art` export (and package root) re-exports React Native renderers (react-native-svg), so the web admin cannot import it; the admin uses a tsconfig path alias `@art/*` -> packages/ui/src/art/* to reach the string renderers. A web-safe subpath export (e.g. `@langquest/ui/art/strings`) would remove the alias.
- packages/db: generated types now expose the media_assets_staff / course_source_localizations_staff views, but there is no repository helper for them; the admin queries the views directly. The contracts speech routes (speechSynthesize/speechTranscribe) require an enrollmentId, so admin probes cannot reuse them — a dedicated admin probe route is needed.
- packages/media: `hashBlobChunked` (progress + cancellation + per-part hashes over a Blob) duplicates computeMultipartChecksum with progress; could be upstreamed.
- Spec §7.4 AI-assisted organisation suggestions and §10.2A visual-asset upload (visual_assets rows, focal point/crop, replacement with immutable keys) have no contract routes; the admin only links cover_visual_asset_id by uuid and queues `describe`/`generate_cover` jobs.

Blockers (external):
- apps/api has no source yet: all contract-backed writes (bulk label, CSV import, publish/unpublish, lesson patch, content generate, model config/benchmark, analytics, playback URLs) are wired but could only be verified against the typed client contract, not a running API.
- Playwright browser binaries are not installed locally (`pnpm exec playwright install` needed); e2e specs are runnable but were not executed in this session.
- Cloudflare R2 is not enabled: the browser->R2 multipart path (presigned PUT + ETag via CORS ExposeHeaders) is verified only through the in-memory fake server in engine.test.ts.
