# Flutter learner app — offline learn path on the real curriculum (2026-11-10)

Branch `refactor/react-to-flutter`, on top of `5c4a87b` (the Flutter prototype with the approved L1 + L3 inside N2
learn path on local mock data). Environment: Linux cloud container, Flutter 3.47.7 stable (archive SHA-256 verified
against the release index), Node 22, Playwright Chromium. No Xcode, Android SDK, Docker stack or API Worker.

## What changed

- The app teaches the **shared draft curriculum** instead of invented French content: a generated bundle
  (`scripts/src/export-flutter-content.ts` → `apps/mobile_flutter/assets/content/`) with the 30-track catalog and the
  four flagship draft chapters (Darija fr/en, Spanish-Spain en, Japanese en, English fr: 21 missions, 170 expressions).
- Learn plans (scene, cards, pairs, tiles, mission exchanges) are built from each mission's own expressions; every
  mission asks only for lines its Learn stop taught (checked for all 28 mission × instruction-language plans).
- Learner state is persisted on the device: enrollments, path stops, review cards, XP per day. Missions unlock in order.
- Spaced review uses a Dart port of the API's FSRS-like scheduler (same defaults), checked against TypeScript vectors.
- English and French interface (gen-l10n, wording reused from `packages/locales` where it exists).
- First run (language → course → disclosure → enroll), catalog of 30 courses, course page, settings, review, progress.
- Hidden rather than faked: Talk stop, Speak and Audio tabs, mini player, any recording/score (CONVENTIONS §8, ADR-006).
- Light theme readable; Outfit and Inter bundled (no runtime font download); app name "LangQuest" on iOS, Android, web.
- CI: a `flutter` job (analyze, test).

## Defects found in the prototype and fixed

| Defect | Fix |
|---|---|
| Progression stopped after mission 2: `isNext` was a fixed flag, so Home fell back to the finished mission 1 | Next mission and unlocks computed from completion |
| Switching to any of 5 "enrolled" courses kept the French missions under the new course's name | Content per course × instruction language; only startable courses can be enrolled |
| Light theme: white text on white (glass panes ignored the theme; ~40 hard-coded white colours) | Theme-aware glass and colour tokens everywhere |
| Simulated conversation: random "voice level", canned replies, "Hands-free mode active", dead info/keyboard buttons | Removed (unreachable first, then deleted with the owner's go-ahead, 2026-11-10) |
| Audio library: 4 tracks all playing one file with a simulated playhead; seek did not seek; dead download/share buttons | Removed (deleted with the owner's go-ahead, 2026-11-10); Audio tab hidden until real audio exists |
| Invented numbers: "Level 3 Learner", "42 words durable", a Mon–Fri streak, "0 pending events · cache up-to-date" | Progress and settings show measured values only |
| Nothing persisted (shared_preferences was a dependency but unused) | Versioned JSON state in SharedPreferences, damaged entries fall back safely |
| Instruction-language switch changed nothing (UI was English-only) | Real en/fr interface |
| Talk stop marked done on opening the fake chat | Talk shown only with a conversation partner |
| Deep link to an unknown mission crashed (null check); close buttons on directly opened screens had nothing to pop | "Not in your course" screen with a way home; back goes Home when nothing is underneath |
| Quick Speak pushed a tab route; the course switcher navigated with a disposed sheet context | Removed from Home (owner direction: minimal Home); router captured before closing the sheet |
| Fonts fetched from Google at runtime (fails offline, reports the learner's IP) | Bundled, checksum-verified font files; runtime fetching off |
| Shuffle hash overflowed 2^53 on the web build, so orders differed from native | 32-bit-safe FNV-1a/`imul`, identical to `packages/curriculum` |
| Hebrew native name ended with an Arabic letter (`עבריت`) | `עברית` |

## Verification (commands run in this session)

| Check | Result |
|---|---|
| `flutter analyze` (apps/mobile_flutter) | No issues found |
| `flutter test` | 52 passed (content invariants for all 28 plans, scheduler vectors, state/persistence, 7 widget flows incl. a whole mission node end to end) |
| `flutter test --platform chrome` | 13 passed (`srs_test.dart` compiled to JavaScript; the other files read assets with `dart:io` and are VM-only) |
| `flutter build web --release` | Built |
| `pnpm --filter @langquest/scripts exec vitest run` (`LANGQUEST_SKIP_LOCAL_STACK=1`) | 20 files, 144 passed, 1 skipped (pre-existing) |
| scripts `tsc --noEmit` / `eslint src` | Pass / 0 errors (1 known warning: `seedTitle` in `seed-curriculum.ts`) |
| `export-flutter-content -- --check` | Bundle up to date |
| Web walkthrough: headless Chromium, 390×844 @2×, driven through Flutter's accessibility tree (`walk.js`, not committed) | Three flows completed — English/Spanish first run → a whole mission node → tabs → light theme; French/Darija first run → a whole mission node → Arabizi tiles; review of due cards. **0 page errors, 0 console errors** |

The scheduler port was checked against vectors produced by `createScheduler()` from `@langquest/curriculum`
(five review sequences incl. lapses and learning steps, interval fuzz, retrievability, FNV-1a and mulberry32 output).
Running it in Chrome caught a wrong expected value in the test itself: a plain 32×32-bit product gives 84696352 in
JavaScript instead of 84696351, the overflow `imul32` exists to avoid.

## Screenshots (`docs/evidence/screenshots/flutter-v2-*.jpg`)

| File | Shows |
|---|---|
| `01-welcome-en`, `02-courses-en`, `03-course-disclosure-en` | First run: app language, courses startable from English, includes / does not have yet |
| `04-home-en`, `05-mission-path-en` | Minimal Home (course chip, next mission with stop dots); the node's three stops |
| `06-scene-en`, `07-cards-en`, `08-pairs-en`, `09-tiles-solved-en` | L1 scene line to shadow, L3 card with note, pairs round, tiles solved |
| `10-mission-choice`, `12-mission-completed-en` | A wrong pick flagged, then the taught reply; +50 XP and 7 phrases into review |
| `14-pathway-en`, `15-progress-en` | Mission 2 unlocked, 3+ locked, draft notice; measured progress (XP 60, streak 1, 8 met, 7 in review) |
| `19-home-light-en`, `21-progress-light-en` | Light theme |
| `24-course-disclosure-fr` | French course page for Darija: learn from English or French, no dialect voice disclosed |
| `26-scene-darija-fr`, `27-cards-darija-fr` | Right-to-left Arabic with Arabizi, French meaning and note; no listen buttons (no Darija voice) |
| `29-darija-fr-mission-choice`, `32-tiles-arabizi-fr` | « Comment dit-on « Bonjour » ? » with a wrong pick; tiles in Arabizi with the Arabic sentence revealed |
| `34-review-front-en`, `35-review-answer-en` | Recall from the meaning, then reveal and rate |

## Not verified here

- iOS and Android builds and on-device behaviour (no Xcode or Android SDK in this container). No native plugin was
  added; `flutter_localizations` is Dart-only. `ios/Runner/Info.plist` now declares `en`/`fr` localizations.
- Device text-to-speech: headless Chromium has no voices, so no listen buttons appear in the captures (expected).
  Exact-locale voice matching is implemented in `speech_service.dart` but not exercised on a device.
- Screen readers beyond the semantics tree used to drive the walkthrough.
- Anything against the API or database (this build does not call them).

## Web deployment image (same day, later)

The owner asked for a phone-sized web version to test on the Infra Tayoo instance domain.

| Change | Detail |
|---|---|
| Phone frame | In a window at least 600 × 560 (computer, tablet), the web build is a centered 430 × ≤ 932 phone; phones are unframed in portrait and landscape. Screens read the frame's size from `MediaQuery`. A mouse drags lists and card pages. |
| Web shell | LangQuest icons (favicon, PWA, maskable, Apple touch icon) instead of Flutter's; a splash until the first frame (`flutter-first-frame`); no service worker (Flutter's is a self-unregistering stub). |
| Image | Root `Dockerfile`: Flutter 3.47.7 shallow clone checked against the tag's commit (`abaf9c5`), `flutter build web --release --no-web-resources-cdn` (CanvasKit served from the same host), Caddy 2.11 on `$PORT` (default 3000; 8080 since the first deployment, see below), `no-cache` + ETag, `nosniff`, admin API off, no SPA fallback (hash routes). `.dockerignore` sends only `apps/mobile_flutter`. Reads no variables. |
| Contrast fix | Found on the iPhone capture: the selected language segment (and the selected chip on the course page) was white on bright cyan (≈ 1.6:1), because `onSecondary` was the text colour. Labels now use `readableOn` on a `readableFill`; a test checks primary, secondary and selected-segment pairs for all 30 course accents and the neutral one, light and dark (≥ 4.5:1). That test also caught 7 accents at 4.34–4.47 (Hindi, Vietnamese, Arabic MSA light; Russian dark), now nudged to 4.5. |
| CI | `web-image` job: `docker build`, then checks that the container serves the page, `main.dart.js`, the content bundle, `application/wasm`, and a 404 for a missing file. |

| Check (this container, Docker 29) | Result |
|---|---|
| `docker build` (cold) | Built in 2 min 17 s; image serves 45.6 MB of files |
| Full walkthrough (`walk.js`, the three flows above) against the container | **0 page errors, 0 console errors** |
| Desktop 1280 × 800 | Phone frame centered (button at x 449–831); splash removed after ≈ 0.9 s; mouse drag moves card 1 → 2 |
| Emulated iPhone 15 (touch, 393 × 659) | Full screen, no frame; 0 errors |
| Headers | `application/wasm`, `Cache-Control: no-cache`, gzip (main.dart.js 3.4 MB → 1.0 MB), 404 for a missing file, `$PORT` honoured |
| `flutter analyze` / `flutter test` / Chrome tests | No issues / 59 passed / 18 passed |

Deployment: the owner had the branch merged into `master` (rebase merge, `8819742`); the hosted app builds `master`.
The first deployment (`dpl_vrtvimudbb`) built in 7 min 22 s on the platform, then failed its health check: the
platform checks `0.0.0.0:8080` and sets no `PORT`, and Caddy defaulted to 3000. The default is now 8080
(alexHonore/langQuest#3, squash `973592a`); the second deployment (`dpl_44097390d8`) was ready in 124 s.

**Live: https://web-languest.tayoo.app** (behind Cloudflare). Checked from this container: `no-cache`, `nosniff`,
`application/wasm`, gzip (main.dart.js 1.05 MB), 404 for a missing file; first frame ≈ 3 s; the full scripted
walkthrough (three flows) against the live URL with **0 page errors and 0 console errors**; framed at 1280 × 800,
full screen as an emulated iPhone 15.

### Web fonts (follow-up)

A request log of the Japanese and Darija flows showed the web engine fetching Noto Sans Arabic, **SC** and **TC** from
`fonts.gstatic.com`: Japanese phrases were drawn with Chinese fonts (the engine picks CJK fallbacks by the browser's
language). Now: Noto Sans subsets per script (`tool/subset_fonts.py`, sources pinned to a google/fonts commit and
checked by SHA-256; 428 KB in all), each phrase and course name with its own script's font first, the rest of the
theme falling back to all of them, licenses registered. Same flows plus the 30-course catalog: **no external
request**, no errors. `test/script_fonts_test.dart` parses the subsets' cmaps: every character of each course's
phrases and native name is in its own script's subset; the interface strings need nothing else.

| File | Shows |
|---|---|
| `flutter-v2-40-web-desktop-frame`, `flutter-v2-41-web-iphone-welcome` | The phone frame in a laptop window; the first screen on an emulated iPhone with the readable language switch |
