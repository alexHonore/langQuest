# Cloudflare — LangQuest API Worker

The API (`apps/api`) is a single Hono Worker named `langquest-api` (`apps/api/wrangler.toml`). It is the only
process that holds provider secrets: mobile and admin bundles receive the Supabase URL + anon key and the API
base URL, nothing else (spec §4.3, §11).

## Secrets (`wrangler secret put <NAME>` from `apps/api`)

| Secret | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL (hosted) or `http://127.0.0.1:54321` locally |
| `SUPABASE_ANON_KEY` | yes | Anon/publishable key; used with the learner JWT so RLS stays in force |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role for server-validated writes (XP, observations, audit, jobs). Never in a client |
| `SUPABASE_JWT_SECRET` | no | Legacy HS256 verification (local stack, older projects). Hosted projects signing with ES256 are verified through JWKS at `/auth/v1/.well-known/jwks.json`; without either, tokens are checked against `/auth/v1/user` |
| `OPENROUTER_API_KEY` | yes for AI | OpenRouter key (text, STT, TTS). Keep the key budget set in the OpenRouter dashboard |
| `AI_SESSION_TICKET_SECRET` | recommended | HMAC secret (≥ 16 chars) for short-lived conversation tickets and worker-proxied media tokens |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | no | Acoustic pronunciation assessor for the locales it documents; without it the API reports reference-comparison (no numeric scores) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | no (until R2 is enabled) | S3-compatible presigning for playback/download URLs and multipart uploads |
| `MEDIA_STREAM_SECRET` | no | Separate HMAC secret for worker-proxied streams (defaults to `AI_SESSION_TICKET_SECRET`) |

Vars (non-secret, in `wrangler.toml [vars]`): `API_ENV`, `LOG_LEVEL`, `JOBS_BACKEND` (`postgres` default,
`cloudflare_queues` optional), `CORS_ALLOWED_ORIGINS` (comma-separated exact origins; localhost is allowed
automatically in development), `R2_BUCKET`, `R2_PUBLIC_BUCKET`.

## Bindings

- `MEDIA` (R2 bucket, optional): direct object access from the Worker — worker-proxied streaming
  (`GET /v1/media/stream/:assetId?t=…`), TTS cache, inline verification of small uploads.
- `RATE_LIMIT`, `IDEMPOTENCY` (KV, optional): cross-isolate abuse-control buckets and idempotent replay cache.
  Without them an in-memory map per isolate is used (still effective against single-source floods).
- `JOBS_QUEUE` (Queue producer, optional; Workers Paid): job notifications when `JOBS_BACKEND=cloudflare_queues`.
  The `processing_jobs` table stays the system of record (ADR-005).

## Current state (2026-10-14)

- R2 is **not enabled** on the account (`10042`): every media URL/upload endpoint returns
  `capability_unsupported` with a clear message instead of a fake URL. Enable R2 in the dashboard, create the
  buckets, set the three `R2_*` secrets and (optionally) uncomment the `[[r2_buckets]]` binding.
- Cloudflare Queues are not created (free plan): keep `JOBS_BACKEND=postgres`; `apps/jobs` polls the table.
- Hosted Supabase is not provisioned; run against the local stack (`pnpm supabase start`).

## Local development

```sh
pnpm supabase start                      # Docker; prints keys (`pnpm supabase status -o json`)
cp apps/api/.dev.vars.example apps/api/.dev.vars   # fill in keys
pnpm --filter @langquest/api dev         # wrangler dev → http://localhost:8787
curl -s http://localhost:8787/v1/languages | head -c 300
```

Authenticated calls need a Supabase access token: sign in with the anon key (`POST
{SUPABASE_URL}/auth/v1/token?grant_type=password`) and send `Authorization: Bearer <access_token>`.

## Abuse control vs learner limits

The Worker applies token-bucket rate limits per user/IP for auth-sensitive, AI and admin endpoints
(`src/middleware/rate-limit.ts`). These are **operator-side abuse guards** (credential stuffing, scripted
floods, runaway clients). They are tuned above any human pace, return `429 rate_limited` with `Retry-After`,
and are never surfaced as quotas, credits, meters or "remaining" allowances — LangQuest has none.

## Deploy

```sh
cd apps/api
npx wrangler secret put SUPABASE_URL      # … repeat for every secret above
npx wrangler deploy --env production
```
