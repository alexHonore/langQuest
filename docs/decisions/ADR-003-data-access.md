# ADR-003 — Data access: supabase-js + RLS-forwarded JWT, RPC for invariants, Postgres job queue

**Status:** accepted (2026-10-14) · **Scope:** `supabase/migrations`, `packages/db`, `apps/api`, `apps/jobs`

## Context
LangQuest stores all structured data in Supabase Postgres 17 (spec §5) and must enforce tenant safety
(§5.5, §11): every user-owned row is readable/writable only by its owner, content is visible only when
published, rights/licences can never be forged by a learner, XP and offline sync must be idempotent, and
changing an enrollment's instruction language must never reset mastery (§2.1). The API runs on Cloudflare
Workers (Hono) and verifies Supabase JWTs; the job runner is a Node process; raw media lives in R2, not Postgres.

## Decision
1. **One typed access package (`@langquest/db`)** built on `@supabase/supabase-js` with types generated from
   the live schema (`pnpm --filter @langquest/db gen-types` → `src/database.types.ts`). Repositories wrap
   PostgREST queries per domain (profiles, enrollments, catalog, curriculum, progress, audio library,
   uploads/jobs, AI profiles, rights, visual assets, audit log). No ORM, no query builder layer of our own.
2. **Three client factories, one RLS story.**
   - `createUserClient(env, accessToken)` forwards the learner's JWT in `Authorization`, so every learner
     route in the API executes under RLS exactly as if the device called Supabase directly. The Worker never
     "trusts itself" for learner data.
   - `createServiceClient(env)` (service role, bypasses RLS) is restricted to server-validated writes:
     XP awards, evaluator observations, audit logs, job orchestration, seeds.
   - `createAnonClient(env)` for the public catalog only (`languages`, `course_tracks`, coverage, approved art).
3. **Invariants live in SQL, exposed as RPCs** (`060_functions.sql`), never only in application code:
   - `award_xp(idempotency_key, user_id, amount, reason, enrollment_id?, reference_table?, reference_id?)` —
     append-only `xp_ledger`, unique key, replay returns the original row; execute granted to the service
     role only (XP is server-validated, §3.8). A reference must pass `xp_reference_owned(user, table, id)`
     (the learner's own, *completed* attempt / reviewed card / observation / achievement / audio lesson /
     session / mastery row / streak day; anything else raises `23503`) and is paid at most once per reason
     (`xp_ledger_reference_once`): a second award for the same reference returns `applied = false` with
     the ledger row that already paid it.
   - `apply_sync_events(jsonb[])` — one `device_sync_events` row per `(user_id, client_event_id)`, the
     batch serialised per user with a transaction-scoped advisory lock; applies audio progress
     (revision-guarded), bookmarks, activity minutes and enrollment opens in the DB (`handled_in_db = true`).
     Engine-handled payloads (`review_result`, `step_completed`, `mission_abandoned`, `observation`,
     `xp_claim`) are recorded as `applied` with `handled_in_db = false` and `applied_at = null`; the API
     Worker finishes them and calls `mark_sync_events_applied`.
   - **`xp_claim` hand-off (API Worker).** The DB never credits a client claim. `apply_sync_events` rejects
     a claim without `referenceId` (`reason = 'xp_claim_requires_reference'`) and otherwise returns it with
     `resolution = 'applied'`, `handled_in_db = false`, `xp_credited = null`. For each such result the Worker
     (service client) must: (1) look up the claimed row and check it is the learner's own, completed one
     (`xp_reference_owned`, or the equivalent repository read); (2) call
     `progress.awardXp({ idempotencyKey: clientEventId, userId, amount: xp_amount_for_reason(reason),
     reason, enrollmentId, referenceTable, referenceId })` — the canonical amount, never the client's;
     (3) `markSyncEventsApplied([clientEventId])`. `award_xp` is idempotent on the clientEventId *and* on
     the reference, so retries and two devices claiming the same completion cannot double-pay. A claim whose
     reference does not validate is left unapplied (`applied_at` stays null) and reported to the client as
     rejected by the API, not by the DB.
   - `set_enrollment_source_language(enrollment_id, code)` — updates only `source_language_code`;
     mastery/reviews/attempts/XP are keyed by `enrollment_id` and untouched. Owner or service role only.
   - `enqueue_processing_job(…)` (editors + service role; an editor JWT is always the `requested_by`) /
     `claim_processing_job(worker_id, job_types[])` / `heartbeat_*` / `complete_*` / `fail_*` — Postgres-backed
     queue with `FOR UPDATE SKIP LOCKED`, leases, exponential backoff and `review_needed` on exhaustion.
     Claiming is **service-role only**: every claim burns an attempt, so a JWT must never be able to strand work.
   - **`requeue_expired_jobs(p_limit default 500)` (jobs runner).** Service-role sweeper for `running` rows
     whose `locked_until` passed without a heartbeat (crashed/killed worker): attempts left → `pending`
     (claimable immediately), exhausted → `review_needed` with `finished_at` set; both get `locked_by = null`
     and `failure_code = 'lease_expired'` unless a code was already recorded. Returns `(job_id, new_state)`
     for every row it moved. The runner (`apps/jobs`) calls `processingJobs.requeueExpired()` once per poll
     loop (before claiming) or from a pg_cron schedule; `claim_processing_job` still reclaims expired leases
     lazily, so the sweeper only makes stranding impossible and visible, it is not required for liveness.
   - `get_due_reviews(enrollment_id, limit)` — SECURITY INVOKER so RLS scopes it to the caller.
   - Helpers used by policies and triggers: `object_key_scope(key)` (classifies R2 keys; CHECK constraints
     on `media_assets`, `visual_assets`, `uploads`), `owns_media_asset(id)` (a learner may only attach audio
     they recorded), `normalize_source_language_code(text)` (signup metadata → catalog code).
   Triggers enforce append-only ledgers (even for the service role), immutable enrollment identity,
   server-decided attempt outcomes (`guard_mission_attempt_write`), upload staging keys bound to the row id
   and a server-owned upload lifecycle (`guard_upload_row`, `guard_upload_client_write`), turn retention
   derived from the session, `updated_at` maintenance and profile creation from `auth.users` (which
   validates/normalises `default_source_language_code` and leaves it NULL when the signup carries none).
4. **Enum values are CHECK-constrained domains** mirroring `@langquest/contracts` enums one-to-one, so the
   generated types stay `string` and the contracts package remains the single source of truth for unions.
5. **RLS on every table** (`070_rls.sql` asserts it). Policy classes: owner (`user_id = auth.uid()`),
   published-only learner reads with parent checks (steps → mission published, segments → transcript
   readable → lesson published), staff reads via `has_role()` helpers (`is_staff`, `is_content_editor`,
   `is_language_reviewer`, `is_admin`, `is_support`), editor/reviewer writes, `super_admin`-only role grants.
   Learners get no access to `content_rights`, `processing_jobs`, `ai_requests`, `audit_logs`.
   Derived learning state (`user_skill_mastery`, `mission_progress`, `streak_activity`,
   `daily_learning_metrics`) is owner **read-only**: the engine writes it with the service role.
   `course_source_localizations.reviewer_id` and `media_assets.owner_id`/`legacy_filename`/`legacy_path`
   are withheld from `anon`/`authenticated` by column-level grants, so learner/editor reads of those two
   tables must name their columns (`COVERAGE_COLUMNS`, `MEDIA_ASSET_COLUMNS` in `@langquest/db`;
   `select=*` gets `42501`); full rows come from the `course_source_localizations_staff` /
   `media_assets_staff` views, which serve staff JWTs and the service role and are empty for everyone else.
6. **Job queue default = Postgres** (ADR-005). Cloudflare Queues stays optional and reuses the same handlers.

## Consequences
- Negative RLS tests are mandatory and run against the local stack (`packages/db/src/__tests__/rls.test.ts`);
  they skip with an explicit message when Docker/Supabase is down, never silently pass.
- A learner JWT can write its own review cards and start/advance its own attempts (its own evidence);
  attempt outcomes, mastery, mission progress, streaks, daily metrics, XP, achievements and observations
  are server-written only.
- Upload rows are opened by `@langquest/db` with a client-generated id (`crypto.randomUUID`) so the
  staging key `uploads/{id}/{checksum}.{ext}` can name its own row; every later lifecycle step is the API
  Worker's (service role).
- `profiles.default_source_language_code` is nullable (no catalog default): onboarding, not the schema,
  decides the instruction language; `@langquest/contracts` `ProfilesTable` mirrors that.
- Catalog seed SQL is **generated** from `@langquest/contracts` (`seed:catalog-sql`) and committed as a
  migration; a unit test fails when the committed file drifts from the constants.
- Changing a function's signature requires regenerating `database.types.ts`; CI should diff it.
