# LangQuest Studio — administrator manual (`apps/admin`)

_Spec §7 (CMS), §6.4 (admin API), §8.7 (AI settings), §12.2 (operations) · Written 2026-10-15 against `apps/admin` as built
(Next.js 16.4 App Router, React 19.3, Tailwind 4). Sections follow the sidebar order in `apps/admin/src/lib/auth/roles.ts`._

Run it with `pnpm dev:admin` (http://localhost:3000) after `developer-setup.md` §6. Interface language: English or French
(switch in the sidebar; cookie via `/api/locale`). Every page keeps the **active course** and **instruction language** context
selectors in the top bar so editors always know which (track × source) pair they are working on.

## 0. How the Studio talks to the backend (read this first)

| Path | Mechanism | Security boundary |
|---|---|---|
| Lists and detail reads | direct Supabase queries under the signed-in user's own session (`src/lib/queries/*`, explicit column lists) | RLS `staff_select` / `admin_select` policies and the `*_staff` views |
| Contract-backed writes | typed client built from `@langquest/contracts` `ROUTES` (`src/lib/api.ts`) → LangQuest API (`NEXT_PUBLIC_API_BASE_URL`) | API role check + RLS |
| Writes the contracts do not expose yet | local Next route handlers under `app/api/admin/**` (`src/lib/local-api/*`), still under the user's Supabase session | RLS only — the admin never holds a service-role key |

The Studio simulates nothing. When the API is unreachable you see "The LangQuest API at … is unreachable. Reads still work
through Supabase; writes need the API." Model discovery, analytics, publishing, bulk labelling and the test harness are the
API-dependent features.

### Roles (`public.user_roles`, CONVENTIONS §2.4)

Staff accounts are ordinary Supabase Auth users with a role row; learners have none and are refused at `/login?reason=norole`.
`super_admin` opens everything. The matrix is the UX gate; writes are additionally enforced by the API and by RLS.

| Section | `super_admin` | `admin` | `content_editor` | `language_reviewer` | `support_readonly` |
|---|:-:|:-:|:-:|:-:|:-:|
| Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ |
| Uploads, Collections, Chapters, Lessons, Speakers, Rights, Publishing | ✓ | ✓ | ✓ | – | – |
| Library, Languages, Transcripts, Content factory, Quality review, Job queue | ✓ | ✓ | ✓ | ✓ | – |
| AI models, Settings, Audit log | ✓ | ✓ | – | – | – |
| Analytics | ✓ | ✓ | – | – | ✓ |
| Users / roles | ✓ | – | – | – | – |

## 1. Login (`/login`)

E-mail + password through `@supabase/ssr` cookies. `proxy.ts` refreshes the session and applies an optimistic staff gate;
every layout/page re-checks with `requireStaff()` / `requireSection()` (`src/lib/auth/session.ts`). Messages you can see:
"This account has no staff role", "Your session expired", "Your role cannot open {section}", and the setup state
("Environment not configured — copy apps/admin/.env.example …") when `NEXT_PUBLIC_*` values are missing. Sign out:
`POST /api/auth/signout`. Learners never need an account here.

## 2. Dashboard (`/`)

Job health (pending / running / failed / review needed, link to the queue), recent uploads, coverage summary ("Honest
editorial status per track × instruction language. Nothing here is a learner promise."), assets by state, **cost today**
(estimated from logged `ai_requests`; needs the `admin` role because that table is admin-only; invoices are reconciled in
Analytics), request count today, quick actions (Uploads, Content factory, Rights) and the in-code mascot preview.

## 3. Uploads (`/uploads`) — many-gigabyte MP3 imports (§7.2)

What you can do:
- **Drop files or nested folders** on the drop zone, or pick a folder with the directory picker. Folder traversal uses the
  FileSystem entry API (`src/lib/upload/traverse.ts`); thousands of files are enumerated without freezing the page.
  Relative folder paths are kept as **legacy metadata** and the suggested collection / chapter / lesson comes from the path
  (`parseImportPath`); the object key is always the content hash, never the filename.
- Accepted containers (`src/lib/upload/path.ts`): `mp3`, `m4a`, `m4b`, `mp4`, `aac`, `wav`, `flac`, `ogg`, `opus`.
  Anything else shows "Unsupported file type"; oversize files show "Larger than the … limit".
- Queue per file with states **Queued → Hashing → Initiating → Uploading → Finalizing → Verifying → Done**, plus
  Duplicate, Paused, Failed, Cancelled, Unsupported. Controls: Start, Pause, Resume, Retry failed, Clear finished, Remove,
  parallel-files setting, asset kind.
- Hashing is chunked SHA-256 in a Web Worker pool (`hash.worker.ts`; falls back to the main thread with a notice);
  per-part hashes feed the multipart checksum.
- Transport: idempotent `POST /v1/admin/uploads/initiate` → presigned multipart `PUT`s (XHR, per-part progress,
  `parts/sign`) → `complete` (composite checksum) → `verify` job. The R2 bucket CORS policy must expose the `ETag` header.
- **Resume**: sessions persist in IndexedDB (`store.ts`); after a reload the page says "N interrupted uploads can resume —
  re-select the file to resume" (the browser cannot re-open a file without a user gesture).
- **Duplicate detection** before upload: same content as another file in the queue, or already stored as asset `{id}`
  (remote lookup by content hash). Duplicates are never silently merged — physical blob and logical asset stay distinct
  (`packages/media/src/uploads.ts` decisions `new_blob | link_existing_blob | reuse_asset | blocked`).
- ID3 preview (`music-metadata`) per file before you commit.

Honest state: until R2 is enabled on the Cloudflare account, `initiate` answers `capability_unsupported` and the queue stops
at "Initiating" with that message; the full browser → R2 path is verified only against the in-memory fake server in
`engine.test.ts` (`docs/reference/cross-package-gaps.md`).

## 4. Library (`/library`, `/library/[id]`) — bulk labelling (§7.3)

- List from `GET /v1/admin/assets` with filters: status (content state), text search, kind, target variety, instruction
  language, collection, chapter, speaker, rights verified, transcript status, job state, legacy path prefix, uploaded
  after/before, sort (created, filename, duration, state). Rows show original vs derived, rights verified/unverified, latest
  job, transcript link, speakers.
- **Bulk label** (`POST /v1/admin/assets/bulk-label`, select rows or *select-by-filter*): every field of
  `BulkLabelPatchSchema` — target variety, instruction language, spoken language codes, regional dialect, speaker,
  collection, chapter, chapter order, lesson order, level, topic, add/remove tags, scene, description, cover visual asset,
  rights record, content state, visibility (`private` \| `authenticated`). "Apply to children" makes the change inherit
  (reversible; the **inheritance preview** shows what would change). Dry run validates without writing. Result: N updated /
  N skipped with reasons; every change is a `content_revisions` row.
- Other operations: **Attach to lesson**, **Move / renumber** (target chapter, start, step), **Split lesson into chapters**
  (original audio untouched), **Merge identical references** (lessons sharing a content hash become one logical lesson;
  blobs are never deleted), **Import CSV** / **Export CSV** (`POST /v1/admin/library/import-manifest`; columns match
  `scripts bulk-audio-scan` output; dry run first), **Process** (queue `verify`, `extract_metadata`, `transcode`,
  `transcribe`, `align`, `detect_language`, `describe`, `segment_lessons`, `generate_cover`; "Force" ignores results cached by
  content hash).
- The detail page previews the asset (needs a playback URL → R2), shows ID3/container metadata, rights, jobs and revisions.

## 5. Collections (`/collections`, `/collections/[id]`)

Local route `app/api/admin/collections/route.ts` (`CollectionUpsertSchema`): localized title and description (add/remove
locales, RTL hint), course track, target variety, instruction language, region, instructor speaker, cover (either a generated
in-code vector cover via the `generate_cover` job or an uploaded cover referenced by visual-asset id), rights record,
publish state, sort order. The detail page lists chapters and lessons.

## 6. Chapters (`/chapters`, `/chapters/[id]`)

`ChapterUpsertSchema`: collection, localized title and summary, sort order, cover, state. The chapter page lists lessons with
**Move up / Move down** reorder (`POST /api/admin/lessons/reorder`, up to 5,000 items, optional chapter move).

## 7. Lessons (`/lessons`, `/lessons/[id]`)

- Create (`LessonCreateSchema`): chapter, localized title, order, level, target variety, instruction language.
- Edit through the API (`PATCH /v1/admin/audio/lessons/:id`): episode, level, topic, tags, scene, spoken languages, regional
  dialect, description, visibility, quality review status. Saves carry `expectedRevision` (derived from `content_revisions`)
  — a stale save shows "This record changed elsewhere. Reload and try again."
- **Attached files** (`POST /api/admin/lessons/:id/assets`): asset + type `master | mobile_encoded | review | slow | clip | cover`
  + order. The master is never replaced by derived renditions (Pimsleur pauses and originals are preserved by the transcode
  handler, `jobs.md` §3).

## 8. Speakers (`/speakers`)

`SpeakerUpsertSchema`: display name, pseudonymous flag, target variety, region, **consent state**
(`unknown | pending | granted | revoked`), rights record, voice description, **synthetic voice** flag (so learners can be told
when a voice is AI). The publish gate blocks lessons/collections whose known speakers lack a name or have consent
`unknown`/`revoked` (`speaker_metadata_missing`).

## 9. Languages / coverage (`/languages`)

- Catalog view of the 30 course tracks (variety, default locale, RTL, tonal, script modes, regional options) — read-only,
  seeded from `@langquest/contracts`.
- **Coverage editor** per (track × instruction language) (`POST /api/admin/coverage`, `CoverageUpdateSchema`): status
  `complete | partial | planned | unavailable`, metrics (mission instructions %, explanations %, UI %, subtitles %, audio
  overlays %), **native reviewed** + reviewer, editorial note key, opt-in fallback source language.
  Rule shown in the UI: "complete" requires a native review with every metric at 100%; "unavailable" hides the pair from
  learners. Rows are created by the catalog seed (`planned` for `en` and `fr`); "Coverage rows missing for this track" means
  the seed has not run. `scripts validate-course-coverage` regenerates `docs/provider-matrix/coverage-report.md` from the same
  data — today **no pair is complete** (690 pairs: 10 partial, 680 planned).

## 10. Transcripts (`/transcripts`, `/transcripts/[lessonId]`) (§7.5)

Filters by lesson, status (`none | pending | machine | edited | reviewed | failed`), language. The editor:
- Segment list (sort index, start/end ms, text, speaker label or speaker id, language code, target variety, confidence,
  reviewed flag) with per-segment **translations** (language, text, QA state `needs_review` by default).
- Playback of the lesson master (Play / Pause / Seek) against a **time ruler — not a fake waveform**; "No playable master"
  when the asset has no playback URL (R2).
- Retime, **Split at playhead**, **Merge with next**, language mix (`source | target | mixed`), status `edited | reviewed`,
  QA state, access rights (`internal_only | learners | public`), coverage %.
- **Import SRT/VTT** (manual transcripts avoid STT cost, §7.5) and **Export SRT/VTT**.
- Save writes a **new revision** (`POST /api/admin/transcripts/:lessonId`, `TranscriptReplaceSchema`, up to 20,000 segments);
  reviewed revisions are never overwritten by the `transcribe` job. Machine transcripts from the job keep word timestamps
  where the STT returned them; alignment is `unavailable` otherwise (`jobs.md`).

## 11. Rights & licensing (`/rights`) (§7.6, §9.9)

- Rights records (`POST /api/admin/rights`, `RightsUpsertSchema` = `content_rights`): origin URL, authors, speakers (names),
  **permission grant** (free text, required), license id + version, commercial redistribution, attribution required +
  attribution text, alterations permitted, AI processing permitted, voice rights (`none | playback_only | synthesis_permitted`),
  expires / revoked timestamps, evidence asset, **verified** (reviewer + `reviewed_at` are recorded).
- **Publish gate preview**: the screen runs `canPublish` from `@langquest/media` on the record and shows either "This record
  allows publishing" or "Would be blocked by: …" with the codes below. Hint text: "Public distribution requires a verified
  license with commercial redistribution. Owning a recording is not a license."
- **Attributions report** (`GET /v1/admin/licenses/attributions`, filter track / only unverified) and "Used by" counts.

Publish-block codes (`packages/media/src/rights.ts` `PUBLISH_BLOCK_CODES`) and what resolves them:

| Code | Meaning | Resolve in |
|---|---|---|
| `invalid_state` | content is not `approved` (or `unpublished`) | Quality review / decision |
| `missing_title`, `missing_language` | title or language/variety missing | Lesson / collection editor |
| `integrity_unverified`, `audio_inaccessible`, `asset_revoked` | no verified media checksum, object unreadable, or disposition not active | Uploads / Library (verify job) |
| `speaker_metadata_missing` | known speaker without name or with consent `unknown`/`revoked` | Speakers |
| `chapter_missing` | lesson not in a chapter | Chapters |
| `rights_missing` | no rights record ("Owning a recording does not grant redistribution rights") | Rights |
| `rights_unverified` | record not verified, or attribution required but no text/authors | Rights |
| `no_redistribution_right` | `commercial_redistribution = false` → owner-only staging only | Rights |
| `rights_expired`, `rights_revoked` | dates passed | Rights |
| `native_review_missing` | blocker for missions/expressions (`requireNativeReview`), warning for audio lessons/collections | Quality review |
| `alt_text_missing` | visual asset without alt-text key | Visual asset |

## 12. Content factory (`/content-factory`) (§9.8)

- **Brief**: track, instruction language, level, intent keys, number of drafts, character, scene (in-code scene art preview).
  Submit → `POST /v1/admin/content/generate` → a `content_generate` job ("Generation job {id} queued"). The same brief is
  idempotent: "Same brief already generated; returning existing drafts."
- **Review queue** of `review_needed` draft missions and expressions with: draft lesson, source examples, the learner-facing
  overlay per source language, prompts (**prompt text stays server-side** — only the prompt-pack name and version are shown),
  QA comments, "Native reviewed" and "Approved for publishing" flags.
- Decisions (`POST /api/admin/content/:id/decision`): **Approve draft**, **Reject draft**, **Request native review**.
  Approval moves `review_needed → approved`, sets `reviewed = true` + `reviewer_id` on expressions and records a revision; it
  **never publishes** (publishing has its own gate, §16). A published item must be unpublished before its decision changes.
- Every generated item carries provenance (model, prompt template version, trace ids, estimated cost) written by the job
  (`jobs.md` §3 `generate_content`); see `../content-rights/native-review-process.md`.

## 13. AI models (`/ai-models`) (§8.2, §8.7)

- **Profiles** (`ai_model_profiles`): scope = task × target variety × source language ("Global default" when both are null);
  provider, primary model, fallback models, params (temperature, top-p, max output tokens, timeout ms, STT language hint,
  TTS voice id), latency class (`realtime | interactive | batch`), daily budget USD, enabled, version, benchmark status
  (`unbenchmarked | passing | failing | stale`). Fallbacks never cross a variety boundary (no ary→arb, yue→cmn, ht→fr).
- **Save** goes to `PUT /v1/admin/models/:task/config`. **Enabling a profile requires passing language-specific smoke tests**
  ("require smoke tests" on): the API runs a real in-variety structured call for text tasks (or a support check for speech)
  and refuses to enable on failure — "Smoke tests failed; the profile was not changed." Results are listed per test.
  Draft (disabled) profiles can also be saved through the local route `/api/admin/models/profiles` when the API is down.
- **Model discovery** (`GET /v1/admin/models`, catalog + pricing metadata) is "unavailable until the API is reachable".
- **Test harness** (`/api/admin/models/test`): run a prompt on up to 5 models side by side (system prompt, temperature,
  max tokens), **Synthesize** text with a voice id, **Transcribe** an audio file with a language hint; each result shows
  latency and estimated cost. It needs the LangQuest API speech routes or a server-only `OPENROUTER_API_KEY` on the admin
  host; otherwise it reports "unavailable" honestly.
- **Benchmark** (`POST /v1/admin/models/:task/benchmark`, sample set id prompt): records a smoke benchmark row in
  `ai_model_benchmarks` (reviewer, latency, pass/fail, notes) and enqueues a `benchmark_model` job for the full sample set.
  Benchmark columns: naturalness, intelligibility, dialect adherence, WER, false corrections, passed. **Note:** the job
  runner has no `benchmark_model` handler yet (`jobs.md` §3 lists it as `no_handler`), so only the inline smoke part runs
  today.

## 14. Quality review (`/quality-review`)

One queue with four cards: **Audio lessons** (approve / reject → `PATCH /v1/admin/audio/lessons/:id` `qualityReviewStatus`
and, when the lesson is `review_needed`, the editorial decision route), **Transcripts** (machine/edited revisions awaiting
review → opens the editor at that revision), **Translations** (`needs_review` overlays), **Visual assets** (pending review).
Who may act: editors and language reviewers.

## 15. Job queue (`/jobs`) (ADR-005, `jobs.md`)

Filters by state (`pending | running | succeeded | failed | review_needed`) and type; columns: progress, error, output, parent
job, requested by, timestamps. **Retry** (`POST /api/admin/jobs/:id/retry`, optional priority) enqueues a fresh job with the
same parameters and an idempotency-key suffix — the original stays in the log. **Cancel is disabled** with the reason shown:
jobs are owned by the runner once claimed and there is no JWT-accessible cancel RPC. Handlers without their own DB type
(`translate_transcript`, `regenerate_manifest`, `cleanup_orphan_uploads`) appear under the carrier type `describe`.
`review_needed` rows need a human (`failure_code` / `failure_message` say why).

## 16. Publishing (`/publishing`) (§7.6, ADR-004)

- **Publishable items** (filter by entity type: audio lessons, collections, missions, lesson courses, expressions, characters,
  visual assets) with the **checklist** (title, language, file integrity, audio accessible, speaker metadata, chapter linked,
  rights verified, native reviewed, alt text).
- **Publish** (`POST /v1/admin/content/:id/publish` with entity table + expected revision + note): on success the item becomes
  `published`, a revision is written and the course/audio manifests are invalidated (`manifest.invalidated`); on failure the
  response lists `blockedBy` codes (§11 table) and the attempt is audited as `content.publish_blocked`.
- **Unpublish** with reason `rights_revoked | quality | takedown | editorial | other`: revokes offline eligibility and
  invalidates manifests; rights-driven reasons send approved items back to `rights_unverified`.
- **Revisions** + **Roll back to this revision** (`POST /api/admin/publishing/rollback`): restores the snapshot as a *new*
  revision — nothing is deleted. "This revision has no snapshot to restore" appears for diff-only revisions.
- **Publication events** list (`publication_events`).

## 17. Analytics (`/analytics`) (§12.2)

Served by the API (`GET /v1/admin/analytics/{quality,cost,usage,errors}`; "Analytics are served by the LangQuest API.
Configure NEXT_PUBLIC_API_BASE_URL and deploy the API to see data."). Filters: from / to / granularity / track / instruction
language.
- **Cost**: total, by task, by provider, storage GB, cost per completed speaking mission, per active learner, per meaningful
  conversation, per reviewed lesson, timeline. **Invoice reconciliation is not implemented**: the API always returns
  `reconciliation: { invoicedUsd: null, deltaUsd: null, asOf: null }` ("No invoice imported for this range") and
  `r2Operations: 0`.
- **Quality**: native-reviewed fraction, rights coverage, unresolved takedowns, live capability by track.
- **Usage**: active learners, retention D7 / D30. **Errors**: API error rate, latency p95, alerts.

## 18. Users / roles (`/users`) — `super_admin` only

Grant / revoke (`POST /api/admin/users/roles`) a role for a **user id (UUID from Supabase Auth)** with an optional expiry;
"Granted by" is recorded. You cannot revoke your own `super_admin`. E-mail lookup is not available (it would need the service
role, which the Studio does not hold) — copy the id from Supabase Studio/Auth.

## 19. Settings (`/settings`) — admins

Environment (API base URL, Supabase URL, interface language), **providers** (OpenRouter, Cloudflare R2, job queue backend —
shown as "Configured on the API host" vs "Server-side probe key on this host"; "R2 bucket names and endpoints are Worker
secrets; the CMS only sees signed URLs"), **API health** probe (Reachable / Unreachable), Studio version.

## 20. Audit log (`/audit-log`) — admins

Append-only `audit_logs`: actor, actor role, action (e.g. `content.publish_blocked`, `models.config_put`,
`content_factory.draft_created`, `import_r2_prefix.object`), entity table/id, before / after JSON, request id. Filters by
action, entity and date.

## 21. What needs R2, a hosted Supabase project or a deployed API

| Feature | Works locally today | Needs |
|---|---|---|
| Login, roles, catalog, coverage editor, speakers, collections/chapters/lessons structure, rights records, decisions, transcript editing (text), job retry, users, audit log | ✓ (local Docker stack + local routes) | — |
| Bulk label, CSV import, lesson patch, publish/unpublish, content generate, model config + smoke tests, benchmarks, analytics, attributions report | ✓ when `pnpm dev:api` runs against the local stack | API reachable |
| Upload queue past "Initiating", asset preview/playback, transcript audio playback, prefix imports, TTS cache | ✗ — `capability_unsupported` | **Cloudflare R2** enabled + `R2_*` secrets (`infra/cloudflare/README.md`) |
| Shared staff accounts, production data | local only | **Hosted Supabase** project (`provisioning.md`) |
| Queue-driven wake-ups | polling works | Cloudflare Queues (Workers Paid) — optional |
| Numeric pronunciation in the test harness / learner app | reference comparison only | `AZURE_SPEECH_KEY/REGION` (ADR-006) |
| Playwright e2e | specs exist | `pnpm exec playwright install` + `ADMIN_E2E_*` accounts |
