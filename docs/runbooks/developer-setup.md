# Developer setup runbook — clone to running stack

_Spec: `docs/MASTER_SPEC.md` §12.2, §13 Phase 12, §16.2 · Conventions: `docs/CONVENTIONS.md` · Written 2026-10-15 against the code in this checkout (commit `f085ead` + uncommitted work in progress)._

This runbook is the "second engineer / coding agent" path from Phase 12: reproduce the local build, migrations and
tests, run every app, and know exactly which pieces are blocked by external provisioning. Companion runbooks:
`database.md` (migrations, types, pgTAP, Docker wedge), `jobs.md` (job runner), `provisioning.md` (what is live on the
owner's accounts), `admin-manual.md`, `mobile-release.md`; provider details in `../provider-matrix/provider-setup-and-cost.md`.

## 0. Prerequisites

| Tool | Version / note | Why |
|---|---|---|
| Node | ≥ 22 (`package.json` `engines`); CI uses Node 24 | every package |
| pnpm | `10.26.1` (`packageManager` field; `corepack enable` or `npm i -g pnpm@10`) | workspace (`node-linker=hoisted`, see `.npmrc`) |
| Docker Desktop | any recent; on macOS see §8 of `database.md` for the Resource-Saver wedge | local Supabase (`pnpm supabase start`) |
| ffmpeg + ffprobe | on `PATH` (or `FFMPEG_PATH` / `FFPROBE_PATH`) | `apps/jobs` media handlers, `@langquest/media` fixture tests, `tests` audio project |
| bzip2 | system binary | `scripts import-tatoeba` streams `*.tsv.bz2` |
| Xcode / Android Studio | optional | native development builds of `apps/mobile` (microphone, SQLite, secure store are native modules — Expo Go is not enough) |
| wrangler | installed as a devDependency of `apps/api` (`wrangler ^4.151`) | Worker dev/deploy |

No global Supabase CLI is needed: the `supabase` npm package (`^2.121`) is a root devDependency, so every
`pnpm supabase …` command in this repo uses the pinned CLI.

## 1. Clone and install

```bash
git clone <repo> LangQuest && cd LangQuest
pnpm install                 # CI uses: pnpm install --frozen-lockfile
```

Libraries have **no build step**: every `packages/*` package exports TypeScript source (`"exports": {".": "./src/index.ts"}`)
and apps consume them as `workspace:*` deps (CONVENTIONS §1). `turbo.json` defines `build`, `typecheck`, `lint`, `test`, `dev`.

Workspace members (`pnpm-workspace.yaml`): `apps/*`, `packages/*`, `scripts`, `tests`.

## 2. Environment files

There are **four** places configuration lives. Nothing secret is ever committed (`.env`, `.dev.vars`, `.env.local` are git-ignored;
the CI `security` job fails on committed key patterns).

| File | Used by | Copy from |
|---|---|---|
| `.env` (repo root) | `apps/jobs` (dotenv), `scripts` (dotenv, never overriding the shell), `packages/db` seed/tests, live tests | `.env.example` |
| `apps/api/.dev.vars` | `wrangler dev` (local Worker secrets) | `apps/api/.dev.vars.example` |
| `apps/admin/.env.local` | Next.js admin (the three public `NEXT_PUBLIC_*` values only; the admin holds no server secret) | `apps/admin/.env.example` (a local file: `apps/admin/.gitignore` matches `.env*`, so a fresh clone does not have it; write the three values from §6 by hand) |
| shell / EAS env for `apps/mobile` | Expo (`EXPO_PUBLIC_*` only; there is no `.env.example` inside `apps/mobile`, use the root `.env` or export in the shell) | root `.env.example` |

```bash
cp .env.example .env
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/admin/.env.example apps/admin/.env.local
```

### 2.1 Every variable in `.env.example` — meaning, scope, where it is read

**Scope legend:** `server` = may only exist on the API Worker, the jobs runner or an operator shell; `public` = safe to
bundle into a browser/mobile app; `cli` = only consumed by a command-line tool, never by app code; `unused` = present in the
template but not read by any package in this checkout (documented so nobody assumes it does something).

| Variable | Scope | Meaning | Read in |
|---|---|---|---|
| `SUPABASE_URL` | server | Supabase API URL: `https://sb-languest.tayoo.app` (Infra Tayoo), `http://127.0.0.1:54321` locally | `apps/api/src/env.ts`, `apps/jobs/src/config.ts`, `scripts/src/lib/db.ts`, `packages/db` local-stack detection |
| `SUPABASE_ANON_KEY` | public (used server-side too) | anon/publishable key; the API pairs it with the learner JWT so RLS stays in force | `apps/api/src/env.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | service role for server-validated writes (XP, observations, audit, queue RPCs) and `scripts --apply` | `apps/api/src/env.ts`, `apps/jobs/src/config.ts`, `scripts/src/lib/db.ts` |
| `INFRA_TAYOO_URL` | cli | Infra Tayoo instance URL (`https://ops.tayoo.app/api/v1/instances/languest`) for the `infra-tayoo` CLI and MCP server | not read by app code |
| `INFRA_TAYOO_KEY` | cli, **secret** | Infra Tayoo instance key (migrations, types, read-only SQL, logs, app env/deploy). Never print, log or commit it | not read by app code |
| `SUPABASE_JWT_SECRET` | server | legacy HS256 verification (the local stack signs HS256; hosted ES256 projects are verified through JWKS instead) | `apps/api/src/env.ts`; tests use `SUPABASE_LOCAL_JWT_SECRET` |
| `CLOUDFLARE_ACCOUNT_ID` | server/cli | account id for wrangler and the optional Queues pull consumer | `apps/jobs/src/queue/cloudflare-queues.ts`, wrangler |
| `CLOUDFLARE_API_TOKEN` | server/cli | scoped token (Workers Scripts:Edit, R2:Edit, Queues:Edit) | `apps/jobs` (Queues backend), wrangler |
| `CLOUDFLARE_EMAIL`, `CLOUDFLARE_API_KEY` | cli | Global API key fallback for wrangler — avoid in CI, prefer the scoped token | not read by code |
| `R2_BUCKET`, `R2_PUBLIC_BUCKET` | server | private master/derived bucket and public bucket names (`langquest-media`, `langquest-public`) | `apps/api/wrangler.toml [vars]`, `apps/jobs/src/config.ts` |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | **server only** | R2 S3 API token (presigned URLs, multipart) | `apps/api/src/env.ts`, `apps/jobs/src/config.ts` |
| `R2_ENDPOINT` | server | `https://<account>.r2.cloudflarestorage.com` (jobs runner S3 client). The Worker derives the endpoint from `R2_ACCOUNT_ID` instead — that secret is **not** in `.env.example`, it lives in `apps/api/.dev.vars` / `wrangler secret` | `apps/jobs/src/config.ts` |
| `OPENROUTER_API_KEY` | **server only** | OpenRouter key (text, STT, TTS) | `apps/api/src/env.ts`, `apps/jobs/src/config.ts`, `packages/ai/src/env.ts`, `scripts` (live only). The admin never reads it: its AI test harness calls the API (`POST /v1/admin/models/test`) |
| `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME` | unused | OpenRouter attribution headers. The API hard-codes `AI_APP_NAME: 'LangQuest'` / `AI_APP_REFERER: 'https://langquest.app'` in `apps/api/src/services/ai.ts`; `packages/ai/src/env.ts` reads `AI_APP_NAME` / `AI_APP_REFERER`, not these names | — |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | server | optional acoustic pronunciation assessor (ADR-006) | `apps/api/src/env.ts`, `packages/ai/src/env.ts`; declared in `apps/jobs/src/config.ts` but unused by jobs |
| `REALTIME_VOICE_PROVIDER` | unused | reserved for a duplex provider; only the STT→LLM→TTS pipeline exists (`DuplexProviderStub` reports unsupported) | — |
| `GEMINI_API_KEY` | unused | not required by the spec; Gemini models are reached through OpenRouter | — |
| `RESEND_API_KEY`, `RESEND_FROM` | unused by code | owner action: configure Supabase Auth SMTP with Resend for branded e-mail (`provisioning.md`) | — |
| `API_BASE_URL`, `ADMIN_BASE_URL` | unused by code | documentation values for the Worker (`:8787`) and admin (`:3000`) | — |
| `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | public | learner app runtime config; missing values render an explicit "not configured" state | `apps/mobile/src/config/env.ts` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL` | public | admin runtime config (put them in `apps/admin/.env.local`) | `apps/admin/src/lib/env.ts` |
| `JOBS_BACKEND` | server | `postgres` (default, polling) or `cloudflare_queues` (Workers Paid) | `apps/jobs/src/config.ts`, `apps/api/wrangler.toml` |
| `JOBS_POLL_INTERVAL_MS` | server | sleep between empty polls. Template says `5000`; the code default is `2000` | `apps/jobs/src/config.ts` |
| `FFMPEG_PATH` | server | ffmpeg binary (`FFPROBE_PATH` likewise) | `apps/jobs/src/config.ts`, `packages/media/src/ffmpeg.ts` |
| `SENTRY_DSN` | unused | no Sentry SDK is installed or wired in any app | — |
| `POSTHOG_API_KEY`, `POSTHOG_HOST` | unused by apps | `@langquest/telemetry` ships a `PostHogSink` (`packages/telemetry/src/sinks.ts`, EU host by default) but no app constructs it yet; mobile logs to the console in dev and drops events in production (`apps/mobile/src/lib/telemetry.ts`) | — |

### 2.2 Variables that exist only outside `.env.example`

| Variable | Where | Meaning |
|---|---|---|
| `AI_SESSION_TICKET_SECRET` (≥ 16 chars) | `apps/api/.dev.vars`, Worker secret | HMAC for conversation tickets and worker-proxied media tokens; `MEDIA_STREAM_SECRET` optionally separates the media secret |
| `R2_ACCOUNT_ID` | `apps/api/.dev.vars`, Worker secret | S3 presigning endpoint for the Worker |
| `CORS_ALLOWED_ORIGINS`, `LOG_LEVEL`, `API_ENV` | `apps/api/wrangler.toml [vars]` / `.dev.vars` | exact origin allowlist (localhost auto-allowed in development), log level, environment name |
| `OPENROUTER_BASE_URL`, `AI_REALTIME_CONNECT_URL`, `R2_PUBLIC_BASE_URL` | API optional | override OpenRouter base URL; streaming turn endpoint template; public bucket base URL |
| `JOBS_WORKER_ID`, `JOBS_CONCURRENCY`, `JOBS_LEASE_SECONDS`, `JOBS_HEARTBEAT_MS`, `JOBS_REQUEUE_SWEEP_MS`, `JOBS_JOB_TYPES`, `JOBS_IDLE_EXIT_MS`, `JOBS_MAX_RUNTIME_MS`, `JOBS_WORK_DIR`, `JOBS_AUTO_CHAIN`, `JOBS_TELEMETRY`, `JOBS_LOG_LEVEL`, `JOBS_MAX_COST_PER_JOB_USD` (default `2`), `OBJECT_STORE` (`r2`\|`local`), `LOCAL_OBJECT_STORE_DIR`, `CLOUDFLARE_QUEUE_ID`, `FFPROBE_PATH`, `FFMPEG_TIMEOUT_MS` | jobs runner | see `jobs.md` §2 for defaults |
| `EXPO_PUBLIC_OAUTH_PROVIDERS` (e.g. `google,apple`), `EXPO_PUBLIC_APP_VERSION` | mobile | OAuth buttons appear only when set; version shown in telemetry/About |
| `DATABASE_URL` | `packages/db seed`, `scripts` | explicit Postgres target; without it the local stack is auto-detected via `supabase status` |
| `LANGQUEST_DB_TARGET=hosted` | `scripts` | required before `--apply` may touch a non-local `SUPABASE_URL` |

### 2.3 Test-only switches

| Variable | Effect |
|---|---|
| `LANGQUEST_LIVE_TESTS=1` | allows paid provider calls in tests and `scripts content-factory` (CONVENTIONS §7); CI sets `'0'` |
| `LANGQUEST_REQUIRE_LOCAL_STACK=1` | turns the "local stack unreachable → skip" into a failure (`packages/db`, `apps/api`, `apps/jobs`) |
| `LANGQUEST_REQUIRE_STACK=1` | same for `tests/` (`tests/vitest.config.ts`) |
| `SUPABASE_LOCAL=1` | set by the CI `database` job for `@langquest/db` tests |
| `SUPABASE_LOCAL_URL`, `SUPABASE_LOCAL_ANON_KEY`, `SUPABASE_LOCAL_SERVICE_ROLE_KEY`, `SUPABASE_LOCAL_JWT_SECRET` | override auto-detection of the local stack in db/api tests |
| `LANGQUEST_SKIP_LOCAL_STACK=1` | `scripts` tests never probe Docker |
| `LANGQUEST_MEDIA_FIXTURES` | `@langquest/media` fixture directory override |
| `ADMIN_E2E_BASE_URL`, `ADMIN_E2E_STAFF_EMAIL/PASSWORD`, `ADMIN_E2E_LEARNER_EMAIL/PASSWORD` | admin Playwright (`apps/admin/playwright.config.ts`; the role-gate and uploads specs skip without accounts) |
| `LANGQUEST_REPO_ROOT` | `scripts` repo-root override |

## 3. Local Supabase (Docker)

```bash
pnpm supabase start                       # full local stack (config: supabase/config.toml, project_id "langquest")
# or the lean profile used by @langquest/db:
pnpm --filter @langquest/db local:start   # supabase start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor
pnpm supabase status -o json              # API_URL / ANON_KEY / SERVICE_ROLE_KEY / JWT_SECRET → paste into .env, apps/api/.dev.vars, apps/admin/.env.local
pnpm supabase db reset                    # drop + apply supabase/migrations/*.sql (000 … 090) + supabase/seed/*.sql
```

Ports: API `54321`, Postgres `54322` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), Studio `54323`, Mailpit
`54324`. `supabase start` applies migrations only on first boot — after editing a migration run `db reset`
(`pnpm --filter @langquest/db local:reset`). The catalog (languages, 30 tracks, varieties, AI model profiles, coverage rows)
is seeded by migration `080_seed_catalog.sql`, which is **generated** from `@langquest/contracts`
(`pnpm --filter @langquest/db seed:catalog-sql`; `catalog-sql.test.ts` fails on drift). `supabase/seed/000_local_dev.sql` is
intentionally empty. Regenerate DB types after schema changes: `pnpm db:types` (→ `packages/db/src/database.types.ts`).

Every seeded `ai_model_profiles` row is `enabled = false`; the API overlays only enabled rows on the package defaults
(`docs/reference/cross-package-gaps.md`), so AI works locally with the `DEFAULT_PROFILES` from `packages/ai/src/profiles.ts`.

Then load the curriculum content, otherwise every course manifest is empty and the Missions tab has nothing to show:

```bash
pnpm --filter @langquest/scripts seed-languages                  # intents + skills + coverage rows (idempotent)
pnpm --filter @langquest/scripts seed-curriculum -- --apply      # chapters/missions/steps/expressions from packages/curriculum (idempotent, deterministic ids)
```

`seed-curriculum` publishes the four flagship AI-draft chapters (arabic-moroccan fr+en, spanish-spain en, japanese en,
english fr+ru) with their draft disclosure intact (`reviewed = false`, coverage `partial`) and loads the other tracks'
chapter-1 skeletons as unpublished `review_needed` structure; details in `database.md` §3.1. Re-run it after editing
`packages/curriculum/src/content/*`.

### 3.1 Create a test learner and a staff account

Sign-up is enabled on the local stack (`[auth] enable_signup = true`, e-mail confirmation off). Create a learner from the mobile
app, the admin login form, or the Auth REST API (`POST {SUPABASE_URL}/auth/v1/signup` with `apikey: <anon>`). Staff accounts
are ordinary Auth users with a row in `public.user_roles`; grant the first `super_admin` with the service role (Studio SQL
editor or `psql`):

```sql
insert into public.user_roles (user_id, role) values ('<auth.users.id>', 'super_admin');
```

Afterwards roles are managed in the admin **Users / roles** section (`admin-manual.md` §17).

## 4. Typecheck, lint, test

```bash
pnpm typecheck        # turbo run typecheck (every package: tsc --noEmit)
pnpm lint             # turbo run lint (eslint 9 flat config; apps/mobile runs `expo lint`)
pnpm test             # turbo run test (vitest 4, run mode; --passWithNoTests everywhere)
pnpm format:check     # prettier
pnpm --filter @langquest/<name> test      # one package
pnpm supabase test db                      # pgTAP: supabase/tests/database/security_hardening.test.sql (needs the stack)
pnpm --filter @langquest/tests test        # cross-cutting projects: integration, security, locales, audio, load (tests/vitest.config.ts)
pnpm --filter @langquest/admin test:e2e    # Playwright (run `pnpm exec playwright install` once; browsers were not installed in the build session)
```

Stack-bound suites (`packages/db/src/__tests__/rls.test.ts`, `apps/api/src/__tests__/integration/stack.test.ts`,
`apps/jobs/src/__tests__/integration.test.ts`, `tests/integration`, `tests/security`) detect the local stack with
`supabase status -o json` and **skip with a warning** when it is down. Tests never call paid providers unless
`LANGQUEST_LIVE_TESTS=1` (CONVENTIONS §7); the live suites that exist are `apps/api/src/__tests__/live/conversation.test.ts`
(one Darija-from-French text turn, well under $0.05) and the 3-second transcription in `apps/jobs` (< $0.001).

As of this writing the `tests/` workspace holds only `package.json`, `tsconfig.json` and `vitest.config.ts` — the project
files under `tests/{integration,security,locales,audio,load}` are being written concurrently; `pnpm test` passes there via
`--passWithNoTests` until they land.

## 5. Run the API Worker (`apps/api`)

```bash
pnpm dev:api          # = pnpm --filter @langquest/api dev → wrangler dev → http://localhost:8787
curl -s http://localhost:8787/v1/languages | head -c 300
```

- Config: `apps/api/wrangler.toml` (`name = "langquest-api"`, `compatibility_date = "2026-10-01"`, `nodejs_compat`, bundles
  workspace TypeScript via the `ESModule` rule). Non-secret vars live in `[vars]`; secrets come from `apps/api/.dev.vars`
  locally and `wrangler secret put` in production (full list in `infra/cloudflare/README.md`).
- Minimum `.dev.vars` for the local stack: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_JWT_SECRET` (local default `super-secret-jwt-token-with-at-least-32-characters-long`), `OPENROUTER_API_KEY`,
  `AI_SESSION_TICKET_SECRET`.
- Authenticated calls: obtain a Supabase access token (`POST {SUPABASE_URL}/auth/v1/token?grant_type=password`) and send
  `Authorization: Bearer <token>`; responses use the `{ ok, data } | { ok, error }` envelope (CONVENTIONS §3).
- Without R2 credentials every media URL/upload endpoint answers `capability_unsupported` with a clear message (no fake URLs).
  Optional bindings (`MEDIA` R2 bucket, `RATE_LIMIT`/`IDEMPOTENCY` KV, `JOBS_QUEUE`) are commented out in `wrangler.toml`.
- Rate limits are operator-side abuse guards (`apps/api/src/middleware/rate-limit.ts`: public 240/min, learner 600/min,
  auth 30/min, ai 90/min, admin 300/min), never learner quotas.

## 6. Run the admin CMS (`apps/admin`)

```bash
pnpm dev:admin        # next dev → http://localhost:3000 (Next 16.4, React 19.3, Tailwind 4)
pnpm --filter @langquest/admin build && pnpm --filter @langquest/admin start
```

`apps/admin/.env.local` needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL`
(`http://127.0.0.1:8787`); a missing value throws "Admin env is incomplete" and the login page renders the setup state.
Sign in with a staff account (§3.1); learners are bounced to `/login?reason=norole`. Reads go straight to Supabase under the
user's session (RLS); every data write goes to the Worker API (`/v1/admin/*`) with the staff JWT (upload parts go to the
presigned URLs the API returns). The only Next route handlers
are `app/api/auth/signout` and `app/api/locale`, and the admin holds no service-role or provider key (`apps/admin/src/lib/env.ts`
reads only the three `NEXT_PUBLIC_*` values). See `admin-manual.md`.

## 7. Run the learner app (`apps/mobile`)

```bash
pnpm dev:mobile                             # expo start (press i / a / w)
pnpm --filter @langquest/mobile export:web  # expo export --platform web → apps/mobile/dist (verified in the build session)
pnpm --filter @langquest/mobile typecheck && pnpm --filter @langquest/mobile lint && pnpm --filter @langquest/mobile test
```

Set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL` in the shell (or root `.env`,
which Expo reads) before `expo start`. A **development build** is required for anything native — the recorder
(`expo-audio`, microphone permission string in `app.json`), `expo-sqlite`, `expo-secure-store`, background playback
(`UIBackgroundModes: ["audio"]`, Android `FOREGROUND_SERVICE_MEDIA_PLAYBACK`):

```bash
cd apps/mobile && npx expo run:ios      # or: npx expo run:android   (Continuous Native Generation; never hand-edit ios/ android/)
# cloud alternative: npx eas-cli@latest build --profile development   (see mobile-release.md — no eas.json exists yet)
```

Web (`expo start --web`, `react-native-web`) covers every screen except native-only behaviour; a single non-blocking React #418
hydration warning appears at first paint of the web export (`cross-package-gaps.md`).

## 8. Run the job runner (`apps/jobs`)

```bash
pnpm dev:jobs                                    # tsx watch src/main.ts start  (poll loop, Ctrl-C stops gracefully)
pnpm --filter @langquest/jobs handlers           # list handlers ↔ job types
pnpm --filter @langquest/jobs -- status          # queue counts
pnpm --filter @langquest/jobs run-once -- --type transcode --asset <uuid>
```

Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (queue RPCs are service-role only), `OPENROUTER_API_KEY` for
transcribe/translate/infer/generate, ffmpeg on `PATH`. Until R2 is enabled the runner falls back to the **dev-only**
`LocalFsObjectStore` (`OBJECT_STORE=local`, `LOCAL_OBJECT_STORE_DIR`) and logs a warning. Everything else — job types, cron
mode, Queues backend, cost ceilings — is in `jobs.md`.

## 9. Data / ops scripts (`scripts`)

`pnpm --filter @langquest/scripts <cli> -- --help` for `import-tatoeba`, `import-taskmaster`, `import-corpora`,
`bulk-audio-scan`, `license-report`, `seed-languages`, `validate-course-coverage`, `content-factory`. Every CLI has
`--dry-run`; nothing is written without `--apply`; live model calls need `--live` or `LANGQUEST_LIVE_TESTS=1` and are capped by
`--max-usd` (default 0.30). Details: `scripts/README.md`; dataset rights: `../content-rights/dataset-attribution-inventory.md`.

## 10. Continuous integration (`.github/workflows/ci.yml`)

Three jobs on push to `main` and on every pull request (`concurrency: ci-${ref}`, cancel-in-progress):

| Job | Steps |
|---|---|
| `verify` — Typecheck · lint · unit tests | checkout → pnpm 10 → Node 24 (pnpm cache) → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test` with `LANGQUEST_LIVE_TESTS: '0'` |
| `database` — Migrations + RLS (needs `verify`) | `pnpm supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector` → `pnpm supabase db reset --local` → `pnpm --filter @langquest/db test` with `SUPABASE_LOCAL: '1'` → `pnpm supabase stop --no-backup` (always) |
| `security` — Secret scan | `git grep` for `sk-or-v1-…`, `sbp_…`, `AKIA…`, `re_…` patterns (excluding `provisioning.md` and the workflow itself) fails the build if a key-like token is committed |

Not in CI (by design): Playwright e2e, live provider tests, mobile native builds, the load run (`tests/load`, documented as
"never run in CI").

## 11. Deploy order (once R2 exists; Supabase is the Infra Tayoo `languest` instance)

See `provisioning.md` "Deploy order": `pnpm db:migrate` (= `infra-tayoo db push`) + `seed-curriculum -- --apply` → `wrangler secret put …`
and `npx wrangler deploy --env production` from `apps/api` → admin on any Node host with the three `NEXT_PUBLIC_*` values →
`eas build` for mobile → run `apps/jobs` on demand where ffmpeg is available.

## 12. Troubleshooting

- **Docker wedged (macOS Docker Desktop).** Symptoms: containers stuck in `Created`, `supabase db reset` hangs at
  "Restarting containers", `supabase test db` never prints TAP, vitest suites skip because `supabase status` reports the stack
  down. Follow `database.md` §8 exactly — Resource Saver pauses the VM; `docker desktop restart` is not enough; do the full
  quit → `pkill -f com.docker.backend` → `pkill -f com.apple.Virtualization.VirtualMachine` → `open -a Docker` → probe with
  `docker run --rm alpine:3.20 true` → `pnpm supabase start -x …` → `pnpm supabase db reset` cycle, chaining the commands you
  need right after the restart. If only the `pg_prove` container wedges, run the pgTAP file through host `psql`
  (`database.md` §5) and generate types with `supabase gen types --db-url …`. Check Docker Desktop → Resources → File sharing
  includes the checkout volume (this repo lives on `/Volumes/SSD-1tb`).
- **`Admin env is incomplete: …`** — copy `apps/admin/.env.example` to `apps/admin/.env.local` and fill the three values.
- **API returns `unauthenticated` for a valid local token** — `SUPABASE_JWT_SECRET` in `.dev.vars` must equal the local stack's
  `JWT_SECRET` (`pnpm supabase status -o json`); hosted projects signing ES256 need no secret (JWKS).
- **`capability_unsupported` on playback/upload URLs** — expected until R2 is enabled and `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` are set (`infra/cloudflare/README.md`).
- **Jobs fail with `provider_unavailable`** — `OPENROUTER_API_KEY` missing in the runner's environment; they retry later.
- **`pnpm install` lockfile conflict** — run it once from the repo root and retry once (CONVENTIONS §1); `--lockfile-only`
  was used to sync workspace symlinks during the build.
- **Playwright "browser not installed"** — `pnpm exec playwright install chromium` (not done in the build session).
- **Port already in use** — API `8787`, admin `3000` (Playwright uses `3100`), Expo `8081`, Supabase `5432x`; the Worker CORS
  default allows `http://localhost:3000` and `http://localhost:8081` only.
- **`supabase start` first boot is slow** — image pulls; the Postgres `health_timeout` is 2 minutes (`supabase/config.toml`).

## 13. What a fresh engineer cannot do in this checkout (external blockers)

| Blocked | Why | Owner action |
|---|---|---|
| Hosted content + first admin | the Infra Tayoo instance `languest` has the schema but no curriculum seed or `super_admin` yet | `seed-curriculum -- --apply` with the service-role key (`infra-tayoo keys --secret`), then insert the first `super_admin` (`database.md` §6) |
| Cloudflare R2 | not enabled on the account (`10042`) | enable R2 (payment method), create `langquest-media` + `langquest-public`, create an R2 API token, set Worker secrets |
| Cloudflare Queues | Workers Paid plan | optional; keep `JOBS_BACKEND=postgres` |
| Azure Speech | no credentials | optional; only tracks on the 33-locale list get numeric pronunciation scores (ADR-006) |
| Native device QA | needs a development build + devices | `mobile-release.md` §6 |
