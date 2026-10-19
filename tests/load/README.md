# Load script — manifest and sync traffic classes

Spec §4.6 separates traffic classes; §14.3 asks for Worker API p95 evidence **without asserting capacity we have not
measured**. This script produces that evidence for the two cheapest, highest-volume learner routes:

| Route | Class | Why |
|---|---|---|
| `GET /v1/courses/:trackId/manifest?source=` | static catalog (edge-cached, ETag/304) | one request per app start / course switch |
| `POST /v1/me/progress/sync` | lightweight idempotent progress writes | batched offline-first sync |

It is **fetch-based** (no `autocannon` in the workspace), runs N concurrent workers for a fixed duration, and prints a
JSON report with per-route p50/p95/p99, status mix, `X-Cache` hits and error rate. **It is not run in CI**; only the
pure helpers have a smoke test (`load.smoke.test.ts`, project `load`).

## Running against `wrangler dev`

```bash
# 1. local stack + API
pnpm supabase start
cp apps/api/.dev.vars.example apps/api/.dev.vars   # SUPABASE_URL/ANON/SERVICE keys from `pnpm supabase status -o json`
pnpm dev:api                                         # http://localhost:8787

# 2. a learner token + an enrollment on that stack (any signed-in learner; e.g. from the mobile app's debug screen,
#    or create one with the integration harness helpers / supabase-js signInWithPassword)
export LOAD_TOKEN=eyJ...            # learner access token (NEVER a service key)
export LOAD_ENROLLMENT_ID=<uuid>    # an enrollment owned by that learner (needed when LOAD_SYNC_SHARE > 0)

# 3. run
pnpm --filter @langquest/tests load -- --base-url=http://localhost:8787 --track=arabic-moroccan --source=fr \
  --concurrency=16 --duration=30 --sync-share=0.3 > load-report.json
```

Knobs (env `LOAD_*` or `--flag=value`; flags win):

| Flag | Env | Default | Meaning |
|---|---|---|---|
| `--base-url` | `LOAD_BASE_URL` | `http://localhost:8787` | API origin (`wrangler dev` or a deployment) |
| `--token` | `LOAD_TOKEN` | — | learner access token (required) |
| `--enrollment` | `LOAD_ENROLLMENT_ID` | — | owned enrollment for sync events |
| `--track` / `--source` | `LOAD_TRACK` / `LOAD_SOURCE` | `arabic-moroccan` / `fr` | manifest pair |
| `--concurrency` | `LOAD_CONCURRENCY` | 8 (max 512) | parallel workers |
| `--duration` | `LOAD_DURATION_S` | 20 | measured seconds (after warm-up) |
| `--sync-share` | `LOAD_SYNC_SHARE` | 0.3 | fraction of requests that are sync POSTs |
| `--warmup` | `LOAD_WARMUP_S` | 2 | seconds discarded before measuring |

Exit code 1 when any route's error rate (network errors + 5xx) exceeds 5 %.

## Reading the report

- `manifest.cacheHits` close to `manifest.count` after the first request means the edge cache + ETag path works; p50
  should be a few milliseconds locally.
- `sync` statuses should be all `200`; the events are `enrollment_opened` + `activity_minutes`, idempotent per client
  event id, so repeated runs do not inflate XP (XP claims are deliberately not part of the load mix).
- Rate limiting: learner routes share the per-IP abuse buckets; a local run from one IP with high concurrency will hit
  `429` — that is the control working, not a capacity limit. Lower `--concurrency` or spread clients.
- Never quote these numbers as production capacity (§14.3); they are local evidence under stated conditions.
