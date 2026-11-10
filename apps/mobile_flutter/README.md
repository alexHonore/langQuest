# LangQuest — Flutter learner app

The Flutter rewrite of the learner app (`apps/mobile` is the Expo app it replaces). This build runs **offline**:
it teaches the shared draft curriculum bundled with the app and keeps the learner's progress on the device. It does
not talk to the LangQuest API yet (see [Next steps](#next-steps)).

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
lists and card pages like a finger. Progress is kept in the browser's local storage. The device voice is the
browser's speech synthesis, with the same exact-locale rule as on phones.

The repository's root `Dockerfile` builds it (Flutter 3.47.7, pinned to its release commit) and serves the files with
Caddy on `$PORT` (default 3000); `deploy/Caddyfile` sends `no-cache` so a redeploy shows on the next load. It reads no
variables: nothing from the host's environment is built into the files served. CI's `web-image` job builds the image
and checks that it serves the app.

```bash
docker build -t langquest-web .                      # from the repository root
docker run --rm -p 8080:3000 langquest-web           # http://localhost:8080
```

On Infra Tayoo (instance `languest`), the hosted app runs this image when its source branch has it: `infra-tayoo
status` shows the source branch and the app URL, `infra-tayoo deploy` deploys the branch's latest commit (the
`infra-tayoo` CLI comes from the Infra Tayoo portal; its key must never be committed or printed).

## What the app does

| Area | How it works |
|---|---|
| First run | Choose the app language (English or French), then a course that can be taught from it. A course page lists what it **includes** and what it **does not have yet** (draft content, no dialect voice, no live conversation, no audio library) before enrolling — CONVENTIONS §8. |
| Courses | All 30 tracks in the catalog. Startable today (bundled drafts): Arabic (Moroccan) from French or English, Spanish (Spain) from English, Japanese from English, English from French. The rest show as *Planned*. One enrollment per track × instruction language; switch from Home's course chip. |
| Learn path (approved **L1 + L3 inside N2**) | Each mission is a node: **Learn** (L1 scene: the dialogue line by line, target script + romanization + meaning, the learner shadows their lines; then L3 discovery cards) → **Practise** (pairs in rounds of ≤ 5, then one sentence from tiles — romanized for non-Latin scripts) → **Mission** (each learner line of the dialogue, cued by the character or by its meaning: choose the taught reply, then say it out loud). Everything a mission asks was taught in its own Learn stop. Missions unlock in order. |
| Review | Phrases used in a mission enter spaced review (first try right = good, otherwise hard). Recall from the meaning, reveal, rate Again / Hard / Good / Easy. The scheduler is a Dart port of the API's FSRS-like scheduler with the same defaults; `test/srs_test.dart` checks it against vectors produced by the TypeScript implementation. |
| Progress | Only measured numbers: XP (practice, never proficiency — product XP amounts: mission 50, step 5, review 3, each mission paid once), streak from active days, this week, missions completed, phrases met / in review, and review strength from the schedule (not a speech score). |
| Settings | App language, dark/light theme, courses (switch, remove with confirmation), reset all local data, open-source licenses. |
| Voice | The phone's synthesizer, only when the device has a voice for the course's **exact** locale (`es-ES` never falls back to a Latin American voice). Colloquial Arabic gets no device voice at all: phone Arabic voices speak MSA, which must never stand in for Darija (ADR-006, variety boundaries). Without a voice, listen buttons are not shown. |

Not shown, because nothing real backs them in an offline build (hidden rather than faked, as the Expo app hides tabs
per course capability): the **Talk** stop and **Speak** tab (live AI conversation), the **Audio** tab and mini player
(no licensed audio library), any recording, waveform or pronunciation score (ADR-006).

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
web/                            index.html (splash until the first frame), flutter_bootstrap.js, manifest, icons
deploy/Caddyfile                static server config for the root Dockerfile
```

## Next steps

1. **API wiring** — sign-in (Supabase auth), enrollments, course manifest, mission attempts and progress sync against
   the Worker (`apps/api`), behind the same `ContentBundle` / `AppState` shapes; the bundle stays as the offline pack.
2. **Talk stop and Speak tab** — live conversation through the API's conversation routes, shown per course capability.
3. **Recording** — attempts with `peakLevelDb` for the server's speech-detection verdict; reference-comparison feedback
   (never a numeric score without an acoustic assessor).
4. Device QA on iOS and Android (this build was verified with unit/widget tests and the web build only).
5. Native launcher icons: `web/` has the LangQuest icons; `ios/` and `android/` still carry Flutter's defaults.
