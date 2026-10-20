# Incident runbooks

_Spec §12.2 (requirement R-12.2-05): alerts for runaway cost or attack, graceful provider fallback, incident runbooks,
and no quiet freemium or dialect switch under degradation. Written 2026-10-20 from the code at that date._

Seven runbooks: runaway AI cost (§2), provider outage (§3), abuse or attack (§4), data exposure (§5), auth or
configuration failure (§6), R2 unavailable (§7) and Supabase down (§8). Each one gives the detection signal, the first
15 minutes, mitigations that exist in this repo, communication and follow-up. Every flag, variable, endpoint and
command below exists in the repo or in the vendor CLI the repo already uses (`wrangler`, `supabase`). Anything
missing is listed as a gap in §9; nothing is invented here.

**Current deployment state (2026-10-20).** There is no hosted production yet. The deployed Worker
`https://langquest-api.langquest-nsh.workers.dev` answers the 503 configuration envelope because its secrets are not
set. Supabase runs only locally (blocker B-SUPABASE), and R2 is not enabled (B-R2). These runbooks are written for
the hosted setup in `docs/runbooks/provisioning.md`. Where a step differs locally, the difference is noted.

## 0. Rules that hold during every incident

1. **Learners never pay, and degradation is never a tier.** No paywall, credit meter, "premium" fallback or
   per-learner quota may be introduced to save cost or survive an outage (CONVENTIONS §6). Rate limits stay operator
   abuse guards (`apps/api/src/middleware/rate-limit.ts` header) and the 429 message says so.
2. **No dialect or source-language switch under degradation.** Never route a variety to a neighbour (no ary→arb,
   yue→cmn, ht→fr, es-ES→es-419). The capability registry refuses it (`varietyBoundaryViolation`,
   `packages/ai/src/capability/registry.ts`). Do not "fix" an outage by editing a profile to point a variety at
   another variety's model or voice.
3. **No fake scores.** If the acoustic assessor is down, pronunciation stays `reference-comparison` with
   `numericScore: null` (ADR-006). Never substitute an LLM score.
4. **Visible means usable.** A capability that is turned off disappears through the capability flags; it is never
   shown greyed out (CONVENTIONS §8). See §2.3 for how a kill switch propagates.
5. **Owner approval for cost and deletion.** Raising a budget, enabling a paid plan, or deleting data or projects
   needs the owner's explicit OK (`docs/HANDOFF.md` §4). Never print secret values: refer to secrets by variable name only.

## 1. Where the signals come from (shared by every runbook)

| Signal | How to read it | Source |
|---|---|---|
| Worker logs (structured JSON, learner text redacted) | Cloudflare dashboard → Workers → `langquest-api` → Logs (`[observability] enabled = true` in `apps/api/wrangler.toml`), or a live stream with `npx wrangler tail` from `apps/api`. Workers Logs keep 3 days on Free and 7 days on Paid ([Cloudflare docs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), read 2026-10-20). | `apps/api/src/middleware/logging.ts` |
| Log events to filter on | `config.invalid` (startup config error), `http.unhandled` (500s), `http.problem` (typed errors), `auth.rejected` (with `reason`), `auth.forbidden`, `auth.roles_failed`, `rate_limit.blocked`, `openrouter.chat.retry`, `openrouter.chat.fallback`, `openrouter.retry`, `ai.profiles_load_failed`, `telemetry.ai_requests_failed` | `apps/api/src/index.ts`, `app.ts`, `middleware/auth.ts`, `packages/ai/src/openrouter/client.ts`, `services/ai.ts`, `services/telemetry.ts` |
| Operator alerts | Studio → Analytics → Errors → Alerts, served by `GET /v1/admin/analytics/errors`. It computes `runaway_cost`, `provider_outage`, `attack` and `rights_expiry` alerts **on request**. Nothing is pushed (§9). | `apps/api/src/routes/admin/analytics.ts` |
| Cost views | Studio → Analytics → Cost (`GET /v1/admin/analytics/cost`), and the `ai_requests` ledger (`estimated_cost_usd`, `task`, `model`, `fallback_index`, `success`, `error_code`, `user_id`, `redacted_log->>'provider'` = the upstream that OpenRouter picked) | `supabase/migrations/…040_ai_tracking.sql` |
| Job queue | `pnpm --filter @langquest/jobs exec tsx src/main.ts status` (counts per state, capped at 200), Studio → Job queue, `processing_jobs.failure_code` | `apps/jobs/src/main.ts` |
| Liveness | `GET /healthz` returns `{ status: 'ok', media: <none\|s3\|binding\|s3+binding> }`. It does **not** touch Supabase. For a database-backed probe use `GET /v1/courses` (reads `course_tracks`). | `apps/api/src/app.ts`, `routes/learner/catalog.ts` |
| Vendor status | [Supabase Status](https://status.supabase.com), [Cloudflare Status](https://www.cloudflarestatus.com), and OpenRouter's status page (URL to confirm; `status.openrouter.ai` answered on 2026-10-20 but its content could not be verified) | — |

The `ai_requests` and `processing_jobs` queries below run as the service role against the hosted database, or against
the local stack with `psql`. Wrap ad-hoc investigation in `begin read only; … rollback;`.

## 2. Runaway AI cost

### 2.1 Detection

- **Studio alert `runaway_cost`.** `CostAnomalyDetector` (`packages/telemetry/src/cost.ts`) runs over the daily
  `ai_requests` totals of the last 30 days, with `absoluteFloorUsd: 1`. It needs at least 3 baseline days and a day
  total of at least $1. It fires `warning` at max(2× the trailing 14-day mean, mean + 3σ) and `critical` at max(4× the
  mean, mean + 3σ).
- **OpenRouter key budget.** The build key has a $50/month budget (`docs/provider-matrix/provider-setup-and-cost.md`).
  When a key's credit limit is used up, OpenRouter answers HTTP 402
  ([OpenRouter limits docs](https://openrouter.ai/docs/api/reference/limits), read 2026-10-20). The client classifies
  that as `insufficient_credits`, which is not retryable (`packages/ai/src/openrouter/client.ts`). The API maps it to
  `503 provider_unavailable` (`apps/api/src/http/envelope.ts` `toProblem`). A sudden wall of AI 503s with healthy
  upstreams therefore usually means the budget is exhausted.
- **Job ceiling.** A job that exceeds `JOBS_MAX_COST_PER_JOB_USD` (default $2) fails with `cost_ceiling_exceeded` and
  is not retried (`apps/jobs/src/cost.ts`).
- **Ledger spike by learner or task:**

  ```sql
  select date_trunc('hour', created_at) h, task, model, count(*), round(sum(estimated_cost_usd)::numeric, 4) usd
  from ai_requests where created_at > now() - interval '24 hours' group by 1, 2, 3 order by 1 desc, 5 desc;
  select user_id, count(*), round(sum(estimated_cost_usd)::numeric, 4) usd
  from ai_requests where created_at > now() - interval '1 hour' group by 1 order by 3 desc limit 20;
  ```

### 2.2 First 15 minutes

1. Confirm the spend in Studio → Analytics → Cost and with the queries above. Check the remaining key budget:
   `curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer $OPENROUTER_API_KEY"` returns `limit`,
   `limit_remaining` and `limit_reset` (same OpenRouter doc). Run it from a shell that already has the variable, and
   never paste the value.
2. Classify the source:
   - one learner id or a few dominating → abuse, go to §4;
   - one task or model → a loop or prompt bug, or a fallback chain landing on an expensive model (`fallback_index > 0`);
   - `processing_jobs` → a batch job (content factory, transcription).
3. Batch spend: stop the job runner process (SIGINT/SIGTERM; `PostgresJobRunner.stop`, `apps/jobs/src/main.ts`).
   Pending jobs stay queued. Restart it later with `JOBS_JOB_TYPES` limited to the safe types if needed.
4. Interactive spend that you cannot stop by blocking an abuser (§4): use the kill switch in §2.3, with the owner's OK.

### 2.3 Mitigations that exist

| Lever | Effect | Command or place |
|---|---|---|
| Lower or freeze the OpenRouter key limit, or disable the key | Every AI call fails with 402 → `503 provider_unavailable`; the learner sees the existing "temporarily unavailable" message (`errors.providerUnavailable`, `packages/locales/src/catalogs/en.json`) | OpenRouter dashboard (owner) |
| **Kill switch: remove `OPENROUTER_API_KEY` from the Worker** | `capabilityEnvFlags().openRouter = false` (`apps/api/src/lib/course-capabilities.ts`), so conversation and AI capabilities report unavailable and the app hides those features. Direct AI calls answer `501 capability_unsupported` "AI features are not configured on this deployment" (`apps/api/src/services/ai.ts`). Applies to every learner equally: an outage, not a tier. | From `apps/api`: `npx wrangler secret delete OPENROUTER_API_KEY`. Restore with `npx wrangler secret put OPENROUTER_API_KEY`. |
| Stop batch AI | No new content generation or transcription | Stop `apps/jobs`; restart with `JOBS_JOB_TYPES=<list>`; lower `JOBS_MAX_COST_PER_JOB_USD` |
| Cap a content-factory run | `--max-usd` (default 0.30) | `pnpm --filter @langquest/scripts content-factory -- … --max-usd 0.1` |
| Re-route one task to a cheaper model of the **same** variety scope | Admin-reviewed profile change; `PUT /v1/admin/models/:task/config` runs language smoke tests first | Studio → AI models (role set `admin`) |

What does **not** work as a kill switch: setting `ai_model_profiles.enabled = false`. Disabled rows are ignored and the
package defaults in `packages/ai/src/profiles.ts` still route the task. This is by design, so that a disabled seed row
never turns AI off (`apps/api/src/services/ai.ts`). Likewise `ai_model_profiles.daily_budget_usd` is stored and
editable, but **not enforced at runtime** (§9).

### 2.4 Communication

- **Internal:** owner first. Spending more needs the owner's explicit OK. Record the spend and the cause.
- **Learners:** there is no broadcast channel (§9). While AI is off, the app shows its existing provider message or
  hides the feature. Never introduce quota or credit wording.

### 2.5 Follow-up

- Record the incident in `docs/evidence/` with the `ai_requests` totals before and after.
- If the cause was a model fallback, add the expensive model's pricing check to the profile review.
- Consider wiring `createProfileBudgetDetectors` and an `AlertSink` (§9).

## 3. Provider outage and graceful fallback

### 3.1 Detection

- Studio alert `provider_outage`: more than 50% of AI requests failed in the last period, with at least 10 requests
  (`analytics.ts`).
- Worker logs show `openrouter.chat.retry` (408/429/5xx/timeouts with exponential backoff) and
  `openrouter.chat.fallback` (a model dropped from the chain), followed by `503 provider_unavailable` to clients.
- In `ai_requests`: rows with `success = false`, a rising `fallback_index`, and `error_code` (for example `timeout`).
- Speech: `POST /v1/speech/*` and conversation turns failing while text tasks succeed points at an STT/TTS upstream.

### 3.2 What the code already does (graceful, bounded)

- **Within a task:** each request sends `models: [primary, …fallbacks]` from the task's profile. OpenRouter fails over
  between models on its side. The client also falls back sequentially when a model id is rejected or retries are
  exhausted (`packages/ai/src/openrouter/client.ts`). The fallbacks are configured **per task × variety × source**
  (`DEFAULT_PROFILES`, `packages/ai/src/profiles.ts`), so a fallback never changes the dialect being taught.
- **Across varieties:** never. The capability registry rejects a provider locale that crosses a variety boundary.
  Azure pronunciation refuses a mismatched locale (`packages/ai/src/speech/pronunciation.ts`).
- **To the client:** `503 provider_unavailable` ("A provider is temporarily unavailable. Please try again in a
  moment.") or, for timeouts, "The request took too long and was cancelled". The app treats it as a connectivity-class
  error: it keeps the learner's clip and resubmits it on reconnect (`apps/mobile/src/features/conversation/controller.ts`,
  `isConnectivityError`). Conversation turns
  are idempotent on `clientTurnId`, so a retry never double-bills a turn (`ROUTES.conversationTurn`).
- **Offline:** lessons and downloaded packs keep working. Progress queues locally and syncs idempotently (ADR-003).

### 3.3 First 15 minutes

1. Identify the failing upstream: `select model, redacted_log->>'provider' upstream, error_code, count(*) from ai_requests where created_at > now() - interval '30 minutes' and not success group by 1, 2, 3 order by 4 desc;`.
   For text tasks `redacted_log.provider` is the upstream OpenRouter used, for example `Google` or `Azure` for Anthropic
   models (observed on the local stack on 2026-10-20).
2. Check OpenRouter's and the upstream's status pages (§1).
3. If one model is down and its fallbacks are healthy, do nothing: the chain already handles it.
4. If every model for a task is down, AI features answer 503 until it recovers. That is the intended graceful state.
   Do not swap in another variety's model or voice.

### 3.4 Mitigations

- Add or reorder **same-scope** fallbacks for the task in Studio → AI models. The smoke tests in
  `apps/api/src/routes/admin/models.ts` must pass for the variety.
- If the outage is long, the owner may use the §2.3 kill switch so that the app hides AI features instead of showing
  repeated errors.

### 3.5 Communication and follow-up

- **Learners:** the existing in-app message. No broadcast channel exists.
- **Follow-up:** note which upstream failed and whether fallbacks covered it; review each variety's fallback depth in
  `docs/provider-matrix/ai-capability-matrix.md`.

## 4. Abuse or attack

### 4.1 Detection

- `rate_limit.blocked` log lines. `429 rate_limited` with `Retry-After` from the buckets in `RATE_POLICIES`
  (`apps/api/src/middleware/rate-limit.ts`): ingress 1200/min (burst 400) per hashed client before auth; public 240,
  learner 600, auth 30, ai 90 and admin 300 per minute. Repeated failed tokens per client key trip
  `rl:auth_fail:k:<clientKey>` ("Too many failed authentication attempts from this network").
- `auth.rejected` floods with `reason` `bad_signature` or `malformed` (credential stuffing or forged tokens).
- Studio alert `attack`: more than 25 processing jobs failed or `review_needed` in the range ("check for abusive
  uploads").
- §2.1 spend concentrated on one `user_id`. `moderation_incidents` rows (safety pipeline).

### 4.2 First 15 minutes

1. Scope it: one account, one network (hashed client key, logged as `clientKey`, never the raw IP), or distributed.
2. One learner account abusing AI: block that account with the Supabase Auth admin API, using the same call the API
   uses for deactivation (`ban_duration`, `apps/api/src/routes/learner/account.ts` `meDelete`): with the service role,
   `PUT {SUPABASE_URL}/auth/v1/admin/users/<id>` with `{"ban_duration":"876000h"}`. Existing access tokens stay
   valid until they expire, so also watch §2.
3. A compromised staff account: a `super_admin` revokes each of its roles in Studio → Users, which calls
   `DELETE /v1/admin/users/:userId/roles/:role` (`adminUserRoleRevoke`, `apps/api/src/routes/admin/users.ts`). Only a
   `super_admin` may call it, and nobody can revoke their own `super_admin`. Roles are read from `user_roles` on every
   request (`apps/api/src/middleware/auth.ts`), so the revoke applies to the next call even with a still-valid token.
   Then check `audit_logs`: the rows with that `actor_id` (what the account did), and the
   `action in ('users.role_grant', 'users.role_revoke')` rows (who changed roles, and when).
4. A network flood: buckets are per isolate unless the `RATE_LIMIT` KV binding exists (`apps/api/src/app.ts`,
   `infra/cloudflare/README.md`). Add Cloudflare WAF or rate-limiting rules in the dashboard (owner; check the plan's
   limits before enabling anything paid).

### 4.3 Mitigations that exist

- Tighter `RATE_POLICIES` numbers through code review and a deploy (`npx wrangler deploy --env production` from
  `apps/api`). They are operator guards: never per learner, never shown as an allowance.
- Bind the `RATE_LIMIT` and `IDEMPOTENCY` KV namespaces so buckets are shared across isolates (`infra/cloudflare/README.md`).
- Abusive uploads: uploads need a content-editor role, are size-capped per kind and are checksum-verified
  (`packages/media/src/uploads.ts`). Revoke the editor role and abort sessions (`POST /v1/admin/uploads/:id/abort`).
  The orphan sweeper (`cleanup-orphan-uploads` job) removes stale multipart uploads.

### 4.4 Communication and follow-up

- Owner first. If accounts were taken over, the owner decides on user notification with counsel (R-11-11).
- **Follow-up:** add a regression test under `tests/security/` (`pnpm --filter @langquest/tests test:security`, local
  stack, run only when no other session uses it).

## 5. Data exposure

Covers a leaked secret, a cross-account read (an RLS or route bug), or learner data in logs or analytics.

### 5.1 Detection

- **CI secret scan:** `git grep` for `sk-or-v1-`, `sbp_`, `AKIA` and `re_` patterns (`.github/workflows/ci.yml`).
  There is no remote, so this only runs if CI runs (`docs/HANDOFF.md` §11).
- **RLS invariant:** `select tablename from pg_tables where schemaname='public' and not rowsecurity;` must return zero
  rows (`docs/runbooks/database.md` §7). Migration `070_rls.sql` §9 refuses to apply otherwise.
- The cross-account security suite (`tests/security/`, A29) and the pgTAP files `supabase/tests/database/*.test.sql`
  fail on a regression.
- A report from a learner or reviewer, or `audit_logs` showing an unexpected `actor_id` or `action`.

### 5.2 First 15 minutes

1. **Leaked secret:** rotate it at the source, then replace it in the Worker with `npx wrangler secret put <NAME>`
   (from `apps/api`; names in `infra/cloudflare/README.md`), and in `.env` / `apps/api/.dev.vars` locally.
   - `OPENROUTER_API_KEY`: revoke the key in the OpenRouter dashboard first, which also stops spend.
   - `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`: rotate in the Supabase dashboard. A JWT secret rotation signs
     everyone out.
   - `AI_SESSION_TICKET_SECRET`, `MEDIA_STREAM_SECRET`, `LEARNER_PSEUDONYM_SALT`: generate new random values. Each must
     differ from every Supabase key: `parseEnv` refuses otherwise. Rotating the ticket secret invalidates live
     conversation tickets. Rotating `MEDIA_STREAM_SECRET` invalidates outstanding playback URLs (they are short-lived).
   - R2 keys: rotate the R2 API token.
2. **Cross-account read:** identify the route and table. Disable the route by deploying a fix, or roll the Worker back
   to the previous version with `npx wrangler rollback`. Check the table's RLS (`070_rls.sql` §2–8).
3. **Learner text in logs:** logs are redacted by design (`redactChatRequest` in
   `packages/ai/src/openrouter/redact.ts`, `redactDeep` in `packages/telemetry/src/privacy.ts`). If a field escaped, ship the fix. Workers Logs age out after 3 or 7 days
   (§1). Purging stored rows needs the owner's OK.

### 5.3 Communication and follow-up

- Breach assessment and any notification to learners or authorities is a legal decision: owner and counsel (R-11-11).
  Collect the facts: what, whose, when, and which rows (`audit_logs` with `request_id` and `ip_hash`).
- Learners can export and delete their own data at any time (`GET /v1/me/export`, `DELETE /v1/me` → the
  `delete_account` RPC).
- **Follow-up:** a negative RLS test for the table (CONVENTIONS §7: "Negative RLS tests are mandatory for every
  user-owned table").

## 6. Auth, JWT or configuration failure

### 6.1 Detection

| Symptom | Meaning | Source |
|---|---|---|
| **Every path** answers `503 provider_unavailable` "API is not configured yet (missing or invalid Worker secrets). See infra/cloudflare/README.md." with `Retry-After: 300` and `details.reason`; log `config.invalid` | `parseEnv` failed at isolate start: a missing or invalid variable, `OPENROUTER_API_KEY` set without `AI_SESSION_TICKET_SECRET`, an empty `CORS_ALLOWED_ORIGINS` with `API_ENV` other than development, an unset `API_ENV`, or a secret equal to a Supabase key | `apps/api/src/index.ts`, `apps/api/src/env.ts` |
| Valid sessions get `401 unauthorized` "Invalid access token"; `auth.rejected` with `reason: bad_signature` | HS256 tokens: `SUPABASE_JWT_SECRET` does not match the project. ES256/RS256: `SUPABASE_URL` points at another project's JWKS. | `apps/api/src/middleware/auth.ts`; `docs/HANDOFF.md` §11 |
| `503` "Authentication service is temporarily unavailable"; `reason: provider_unavailable` | JWKS fetch or Supabase Auth unreachable (see §8) | `auth.ts` |
| `401` "Your session has expired" for everyone right after a deploy | The clock or the JWT secret changed (rotation) | `auth.ts` |
| Admins get `403` "This action requires a staff role" | Missing `user_roles` row, or the role is outside the route's set (`ROLE_SETS`; the roles that can call each operation are its `x-langquest-roles` in `docs/api/openapi.json`) | `auth.ts` |
| `500` "Could not resolve account roles"; `auth.roles_failed` | The service client cannot read `user_roles` (`SUPABASE_SERVICE_ROLE_KEY` wrong, or the database is down) | `auth.ts` |
| Browser calls blocked by CORS | The origin is missing from `CORS_ALLOWED_ORIGINS` | `apps/api/src/middleware/security.ts`, `wrangler.toml` `[vars]` |

### 6.2 First 15 minutes

1. Read `details.reason` from any 503 response, or the `config.invalid` log line. It names the failing variable, never
   its value.
2. List what is set with `npx wrangler secret list` (names only), and compare with `infra/cloudflare/README.md`.
3. Fix it with `npx wrangler secret put <NAME>`, or roll back the deploy that introduced it with `npx wrangler rollback`
   (from `apps/api`).
4. **Locally:** a `401` with a valid local token means `apps/api/.dev.vars` `SUPABASE_JWT_SECRET` does not match the
   stack's JWT secret (`pnpm supabase status` shows the local one; never paste it into chat). `wrangler dev`
   hot-reloads after the file changes.

### 6.3 Communication and follow-up

- Fail-closed means no learner data was served while misconfigured. Learners saw errors, not wrong data.
- **Follow-up:** add the missing variable to `.env.example` or `infra/cloudflare/README.md`; add a `parseEnv` unit
  test for the bad combination (`apps/api/src/__tests__`).

## 7. R2 unavailable

R2 is **not enabled** today (B-R2). That is the steady state, and the app is built for it: media capabilities are
false, so audio-library features are disclosed at enrollment and hidden after it (CONVENTIONS §8).

### 7.1 Detection

- `GET /healthz` reports `media: "none"` when neither the `MEDIA` binding nor the S3 credentials exist.
- Media endpoints answer `501 capability_unsupported` "Media storage is not configured" (stream), or the
  `R2_UNAVAILABLE_MESSAGE` (playback URL, download pack, uploads, imports, visual assets).
  Sources: `apps/api/src/routes/media-proxy.ts`, `routes/audio/index.ts`, `routes/admin/{uploads,imports,visual-assets}.ts`,
  `services/r2.ts`.
- With R2 enabled but failing: `http.unhandled` or `http.problem` on media routes, and failed `transcode` or
  `transcribe` jobs (`processing_jobs.failure_code`).

### 7.2 First 15 minutes

1. Check the [Cloudflare Status](https://www.cloudflarestatus.com) page and the R2 dashboard.
2. Confirm the binding and secrets: `MEDIA` in `wrangler.toml` `[[r2_buckets]]` (currently commented out per
   `infra/cloudflare/README.md`), and `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
3. Pause media jobs: stop `apps/jobs`, or restart it with `JOBS_JOB_TYPES` excluding media types.
   **Do not** switch production to `OBJECT_STORE=local`: it is a dev-only filesystem store (`apps/jobs/src/config.ts`).

### 7.3 Mitigations and what learners keep

- There is no secondary object store. Downloaded offline packs keep playing on devices. Lessons and missions that do
  not need streamed audio keep working.
- After recovery: re-run failed jobs with a **new** idempotency key (re-enqueueing with the same key returns the
  existing row; `docs/runbooks/jobs.md` §6). `pnpm --filter @langquest/jobs requeue` sweeps expired leases.

### 7.4 Communication and follow-up

- **Learners:** the existing error copy. While R2 stays disabled, nothing is announced, because the features are
  simply not shown.
- **Follow-up:** enabling R2 is an owner decision (payment method); see the deploy order in `provisioning.md`.

## 8. Supabase down

### 8.1 Detection

- `GET /v1/courses` fails while `/healthz` is OK (`/healthz` does not touch the database).
- `500 internal` "Database request failed" (`DbError` mapping in `apps/api/src/http/envelope.ts`), `500` "Could not
  resolve account roles", or `503` "Authentication service is temporarily unavailable" (JWKS or `/auth/v1/user`
  unreachable).
- The jobs runner cannot claim jobs; `status` fails.
- [Supabase Status](https://status.supabase.com). **Locally:** `pnpm supabase status`; containers stuck in `Created`
  is the Docker wedge (`docs/runbooks/database.md` §8).

### 8.2 First 15 minutes

1. Hosted: check the status page and the project dashboard. There is no failover database, so wait for recovery. Do
   not restore a backup or reset without the owner.
2. Local: follow `database.md` §8 only with the owner's OK and when no other session uses the stack. **Stop before its
   last line** (`pnpm supabase db reset`), which wipes local state (`docs/HANDOFF.md` §11).
3. Stop the jobs runner to avoid lease churn. When it comes back, `requeue_expired_jobs()` (run every loop) returns
   expired leases to `pending`, or to `review_needed` when attempts are exhausted.

### 8.3 What learners keep

- The app is offline-first. Progress, XP events and audio positions queue locally with client UUIDs, and sync
  idempotently when the API is back (`apply_sync_events`, `device_sync_events` and `xp_ledger` unique keys; ADR-003). Nothing is lost and
  nothing is double-counted.
- Sign-in and new enrollments fail until Auth recovers.

### 8.4 Communication and follow-up

- **Learners:** the existing connectivity and error messages.
- **Follow-up:** check that sync drained: `device_sync_events` rows with `applied_at is null` should go back to zero.
  Record the duration.

## 9. Gaps (honest list, nothing above depends on them)

- **No pushed alerts.** `EmailAlertSink`, `WebhookAlertSink` and `createResendAlertTransport` exist in
  `packages/telemetry/src/sinks.ts`, but no app constructs them. `RESEND_API_KEY` is "not wired yet"
  (`.env.example`). Alerts appear only when someone opens Studio → Analytics.
- **`ai_model_profiles.daily_budget_usd` is not enforced.** `createProfileBudgetDetectors` exists but no app calls it.
  `docs/provider-matrix/provider-setup-and-cost.md` §3 says these alerts surface in Analytics. They do not: Analytics
  runs only the total-cost detector.
- **No dedicated kill-switch flag** per AI feature or track. The levers are the OpenRouter key and the Worker secret
  (§2.3).
- **No learner broadcast channel** (status page, in-app banner or e-mail) for incident communication.
- **Job ceiling only.** There is no per-day ceiling for interactive AI spend beyond the OpenRouter key budget.
- `/healthz` does not check Supabase or OpenRouter reachability.
