# LangQuest handoff

- **Date:** 2026-10-20 (first written 00:46; refreshed about 07:00 after the device QA pass and the owner-free backlog rounds)
- **Pinned to:** commit `c4c27f8` on `master`, clean working tree at the time of writing (the Device QA session may add commits; check `git log`)
- **Audience:** a new Claude Code session with no memory of earlier conversations
- **Rule for this file:** every fact here was checked against repo files or command output on 2026-10-20. Items marked **UNVERIFIED** were not. Cells marked **session output** come from 2026-10-20 command runs whose output is not saved in the repo.

---

## 1. Start here

Paste this into a new session:

```text
You are continuing work on LangQuest, at /Volumes/SSD-1tb/LangQuest. LangQuest is a free,
conversation-first, AI-native language-learning product. It is a pnpm/Turbo monorepo:
an Expo learner app, a Next.js admin "Studio", a Cloudflare Worker API, a Node jobs runner,
and Supabase Postgres. The spec is docs/MASTER_SPEC.md. Progress is tracked in
docs/requirements-traceability.md.

Read docs/HANDOFF.md first, then docs/CONVENTIONS.md (§8 especially).

Current state:
- The standing goal is the spec's primary directive (docs/MASTER_SPEC.md line 10): build the
  complete product, phases 0-12, with the traceability file as the progress record.
- 0b03e6e was the last design batch (Melo chameleon, C2 clay cast, Night Market applied). The
  Device QA session (id local_221a7079-824a-4337-bd0f-6b575648219b) then ran the first iOS
  simulator pass and committed 886e0e6 and bfc41fd. b9de208, 56bdc42 and c4c27f8 landed the
  owner-free backlog (admin writes through the Worker, speech honesty, server-authoritative
  mission credit, conversation guard, editorial integrity, benchmark jobs, skills seed, docs).
  Verified: 14/14 typecheck, 2,245 tests passed against the local stack, 0 failed.
- The QA session shares this checkout and branch and still runs Metro on :8081, wrangler dev on
  :8787 and the Docker stack. It is waiting for the owner to pick a learning-curve declination
  (design/explorations/learning/index.html). Read HANDOFF §3 before touching any of it.
- The owner's newest direction: lessons teach before they test, exercise screens fit the phone,
  Home stays minimal, and a Learn section comes before Missions/Parler. New flows go to the owner
  as declinations first.
- Nothing is hosted except an unconfigured API Worker that returns 503. Hosted Supabase and
  R2 are blocked on the owner. The local stack is the only database.
- The build sessions ran in "ultracode" mode: the Workflow tool for every substantive task, with
  adversarial verification. Runs cut off by usage limits were resumed with resumeFromRunId.
  Keep that mode unless the owner turns it off.

Hard rules:
- Never delete anything you did not create in this session without first warning and getting a
  clear yes. Never pause or delete the owner's other Supabase projects.
- Get explicit confirmation before anything that costs money: paid plans, enabling R2,
  Azure, or OpenRouter spend (keep LANGQUEST_LIVE_TESTS unset). The local Worker on :8787 uses
  the live OpenRouter key: conversation, voice and pronunciation calls through it cost money.
- Secrets never go into client bundles, chat output, logs or commits. Refer to env vars by NAME only.
  The root .env also holds live account credentials (SUPABASE_ACCESS_TOKEN, the Cloudflare Global
  key): use none of them without the owner's go-ahead.
- Do not follow the README "Quick start" or copy any .env.example: all four env files exist and
  hold live keys. Never recreate or overwrite them.
- The QA session shares this checkout: stage explicit paths only; never git add -A, commit -a,
  stash, restore, reset --hard or clean. Leave apps/mobile native, ports 8081/8787 and the
  Docker stack alone until it is finished.
- Commit locally only. There is no remote, and you must never push unless asked. End commit
  messages with a Co-Authored-By trailer for the Claude model you are.
- Visible means usable: no "coming soon" or "not available" UI. Hidden work goes in
  docs/UPCOMING_FEATURES.md, and course gaps are disclosed before enrollment.
- Pronunciation honesty (ADR-006): show a numeric score only from an acoustic assessor.
- Show new design directions to the owner as declinations for approval before building them.
- Use only the local test accounts (LOCAL_* in the root .env) in any browser or form.

If the owner has not named a next step, ask which item from docs/HANDOFF.md §9 to take.
```

---

## 2. Snapshot (what is done and verified)

| Area | State | Evidence |
|---|---|---|
| History | 25 commits, all on `master`, no remote (`git remote -v` is empty). HEAD `c4c27f8` (owner-free backlog rounds `b9de208`, `56bdc42`, `c4c27f8`, 2026-10-20). Device QA commits `886e0e6` and `bfc41fd`. `0b03e6e` was the last design batch | `git log --oneline` |
| Typecheck / lint | 14/14 packages typecheck. Lint 14/14, 1 known warning (`scripts/src/seed-curriculum.ts` `seedTitle` unused) | integration run before `c4de208` (commit message, traceability header) |
| Full test suite | **2,245 passed, 6 live-only skipped, 0 failed** (231 files) with `LANGQUEST_REQUIRE_LOCAL_STACK=1 LANGQUEST_REQUIRE_STACK=1 pnpm -r --workspace-concurrency=1 test`. pgTAP 6 files / 271 tests. Admin `next build` and mobile `export:web` pass. Earlier baselines 2,184, 2,076, 1,706 | `docs/evidence/test-run-2026-10-20.md` (all four 2026-10-20 runs, row counts, leftovers) |
| Traceability (763 rows, recount = header) | 440 implemented_tested, 248 in_progress, 57 blocked, 18 not_started | `docs/requirements-traceability.md`, awk recount in §9 |
| Admin | All Studio writes go through Worker `/v1/admin/*` routes. The only Next handlers left are `app/api/auth/signout` and `app/api/locale`. 57 direct reads remain under the staff JWT and RLS | `packages/contracts/src/api/admin-studio.ts`, `apps/api/src/routes/admin/{editorial,jobs,users,model-test}.ts`, `docs/runbooks/admin-manual.md` §0 |
| API docs | Generated OpenAPI 3.1: 92 paths, 108 operations. Regenerate with `pnpm --filter @langquest/scripts exec tsx src/generate-openapi.ts` (`--check` in CI style) | `docs/api/README.md`, `docs/api/openapi.json` |
| Speech honesty | STT results carry a speech-detection verdict (no_speech_prob, logprob, curated Whisper silence hallucinations). No-speech attempts are never graded "understood" and earn no XP or skill credit. Caller-supplied audio URLs are refused (422) on transcribe, pronunciation and conversation turns | `packages/ai/src/speech/*`, `apps/api/src/__tests__/unit/speech-honesty*.test.ts` |
| Design | M3 Melo (17 states), C2 cast (97 characters), U2 Night Market tokens, calm density, app icon. Home is minimal and lesson steps fit the screen (`bfc41fd`) | commits `46feda5`, `0b03e6e`, `bfc41fd` |
| Locales | en and fr complete (1,571 keys). es and ru partial (12.22%) | `packages/locales/src/catalogs/coverage.json` |
| Local DB | 30 course_tracks, 97 characters, 203 missions (21 published), 62 skills (en/fr names), 2 auth users (`LOCAL_*`), one `super_admin`, the learner's arabic-moroccan/fr enrollment. `seed-curriculum -- --apply` was re-run 2026-10-20 | read-only psql after the integration run |
| Content | 4 flagship draft chapters published with disclosure (Darija fr/en, es-ES en, ja en, en fr/ru). Nothing is native-reviewed | `scripts/src/seed-curriculum.ts` |
| Device | First iOS simulator pass done on iPhone 17 / iOS 27.0 (dev client, local stack, real Nadia conversation for $0.037). Android, a physical iPhone, background/lock-screen audio and Maestro flows are not run | `docs/evidence/device-qa-2026-10-19.md`, `docs/provider-matrix/mobile-audio-qa.md`, `device-ios-*` screenshots |
| Hosted | Worker `langquest-api.langquest-nsh.workers.dev` answers **503 `provider_unavailable`** (no secrets). No hosted Supabase, no R2, admin not deployed, no EAS build | §8 |
| CI | `.github/workflows/ci.yml` exists but **has never run** (no remote; it also triggers on `main` while the branch is `master`) | §11 |

---

## 3. In-flight work

**Device QA session** ("Device QA: iOS Simulator dev build of the mobile app", id `local_221a7079-824a-4337-bd0f-6b575648219b`). It shares **this checkout and branch**.
- **Done:** `886e0e6` (iOS 27 UIScene config plugin, so the app launches) and `bfc41fd` (fit-to-screen lessons, minimal Home, Hermes Intl polyfills, a settings data-loss fix in contracts `patchOf`, a11y fixes, focus refetch, evidence doc and screenshots).
- **Waiting on the owner:** its last question was "Which learning-curve options should I build?". The declinations are in `design/explorations/learning/index.html` (L1-L3 lesson flows × N1-N3 navigation, including the Learn section). It suggested **L1 + L3 inside N2**. Nothing is built yet. The owner answers in that session; do not build any of it elsewhere without the owner's pick.
- **Still running (as of 2026-10-20 ~07:00):** its Metro (`expo start --dev-client`, :8081), `wrangler dev` (:8787, restarted by that session at 06:02), the simulator log stream, and the Docker stack. Leave them alone; do not stop, restart or kill them.
- It proposed a separate session for the Whisper "understood on silence" defect. The server side of that is now fixed (`b9de208`, `56bdc42`). Only the mobile half remains (send `recording.peakLevelDb`, §9).

**Owner direction from the device walkthrough** (memory note `feedback-teach-before-test`, 2026-10-20):
- Lessons teach before they test: an immersive moment comes first (animation, the character speaking, a short audio mini-lesson), then practice, on a real learning curve.
- Lesson and exercise screens fit the phone with no scrolling or overflow (done in `bfc41fd`).
- Home is minimal: no greeting heading, no coverage chip, no quick-speak (done in `bfc41fd`).
- A **Learn** section (audio, text, lessons, mini-games) comes before Missions and Parler, which stay. This is the pending declination choice above.

**Before you touch mobile, the local stack, :8081 or :8787:**
1. Read the QA session's latest result (desktop session tools such as `get_session`/`list_events` with the id above, if your session has them) or ask the owner. Never stop, archive, clear or message the QA session, and never kill its processes.
2. Run read-only checks:
   ```bash
   git -C /Volumes/SSD-1tb/LangQuest status --short
   git -C /Volumes/SSD-1tb/LangQuest log --oneline -5
   ps aux | grep -E 'expo (run:ios|start)|xcodebuild|wrangler|workerd|pod install|simctl' | grep -v grep
   lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(8081|8787|54321|54322)\b'
   ```
3. The shared `wrangler dev` hot-reloads `apps/api` **and the packages it imports** on every save. A half-written edit in `packages/contracts` crashed it once on 2026-10-20 ("UuidSchema is not defined"). Write complete files, register routes last, and typecheck right after each change.
4. While its processes run, do not run expo, pod, xcodebuild, simctl, `supabase start/stop/reset`, a Docker restart or screenshot captures. Stack-bound suites and seeds were run on 2026-10-20 while that session was idle; they clean up their users, but see §11 for the rows they leave.
5. `apps/mobile/ios/` is generated (CNG) and gitignored: never hand-edit or commit it. The `ios`/`android` scripts now run `expo run:*` (Expo CLI rewrote them, committed in `886e0e6`); whether to keep that is the owner's call.

---

## 4. Hard rules (the owner's standing rules)

| Rule | What it means in practice |
|---|---|
| No deletes without warning | Do not delete anything you did not create in the same session (files, rows, projects, workflows) until you have warned and got a clear yes. **Never pause or delete the Supabase projects "MAA" or "Tayoo's Project".** Freeing a slot is the owner's call. |
| Confirm before any cost | Get explicit confirmation before Supabase Pro ($25/mo), enabling R2 (needs a payment method), Workers Paid/Queues ($5/mo), Azure Speech, or any OpenRouter spend (content factory, fixture suites, benchmarks, `LANGQUEST_LIVE_TESTS=1`). The OpenRouter key has a $50/month budget (`docs/provider-matrix/provider-setup-and-cost.md`). **The local Worker on :8787 is not a sandbox**: `apps/api/.dev.vars` carries the live `OPENROUTER_API_KEY`, so every conversation session, voice turn or pronunciation check sent through it (simulator, web app, curl or a capture script) is a real call. The 2026-10-19 journey made 4 calls for $0.0317 (`docs/evidence/conversation-journey-2026-10-19.md`). Get the owner's OK before driving those flows and record the spend from `ai_requests` in the evidence file. API unit tests use a fake reasoner (`apps/api/src/__tests__/harness.ts:234`) and spend nothing. |
| Secrets | Secrets go only in the gitignored env files. Browser and mobile bundles get only the Supabase URL, the anon key and the API base (CONVENTIONS §1). Never print values in chat or logs. Never commit them. CI greps for `sk-or-v1-`, `sbp_`, `AKIA`, `re_`. |
| Local commits only | There is no remote. Never push unless asked. Commit messages end with `Co-Authored-By: <Claude model> <noreply@anthropic.com>`. The build sessions committed each finished, verified batch locally as part of the owner's "build the spec" request. Commit with an explicit pathspec (`git commit -m … -- <paths>`) so nothing another session staged rides along. |
| Shared checkout | The QA session uses this same checkout and branch. Stage only the paths you changed (`git add <path>…`). Never run `git add -A`/`git add .`, `git commit -a`, `git stash`, `git checkout -- …`/`git restore`, `git reset --hard` or `git clean`: they would sweep in, hide or delete the QA session's uncommitted fixes, its screenshots and the untracked `docs/HANDOFF.md`. Run `git status --short` before every commit and leave files you did not change alone. |
| Visible means usable (CONVENTIONS §8) | No "not available", "coming soon" or disabled placeholders. Hidden features are listed in `docs/UPCOMING_FEATURES.md` with their unlock condition. Course gaps are disclosed in the enrollment-wizard disclaimer, then hidden (mobile tabs use `href: null`). |
| Pronunciation honesty (ADR-006) | Only `acoustic-assessor` mode may carry `numericScore`. Every other mode goes through `referenceComparisonAssessment()` (score `null`, confidence `limited`). Never put an LLM in charge of a score. Never fall back across a variety boundary (no ary->arb, yue->cmn, ht->fr). |
| Design declinations first | The approved direction is M3/C2/U2 (2026-10-19), but the owner said UI/UX may still change. Show any new learner-facing design or direction as declinations and get approval before building it. |
| Test accounts only | In browsers and forms use only `LOCAL_ADMIN_*` / `LOCAL_LEARNER_*` (root `.env`). Lesson learned: a browser sign-up once autofilled the owner's real email into the local DB, and it had to be removed. |
| Free to learners | No paywalls, credits or usage meters (CONVENTIONS §6). Rate limits are abuse guards for operators only. |

---

## 5. Run it locally

**Do NOT follow the README "Quick start" or the `docs/runbooks/developer-setup.md` §2 copy block in this checkout.**
- `cp .env.example .env` and `cp apps/api/.dev.vars.example apps/api/.dev.vars` overwrite the live gitignored env files. The root `.env` holds the owner's provider keys and the repo's only copy of the `LOCAL_*` test credentials (they appear in no other repo file), and `.dev.vars` feeds the running wrangler dev.
- `pnpm supabase db reset` wipes the local DB the QA session is using, and `pnpm test` (turbo, parallel) writes to it.
- All four env files already exist: never recreate or overwrite them. If one is damaged, stop and ask the owner (per the earlier sessions' memory note, the root `.env` mirrors the owner's own credentials file outside the repo; do not go looking for it).
- The commands below are for a fresh machine. While §3's probe shows the QA session's processes, skip `pnpm install`, `local:start`, `seed-* -- --apply`, `pnpm dev:api` and `mobile web`.

**Toolchain:** Node >=22 (local v24.12.0), pnpm 10.26.1 (`packageManager`), Docker Desktop, ffmpeg/ffprobe, bzip2. The Supabase CLI is **not global**: always use `pnpm supabase …` (pinned 2.121.0). Maestro is not installed.

```bash
pnpm install                                   # CI uses --frozen-lockfile
pnpm --filter @langquest/db local:start        # supabase start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor
pnpm --filter @langquest/scripts seed-languages
pnpm --filter @langquest/scripts seed-curriculum -- --dry-run   # then -- --apply (writes the local DB)
pnpm dev:api                                   # wrangler dev -> http://localhost:8787 (GET /healthz)
pnpm dev:admin                                 # next dev -> http://localhost:3000
pnpm --filter @langquest/mobile web            # expo start --web (launch.json "mobile-web" uses --port 8081)
pnpm --filter @langquest/mobile export:web     # static web build -> apps/mobile/dist
```

Native dev build: `cd apps/mobile && npx expo run:ios`. Do not run it while the QA session is active (§3): it regenerates `apps/mobile/ios`. Native work needs `expo-dev-client` and bundle id `org.langquest.app`. Use `npx expo install` to add dependencies and `npx eas-cli@latest` for EAS.

Jobs: `pnpm dev:jobs`. It does **not** auto-detect the stack: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be exported in the shell, and they are empty in the root `.env`.

| Port | Service |
|---|---|
| 54321 | Supabase API (Kong) |
| 54322 | Postgres (local default credentials, `docs/runbooks/database.md`) |
| 54323 | Studio (enabled in `supabase/config.toml` and not in the `-x` list, but not running in the current stack) |
| 54324 | Mailpit/inbucket |
| 8787 | API Worker (`wrangler dev`); held by the QA session while it runs |
| 3000 / 3100 / 3011 | admin dev / admin Playwright / admin prod build for captures |
| 8081 | Metro. Held by the QA session's `expo start --dev-client --port 8081` while it runs (observed 2026-10-20), so do not start Expo web on 8081 then (use `--port 8082`) |
| 8911 | design gallery (`.claude/launch.json` "gallery") |
| 8921 / 8922 | SPA capture server (after / baseline) |

**Env files (gitignored, names only):**

| File | Read by | Key names |
|---|---|---|
| `.env` (root) | jobs, scripts, db seed | `OPENROUTER_API_KEY` (live, so never set `LANGQUEST_LIVE_TESTS`), `LOCAL_ADMIN_EMAIL/PASSWORD`, `LOCAL_LEARNER_EMAIL/PASSWORD`. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF` and the `R2_*` keys are empty. Unused provider keys: Gemini, AWS, Twilio, Hostinger, Resend. **Live account credentials:** `SUPABASE_ACCESS_TOKEN` (set) is a management token for the owner's Supabase org (the one holding "MAA" and "Tayoo's Project"); the CLI accepts it in place of `supabase login` (`database.md` §6), so `pnpm supabase projects …`, `pnpm supabase link` and `pnpm --filter @langquest/db migrate` (`supabase db push`) would act on real projects. `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` + `CLOUDFLARE_ACCOUNT_ID` form the account's Global API key, which can `wrangler deploy` over the live Worker. Without the owner's explicit go-ahead use none of them, and no hosted Supabase/Cloudflare/Vercel connector either. The repo is not linked (`supabase/.temp` has no `project-ref`): keep it that way. |
| `apps/api/.dev.vars` | wrangler dev | `SUPABASE_URL` (local), `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `OPENROUTER_API_KEY` (live), `AI_SESSION_TICKET_SECRET`, `CORS_ALLOWED_ORIGINS`, `JOBS_BACKEND=postgres`, `LOG_LEVEL`, `API_ENV=development` |
| `apps/admin/.env.local` | Next admin | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL`, `ADMIN_E2E_*` (those users do **not** exist in local `auth.users`) |
| `apps/mobile/.env` | Expo | `EXPO_PUBLIC_SUPABASE_URL` (127.0.0.1:54321), `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL` (localhost:8787). Optional flags: `EXPO_PUBLIC_MASCOT_RIVE`, `EXPO_PUBLIC_OAUTH_PROVIDERS`, `EXPO_PUBLIC_APP_VERSION` |

**Accounts** (read-only psql, 2026-10-20 01:05):
- `LOCAL_ADMIN_*` holds the only `super_admin` row in `public.user_roles`.
- `LOCAL_LEARNER_*` has one active enrollment, `arabic-moroccan` with source `fr`. Both local profiles have `ui_locale` `fr-CA`, so the app opens in French (`device-ios-02b-home-fr-light.png`).
- Sign-up is on and email confirmation is off (`supabase/config.toml`).
- Test-suite users are `tests-<label>-<uuid>@langquest.test` (`tests/src/harness/users.ts:30`) and are purged by id with `purge_test_user` (migration 100). The `LOCAL_*` and `ADMIN_E2E_*` accounts share the `@langquest.test` domain, so never purge by domain.
- To re-check without writing: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -At -c "begin read only; select count(*) from auth.users; select role, count(*) from public.user_roles group by 1; rollback;"`

---

## 6. Repo map

| Path | Package | Purpose | Start reading at |
|---|---|---|---|
| `apps/api` | `@langquest/api` | Cloudflare Worker (Hono), `/v1/*`, JWT forwarded so RLS applies, fail-closed 503 on bad config | `src/index.ts`, `src/app.ts`, `wrangler.toml` |
| `apps/admin` | `@langquest/admin` | Next.js 16 Studio CMS (uploads, chapters, rights, AI models, jobs, setup) | `proxy.ts`, `app/(studio)/layout.tsx`, `src/lib/setup/status.ts` |
| `apps/mobile` | `@langquest/mobile` | Expo SDK 57 / Expo Router learner app (iOS, Android, web). `plugins/` holds the iOS scene-lifecycle config plugin | `src/app/_layout.tsx`, `src/app/(tabs)/_layout.tsx`, `src/lib/api/client.ts` |
| `apps/jobs` | `@langquest/jobs` | Node job runner (ffmpeg, transcription, imports, content generation). Postgres queue by default | `src/main.ts`, `src/handlers/index.ts` |
| `packages/contracts` | `@langquest/contracts` | Zod v4 schemas. Single source of truth for types and the catalog | `src/catalog.ts`, `src/enums.ts`, `src/api/*` |
| `packages/db` | `@langquest/db` | Supabase clients, repositories, generated types, seed generators | `src/client.ts`, `src/seed/*`, `src/local-stack.ts` |
| `packages/curriculum` | `@langquest/curriculum` | Skills, intents, missions, casting, FSRS scheduler, draft content | `src/missions/{blueprint,casting,story}.ts`, `src/content/*` |
| `packages/ai` | `@langquest/ai` | OpenRouter reasoner, STT/TTS/pronunciation, capability registry, prompts | `src/reasoner.ts`, `src/capability/*`, `src/profiles.ts` |
| `packages/locales` | `@langquest/locales` | ICU catalogs en/fr/es/ru, coverage, RTL | `src/catalogs/*` |
| `packages/ui` | `@langquest/ui` | Tokens, theme, art (mascot, cast, covers, scenes), RN components | `src/tokens/*`, `src/theme/*`, `src/art/*` |
| `packages/media`, `packages/telemetry` | — | R2 keys, manifests, rights gating / typed events, cost, redaction | `src/*.ts` |
| `supabase/` | — | 17 migrations (000 to 161; 160 is the conversation session guard, 161 the atomic mission credit), pgTAP tests, `config.toml`, `seed/000_local_dev.sql` | `migrations/` |
| `scripts/` | `@langquest/scripts` | Importers, seed-languages, seed-curriculum, content-factory, coverage validator | `scripts/README.md` |
| `tests/` | `@langquest/tests` | Cross-cutting Vitest projects (integration, security, locales, audio, load); 6 Maestro flows plus 3 shared sub-flows | `tests/README.md`, `tests/e2e/README.md`, `src/harness/*` |
| `design/explorations/` | — | Declinations gallery (M1-M5, C1-C4, U1-U4). Approved: `mascots/M3`, `characters/C2`, `ui/U2` | `index.html` |
| `assets/` | — | Generated art: `mascot/`, `characters/` (97), `covers/` (30), `scenes/`, `icons/`, `art-manifest.json` | regenerated by `export-art` |
| `docs/`, `infra/cloudflare/`, `data/`, `.github/workflows/ci.yml` | — | Spec and docs, infra notes, datasets (`raw/` gitignored), CI | §12 |

Libraries have no build step. Each package exports its TS source and is consumed as `workspace:*`.

---

## 7. Design system

The approved direction (2026-10-19) is **M3 Melo** chameleon, **C2** clay cast and **U2 "Night Market"** (dark first, glass cards, per-course lantern glow, calm text density). Screens read only `useTheme()`, so a swap is a token or art edit. The full guide is `docs/design/design-system.md` (§8 is the swap table).

| Change | Edit |
|---|---|
| Palette (dark/light/high contrast) | `packages/ui/src/tokens/color.ts` (keep the token names), `contrast.ts` |
| Dark-first default, density default | `packages/ui/src/theme/resolve.ts` |
| Glass, glow, motion, text budget | `packages/ui/src/tokens/layout.ts` |
| Lanterns | `packages/ui/src/components/Lanterns.tsx` (`BLOBS`) |
| Course and lesson tint | `packages/ui/src/tokens/accent.ts` (`courseAccent`, `LESSON_ACCENTS`) + `src/art/covers.ts` (`COVER_RECIPES`) |
| Mascot tint per state and course family | `packages/ui/src/art/mascot/tint.ts` |
| Type | `packages/ui/src/tokens/typography.ts` |
| Cast, roles, scenes, covers | `packages/ui/src/art/characters/{roster/*,situations.ts}`, `packages/curriculum/src/missions/casting.ts`, `src/art/**` |
| Mobile wiring | `apps/mobile/src/components/{Melo,CourseAccentScope}.tsx` |
| Admin (CSS variables, defaults to **light**) | `apps/admin/src/lib/visual/theme.ts` -> `app/globals.css` |

To regenerate art:
```bash
pnpm --filter @langquest/ui export-art          # assets/* + art-manifest.json (-- --only mascot,icons)
pnpm --filter @langquest/ui lottie              # mascot Lottie clips
pnpm --filter @langquest/db seed:characters-sql # cast SQL: regenerates migration 140 in place, then seed-curriculum -- --apply
```

`seed:characters-sql` rewrites `supabase/migrations/20261019180000_140_seed_cast_v2.sql` by default (`packages/db/src/seed/write-characters-sql.ts`), and `characters-sql.test.ts` requires 140 to match the generator. A DB that already applied 140 (local after first boot, hosted after `db push`) will not re-run it. To ship a roster change there, also write the same SQL as a new migration: `pnpm --filter @langquest/db seed:characters-sql ../../supabase/migrations/<timestamp>_150_seed_cast_v3.sql` (the path is relative to `packages/db`; the SQL is an idempotent upsert on `character_key`). Locally, `local:reset` also works, but ask first (§11).

To check a swap: run `pnpm --filter @langquest/ui test`, then `pnpm --filter @langquest/ui typecheck`, then capture dark/light screens (§10) and update the doc.

Other design facts:
- The Rive rig `melo.riv` is **not committed** (`docs/design/mascot-rive-spec.md`). Static SVG and Lottie are what ships.
- The gallery is also published as the private artifact "LangQuest Art Direction Review" (https://claude.ai/artifact/S9HT7ykuL9PFqJSYoQAitZ).

---

## 8. Owner-gated blockers

Row counts are from `docs/requirements-traceability.md` (status column + Blocker column, recounted 2026-10-20).

| Key | Exact owner action | What it unlocks | Cost |
|---|---|---|---|
| B-SUPABASE | Free a free-project slot (the owner's choice; Claude must not do it) or upgrade to Pro. Then `pnpm supabase login`, `pnpm supabase link --project-ref <ref>`, `pnpm db:migrate`. Insert the first `super_admin`. Then, with the hosted `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exported and `LANGQUEST_DB_TARGET=hosted`, run `pnpm --filter @langquest/scripts seed-languages -- --database-url <hosted db url>` and then `pnpm --filter @langquest/scripts seed-curriculum -- --apply`. Without `--database-url` (or `DATABASE_URL`), seed-languages falls back to the local stack; without `LANGQUEST_DB_TARGET=hosted`, seed-curriculum ignores a non-local `SUPABASE_URL` and does too (`scripts/src/lib/db.ts:28-31`, `scripts/src/seed-languages.ts:73`). The seed sets flagship coverage to partial itself. | Hosted DB. Lets the Worker go out of 503. Unblocks R-13.0-15 and 4 in_progress rows | $25/mo if Pro |
| Worker secrets | From `apps/api`: `npx wrangler secret put` for `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `AI_SESSION_TICKET_SECRET` (optional: `SUPABASE_JWT_SECRET`, `LEARNER_PSEUDONYM_SALT`, `MEDIA_STREAM_SECRET`). Then `npx wrangler deploy --env production` | A live hosted API. Push migration 120 first | none |
| B-CF-TOKEN | Create a scoped `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, R2:Edit, Queues:Edit). The root `.env` holds only the Global key | Safer deploys | none |
| B-R2 | Dashboard -> R2 -> Enable (needs a payment method). Create buckets `langquest-media` (private) and `langquest-public` plus an API token. Set the `R2_*` Worker secrets, and set CORS to expose `ETag` | 21 blocked rows cite B-R2 (18 as the primary blocker), plus 29 in_progress rows. Uploads, playback URLs, offline downloads | free up to 10 GB-month, then $0.015/GB-month |
| Admin deploy | `cd apps/admin && vercel deploy` (or any Node host) with the 3 `NEXT_PUBLIC_*` vars. Update `CORS_ALLOWED_ORIGINS` if the domain differs | Hosted Studio | host-dependent |
| Mobile build | `npx eas-cli@latest init` (there is no `projectId` in `app.json`), then `eas build` with the 3 `EXPO_PUBLIC_*` vars | Store and internal builds | EAS plan |
| B-NATIVE / B-LICENSE / B-RIGHTS | Contract native reviewers, supply licensed recordings, obtain dataset permissions | 28 of the 57 blocked rows and 73 in_progress rows | contracts |
| B-AZURE | Provide `AZURE_SPEECH_KEY`/`REGION` (re-verify the 33-locale list first) | Numeric pronunciation scores (9 rows: 2 blocked, 7 in_progress) | pay-per-use |
| B-QUEUES | Workers Paid | Optional Queues backend (R-4.1-07) | $5/mo |
| Resend SMTP, Sentry, PostHog | Wire SMTP in `supabase/config.toml` (needs hosted Supabase). Provide a Sentry DSN | Auth email, error tracking | free tiers |
| Decisions | Age policy (R-11-06), counsel (R-11-11), approval of any new learner-facing design, keep or revert the `package.json` script change | — | — |

**What learners see is computed per course × instruction language** by the API (`CourseCapabilities`, `docs/UPCOMING_FEATURES.md`), not globally.
- Owner-gated: audio library and offline downloads (B-R2 / B-LICENSE), numeric score (B-AZURE), es/ru UI (catalog completeness). Missions and live conversation appear wherever content is published and the API has its keys.
- On the local stack, the learner's course (arabic-moroccan from fr) shows missions, live conversation with voice, and reference-comparison pronunciation feedback (never a numeric score for Darija). It hides the Audio tab and mini player (no published collection with instruction language fr), offline downloads (no R2) and the numeric score (`docs/evidence/capabilities-2026-10-19.md`; the device Home shows Accueil/Missions/Parler/Progrès tabs in `device-ios-02b-home-fr-light.png`).
- A missing Audio tab on the device is correct behaviour, not a bug: never add a placeholder, and never seed an unlicensed collection to make it appear.
- On the hosted side, everything stays unreachable until B-SUPABASE and the Worker secrets.

---

## 9. Next steps a session can do without the owner (prioritized)

Done on 2026-10-20 in four verified rounds: `b9de208` (admin writes through the Worker, route tests, speech honesty, editorial integrity, benchmark jobs, skills seed, docs rows), `56bdc42` (server-authoritative mission credit, test network guard, strict query flags, learner-only analytics, realtime no-speech, skill-key registry, restorable revisions, diversity publish gate), `c4c27f8` (conversation session guard, atomic mission credit and progress, publish override in the contract, conditional suggestion decisions, test leftovers). Run record: `docs/evidence/test-run-2026-10-20.md` (its "Known leftovers after round 4" list is the detailed backlog).

| # | Task | Main files | Done when |
|---|---|---|---|
| 1 | Suggestion approval races: the `expectedRevision` approve path writes the lesson before the conditional decide; an override written while pending can be applied by a concurrent approval; two identical concurrent decisions answer 409 instead of a replay | `apps/api/src/routes/admin/suggestions.ts`, `packages/db/src/repositories/asset-suggestions.ts` | One `decide(..., { suggestion })` call, a replay when the status already matches, decide-then-apply; a real-Postgres race test |
| 2 | Conversation edge cases: a service-role line can land milliseconds after the finish; retained inline recordings are never linked to their turn (append-only); a replayed `/end` shows `xpAwarded: 0`; a background evaluator run that lands before the finish records observations twice | `apps/api/src/routes/speech/conversation.ts`, `apps/api/src/lib/conversation.ts`, migrations if needed | Each case has a test and an honest outcome |
| 3 | Mission credit leftovers: `scheduleReviews` can hit 23505 (500 after the decision settled); `mission_attempts.xp_awarded` and the mastery recompute are read-then-write; a DB-side variety check in `complete_mission_attempt`; `mission_evidence_claims` in contracts `DB_TABLES` | `apps/api/src/lib/{xp-credit,learning}.ts`, `apps/api/src/routes/learner/missions.ts` | Tests for each, no 500 on a settled decision |
| 4 | Editorial leftovers: missions cannot pass `nativeReviewed`; visual-asset rollback restores only `alt_text_key` and `focal_point`; slot assignments only partly restorable; content-factory CLI verdict-sheet ingestion and mission rows on `--apply` | `apps/api/src/routes/admin/*`, `scripts/src/lib/content-factory.ts` | Tests; rows in `docs/requirements-traceability.md` updated |
| 5 | Analytics: per-panel aggregate SQL functions (exact totals without paging); a stack test for `analytics/quality`; check the Studio analytics screen in a browser | `apps/api/src/routes/admin/analytics.ts`, a new migration, `apps/admin/app/(studio)/analytics/*` | Exact totals at any volume; screenshot of the screen |
| 6 | Older items: reviews-due window vs the 7-day calendar; localized course names; move `admin.ui` keys out of `apps/admin/src/lib/i18n/extra.ts`; cross-package cleanup (`loc<T>()` casts, admin `@art/*` alias); stack journeys (A09, R-2.1-09, R-2.1-07, T-int-07); load run (T-perf-03) | `docs/reference/cross-package-gaps.md`, the traceability rows | Rows move to implemented_tested with evidence |

**Mobile-owned leftovers** (the QA session's files; give them to that session or do them after it is finished). The server already serves these rules on :8787:
- `apps/mobile/src/features/lesson/machine.ts` should read `r.outcome ?? speechObservationOutcome(r)` (and update `machine.test.ts`).
- Show "I didn't hear you, try again" when `speech.speechDetected === false`.
- Send `recording.peakLevelDb` with attempts, so near-silent clips are caught on the server.
- Choice steps are never credited now (the player sends the answer key); crediting them needs opaque server-shuffled option ids in contracts and mobile.
- Show skill names instead of `descriptor`/raw keys (`apps/mobile/src/app/(tabs)/progress.tsx`, `review/index.tsx`, mission chips).
- 182 of the 203 seeded missions have no target expression, so they complete without paying XP. That is honest, but visible on the device.

**Owner decisions waiting** (list them, do not decide):
- The learning-curve declination (QA session's question, §3).
- Reviewer write scope: the Worker follows the role table in `docs/content-rights/native-review-process.md` (reviewers approve/reject drafts, save reviewed transcript revisions, record `quality_review_status`), which is wider than the editors-only RLS. Each route moves to editors-only with a one-word role change in `apps/api/src/routes/admin/editorial.ts`.
- Whether learner-inserted conversation turns should count toward conversation XP (migration 070 `owner_insert`).
- Whether an admin Retry of a failed `benchmark_model` job may spend again (contracts still map it to no runner, so Retry is refused with 412).
- Whether hiding a published lesson should invalidate its offline packs.
- Test leftovers in the local DB (16 older test assets with their provenance, 7 `auth` `ai_requests` rows, 10 `test:*` jobs, 15 feedback rows, 3 mastery rows with invented skill keys plus their observations and 2 review cards): delete or keep. A migration letting `purge_test_user` remove a test-owned asset would also stop the one `removed` provenance event per run.
- The Playwright browser download (`pnpm exec playwright install chromium`) for the admin e2e tests.

Traceability recount (prints 440 / 248 / 57 / 18, total 763 at `c4c27f8`):
```bash
awk -F'|' 'NF>=7 && $2 ~ /^ *(R-|A[0-9]|T-|N[0-9]|F[0-9]|E[0-9])/ {s=$5; gsub(/ /,"",s); c[s]++; n++} END {for (k in c) print k, c[k]; print "total", n}' docs/requirements-traceability.md
```

---

## 10. Verification checklist

Run these before declaring work done:

```bash
pnpm run typecheck                                          # expect 14/14
pnpm lint                                                   # expect exit 0 (1 known warning in scripts)
pnpm --filter @langquest/mobile lint                        # expo lint
# while another session uses the stack: unit tests only
LANGQUEST_SKIP_LOCAL_STACK=1 pnpm --filter <pkg> exec vitest run
# only when the stack is free (LANGQUEST_LIVE_TESTS unset): a missing stack fails instead of skipping
LANGQUEST_REQUIRE_LOCAL_STACK=1 LANGQUEST_REQUIRE_STACK=1 pnpm -r --workspace-concurrency=1 test   # baseline 2,245 passed / 6 skipped
# only when the stack is free: pgTAP (6 files, 271 tests); starts a pg_prove container (wedge risk, database.md §8)
pnpm supabase test db
# always
pnpm --filter @langquest/mobile export:web                  # web export still builds
pnpm --filter @langquest/admin build                        # admin still builds
git status --short                                          # nothing unexpected; no secrets, no ios/
```

All recorded full runs used `pnpm -r test`. Whether `pnpm test` (turbo, running packages in parallel) is stable against one shared Postgres is **UNVERIFIED**.

**Re-capture screenshot evidence** (procedure in `docs/evidence/polish-2026-10-19.md` §2 and §7.4; tools in `docs/evidence/tools/polish-capture/`). Captures need the stack and :8787, so run them only after the QA session is finished: its device is signed in as the same `LOCAL_LEARNER`.
1. Export the web build: `pnpm --filter @langquest/mobile export:web`. This bakes in `apps/mobile/.env`.
2. Serve it: `python3 docs/evidence/tools/polish-capture/spa_server.py apps/mobile/dist 8921`.
3. In a scratch dir `$S` (never the repo), mint sessions with the password grant `POST http://127.0.0.1:54321/auth/v1/token?grant_type=password` (anon `apikey`) for `LOCAL_LEARNER_*` and `LOCAL_ADMIN_*`. Save them as `$S/session-LEARNER.json` and `$S/session-ADMIN.json`. **Both are required.** The exact JSON shape is inferred from `make-config.py` (**UNVERIFIED**), so read that file first.
4. Optional, for admin captures: run `pnpm --filter @langquest/admin build`, then `next start -p 3011` (127.0.0.1:3011 is hard-coded).
5. Generate the configs: `python3 docs/evidence/tools/polish-capture/make-config.py "$S" 8921 docs/evidence/screenshots polish- <1|0> [en|fr]`. Before a locale phase, PATCH `/v1/me/settings {"uiLocale":"en"}` yourself with the learner token: neither `make-config.py` (lines 3-6) nor `cdp-shots.mjs` does it. Afterwards PATCH `{"uiLocale":"fr-CA"}` back and confirm with `GET /v1/me`. The review-calendar captures in polish §7.4 also inserted 3 `user_expression_reviews` rows tagged `polish-capture-seed` and deleted them afterwards; delete only rows you inserted.
6. Shoot: `node docs/evidence/tools/polish-capture/cdp-shots.mjs "$S/config-polish-mobile.json"`. It needs Node 22+ and Chrome at the default macOS path, and renders 430x932 @2x in dark and light.
7. Record the commands and results in a dated `docs/evidence/*.md`.

---

## 11. Gotchas

- **Stack writes from tests.** Stack suites auto-detect a running Docker stack (`supabase status`) and write to it. They clean up after themselves, but use `LANGQUEST_SKIP_LOCAL_STACK=1` while another session owns the stack.
- **`supabase db reset` wipes local state.** It drops the LOCAL_* auth users, the super_admin row, the learner enrollment and all seeded content (the characters come back from migrations 130 and 140). It is never part of a recovery unless the owner says so. If a reset does happen, rebuild in this order:
  1. `seed-languages`, then `seed-curriculum -- --apply`.
  2. Sign up both `LOCAL_*` accounts via `POST http://127.0.0.1:54321/auth/v1/signup` (confirmation is off).
  3. With the service role, insert `public.user_roles (user_id, role) values (<admin uid>, 'super_admin')`.
  4. As the learner, `POST /v1/me/enrollments {"courseTrackId":"arabic-moroccan","sourceLanguageCode":"fr"}` (`docs/evidence/capabilities-2026-10-19.md`), then `PATCH /v1/me/settings {"uiLocale":"fr-CA"}` for each account.
- `supabase start` applies migrations only on first boot. After editing a migration you need `local:reset`, so ask first if another session is active. Migrations 080, 130 and 140 are **generated**, so never hand-edit them (§7 for 140).
- **Docker Desktop wedge** (containers stuck in `Created`): `docker desktop restart` is not enough. The full recovery is in `docs/runbooks/database.md` §8. It kills Docker and its block ends with `pnpm supabase db reset`: stop before that last line. A Docker restart keeps the stack's data volume: the 2 local users, the super_admin row and the enrollment were still there at 01:05 on 2026-10-20, after the QA session's Docker and stack restart. Never run the recovery while another session uses the stack, and ask the owner first.
- **Ignore rules can swallow source.** The root `.gitignore` rule `coverage/` once hid an admin route file from git. That route now lives in the Worker, but after adding any folder named `coverage`, `build` or `dist`, run `git check-ignore -v <file>`.
- **Stack suites leave some rows.** Each full run adds about 99 `audit_logs` and 1 `ai_requests` row (append-only by design) and 1 `asset_provenance_events` row; `processing_jobs` and `media_assets` no longer grow, and users are purged. A network guard fails any stack test that reaches a non-local host. Do not delete leftovers without the owner's OK (§9 owner decisions).
- `apps/admin/.env.example` exists locally but is gitignored (`apps/admin/.gitignore:34` `.env*`), yet `developer-setup.md` §2 (line 52) says to copy it, so a fresh clone lacks it. There is no `apps/mobile/.env.example`.
- **CI gaps.**
  - CI triggers on `main`, but the branch is `master`.
  - The database job lacks `LANGQUEST_REQUIRE_LOCAL_STACK=1`, so it could pass by skipping.
  - `pnpm/action-setup` `version: 10` might conflict with the `packageManager` pin (**UNVERIFIED**).
- `unauthenticated` with a valid local token means `.dev.vars` `SUPABASE_JWT_SECRET` does not match the stack's JWT secret. `capability_unsupported` on media URLs is expected while R2 is off.
- **Seeding bypasses the publish gate on purpose.** `seed-curriculum` publishes draft chapters (`reviewed=false`, coverage `partial`). Do not "fix" this into unpublishing without the owner.
- **Two locale code paths.** Mobile device-locale negotiation can pick es/ru (partial catalogs, falling back to en per key). The Account picker offers only en and fr.
- Android emulator hosts are `10.0.2.2:8787` and `10.0.2.2:54321`.
- `pnpm --filter @langquest/jobs handlers|status` is documented but has no matching script. Use `pnpm --filter @langquest/jobs exec tsx src/main.ts status` (**UNVERIFIED**, not run).
- **Stale docs.**
  - `CONVENTIONS.md` §6 and `MASTER_SPEC.md` §10.2A still describe the old "orbit-creature" mascot.
  - `mobile-release.md` §4 and `developer-setup.md` §7 say there is no `eas.json` (it is committed).
  - `developer-setup.md` lists migrations up to 090 (there are 15, up to 140).
  - `coverage-report.md` (10-15) is stale.
  - The license item count differs: 1,220 in the inventory vs 1,160 in `data/derived/license-report.md`.
  - The memory note cites `docs/design-system.md`; the real path is `docs/design/design-system.md`.
- **Usage-limit interruptions.** Long Workflow runs were resumed with `resumeFromRunId` (see the working-mode note in §1).

---

## 12. Doc index

| Doc | Use it for |
|---|---|
| `docs/MASTER_SPEC.md` | The product spec (phases 0-12, 1,528 lines; primary directive at line 10). The source of every requirement ID |
| `docs/CONVENTIONS.md` | Cross-package rules: ids, API envelope, DB/RLS, AI, §8 visible-means-usable |
| `docs/requirements-traceability.md` | 763 requirement rows with status, evidence and blocker key. Stale header (§2) |
| `docs/UPCOMING_FEATURES.md` | Hidden learner and admin features, each with its unlock condition |
| `docs/decisions/ADR-001..006` | Audio runtime, voice pipeline, data access, manifests, job queue, pronunciation honesty |
| `docs/runbooks/developer-setup.md` | Full local setup, env files, CI, troubleshooting (do not run its §2 copy block here, §5) |
| `docs/runbooks/database.md` | Migrations, seeds, types, pgTAP, hosted project, Docker wedge (§8) |
| `docs/runbooks/provisioning.md` | Hosted deploy order, account state, cost notes |
| `docs/runbooks/{admin-manual,jobs,mobile-release}.md` | Studio usage, jobs runner, EAS/store release |
| `docs/design/design-system.md` | Tokens, theme, density, and the swap table in §8 |
| `docs/design/{character-casting,mascot-rive-spec,mobile-screens}.md`, `docs/mascot-style-guide.md` | Cast rules, Melo Rive state machine, screen inventory, Melo style |
| `docs/evidence/polish-2026-10-19.md` | Latest verified run (§7.1), capture procedure (§2, §7.4), open items (§7.6) |
| `docs/evidence/test-run-2026-10-19.md`, `ux-observations-2026-10-19.md`, `capabilities-…`, `conversation-journey-…` | Earlier runs, UX log, capability snapshot, live conversation proof and spend |
| `docs/evidence/screenshots/device-ios-*` | First iOS simulator captures (QA session, 2026-10-20) |
| `docs/provider-matrix/*` | AI capability matrix, provider setup and cost, Azure locales, mobile audio QA (11 device rows, all pending) |
| `docs/content-rights/*` | Dataset attribution inventory and native review process |
| `docs/reference/cross-package-gaps.md` | Integration gaps (10-15, partly stale) |
| `infra/cloudflare/README.md` | Worker, R2, KV and Queues setup (state dated 10-14) |
| `tests/README.md`, `tests/e2e/README.md` | Test harness, stack flags, Maestro flows and env |
