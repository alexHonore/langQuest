# @langquest/tests — cross-cutting suites

Spec §14.1 (journeys), §14.3 (test classes), §11 (security), §4.6 (reliability), §5.5 (RLS invariants).

```
tests/
  vitest.config.ts        projects: integration | security | locales | audio | load
  src/harness/            stack detection, in-process API, users/tokens, content seeding (Seeder)
  src/fixtures/           prompt-injection fixtures
  integration/            A01–A07 enrollment/source-language journeys, manifest localization, A27 sync idempotency,
                          A17 reviews due (real scheduler), audio library published-only reads, mission evaluate loop,
                          A28 export + deletion with ledger rows present, conversation 409 turn_in_progress → same-clientTurnId
                          replay, audio progress PUT cross-device ordering (clientSentAt skew correction, migration 110)
  security/               A29 cross-account (API + negative RLS for every user-owned table), forged XP/mastery/outcomes,
                          every admin route vs anonymous/learner/support_readonly (closed over the mounted Hono routes, and the
                          library-structure routes with real ids), expired/forged tokens, prompt-injection fixtures through
                          guard/evaluator/API, A20 rights gate, signed-URL misuse (pseudonymous stream subject)
  locales/                en/fr parity + ICU validity, RTL/bidi helpers, 30-track labels and per-track keys
  audio/                  real ffmpeg/ffprobe fixture pipeline (probe, metadata, hashes, transcode/slow/clip, peaks)
  load/                   fetch-based load script (documented, never run in CI) + smoke test of its helpers
  e2e/                    Maestro mobile flows + README (admin Playwright lives in apps/admin/e2e)
```

## Running

```bash
pnpm --filter @langquest/tests test                 # all projects
pnpm --filter @langquest/tests test:security        # one project (also: test:integration, test:locales, test:audio)
pnpm --filter @langquest/tests test:require-stack   # fail (instead of skip) when the local stack is down
pnpm --filter @langquest/tests typecheck && pnpm --filter @langquest/tests lint
```

## How stack-bound suites work

- The local Supabase stack is detected with `@langquest/db` `detectLocalStack()` (`supabase status -o json`, or
  `SUPABASE_LOCAL_URL` / `SUPABASE_LOCAL_ANON_KEY` / `SUPABASE_LOCAL_SERVICE_ROLE_KEY` [+ `SUPABASE_LOCAL_JWT_SECRET`]).
- The Hono app is imported from `apps/api/src/app.ts` and driven with `app.request()` — **no network, no wrangler**.
  Env comes from the stack; `AI_SESSION_TICKET_SECRET` is a test constant; no OpenRouter key is passed, so AI routes
  answer with honest `capability_unsupported` (nothing is spent).
- Each suite creates its own isolated users through the GoTrue admin API (`tests-<label>-<uuid>@langquest.test`), signs
  them in for real tokens, seeds content with the service client through `Seeder` (tracked and deleted in reverse order
  in `afterAll`), and purges its users with the service-only `purge_test_user` RPC (migration 100): it runs
  `delete_account` under the append-only bypass, so learners with XP / observation / sync ledger rows are removed cleanly;
  the RPC refuses any e-mail outside `@langquest.test`, and a user the suite already deleted through `DELETE /v1/me` is skipped.
- Missing stack → the suite **skips with an explicit warning**; `LANGQUEST_REQUIRE_STACK=1` turns that into a failure.
  Missing `ffmpeg` is handled the same way by the audio project.
- Nothing here calls a paid provider. Live tests (OpenRouter) live in `apps/api/src/__tests__/live` behind
  `LANGQUEST_LIVE_TESTS=1`.

## Conventions

- Assertions prefer the contracts schemas (`MissionEvaluateResponseSchema.parse(...)`) over ad-hoc shapes.
- Negative tests assert the *absence* of effects in the database (ledger rows, enrollment columns), not just status codes.
- No fake data: fixtures are rendered with ffmpeg, content is seeded as drafts/published rows with `nativeReviewed: false`.
