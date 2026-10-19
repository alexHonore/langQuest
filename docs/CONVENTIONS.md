# LangQuest engineering conventions (read before touching any package)

LangQuest is a conversation-first, AI-native language-learning product that is **100% free to learners**.
Authoritative product spec: `docs/MASTER_SPEC.md`. This file fixes the cross-package conventions so that
independently written packages fit together.

## 1. Workspace layout and names

pnpm workspace (`node-linker=hoisted`), TypeScript strict, **no build step for libraries**: every
`packages/*` package exports TypeScript source directly (`"exports": {".": "./src/index.ts"}`), and
apps consume them as workspace deps (`"@langquest/x": "workspace:*"`).

| Path | Package | Role |
|---|---|---|
| `packages/contracts` | `@langquest/contracts` | Zod v4 schemas + TS types for API, DB rows, events, AI adapters, language catalog constants. **Single source of truth for shared types.** |
| `packages/db` | `@langquest/db` | Typed Supabase client factories, repositories, generated `Database` types, migration/seed runners. |
| `packages/curriculum` | `@langquest/curriculum` | Skills, intents, mission templates, FSRS-like scheduler, mastery state machine, next-mission planner. |
| `packages/ai` | `@langquest/ai` | OpenRouter `TextReasoner`, STT/TTS/realtime/pronunciation adapters, capability registry, model profiles, dialogue + evaluator orchestration, prompt templates. |
| `packages/locales` | `@langquest/locales` | ICU message catalogs (en, fr first; es, ru next), `LanguageContext`, RTL/script helpers, transliteration utilities. |
| `packages/ui` | `@langquest/ui` | Design tokens (light/dark/high-contrast), mascot + character SVG art, shared RN components. |
| `packages/media` | `@langquest/media` | Audio metadata extraction, content hashing, R2 object-key scheme, manifests, license gating logic. |
| `packages/telemetry` | `@langquest/telemetry` | Typed event schema, cost accounting, privacy redaction. |
| `apps/api` | `@langquest/api` | Cloudflare Worker (Hono) HTTP API — `/v1/*` routes from spec §6. |
| `apps/jobs` | `@langquest/jobs` | Node job runner (ffmpeg, transcription, alignment, imports); Postgres-backed queue by default, Cloudflare Queues optional. |
| `apps/admin` | `@langquest/admin` | Next.js 16 App Router private CMS. |
| `apps/mobile` | `@langquest/mobile` | Expo SDK 57 / Expo Router app (routes under `src/app/`). |
| `scripts` | `@langquest/scripts` | Importers (Tatoeba, corpora), bulk audio scan, license report, seed languages, coverage validation. |
| `tests` | `@langquest/tests` | Cross-cutting integration / security / e2e / load suites. |
| `supabase/migrations` | — | Ordered SQL migrations (`YYYYMMDDHHMMSS_name.sql`). |

Rules:
- Only edit files inside the directory you were assigned. If you need something from another package that
  does not exist yet, add a clearly named export to **your** package and note the gap in your report.
- Do **not** run `pnpm install` unless you must add a dependency; if you do, run it once, from the repo
  root, and retry once on a lockfile conflict. Most deps are pre-installed (see each `package.json`).
- Node ≥ 22, TypeScript ~5.9 (mobile uses Expo's pinned TS), Zod **v4** (`import { z } from 'zod'`), Vitest 4.
- Every package must pass `pnpm --filter <name> typecheck` and `pnpm --filter <name> test`.
- No secrets in code. Server-side env only: `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, R2 keys.
  Mobile/admin browser bundles get only `SUPABASE_URL` + anon/publishable key + API base URL.

## 2. Canonical identifiers

### 2.1 The 30 course tracks (slugs are stable, never rename)

| # | `course_track_id` | Display name | `target_variety_id` | language | default locale | scripts |
|---|---|---|---|---|---|---|
| 01 | `arabic-eastern` | Arabic (Eastern) | `ar-levant` | `ar` | `ar-SY` (regional selector: SY/LB/PS/JO) | Arab (+ Latn transliteration) |
| 02 | `arabic-moroccan` | Arabic (Moroccan) | `ary` | `ar` | `ar-MA` | Arab + Latn (Arabizi) |
| 03 | `arabic-egyptian` | Arabic (Egyptian) | `arz` | `ar` | `ar-EG` | Arab (+ Latn) |
| 04 | `arabic-msa` | Arabic (Modern Standard) | `arb` | `ar` | `ar` | Arab (+ Latn) |
| 05 | `chinese-cantonese` | Chinese (Cantonese) | `yue` | `zh` | `zh-HK` | Hant (+ Jyutping) |
| 06 | `chinese-mandarin` | Chinese (Mandarin) | `cmn` | `zh` | `zh-CN` | Hans default, Hant option, Pinyin |
| 07 | `chinese-simplified` | Chinese (Simplified) | `cmn` (shared Mandarin assets, `script_focus: 'Hans'`) | `zh` | `zh-CN` | Hans + Pinyin |
| 08 | `english` | English | `en` | `en` | `en-US` (GB option) | Latn |
| 09 | `danish` | Danish | `da` | `da` | `da-DK` | Latn |
| 10 | `french` | French | `fr` | `fr` | `fr-FR` (fr-CA option) | Latn |
| 11 | `german` | German | `de` | `de` | `de-DE` | Latn |
| 12 | `greek` | Greek | `el` | `el` | `el-GR` | Grek |
| 13 | `haitian-creole` | Haitian Creole | `ht` | `ht` | `ht-HT` | Latn |
| 14 | `hebrew` | Hebrew | `he` | `he` | `he-IL` | Hebr (+ Latn) |
| 15 | `hindi` | Hindi | `hi` | `hi` | `hi-IN` | Deva (+ Latn) |
| 16 | `italian` | Italian | `it` | `it` | `it-IT` | Latn |
| 17 | `japanese` | Japanese | `ja` | `ja` | `ja-JP` | Jpan (+ romaji, furigana) |
| 18 | `korean` | Korean | `ko` | `ko` | `ko-KR` | Kore (+ RR romanization) |
| 19 | `portuguese-brazilian` | Portuguese (Brazilian) | `pt-BR` | `pt` | `pt-BR` | Latn |
| 20 | `portuguese-european` | Portuguese (European) | `pt-PT` | `pt` | `pt-PT` | Latn |
| 21 | `romanian` | Romanian | `ro` | `ro` | `ro-RO` | Latn |
| 22 | `russian` | Russian | `ru` | `ru` | `ru-RU` | Cyrl (+ Latn) |
| 23 | `spanish-latin-american` | Spanish (Latin American) | `es-419` | `es` | `es-419` (regional voices e.g. es-MX) | Latn |
| 24 | `spanish-spain` | Spanish (Spain-Castilian) | `es-ES` | `es` | `es-ES` | Latn |
| 25 | `swahili` | Swahili | `sw` | `sw` | `sw-KE` / `sw-TZ` selector | Latn |
| 26 | `kinyarwanda` | Kinyarwanda | `rw` | `rw` | `rw-RW` | Latn |
| 27 | `swedish` | Swedish | `sv` | `sv` | `sv-SE` | Latn |
| 28 | `lingala` | Lingala | `ln` | `ln` | `ln-CD` | Latn |
| 29 | `ukrainian` | Ukrainian | `uk` | `uk` | `uk-UA` | Cyrl (+ Latn) |
| 30 | `vietnamese` | Vietnamese | `vi` | `vi` | `vi-VN` (north/south voice) | Latn |

### 2.2 Source (instruction) languages
`source_language_code` is an ISO-639-1 style code: `en`, `fr`, `es`, `ru`, `ar`, `zh`, `de`, `it`, `pt`,
`ja`, `ko`, `hi`, `he`, `el`, `da`, `sv`, `ro`, `uk`, `vi`, `sw`, `rw`, `ln`, `ht`. Production priority:
`en` → `fr` → `es`, `ru` → others. Every enrollment stores its own `source_language_code` (NOT NULL).
`course_source_localizations` records honest coverage per (track, source) and drives availability UI.

### 2.3 LanguageContext (passed to every mission/AI/audio/scoring call)
```ts
{ uiLocale: 'fr-CA', enrollmentId: 'uuid', sourceLanguage: 'fr', targetTrack: 'arabic-moroccan',
  targetVariety: 'ary', targetScriptMode: 'both' | 'native' | 'latin', regionalPreference?: 'Casablanca',
  learnerLevel: 'beginner' | 'elementary' | 'intermediate' | 'upper_intermediate' | 'advanced' }
```

### 2.4 Mastery states, content states, job states
- Mastery: `not_attempted | emerging | practiced | independent | durable`.
- Content publication: `imported_draft | metadata_needed | rights_unverified | transcription_pending | review_needed | approved | published | unpublished | rejected`.
- Processing jobs: `pending | running | succeeded | failed | review_needed`.
- Roles: `super_admin | admin | content_editor | language_reviewer | support_readonly` (learner has none).

## 3. API conventions (`apps/api`)
- Hono on Cloudflare Workers. Base path `/v1`. Auth: `Authorization: Bearer <Supabase access token>`;
  the Worker verifies the JWT (JWKS or `SUPABASE_JWT_SECRET`) and forwards it to supabase-js so **RLS stays
  in force** for learner routes. Admin routes additionally require a role from `user_roles` (server-verified).
- Response envelope: success `{ "ok": true, "data": ... }`; failure `{ "ok": false, "error": { "code": "...", "message": "...", "details"?: ... } }`.
  Error codes live in `@langquest/contracts` (`ApiErrorCode`). HTTP status mirrors the code class.
- All request/response bodies are validated with Zod schemas from `@langquest/contracts`.
- Idempotency: progress sync and XP use client event UUIDs; duplicates return the original result.
- Never return provider secrets or raw prompts to clients.

## 4. Database conventions (`supabase/migrations`, `packages/db`)
- Postgres 17 (Supabase). `snake_case`, `uuid` PKs (`gen_random_uuid()`), `created_at`/`updated_at timestamptz`.
- RLS enabled on **every** public table; owner policies on `user_id`; admin access via `public.has_role(text)`
  (reads `user_roles`). Catalog/content tables are readable when `published`, writable only by editors.
- Append-only ledgers (`xp_ledger`, `device_sync_events`) with unique idempotency keys.
- Migrations are plain SQL files `supabase/migrations/<timestamp>_<name>.sql`; seeds in `supabase/seed/*.sql`
  and typed seed scripts in `packages/db/src/seed`.
- Local dev: `pnpm supabase start` (Docker). Hosted: `supabase link` + `supabase db push`.

## 5. AI conventions (`packages/ai`)
- All LLM text calls go through `TextReasoner.generateStructured(task, languageContext, prompt, schema)` backed by
  OpenRouter (`https://openrouter.ai/api/v1/chat/completions`, OpenAI-compatible, `response_format` JSON schema,
  `models: [primary, ...fallbacks]` routing). Model IDs come from `ai_model_profiles` (task × variety × source),
  never hard-coded in UI.
- Capability registry: every adapter exposes `supports(...)` and a fallback **may not cross a variety boundary**
  (no ary→arb, yue→cmn, ht→fr, fr→en coaching).
- Pronunciation numeric scores only from a capable acoustic assessor; otherwise `numericScore: null`,
  `assessmentMode: 'reference-comparison'`, `confidence: 'limited'`.
- Two roles per conversation: character agent (fast, in-dialect) and evaluator (async, structured observations).

## 6. Mobile / admin UX conventions
- Mobile tabs: Home, Missions, Audio, Speak, Progress. Every screen shows active course + its source language with an edit affordance.
- Mascot (orbit-creature, original) states per spec §10.2A; `reduceMotion` + "mascot off" always respected.
- No paywalls, credits, tiers, or usage meters anywhere in UI copy or code.
- i18n via ICU catalogs in `@langquest/locales` (`t(key, vars)`), `en` complete, `fr` complete; RTL aware.

## 7. Testing
- Unit tests next to code: `src/**/*.test.ts` (Vitest). Integration/security/e2e under `tests/`.
- Tests must never call paid providers unless `LANGQUEST_LIVE_TESTS=1` is set; use recorded fixtures otherwise.
- Negative RLS tests are mandatory for every user-owned table.

## 8. Product rule (owner decision, 2026-10-19): visible means usable

- Never render "not available", "coming soon" or disabled placeholder features in the learner or admin apps. If a feature is not ready, it is not shown; it is listed in `docs/UPCOMING_FEATURES.md` with the condition that unlocks it.
- Capability differences between courses (missions, audio library, live conversation, pronunciation scoring, downloads, instruction-language coverage) are disclosed **before enrollment** in the enrollment wizard, as a plain list of what this course × instruction language does not have yet. After enrollment the app adapts: tabs, sections and controls that the enrollment cannot use are hidden, not greyed out.
- The spec's honesty rules still hold (no fabricated scores, no silent dialect/source substitution) but are expressed by omission plus the enrollment disclaimer, not by empty-state copy.
- Design directions, mascots and character styles are presented as declinations for owner approval before any build-out.
