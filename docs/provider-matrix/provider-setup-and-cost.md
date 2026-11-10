# Provider setup and cost matrix

_Spec §4.1 (stack), §8.2 (router), §12.1–12.3 (cost control, observability, pricing sources) · Written 2026-10-15. Account
state as verified in `../runbooks/provisioning.md` (2026-10-14). Prices below are **snapshots** from the dates stated — the
code never treats them as truth (§12.3): the provider-reported `usage.cost` wins in the `ai_requests` ledger and the pricing
table refreshes from `GET /api/v1/models`._

## 1. Provider inventory

| Provider | Role in LangQuest | Required? | State (2026-10-14) |
|---|---|---|---|
| OpenRouter | all LLM text tasks, STT, TTS (single gateway, `packages/ai`) | yes | key valid, $50/month key budget |
| Supabase | Postgres 17, Auth, RLS, RPC job queue (`packages/db`, `supabase/`) | yes | self-hosted on Infra Tayoo, instance `languest` (https://sb-languest.tayoo.app): migrations applied 2026-11-10, content seed pending; local Docker for development |
| Cloudflare Workers | `apps/api` Hono Worker `langquest-api` | yes | account OK, `workers.dev` subdomain `langquest-nsh`; free plan |
| Cloudflare R2 | master/derived/public media, manifests, TTS cache | yes for media | **not enabled** (`10042`) |
| Cloudflare Queues | optional job wake-up signal (`JOBS_BACKEND=cloudflare_queues`) | no | not created (needs Workers Paid) |
| Cloudflare KV | optional cross-isolate rate-limit + idempotency store | no | not created (in-memory fallback) |
| Azure Speech | optional acoustic pronunciation assessor (ADR-006) | no | no credentials |
| Resend | optional branded auth e-mail via Supabase SMTP | no | key valid, domain verified, **not wired** |
| PostHog | optional product analytics sink | no | sink exists in `@langquest/telemetry`, **not wired** in any app |
| Sentry | listed in `.env.example` | no | **no SDK installed or wired** |
| ffmpeg (local binary) | transcode/segment/waveform in `apps/jobs` | yes for media jobs | free; CPU time only |

## 2. Per-provider setup

### 2.1 OpenRouter

- **Setup:** create a key at https://openrouter.ai/ → set a **key budget** in the dashboard (the build used $50/month) →
  put it in `apps/api/.dev.vars` / `wrangler secret put OPENROUTER_API_KEY` and the root `.env` for `apps/jobs` and `scripts`.
  Never in the admin: the Studio holds no provider key, and its AI test harness runs on the API
  (`POST /v1/admin/models/test`, `apps/api/src/routes/admin/model-test.ts`).
- **Secrets / vars:** `OPENROUTER_API_KEY` (server only), `OPENROUTER_BASE_URL` (optional override), attribution headers
  `AI_APP_NAME` / `AI_APP_REFERER` (the API sets `LangQuest` / `https://langquest.app` in `apps/api/src/services/ai.ts`;
  `OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME` in `.env.example` are not read).
- **Read in code:** `packages/ai/src/env.ts` (`AiEnvSchema`), `packages/ai/src/openrouter/client.ts` (chat completions with
  `response_format` JSON schema and `models: [primary, …fallbacks]`; `/api/v1/audio/transcriptions`, `/api/v1/audio/speech`;
  client-side sequential fallback when OpenRouter rejects an unknown id), `apps/api/src/env.ts`, `apps/jobs/src/config.ts`,
  `scripts/src/lib/reasoner.ts`.
- **Model routing:** `ai_model_profiles` rows (task × variety × source) over `DEFAULT_PROFILES` in
  `packages/ai/src/profiles.ts` — see `ai-capability-matrix.md` "Model routing defaults". Changing a model in the admin
  requires passing language-specific smoke tests (`apps/api/src/routes/admin/models.ts`).
- **Pricing:** https://openrouter.ai/models and https://openrouter.ai/docs. Snapshot in
  `openrouter-models-snapshot-2026-10-14.json`; seeded table `DEFAULT_PRICING` in `packages/ai/src/openrouter/pricing.ts`
  (source `snapshot-2026-10-14`), e.g. `anthropic/claude-haiku-5.5` $0.10 / $0.50 per M tokens in/out,
  `anthropic/claude-sonnet-5.5` $2 / $10, `google/gemini-3.8-flash` $0.75 / $3.75, `google/gemini-3.5-flash-lite` $0.30 /
  $2.50, `deepseek/deepseek-v4.1-flash` ≈ $0.016 / $0.89; STT billed per audio second, TTS per character.
  Refreshed at runtime by `client.models.refreshPricing()`; `PricingTable` in `packages/telemetry/src/cost.ts` parses the
  snapshot shape.
- **Measured during the build (real spend):**
  - Capability smoke run, 2026-10-14 (`ai-capability-matrix.md`): total ≈ **$0.004** — one structured Darija chat call on
    `claude-haiku-5.5` reported `usage.cost` **0.0000661**; Whisper-large-v3 transcription of a 2.52 s clip **0.0000189**;
    Gemini/Kokoro/MAI TTS samples and three STT engines included.
  - Jobs live test (`../runbooks/jobs.md` §4): 3.5 s clip on `openai/whisper-large-v3` → **$0.000026**; projection
    $0.03–0.40 per 60-minute lesson depending on model; re-runs are free (cache by content hash + model recipe).
  - Content factory, `arabic-moroccan` from `fr`, chapter 1
    (`data/drafts/content-factory/arabic-moroccan-fr-chapter-2026-10-15T01-49-04Z.json`): **$0.022015 estimated** for 6 calls
    on `anthropic/claude-haiku-5.5` (26,966 input / 38,637 output tokens, 0 failures, 5 blueprints, 46 expressions accepted).
  - Live conversation test (`apps/api/src/__tests__/live/conversation.test.ts`): one Darija-from-French text turn, budgeted
    "well under $0.05".
  - Admin test harness shows estimated cost per probe; `scripts content-factory --max-usd` defaults to **$0.30** per run.

### 2.2 Supabase

- **Setup (hosted):** self-hosted Supabase on Infra Tayoo (https://ops.tayoo.app), instance `languest`, never Supabase
  cloud. `infra-tayoo link` → `pnpm db:migrate` (`infra-tayoo db push`; migration 080 seeds the catalog) →
  `seed-curriculum -- --apply` → insert the first `super_admin` into `public.user_roles` with the service role →
  `pnpm db:types`. Local: `pnpm supabase start` (`../runbooks/database.md`).
- **Secrets:** `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public), `SUPABASE_SERVICE_ROLE_KEY` (server only),
  `SUPABASE_JWT_SECRET` (legacy HS256 only; hosted ES256 projects use JWKS), CLI-only `INFRA_TAYOO_URL`,
  `INFRA_TAYOO_KEY` (secret).
- **Read in code:** `apps/api/src/env.ts` + `middleware/auth.ts` (JWT verification, RLS-forwarded client, ADR-003),
  `packages/db` client factories (`createUserClient` / `createServiceClient` / `createAnonClient`), `apps/jobs/src/config.ts`,
  `scripts/src/lib/db.ts`, `apps/admin/src/lib/env.ts` (`NEXT_PUBLIC_*`), `apps/mobile/src/config/env.ts` (`EXPO_PUBLIC_*`).
- **Pricing:** https://supabase.com/pricing · auth docs https://supabase.com/docs/guides/auth. Free tier covers local-equivalent
  usage; Pro is $25/month (`provisioning.md`, not purchased by the build). Measured cost: $0 (local Docker only).

### 2.3 Cloudflare Workers (`apps/api`)

- **Setup:** `wrangler whoami` with a **scoped API token** (`CLOUDFLARE_API_TOKEN`: Workers Scripts:Edit, R2:Edit, Queues:Edit;
  avoid the Global key `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` in CI) → from `apps/api`: `npx wrangler secret put <NAME>` for
  every secret in `infra/cloudflare/README.md` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_JWT_SECRET?`, `OPENROUTER_API_KEY`, `AI_SESSION_TICKET_SECRET`, `AZURE_SPEECH_KEY/REGION?`, `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `MEDIA_STREAM_SECRET?`) → `npx wrangler deploy --env production`. Non-secret vars
  (`API_ENV`, `LOG_LEVEL`, `JOBS_BACKEND`, `CORS_ALLOWED_ORIGINS`, `R2_BUCKET`, `R2_PUBLIC_BUCKET`) live in `wrangler.toml`.
- **Read in code:** `apps/api/src/env.ts` (`ApiEnvSchema`, `parseEnv`, `hasR2S3`).
- **Pricing:** https://developers.cloudflare.com/workers/platform/pricing/. The free plan is enough for the API; Queues need
  Workers Paid ($5/month per `provisioning.md`). Measured: $0 (dev only; `observability.enabled = true` in `wrangler.toml`).

### 2.4 Cloudflare R2

- **Setup:** Dashboard → R2 → Enable (requires a payment method) → create buckets `langquest-media` (private) and
  `langquest-public` → create an R2 API token (Object Read & Write) → Worker secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`; jobs/`.env`: `R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BUCKET` → optionally uncomment `[[r2_buckets]] binding = "MEDIA"` in
  `wrangler.toml` for worker-proxied streaming and the TTS cache → set bucket CORS to expose `ETag` for browser multipart.
- **Read in code:** `apps/api/src/services/r2.ts` (aws4fetch presigning, multipart), `apps/api/src/routes/media-proxy.ts`
  (HMAC-token streams, `Range`), `apps/jobs/src/r2.ts` (`@aws-sdk/client-s3`; `LocalFsObjectStore` dev fallback),
  `packages/media/src/keys.ts` (object-key scheme `master/ derived/ public/`, enforced by `object_key_scope()` in SQL).
- **Pricing:** https://developers.cloudflare.com/r2/pricing/ (Standard storage $0.015/GB-month, no egress fee; operations
  billed: class A ≈ $4.50/M, class B ≈ $0.36/M; 10 GB-month free) · presigned URLs
  https://developers.cloudflare.com/r2/api/s3/presigned-urls/. `estimateR2Cost` in `packages/telemetry/src/cost.ts` prices
  storage/operations from refreshable inputs; a transcode writes ~5 derived objects per master.
- **Measured:** $0 — **R2 is not enabled**, so presigned playback, multipart uploads, prefix imports and the TTS cache were
  exercised only through fakes (`cross-package-gaps.md`). Every such endpoint returns `capability_unsupported` until then.

### 2.5 Cloudflare Queues and KV (optional)

- Queues: `JOBS_BACKEND=cloudflare_queues` + `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_QUEUE_ID`, `CLOUDFLARE_API_TOKEN` for the
  Node pull consumer (`apps/jobs/src/queue/cloudflare-queues.ts`); Worker producer binding `JOBS_QUEUE` (commented in
  `wrangler.toml`). `processing_jobs` stays the system of record (ADR-005). Implemented and unit-tested with fakes; not run
  against a real queue. Cost: Workers Paid.
- KV: `wrangler kv namespace create RATE_LIMIT` / `IDEMPOTENCY` → bindings in `wrangler.toml`; without them
  `apps/api/src/middleware/rate-limit.ts` and `idempotency.ts` use per-isolate memory maps.

### 2.6 Azure Speech (optional, pronunciation only)

- **Setup:** create a Speech resource → `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` as Worker secrets (and in `.env` for
  tests). **Re-verify the pronunciation-assessment locale list** against
  https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment before
  enabling in production (`azure-pronunciation-locales-2026-10-14.md` had to be corrected once).
- **Read in code:** `packages/ai/src/speech/pronunciation.ts` (`AzurePronunciationAssessor`, REST with the
  `Pronunciation-Assessment` header), `packages/ai/src/capability/azure-locales.ts` (33 locales), `apps/api/src/env.ts`,
  `apps/api/src/lib/capabilities.ts` (`pronunciationScoringLevel`).
- **Pricing:** Azure Speech pay-per-use (pronunciation assessment is billed as speech-to-text time; check the Azure pricing
  page for your region). Measured: $0 — not exercised (no credentials); adapter covered by fixture tests. Behaviour without
  it: every track uses `ReferenceComparisonAssessor` (no numeric score) — ADR-006.

### 2.7 Resend (optional)

Key valid and domain `alexhonore.com` verified (`provisioning.md`). Not read by any package: the intended use is Supabase
Auth SMTP (`[auth.email.smtp]` in `supabase/config.toml` / the hosted dashboard) so sign-up and reset e-mails carry the
LangQuest sender (`RESEND_FROM`). Locally Mailpit (`:54324`) captures mail. Free tier.

### 2.8 PostHog / Sentry (optional observability)

- `@langquest/telemetry` ships `PostHogSink` (`packages/telemetry/src/sinks.ts`, default host `https://eu.i.posthog.com`
  for data-region reasons, no-op without an API key), `SupabaseTableSink`, `ConsoleSink`, `WebhookAlertSink`. **No app
  constructs the PostHog sink yet**; mobile uses the console sink in dev and drops events in production; the jobs runner uses
  `JOBS_TELEMETRY=console|supabase|none`. `POSTHOG_API_KEY` / `POSTHOG_HOST` are therefore unused until wired.
- `SENTRY_DSN` is in `.env.example` but no Sentry SDK is installed. Worker logs go to Cloudflare observability.

## 3. The cost-control hierarchy as implemented (§12.1)

| §12.1 rule | Implementation | Where |
|---|---|---|
| 1. Generate static voice/course content once; store optimized media in R2; share per course | masters + derived renditions keyed by content hash (`media/{id}/{sha}.{ext}`, AAC 64/96k, Opus 32/48k, slow 0.75/0.85), one copy for all learners; TTS object cache keyed by text + voice when the `MEDIA` binding exists | `apps/jobs/src/handlers/transcode.ts`, `apps/api/src/services/r2.ts`, `packages/media/src/keys.ts` |
| 2. Reusable manifests, localized phrases, cached translations; no per-user writes for browsing | versioned course/audio manifests `manifests/…/v{n}.json` + `latest.json`, edge-cached, invalidated on publish (`manifest.invalidated`); transcript translations stored once per segment × language | ADR-004, `apps/jobs/src/handlers/regenerate-manifest.ts`, `apps/api/src/services/cache.ts`, `routes/learner/manifest.ts` |
| 3. Lightweight spoken recall: short snippet → STT/scoring, no live AI call | `POST /v1/speech/transcribe` and `/v1/speech/pronunciation-assess` take a clip against a published reference expression; meaning check is a small-model structured call | `apps/api/src/routes/speech/speech.ts`, `packages/ai/src/semantic/meaning.ts` |
| 4. Guided tasks: preauthored prompts + small model | prompt packs + `meaning_assessment` on `gemini-3.8-flash` (temperature 0), `language_quality_check` on `gemini-3.5-flash-lite` | `packages/ai/src/prompts/*`, `profiles.ts` |
| 5. Free-form realtime only for actual speaking; lean context; efficient TTS; still free and unrestricted | turn-based STT→LLM→TTS pipeline (no duplex sessions until benchmarked), character on `haiku-5.5` (sonnet only for low-resource varieties), evaluator **async** on a cheaper model, summariser keeps context lean, short-lived purpose-limited tickets | ADR-002, `packages/ai/src/realtime/pipeline.ts`, `conversation/evaluator.ts`, `summariser.ts` |
| 6. Batch offline/async; dedupe transcription and generation by version + hash | all media/LLM batch work in `apps/jobs`; `transcribe` reuses results by content hash + model recipe; `generate_content` and `content_factory` idempotent by brief; `--force` needed to bypass cache | `../runbooks/jobs.md` §3 |
| 7. Progress: local update then periodic idempotent sync; cached leaderboards/manifests | mobile outbox with client UUIDs + monotonic revisions, server dedupes (`device_sync_events`, `xp_ledger` unique keys); manifests cached in SQLite | `apps/mobile/src/store/*`, ADR-003 |
| 8. Async media processing on demand, not 24/7 | runner exits when idle (`JOBS_IDLE_EXIT_MS`, `JOBS_MAX_RUNTIME_MS`), cron/container friendly; Postgres polling backend has zero fixed cost | ADR-005, `../runbooks/jobs.md` §1 |
| 9. R2 Standard, periodic recalculation | bucket class Standard; `estimateR2Cost` + `output._cost` per job; storage GB in analytics | `packages/telemetry/src/cost.ts`, `/v1/admin/analytics/cost` |
| 10. Monitor cost per completed speaking mission, retries, latency, retention; cheapest model is not automatically best | `CostLedger` aggregates cost per completed speaking mission / active learner / meaningful conversation / reviewed lesson; admin Analytics + Dashboard "cost today"; benchmark gate + smoke tests before a cheaper model goes live; variety-scoped stronger defaults for ary/arz/ar-levant/yue/ht/rw/ln/sw | `packages/telemetry/src/cost.ts`, `apps/api/src/routes/admin/analytics.ts`, `routes/admin/models.ts` |

Hard ceilings and alerts (operator-side only; never learner quotas):

- `JOBS_MAX_COST_PER_JOB_USD` (default **$2**) → job fails `cost_ceiling_exceeded`, no retry (`apps/jobs/src/cost.ts`).
- `ai_model_profiles.daily_budget_usd` → `createProfileBudgetDetectors` + `CostAnomalyDetector` emit **operator** alerts
  through an `AlertSink` (`packages/telemetry/src/cost.ts`); surfaced in Analytics → Alerts.
- `scripts content-factory --max-usd` (default $0.30) caps a drafting run; tests need `LANGQUEST_LIVE_TESTS=1` to spend.
- OpenRouter dashboard key budget ($50/month on the build key).
- Rate limits (`apps/api/src/middleware/rate-limit.ts`): public 240/min, learner 600/min, auth 30/min, ai 90/min, admin
  300/min — abuse guards tuned above human pace, returned as `429 rate_limited` with `Retry-After`, never shown as quotas.
- Every priced call lands in `ai_requests` with trace id, model, tokens/seconds and `usage.cost`; jobs write
  `cost_actual_usd` and a `job_cost` telemetry event.

## 4. Honest gaps

- No invoice import / reconciliation exists (`reconciliation.invoicedUsd` is always `null`); R2 operation counts are not
  aggregated (`r2Operations: 0`) because R2 is not enabled.
- Azure, R2, Queues, hosted Supabase, Resend SMTP, PostHog and Sentry have **no measured cost** because they were not
  exercised; the figures above are vendor list prices from the dates stated.
- The `benchmark_model` job runs in `apps/jobs` (`apps/jobs/src/handlers/benchmark-model.ts`) on the fixed `core-v1` sample
  set for the three target-variety text tasks (`CORE_SET_TASKS`: `character_dialogue`, `scene_planning`,
  `content_generation`), within `JOBS_MAX_COST_PER_JOB_USD` and the profile's `daily_budget_usd`; its calls are ledgered in
  `ai_requests` as staff spend. Speech benchmarks (WER/CER, voice naturalness) score nothing until reference-audio sample
  sets exist; for those tasks only the inline smoke benchmark records a row. It has run only against fakes so far: a real
  run spends OpenRouter credit and needs the owner's OK.
