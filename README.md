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

_Sections below are completed at the end of the build: status matrix, acceptance evidence, known blockers._
