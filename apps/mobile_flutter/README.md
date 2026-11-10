# LangQuest — Flutter learner app

The Flutter rewrite of the learner app (`apps/mobile` is the Expo app it replaces). It runs **offline**: it teaches
the shared draft curriculum bundled with the app and keeps the learner's progress on the device. When a backend is
configured, an optional account keeps courses and completed missions in step across devices
([Account](#account-optional-sign-in-and-sync)).

## Run

Flutter **3.47.7** (Dart 3.13.5), the version in `.metadata`.

```bash
cd apps/mobile_flutter
flutter pub get
flutter run                     # a connected device or simulator
flutter run -d chrome           # web
```

```bash
flutter analyze                 # expect: No issues found
flutter test                    # VM: content, learn plans, scheduler, state, widget flows
flutter test --platform chrome test/srs_test.dart   # the hashing/scheduler port compiled to JavaScript
flutter build web --release
```

## Web app (phone-sized) and its deployment

The web build is the same app, laid out for a phone: on a phone browser it fills the screen; in a wider window
(a computer or a tablet) it is shown as a centered phone (`lib/core/layout/phone_frame.dart`), and a mouse can drag
lists and card pages like a finger. Progress is kept in the browser's local storage. After one visit it also opens
offline (airplane mode, or from the home screen): `web/sw.js` serves the files from its cache when the network fails
(network first, so a redeploy shows on the next load; same-origin files only — the account API is never cached). The device voice is the
browser's speech synthesis, with the same exact-locale rule as on phones. On their own lines the learner can record themselves
(MediaRecorder; the browser asks for the microphone the first time, and only on https or localhost) and hear the take next to
the reference voice; the take stays in memory and is never uploaded.

The repository's root `Dockerfile` builds it (Flutter 3.47.7, pinned to its release commit) and serves the files with
Caddy on `$PORT` (default 8080, what the Infra Tayoo hosted app checks); `deploy/Caddyfile` sends `no-cache` so a redeploy shows on the next load. It reads no
variables: nothing from the host's environment is built into the files served. CI's `web-image` job builds the image
and checks that it serves the app.

```bash
docker build -t langquest-web .                      # from the repository root
docker run --rm -p 8080:8080 langquest-web           # http://localhost:8080
```

On Infra Tayoo (instance `languest`), the hosted app builds `master` with this image and health-checks
`0.0.0.0:8080`: `infra-tayoo status` shows the source and the app URL, `infra-tayoo deploy` deploys `master`'s latest
commit (the `infra-tayoo` CLI comes from the Infra Tayoo portal; its key must never be committed or printed).

Fonts: Inter and Outfit cover the interface; small Noto Sans subsets (`assets/fonts/scripts/`, 428 KB in all) cover
the other scripts the bundle uses (Japanese, Arabic, and the Chinese, Korean, Hebrew and Devanagari course names).
Without them the web engine downloads fallback fonts from `fonts.gstatic.com` and picks Chinese or Japanese kanji
forms by the browser's language. A phrase or course name puts its own script's font first (`core/theme/script_fonts.dart`),
so Japanese is drawn with Japanese forms everywhere. `test/script_fonts_test.dart` reads the subsets' character maps
and fails when the bundle uses a character they lack; then regenerate them (Python with fonttools, network access):

```bash
python3 -m venv /tmp/fonts-venv && /tmp/fonts-venv/bin/pip install fonttools==4.68.0
/tmp/fonts-venv/bin/python tool/subset_fonts.py     # from apps/mobile_flutter
```

## Account (optional): sign-in and sync

Without a backend the app is offline: progress lives on the device and nothing about accounts is shown. With one
(Settings › Account, shown only while the API answers `/healthz`), a learner signs in with email and password
(Supabase auth) and the app keeps the account in step with the device (`lib/core/backend/`):

| Synced | How |
|---|---|
| Courses | Enrolled here → `POST /v1/me/enrollments`; enrolled in the account → added here (archived ones are not). One active source per track on the server: a second instruction language of the same track stays on the device and is named in Settings. |
| Completed missions | Done here → `GET /v1/missions/:id` + attempt + evaluate. Steps built on the learner's own lines are claimed `success`, the others `unclear`: the server records the mission as completed for the path and credits nothing it has no evidence for. Done in the account → their stops are marked done here (read from the learner's own `mission_progress` rows), so the path continues on any device. |
| Not synced | Practice XP and the review schedule: the server pays XP and creates review cards only for missions with an assessed spoken attempt, which needs a recognizer on the server (OpenRouter, not configured); takes recorded in the app stay on the device. |
| Your data | Settings › Account › **Export my data** downloads the server's JSON bundle (`GET /v1/me/export`; web only for now — native needs a file/share plugin). **Delete my account** asks for a typed confirmation word, calls `DELETE /v1/me`, and signs out only once the server has answered (`deleted` / `scheduled`, shown as such); progress on the device stays until the learner resets it. |

Server ids are computed offline: missions and expressions are UUIDv5 of their curriculum keys
(`core/backend/curriculum_ids.dart`, same namespace as `packages/db/src/seed/curriculum-uuid.ts`). Every call is
idempotent (deterministic `clientAttemptId` / `clientEventId`), so an interrupted sync is simply run again.

Configuration — client-safe values only (URL, anon key), never a secret:

- native builds: `--dart-define=LQ_SUPABASE_URL=… --dart-define=LQ_SUPABASE_ANON_KEY=… --dart-define=LQ_API_BASE_URL=…`;
- the web image: Caddy fills `/config.json` (`deploy/config.json`, a template) from the container's environment on
  each request — `LQ_SUPABASE_URL`, `LQ_SUPABASE_ANON_KEY` (or the hosted app's `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and `LQ_API_BASE_URL`; nothing is written at start-up. The API Worker needs its secrets and the web origin in `CORS_ALLOWED_ORIGINS`
  (`apps/api/wrangler.toml`, `infra/cloudflare/README.md`).

On the live web app (https://web-languest.tayoo.app › Settings › Account), sign in with the test learner whose
credentials are the hosted app's `LOCAL_LEARNER_EMAIL` / `LOCAL_LEARNER_PASSWORD` variables (confirmed on the
instance, no email needed). New accounts need email confirmation on that instance.

Try it locally (local stack and local test accounts only):

```bash
pnpm --filter @langquest/db local:start
pnpm --filter @langquest/scripts seed-languages && pnpm --filter @langquest/scripts seed-curriculum -- --apply
# apps/api/.dev.vars from .dev.vars.example with the keys of `pnpm supabase status -o json`, API_ENV=development
pnpm dev:api                                         # http://127.0.0.1:8787
docker build -t langquest-web . && docker run --rm --network host -e PORT=8090 \
  -e LQ_SUPABASE_URL=http://127.0.0.1:54321 -e LQ_SUPABASE_ANON_KEY=<local anon key> \
  -e LQ_API_BASE_URL=http://127.0.0.1:8787 langquest-web   # http://localhost:8090 › Settings › Account
```

## What the app does

| Area | How it works |
|---|---|
| First run | Choose the app language (English or French), then a course that can be taught from it. A course page lists what it **includes** and what it **does not have yet** (draft content, no dialect voice, no live conversation, no audio library) before enrolling — CONVENTIONS §8. |
| Courses | All 30 tracks in the catalog. Startable today (bundled drafts): Arabic (Moroccan) from French or English, Spanish (Spain) from English, Japanese from English, English from French. The rest show as *Planned*. One enrollment per track × instruction language; switch from Home's course chip. |
| Learn path (approved **L1 + L3 inside N2**) | Each mission is a node: **Learn** (L1 scene: the dialogue line by line, target script + romanization + meaning, the learner shadows their lines; then L3 discovery cards) → **Practise** (pairs in rounds of ≤ 5, then one sentence from tiles — romanized for non-Latin scripts) → **Mission** (each learner line of the dialogue, cued by the character or by its meaning: choose the taught reply, then say it out loud). Everything a mission asks was taught in its own Learn stop. Missions unlock in order. |
| Review | Phrases used in a mission enter spaced review (first try right = good, otherwise hard). Recall from the meaning, reveal, rate Again / Hard / Good / Easy. The scheduler is a Dart port of the API's FSRS-like scheduler with the same defaults; `test/srs_test.dart` checks it against vectors produced by the TypeScript implementation. |
| Progress | Only measured numbers: XP (practice, never proficiency — product XP amounts: mission 50, step 5, review 3, each mission paid once), streak from active days, this week, missions completed, phrases met / in review, and review strength from the schedule (not a speech score). |
| Settings | Account (when a backend answers), app language, dark/light theme, courses (switch, remove with confirmation), reset all local data, open-source licenses. |
| Record and compare | On the learner's own lines (the Learn scene, the Mission's "say it" card), where the device can record — the web app today (`lib/core/platform/recorder_web.dart`): record yourself, then play your take next to the reference voice, ADR-006's *listen / record / compare*. Nothing is judged: no score or waveform, only the microphone level while recording; a take whose loudest moment stays at or below −50 dBFS (the server's silence floor, `SILENCE_PEAK_DBFS`) is answered "I didn't hear anything". A refused or missing microphone is said plainly. The take stays in memory on the device — never saved or uploaded — and is dropped when the line changes. Without a recorder (the iOS and Android builds, no plugin yet) the control is not shown. |
| Voice | The phone's synthesizer, only when the device has a voice for the course's **exact** locale (`es-ES` never falls back to a Latin American voice). Colloquial Arabic gets no device voice at all: phone Arabic voices speak MSA, which must never stand in for Darija (ADR-006, variety boundaries). Without a voice, listen buttons are not shown. |

Not shown, because nothing real backs them in an offline build (hidden rather than faked, as the Expo app hides tabs
per course capability): the **Talk** stop and **Speak** tab (live AI conversation), the **Audio** tab and mini player
(no licensed audio library), any waveform or pronunciation score (ADR-006), and recording in the native builds (no
recorder plugin yet).

## Content

`assets/content/catalog.json` and `assets/content/chapters.json` are **generated** — never edit them by hand:

```bash
pnpm --filter @langquest/scripts export-flutter-content          # rewrite the bundle
pnpm --filter @langquest/scripts export-flutter-content -- --check
```

The exporter (`scripts/src/export-flutter-content.ts`) reads `@langquest/contracts` (tracks, varieties),
`@langquest/ui/art/web` (cover hues for the course accent), the French locale catalog (French course names) and
`@langquest/curriculum` (`DRAFT_CHAPTERS`). Expression ids are the curriculum seed ids
(`<chapter>:<mission>:<expression>`), so on-device review cards can later be mapped to the API's.
`scripts/src/export-flutter-content.test.ts` fails CI when the bundle is stale.

Every bundled chapter is an AI draft (`nativeReviewed: false`); the app says so before enrolling and on the pathway.
Code-switch and pronunciation notes exist in English only in the curriculum, so they are shown only to learners
taught from English.

## Layout

```
lib/
  main.dart                     bootstrap: content bundle + saved state, bundled fonts, licenses, en/fr
  l10n/                         app_en.arb, app_fr.arb (gen-l10n → l10n/generated/)
  navigation/                   go_router: first-run redirect, Home/Missions/Progress shell, learn routes
  core/content/                 bundle model + loader (Course = track × instruction language)
  core/learning/                FSRS scheduler port, web-safe FNV-1a / mulberry32
  core/services/                learner state (JSON v1, SharedPreferences), app state notifier, speech
  core/theme/                   Night Market tokens, theme-aware glass, course accent (contrast-checked labels), Material theme
  core/layout/                  phone frame for the web build in wide windows
  features/learn/               learn plans (pure) + scene, cards, practice, mission path screens
  features/…                    home, missions, mission player, review, progress, catalog, course page, settings, onboarding
assets/content/                 generated content bundle
assets/fonts/                   Outfit + Inter (OFL), bundled: no runtime font downloads
assets/fonts/scripts/           Noto Sans subsets for other scripts (tool/subset_fonts.py, OFL-NotoSans*.txt)
web/                            index.html (splash until the first frame), flutter_bootstrap.js, sw.js (offline), manifest, icons
deploy/Caddyfile, config.json  static server config for the root Dockerfile; the account settings template
```

## Next steps

1. **API wiring, continued** — sign-in, courses, mission completion, export and account deletion are wired (above).
   Next: password reset and email confirmation links (need the web origin in Supabase's redirect URLs), the course
   manifest instead of the bundle when online, reviews from the server once missions are credited.
2. **Talk stop and Speak tab** — live conversation through the API's conversation routes, shown per course capability.
3. **Recording, continued** — record and compare works in the web app, on the device only. Next: a recorder in the
   iOS and Android builds (a recorder plugin and the microphone permission strings), then — once the server has a
   recognizer (OpenRouter, a cost decision) — sending takes with `peakLevelDb` for its speech-detection verdict and
   reference-comparison feedback (never a numeric score without an acoustic assessor).
4. Device QA on iOS and Android (this build was verified with unit/widget tests and the web build only).
5. Android adaptive launcher icon: the launcher icons are LangQuest's on every platform, but Android gets the legacy
   square PNGs only (no `mipmap-anydpi-v26` foreground/background pair yet).
