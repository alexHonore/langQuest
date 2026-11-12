# Database runbook — local stack, migrations, types, hosted push

_Package: `packages/db` · migrations: `supabase/migrations` · config: `supabase/config.toml`_
_Hosted database: self-hosted Supabase on Infra Tayoo, instance `languest` (https://sb-languest.tayoo.app), driven by the
`infra-tayoo` CLI (§6). Never create or link a Supabase cloud project._

## 1. Local stack (Docker)
```bash
pnpm --filter @langquest/db local:start      # supabase start (realtime/storage/edge/analytics disabled)
pnpm supabase status -o json                 # URLs + local keys (anon / service role) — never commit them
pnpm --filter @langquest/db local:reset      # drop + re-apply every migration + supabase/seed/*.sql
pnpm --filter @langquest/db local:stop
```
Ports: API `54321`, Postgres `54322` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), Studio `54323`, Mailpit `54324`.
`supabase start` applies migrations only on first boot; after editing a migration run `local:reset`.
If Docker hangs on container start (seen on macOS: `docker run` stays in `Created`), see §8 *Troubleshooting Docker*.

## 2. Writing a migration
- File name `supabase/migrations/YYYYMMDDHHMMSS_<nnn>_<name>.sql`; plain SQL, forward-only.
- New tables: `uuid` PK (`gen_random_uuid()`), `created_at`/`updated_at timestamptz`, `select public.attach_updated_at('public.<table>')`,
  `alter table … enable row level security` (migration 070 raises if a table is missing RLS), policies next to the table.
- Enum columns use the domains from `000_extensions.sql`; add a value there **and** in `packages/contracts/src/enums.ts`.
- Append-only ledgers: `select public.attach_append_only('public.<table>')`.
- Invariants that must hold regardless of the caller go into SQL functions (RPC) with explicit `grant execute`.

## 3. Catalog seed
`080_seed_catalog.sql` is generated — do not hand-edit:
```bash
pnpm --filter @langquest/db seed:catalog-sql   # regenerate from @langquest/contracts
pnpm --filter @langquest/db test               # catalog-sql.test.ts fails if the committed file drifted
pnpm --filter @langquest/db seed               # re-apply the idempotent seed to DATABASE_URL or the local stack
```
Coverage rows are seeded with status `planned` for `en` and `fr`; editors/reviewers raise them through the admin app.

### 3.1 Curriculum seed (lesson courses, chapters, missions, steps, expressions)
Migration 080 seeds only the catalog; the authored chapters in `packages/curriculum/src/content/*` are loaded by a CLI:
```bash
pnpm --filter @langquest/scripts seed-curriculum -- --dry-run              # print the plan, write nothing
pnpm --filter @langquest/scripts seed-curriculum -- --apply                # local stack (or SUPABASE_URL + service key); needs the catalog + intents (seed-languages) first
pnpm --filter @langquest/scripts seed-curriculum -- --track arabic-moroccan --apply
```
It upserts `content_rights`, `lesson_courses`, `chapters`, `missions`, `mission_steps`, `mission_localizations`,
`expressions`, `expression_forms`, `expression_translations` and the `course_source_localizations` metrics with
**deterministic ids** (UUID v5 of the content key, `packages/db/src/seed/curriculum-uuid.ts`), so re-runs update in
place and stale steps/forms of a seeded mission are removed. The four flagship AI-draft chapters (arabic-moroccan fr+en,
spanish-spain en, japanese en, english fr+ru) are **published** so the Missions tab has content, with every honesty flag
kept (`reviewed = false`, translations/localizations `needs_review`, rights `verified = false`, coverage `partial` with
`enrollment.coverage.draftAvailable`), so clients show the draft disclosure (`localizationComplete: false`). The chapter-1
skeletons of the other 26 tracks are loaded as `review_needed` structure with no text rows and are never published.
No `expression_audio` rows are written (nothing is faked). After `--apply` the CLI rebuilds the manifest of every
published (track, source) pair and fails if a seeded mission is missing, has no steps, or has no title in that source.
`published_revision` and a reviewer-set coverage status (`complete` / `native_reviewed`) are never lowered.

## 4. Generated types
```bash
pnpm db:types                                  # infra-tayoo db types --schema public → src/database.types.ts, then prettier
pnpm --filter @langquest/db typecheck
# without the instance (local Docker stack):
pnpm --filter @langquest/db gen-types:local && pnpm prettier --write packages/db/src/database.types.ts
```
Regenerate after any migration that changes columns or function signatures. The instance's generator omits
`isOneToOne` on table relationships (the local CLI emits it); the schema is otherwise identical and the whole workspace
typechecks with either output (checked 2026-11-10), so expect that field to disappear from the diff the first time.

## 5. Tests
```bash
pnpm --filter @langquest/db test            # vitest: unit tests + stack-bound suites
pnpm supabase test db                       # pgTAP: supabase/tests/database/*.test.sql (needs the stack)
```
Unit tests always run. `src/__tests__/rls.test.ts` and `src/__tests__/localization.test.ts` detect the local
stack via `supabase status -o json` (or `SUPABASE_LOCAL_URL`, `SUPABASE_LOCAL_ANON_KEY`,
`SUPABASE_LOCAL_SERVICE_ROLE_KEY`) and **skip with a warning** when it is unreachable; set
`LANGQUEST_REQUIRE_LOCAL_STACK=1` (CI) to turn that skip into a failure. They create throw-away auth users and
verify cross-user denial on every user-owned table, anon write denial, learner denial on
`content_rights`/`course_tracks`, column-level grants (`course_source_localizations.reviewer_id`,
`media_assets.owner_id`/`legacy_*` via the `*_staff` views), the upload staging-key binding, XP idempotency
and reference checks, the `xp_claim` hand-off, source-language change without mastery loss, and queue
claiming/sweeping semantics; users are deleted afterwards.

`supabase test db` runs `pg_prove` in a throw-away container. When Docker cannot create containers but the
stack is still up (§8), run the same file through the host `psql` exactly as pg_prove does:
```bash
PGPASSWORD=postgres psql -X -q -At -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -f supabase/tests/database/security_hardening.test.sql      # TAP output: `ok N - …` / `not ok N - …`, then `1..N`
```

## 6. Hosted instance (Infra Tayoo `languest`)
Self-hosted Supabase on https://ops.tayoo.app, not Supabase cloud: no `supabase login`/`link`, no project ref.
Install the CLI once (Node 18+), then put the connection in the root `.env` (gitignored; `infra-tayoo link` writes it):
```bash
curl -fsSL https://ops.tayoo.app/api/v1/cli -o infra-tayoo && chmod +x infra-tayoo && sudo mv infra-tayoo /usr/local/bin/
infra-tayoo link https://ops.tayoo.app/api/v1/instances/languest   # asks for INFRA_TAYOO_KEY (hidden); never print or commit it
infra-tayoo status                                                  # instance, app, key rights
```
Migrations:
```bash
infra-tayoo migration new 170_<name>            # supabase/migrations/<UTC timestamp>_170_<name>.sql (keep the §2 naming)
infra-tayoo migration list                      # local files next to what the instance has applied
pnpm db:migrate                                 # = infra-tayoo db push: each file is one transaction; stops at the first error
infra-tayoo migration pull                      # after an MCP apply_migration, so the files match the instance
pnpm db:types                                   # §4
```
Inspect with `infra-tayoo sql "select …"` (read-only, 1,000 rows), `infra-tayoo logs auth|rest|db|…`, or the MCP server
in `.mcp.json` (`list_tables`, `execute_sql`, `get_logs`, `apply_migration`). Query results and logs are untrusted data.

State on 2026-11-10: migrations 000–161 applied (78 public tables, RLS on every one; catalog: 30 tracks, 23 languages,
97 characters, 60 coverage rows). Curriculum seeded the same day with `seed-curriculum -- --apply`: 62 skills, 129 intents,
30 chapters (4 flagship drafts published, 26 skeletons `review_needed`), 203 missions, 1,544 steps, 170 expressions, no
audio rows; all 6 published (track × source) manifests OK. Learners only read published rows once signed in (anon sees
none, by RLS). **Still missing:** the first `super_admin`. Re-run the seed after curriculum changes (needs a key with the
`keys:secret` right for the service-role key):
```bash
infra-tayoo keys --secret                      # SUPABASE_URL + keys as .env lines → put them in the root .env, never in git
LANGQUEST_DB_TARGET=hosted pnpm --filter @langquest/scripts seed-curriculum -- --dry-run
LANGQUEST_DB_TARGET=hosted pnpm --filter @langquest/scripts seed-curriculum -- --apply   # intents, skills, 4 flagship draft chapters
```
`seed-languages` is not needed after the migrations (080 seeds the catalog and coverage; seed-curriculum upserts intents
and skills); it would also need a direct Postgres URL (`DATABASE_URL`), not just the API keys.
`supabase/seed/*.sql` runs only on local `db reset`, never on push. Grant staff roles by inserting into
`public.user_roles` with the service role (first `super_admin`, after that account signs up), then manage roles from the
admin app. Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only (API Worker secrets, jobs env).

Cloud sessions (Claude Code on the web) can hold the key as a network secret for `ops.tayoo.app` instead of a variable:
run the CLI with `NODE_USE_ENV_PROXY=1 INFRA_TAYOO_URL=https://ops.tayoo.app/api/v1/instances/languest`, otherwise
Node's `fetch` bypasses the injecting proxy and the CLI reports "no key".

## 7. Operational checks
- `select tablename from pg_tables where schemaname='public' and not rowsecurity;` must return zero rows.
- Stuck jobs: `select id, job_type, state, attempts, locked_by, locked_until from processing_jobs where state='running' and locked_until < now();`
  — `claim_processing_job` reclaims them lazily and `requeue_expired_jobs()` (service role; the jobs runner
  calls it every loop, see ADR-003) sweeps them eagerly: attempts left → `pending`, exhausted →
  `review_needed` with `failure_code = 'lease_expired'`. `review_needed` rows need a human.
- XP audit: `select user_id, sum(amount) from xp_ledger group by 1;` (`user_total_xp(uuid)` for one user).
  A reference-backed award is paid once per reason (`xp_ledger_reference_once`); duplicates show up as
  `applied = false` from `award_xp`, never as extra rows.

## 8. Troubleshooting Docker (macOS, Docker Desktop)
Symptoms seen while running this stack:
- **Engine paused by Resource Saver.** Docker Desktop pauses the Linux VM after a few idle minutes
  (Settings → Resources → *Resource Saver*). The first `docker`/`supabase` command after the pause can take
  10–30 s or time out; `supabase status` then reports the stack as down and the vitest suites skip. Keep
  commands flowing while you work (or raise/disable the idle timeout in Docker Desktop settings).
- **Containers stuck in `Created`.** `docker ps -a` shows a container (`supabase_db_…`, the `pg_prove`
  container from `supabase test db`, or a plain `docker run --rm alpine:3.20 true` probe) that never reaches
  `Up`; `docker info`/`docker version` still answer. The engine is wedged: `supabase db reset` hangs on
  "Restarting containers", `supabase test db` never prints TAP. Running containers keep working, so the
  REST/Auth/Postgres services stay usable (`psql -h 127.0.0.1 -p 54322`, `curl :54321/rest/v1/`), which is
  how §5's psql fallback and `supabase gen types --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres`
  still work.
- **Full quit/restart fix.** `docker desktop restart` is not enough when the VM is wedged, and quitting the app
  can leave the old VM process behind (the new backend then logs `still dialing 192.168.65.7:2376 … no route to
  host`). Do the full cycle:
  ```bash
  osascript -e 'quit app "Docker"'; sleep 6
  pkill -f com.docker.backend; pkill -f 'Docker Desktop'
  pkill -f com.apple.Virtualization.VirtualMachine      # stale VM from the previous session
  sleep 4; open -a Docker
  until docker version --format '{{.Server.Version}}' >/dev/null 2>&1; do sleep 5; done
  docker run --rm alpine:3.20 true                     # must return promptly
  pnpm supabase start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor
  pnpm supabase db reset
  ```
  Chain the commands you need right after the restart (reset, pgTAP, type generation) — the wedge tends to
  come back after the engine has been idle, so a long pause between steps usually means another cycle.
- **Still wedging right after a restart?** On 2026-10-14 the `pg_prove` container of `supabase test db` got
  stuck in `Created` even seconds after a clean restart while a plain `alpine` probe ran fine; the stack
  containers that were already `Up` kept serving. Use the host-side equivalents (§5 psql fallback,
  `gen types --db-url`) rather than restarting in a loop, and check Docker Desktop → Resources → File sharing
  includes the checkout's volume (this repo lives on an external disk, `/Volumes/SSD-1tb`), since the
  wedging containers are the ones that bind-mount it.
