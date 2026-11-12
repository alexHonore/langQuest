# LangQuest — conversation-first, AI-native language learning

**Free for every learner. No subscriptions, credits, paywalls or usage meters.**
Thirty selectable course tracks, each learnable *from* any supported instruction language (English first, French second),
built around listen → anticipate → speak → converse → remember loops with real AI conversation partners and an
owner-managed audio library.

Authoritative spec: [`docs/MASTER_SPEC.md`](docs/MASTER_SPEC.md) · Conventions: [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) ·
Decisions: [`docs/decisions/`](docs/decisions) · Provisioning: [`docs/runbooks/provisioning.md`](docs/runbooks/provisioning.md)

## Workspace

| Path | What |
|---|---|
| `apps/mobile` | Expo SDK 57 / Expo Router learner app (iOS, Android, web) |
| `apps/admin` | Next.js 16 private CMS (uploads, library, courses, AI models, rights, review, jobs, analytics) |
| `apps/api` | Cloudflare Worker (Hono) — `/v1/*` learner + admin API, signed media access, AI gateway |
| `apps/jobs` | Node job runner (ffmpeg, transcription, imports); Postgres-backed queue by default |
| `packages/*` | `contracts`, `db`, `curriculum`, `ai`, `locales`, `ui`, `media`, `telemetry` |
| `supabase/` | SQL migrations, RLS, catalog seed, local stack config |
| `scripts/` | importers (Tatoeba, corpora), bulk audio scan, license report, coverage validation |
| `tests/` | integration, security, e2e, load suites |

## Quick start

```bash
pnpm install
cp .env.example .env            # fill in secrets (never commit .env)
pnpm supabase start             # local Postgres/Auth/Studio via Docker
pnpm supabase db reset          # apply migrations + catalog seed
pnpm typecheck && pnpm test
pnpm dev:api                    # Worker on http://localhost:8787
pnpm dev:admin                  # CMS on http://localhost:3000
pnpm dev:mobile                 # Expo dev server
```

## Status (2026-10-20)

Requirement status (`docs/requirements-traceability.md`, 763 rows): 440 implemented_tested, 248 in_progress,
57 blocked_by_external_dependency, 18 not_started.

| Area | State | Evidence |
|---|---|---|
| Shared packages (contracts, db, curriculum, ai, locales, ui, media, telemetry) | implemented, unit-tested | `pnpm -r test` with the local stack on 2026-10-20: 2 245 passed, 6 live-only skips, 0 failures (`docs/evidence/test-run-2026-10-20.md`) |
| Database (17 migrations, RLS on every table, pgTAP suites, catalog + cast + curriculum seeds) | implemented, verified on the local Docker stack | `packages/db` stack tests, `supabase/tests/database/*.sql` |
| API Worker (106 contract routes, JWT + RLS forwarding, idempotent sync/XP, conversation pipeline, admin routes) | implemented, integration-tested locally; deployed to workers.dev | `docs/evidence/conversation-journey-2026-10-19.md`, `docs/evidence/capabilities-2026-10-19.md` |
| Admin CMS (all §7.1 sections, direct multipart uploads, Setup page) | implemented, built, browser-verified | `docs/evidence/screenshots/admin-*.jpg` |
| Mobile app (onboarding, enrollment with capability disclaimer, lessons, live conversation, pronunciation coach, audio library, progress, account) | implemented, web export + unit tests; native device QA pending | `docs/evidence/screenshots/mobile-web-*.jpg`, `docs/provider-matrix/mobile-audio-qa.md` |
| Jobs runner (ffmpeg, transcription, imports, content factory) | implemented, tested with fixtures + one live transcription | `docs/runbooks/jobs.md` |
| Data scripts (Tatoeba/Taskmaster importers, seeds, coverage validator, content factory CLI) | implemented, run against real exports | `docs/content-rights/dataset-attribution-inventory.md` |
| Content | chapters 1 to 4 of all 30 courses (22–25 missions each) as **draft** chapters with disclosure (not native-reviewed): chapter 1 — 4 hand-authored, 26 drafted by the content factory with French added (`import-factory-chapters`); chapters 2–4 — written per course in the authored format (`packages/curriculum/src/content/authored/`), from English and French; in the app bundle; the hosted database still holds the 4 hand-authored chapter 1s (publishing the rest, chapters 2–4 included, is an owner action: `seed-curriculum --apply`; until then the app keeps chapter-2 completions on the device and reports them once the server has the chapter); audio library empty | `docs/content-rights/native-review-process.md` |
| Visual identity | approved by the owner on 2026-10-19 and applied: M3 Melo chameleon mascot, C2 clay cast, U2 "Night Market" UI (UI/UX may still change; new directions are shown as declinations first) | `design/explorations/index.html`, commits `46feda5`, `0b03e6e` |

Learner-facing honesty rules in force: no numeric pronunciation score without an acoustic assessor; no silent dialect or
instruction-language substitution; per-course capability disclaimer before enrolling and no "not available" placeholders after
(`docs/CONVENTIONS.md` §8, `docs/UPCOMING_FEATURES.md`).

## External blockers (owner actions)

See `docs/runbooks/provisioning.md`: Cloudflare R2 is not enabled (media uploads, playback, downloads stay hidden), a hosted
Supabase project slot is needed (the org is at its free-project limit), Azure Speech credentials are optional for phoneme
scoring on supported locales, and every language track needs native-speaker review before its content can leave draft state.

## Documentation map

- `docs/requirements-traceability.md` — every spec requirement with status and evidence
- `docs/runbooks/` — developer setup, database, jobs, provisioning, admin manual, mobile release
- `docs/decisions/` — ADR-001…006
- `docs/provider-matrix/` — AI capability matrix per track, OpenRouter notes, Azure locales, provider setup and cost
- `docs/content-rights/` — dataset attribution inventory, native review process
- `docs/evidence/` — test runs, live journeys, screenshots, design renders

