# Jobs runbook — `apps/jobs` (ADR-005)

_Package: `@langquest/jobs` · Node ≥ 22 · run with `tsx` · ffmpeg required for media handlers._

The job runner executes everything that must not run in a Worker: ffmpeg transcodes, transcription,
alignment, metadata inference, bulk imports, the content factory, manifest regeneration, cover rendering
and the upload sweeper. `processing_jobs` in Postgres is the system of record; the default backend is
polling (`JOBS_BACKEND=postgres`, zero fixed cost). Cloudflare Queues is an optional wake-up signal
that needs the **Workers Paid** plan (the account is on the free plan — see `provisioning.md`).

## 1. Run it

```bash
pnpm --filter @langquest/jobs start                       # poll loop; Ctrl-C = graceful stop
pnpm --filter @langquest/jobs handlers                    # list handlers ↔ job types
pnpm --filter @langquest/jobs -- status                   # queue counts by state (capped at 200/state)
pnpm --filter @langquest/jobs requeue                     # sweep expired leases once (requeue_expired_jobs)
pnpm --filter @langquest/jobs enqueue  -- --type transcribe --asset <uuid> --params '{"locale":"ary","translateTo":["fr"]}'
pnpm --filter @langquest/jobs run-once -- --type transcode --asset <uuid>              # enqueue (priority 10) + drain that type
pnpm --filter @langquest/jobs run-once -- --type regenerate_manifest --direct \
     --params '{"kind":"course","courseTrackId":"arabic-moroccan","sourceLanguageCode":"fr"}'   # no queue row
```

`--type` takes a handler name (`inspect_asset, transcode, transcribe, align, translate_transcript,
infer_metadata, import_r2_prefix, import_manifest, generate_content, regenerate_manifest, render_cover,
cleanup_orphan_uploads`) or a raw `processing_job_type`. Handlers without a dedicated DB type
(`translate_transcript`, `regenerate_manifest`, `cleanup_orphan_uploads`) ride on the carrier type
`describe` with `params.handler` — the CLI and `enqueueSpecFor()` add it for you.

### On demand (cron / container)
The runner is designed to **exit when idle** so it can run from cron, a GitHub Action or a one-shot
container instead of 24/7:

```bash
# every 10 minutes, process whatever is pending, exit after 30 s of idleness, never run longer than 50 min
*/10 * * * * cd /srv/langquest && JOBS_IDLE_EXIT_MS=30000 JOBS_MAX_RUNTIME_MS=3000000 pnpm --filter @langquest/jobs start
```

Container: any image with Node 22 + ffmpeg (`FFMPEG_PATH`/`FFPROBE_PATH` if not on `PATH`). Mount nothing;
scratch goes to `JOBS_WORK_DIR` (default `$TMPDIR/langquest-jobs`, cleaned per job). Run several replicas
safely: claims use `FOR UPDATE SKIP LOCKED` and leases (`JOBS_LEASE_SECONDS`, extended by heartbeats);
a crashed replica's jobs are reclaimed by the sweeper or by the next claim.

Nightly housekeeping: `run-once --type cleanup_orphan_uploads` (sweeps expired/abandoned uploads,
re-queues `completed`-but-unverified sessions for verification).

### Cloudflare Queues (optional, Workers Paid)
Set `JOBS_BACKEND=cloudflare_queues` plus `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_QUEUE_ID`,
`CLOUDFLARE_API_TOKEN` (Queues:Edit). `start` then runs an HTTP **pull consumer** from Node (same
handlers, same leases). For a Worker-side push consumer, `createQueueConsumer({ runtime: 'worker' })`
from `src/queue/cloudflare-queues.ts` exports a `queue()` handler; it acknowledges ffmpeg-bound
(`runtime: 'node'`) jobs without claiming them so the Node runner picks them up. The API publishes
`{ jobId, jobType }` with `publishJobMessage()` after `enqueue_processing_job`.

## 2. Environment

| Variable | Default | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | — | **Server only.** Queue RPCs are service-role only. Local stack: `pnpm supabase status -o json`. |
| `OPENROUTER_API_KEY` (+`OPENROUTER_BASE_URL`) | — | Needed by transcribe / translate / infer_metadata / generate_content. Missing → those jobs fail `provider_unavailable` and retry later. |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (+`R2_PUBLIC_BUCKET`) | — | S3 endpoint `https://<account>.r2.cloudflarestorage.com`. Until R2 is enabled the runner falls back to the **dev-only** `LocalFsObjectStore`. |
| `OBJECT_STORE` | auto | `r2` or `local`; `LOCAL_OBJECT_STORE_DIR` sets the local root. Never use `local` in production. |
| `JOBS_BACKEND` | `postgres` | or `cloudflare_queues`. |
| `JOBS_WORKER_ID` | `host-pid` | Shows in `processing_jobs.locked_by`. |
| `JOBS_CONCURRENCY` | `2` | Parallel jobs per process (ffmpeg is CPU bound — keep ≤ cores). |
| `JOBS_POLL_INTERVAL_MS` | `2000` | Sleep between empty polls. |
| `JOBS_LEASE_SECONDS` / `JOBS_HEARTBEAT_MS` | `600` / `30000` | Lease length and heartbeat; a lost lease aborts the running handler. |
| `JOBS_REQUEUE_SWEEP_MS` | `60000` | How often `requeue_expired_jobs` runs. |
| `JOBS_JOB_TYPES` | all | Comma list to specialise a replica (e.g. `transcode` on a big box). |
| `JOBS_IDLE_EXIT_MS` / `JOBS_MAX_RUNTIME_MS` | `0` / `0` | Cron mode (exit when idle / hard cap). `0` = never. |
| `JOBS_AUTO_CHAIN` | `true` | Enqueue follow-ups from events (`asset.verified` → `extract_metadata`, …), idempotent. |
| `JOBS_MAX_COST_PER_JOB_USD` | `2` | AI spend ceiling per job; exceeded → `cost_ceiling_exceeded` (no retry). |
| `JOBS_TELEMETRY` | `console` | `console` JSON lines, `supabase` (daily metrics + ai_requests), `none`. |
| `JOBS_LOG_LEVEL` | `info` | Structured JSON logs on stderr, redacted. |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `FFMPEG_TIMEOUT_MS` | `ffmpeg`, `ffprobe`, 30 min | |
| `AZURE_SPEECH_KEY/REGION` | — | Optional (pronunciation assessor only; unused by jobs today). |

`.env` at the repo root is loaded automatically (never committed; keys stay server-side).

## 3. Job types → handlers

| DB `job_type` | Handler | What it does |
|---|---|---|
| `verify`, `extract_metadata` | `inspect_asset` | download → SHA-256 + sniff + ID3/container metadata → verify vs upload record → promote to `media/{id}/{sha}.{ext}` → `media_assets`/`uploads` → `asset.verified`. Mismatches quarantine. |
| `transcode` | `transcode` | AAC 64/96k + Opus 32/48k renditions (skipped when no benefit), slow 0.75/0.85 (pitch kept), waveform peaks JSON, embedded cover; masters untouched. |
| `transcribe` | `transcribe` | chunk > 20 MB / > 10 min with ffmpeg → OpenRouter STT (per-variety model chain; `ai_model_profiles` overrides) → `transcripts` + `transcript_segments` (new revision, never overwrites reviewed) + raw JSON with word timestamps; reuse by content hash; mixed-language flagged; chains `align` (+ `translate_transcript` with `translateTo`). |
| `align` | `align` | sentence boundaries normalised; word alignments only when the STT returned words, else `wordAlignment: 'unavailable'` with reason. |
| `describe` + `params.handler=translate_transcript` | `translate_transcript` | per-segment overlays in each requested source language → `transcript_translations` (`needs_review`, flags) + `translation.review_requested`. |
| `detect_language`, `describe`, `segment_lessons` | `infer_metadata` | LLM suggestions (languages, variety, instruction vs target voice, lesson/chapter guess, description, tags, topics, level) with confidence + provenance; stored on the job output, provenance event and `lesson_topics(ai_suggested)`; never applied, never published. |
| `import_prefix` | `import_r2_prefix` | list prefix → parse paths + sidecar CSV/JSON → (dry run) report; else copy to hashed master keys, draft collection/chapter/lesson rows, legacy path kept, idempotent via audit ledger. |
| `import_manifest` | `import_manifest` | apply label rows (by assetId / storageKey / legacyPath) to lessons with audit before/after. |
| `content_generate` | `generate_content` | content factory: brief → structured generation → language guard + intent/register validators → dialogue diversity gate (`scoreDialogueDiversity`; failing missions get `reviewFlags: ['diversity_needs_regeneration']`) → `review_needed` missions/expressions with provenance. |
| `describe` + `params.handler=regenerate_manifest` | `regenerate_manifest` | course / audio-collection manifest → `manifests/…/v{n}.json` + `latest.json` → `manifest.invalidated` (only when content changed). |
| `generate_cover` | `render_cover` | in-code SVG cover → public `visual_assets` (+ `audio_cover_art`); PNG only when `sharp` is importable. |
| `describe` + `params.handler=cleanup_orphan_uploads` | `cleanup_orphan_uploads` | executes `planOrphanCleanup`: expire, abort multipart, delete old failed objects, requeue verify, fail unverified. |
| `benchmark_model` | `benchmark_model` | fixed `core-v1` sample set (`benchmark-samples.ts`) through the measured profile with the benchmarked model first → one `ai_model_benchmarks` row (dialect adherence, latency p50/p95, cost per call; naturalness/WER stay null), the profile's `benchmark_status` only for its primary model on its own variety, `processing_jobs.output.benchmarkId`, staff-attributed `ai_requests` rows. Per-job ceiling and the profile's `daily_budget_usd` are checked before every sample; tasks outside `CORE_SET_TASKS` finish without a call. |
| `image_generate` | — | not served by this runner (`no_handler`, failed without retry). |

Failure semantics: `JobFailure(code, { retry })` → `fail_processing_job` (retry with exponential backoff
→ `review_needed` when `max_attempts` is exhausted; `retry:false` → `failed`). Provider outages retry;
capability/validation errors do not. Every job writes `cost_actual_usd` and emits a `job_cost` telemetry event.

## 4. Cost notes

- **STT**: billed per audio second by the provider (the live test clip of 3.5 s on `openai/whisper-large-v3` cost $0.000026). A 60-minute lesson ≈ $0.03–0.40 depending on the model; chunking does not change the total. Results are cached by content hash + model recipe, so re-runs are free.
- **LLM** (translate / infer / content factory): priced per token from the OpenRouter catalog; one translation batch of 40 segments ≈ a few thousand tokens. `JOBS_MAX_COST_PER_JOB_USD` stops runaway jobs; every call lands in `ai_requests` with the job's trace id (`job:<id>:<attempt>`).
- **R2**: class A (put/list/copy/multipart) $4.50/M, class B (get) $0.36/M, storage $0.015/GB-month, no egress. A transcode writes ~5 derived objects + 1 asset row each. Counts are in `output._cost`.
- **ffmpeg**: CPU only; wall time is reported as `cpuMs` in `job_cost` (Node cannot read child CPU time).
- Keep OpenRouter spend observable: `JOBS_TELEMETRY=supabase` writes `ai_requests` + daily metrics; the admin cost view reads them.

## 5. Tests

```bash
pnpm --filter @langquest/jobs test                      # unit tests (ffmpeg fixtures, LocalFsObjectStore, fake STT/LLM)
pnpm --filter @langquest/jobs test                      # + src/__tests__/integration.test.ts when the local stack is up
LANGQUEST_LIVE_TESTS=1 pnpm --filter @langquest/jobs test   # + live OpenRouter transcription of a 3-second macOS `say` clip (< $0.001)
```

## 6. Operational checks

- Stuck jobs: `select id, job_type, state, attempts, locked_by, locked_until from processing_jobs where state='running' and locked_until < now();` — the next claim or sweep reclaims them.
- `review_needed` rows need a human; `failure_code`/`failure_message` say why. Re-enqueue with the same `idempotency_key` returns the existing row — use a new key to retry on purpose.
- Verify the object store: `ls $LOCAL_OBJECT_STORE_DIR/derived/<assetId>/` locally, or `wrangler r2 object get` in production.
