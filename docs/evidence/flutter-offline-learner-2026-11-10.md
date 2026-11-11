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

### Account: sign-in and sync (follow-up, local stack)

The owner approved sign-in and progress sync with the instance. What the server allows shaped it: mission credit is
server-authoritative (XP and review cards only with an assessed spoken attempt), so the Flutter app syncs courses and
mission completion, and keeps practice XP and its review schedule on the device. Details in the app README.

| Check (local Supabase stack + `wrangler dev`, local test accounts only) | Result |
|---|---|
| Learner flow by hand (`signup` → token → `POST /v1/me/enrollments` → mission detail → attempt → evaluate) | 201, then 409 `conflict` on repeat; evaluate 200: `missionCredited=false`, 0 XP, next mission returned; mission ids = UUIDv5 of the bundle keys (checked in the DB) |
| Browser A (Docker image, `config.json` from env): first run → Settings › Create account → Spanish mission 1 through the UI | Signed in; server: `spanish-spain\|en active`, `mission_progress completed`, not credited |
| Browser B (fresh): Japanese first run → Settings › Sign in | Spanish course added next to Japanese, mission 1's stops done, 0 review cards, local XP untouched; 0 errors |
| `flutter test` | 82 passed (UUID vectors, config, sync: send / replay / restore / refused course / signed out, Settings section) |

Live setup (owner granted `keys:secret`, then said merge): the `langquest-api` Worker got `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (values piped from the Infra Tayoo API into `wrangler secret put`,
never printed; no OpenRouter key) and was redeployed from `master` with the web origin in CORS: `/healthz` 200, the
instance's four seeded courses listed, preflight from `https://web-languest.tayoo.app` allowed. `LQ_API_BASE_URL` set
on the hosted app. The first deployment of the account build served no `/config.json` (404): the start-up script
that wrote it did not run there (entrypoint overridden or read-only image). It is now a static template that Caddy
fills from the environment on each request — checked with a read-only root filesystem.

Live check (owner approved a temporary account): a confirmed account created through the admin API; browser A on
https://web-languest.tayoo.app signed in from Settings and completed Spanish mission 1 through the UI; the instance
then held `spanish-spain|en active` and the mission `completed` (not credited, as designed); a fresh browser B signed
in and got the Spanish course back next to its own Japanese one, mission 1's stops done, 0 review cards; the account
was then deleted through `DELETE /v1/me` (200 `deleted`). 0 page or console errors.

Test learner (owner's request): a confirmed account on the instance from the hosted app's `LOCAL_LEARNER_EMAIL` /
`LOCAL_LEARNER_PASSWORD` (domain `langquest.test`), so it signs in without an email; checked: sign-in ok, `/v1/me` 200.

Account data (follow-up, local stack): Settings › Account › Export my data downloaded `langquest-export-<date>.json`
in the browser (the server's bundle: profile, enrollments, progress, …); Delete my account required the typed word,
called `DELETE /v1/me`, showed "Your account was deleted." and signed out; signing in again was refused. A widget test
caught the confirmation field's controller being disposed during the dialog's closing animation (fixed: the dialog owns
it). `flutter test`: 84 passed.


Account data, live (after #8 was merged and the hosted app redeployed from `master`): the test learner signed in on
https://web-languest.tayoo.app, Delete my account was offered, Export my data downloaded the server's bundle
(`spanish-spain|en`), then signed out; 0 page errors. Read-only: the test learner was not deleted.

### Offline and record-and-compare (follow-up)

Offline: after one online visit (Chromium, against the image), 40 files cached and the page controlled by `sw.js`; with
the network cut, a reload started the app, and a first run → Japanese → its first lesson worked (こんにちは drawn in the
bundled Noto Sans JP); 0 errors. CI's image smoke test checks that `sw.js` is served.

Record and compare (Chromium, release build, fake microphone), on the Learn scene's learner line and on the Mission's
"say it" card: Record yourself → the microphone track is live while recording and ended right after Stop → My voice
plays the take (a `blob:` URL, nothing uploaded), next to Again. With a silent WAV as the microphone: "I didn't hear
anything…" and no playback. With getUserMedia refused (`NotAllowedError`): "The microphone is blocked…" and Try again.
0 page errors (the one 404 was `/config.json`, which only the image's Caddy serves). The first release build took the
failure path right after a successful start, though the VM widget tests passed: the dart2js output of `_start` read a
stale variable for the nullable `failure` local (assigned in a catch clause after an `await`, captured by a `setState`
closure). The start and stop outcomes now come back from small helper functions. `flutter test`: 95 passed (11 for the
recorder: states, the −50 dBFS silence floor, microphone released on stop and on leaving, French).

### Display settings and large text (follow-up, merged as #10)

Settings › Display: theme (dark, light, the device's — followed live), text size 90–180 % in − / + steps, reduce
motion, show or hide Melo. Probing every route at 130–200 % text on a 360 × 690 phone found three overflows (welcome
screen, a Settings card header, the Progress week row), fixed; a widget test now visits every screen at 200 %, and the
whole mission-node walk runs at 100 % and 200 %. In Chromium (release build): Device followed the browser into dark,
text size stepped to 130 %, Home ran 0 animation frames per second under reduced motion (about 15 before), Melo
hidden. A Material `Slider` was replaced by the steps: its value bubble's overlay showed as an empty full-screen node
with `pointer-events: auto` on top of the page in the web accessibility tree.

### Email confirmation and password reset (follow-up, local stack)

Release web build against the local Supabase (emails caught by Mailpit) and the local API:
- Forgot password? → "a link to choose a new password is on its way" (announced: the account notices are now live
  regions) → the email's link redirects to the app → address cleaned, **Choose a new password** → saved: the server
  accepts the new password and refuses the old one. The same link again: "This email link can't be used…". A link
  asked for in one browser and opened in another (no PKCE verifier there): the same explanation, no dialog.
- With confirmations turned on locally (config restored afterwards): Create account → "Check your email…" → the
  confirmation link → back in the app, "Email confirmed. You're signed in.", the course saved to the new account;
  the server shows the email confirmed and `ui_locale` from the sign-up metadata. 0 page errors.
- The Infra Tayoo instance's auth logs show GoTrue answering with `referer: http://localhost:3000`: its Site URL is
  still the default and the web origin is not an allowed redirect, so links from it would not reach the web app until
  the owner sets them (not reachable through the instance API).

### Practise saying, and a browser smoke test in CI (follow-up)

Practise saying (Chromium, release build, fake microphone): before the Learn stop no entry on the path; after it,
**Practise saying the phrases** → each phrase with Record yourself → My voice; the next phrase drops the previous take;
Done returns to the path; 0 page errors. Widget tests: the entry needs a recorder and a done Learn stop; the walk
through every phrase, back, Done. `tool/web_smoke.cjs` passed locally and against https://web-languest.tayoo.app
(first run, a lesson, record yourself with the microphone released after the take, Settings › Display, 0 errors) before
joining the CI image job.

### First-run warm-up, and spaced pages without intrinsics (follow-up)

After the first course is chosen, **Try your first phrase** shows the course's first taught phrase (Chromium, release
build, fake microphone: shown, a take recorded and offered for playback, Start learning → Home; a second course opens
Home directly; 0 errors). The 200 % text test failed when run on its own (it passed in the full file): the welcome
screen's Column inside an IntrinsicHeight was 28 px taller than its intrinsic estimate with the test font. The welcome
and warm-up screens now use `SpacedPage` (min-height column with `spaceBetween`, no intrinsic pass); the test passes on
its own and in the suite. `flutter test`: 114 passed.

### First visit lighter by about 1.4 MB (follow-up)

Measured on the live site (Chromium, CDP encoded sizes): a first visit downloaded 5.7 MB in 41 responses, of which
1.44 MB were six `LucideVariable-w100…w600.ttf` files. lucide_icons_flutter declares them for its
`lucide_icons_<weight>.dart` libraries, which the app never imports (its icons use the tree-shaken `Lucide` family),
and the web engine downloads every font in `FontManifest.json` at start-up. `tool/prune_web_fonts.dart` removes the
six families after the build (refusing if `lib/` imports a weight library); on the pruned release build the smoke test
passes, icons render, and no LucideVariable file is requested. CI checks the image's manifest.

### Speech check against the live server (follow-up, 2026-11-11)

The owner enabled the Worker's AI (OpenRouter) on the instance. Release build served locally, signed in as the
instance's test learner, Chromium's fake microphone playing the server's own voice saying "Hola, buenos días."
(`--use-file-for-fake-audio-capture`); API calls to the live Worker through a route adding CORS for the local origin.
Mission *Greet and introduce yourself*, exchange 1 (asks for "Hola, buenos días."): the take went to
`POST /v1/speech/pronunciation-assess` as `webm_opus` with expression id `bf0c634b-…` (the seed's UUIDv5) and the
mission's id as `scenarioId`; verdict **Understood!**, *I heard: "Hola, buenos días."*. Exchange 2 (asks for "¿Qué
tal?") with the same audio: **Not quite**, *I heard: "Hola, buenos días."*. 0 page errors. Verdicts are about meaning
(the course's scorer is reference comparison: no number is shown). `flutter test`: 132 passed (verdict mapping, the
request's ids and encoding, capability snapshots, the widget states, a mission walked with checked replies).

### Live call with a mission's character (follow-up, 2026-11-11)

Release build, test learner, live Worker (CORS added by a test route), Chromium fake microphone saying "Hola, buenos
días.": the path of *Greet and introduce yourself* showed the Talk stop; **Call** → Pablo (the server's character for
the mission; his roster portrait) picked up in 6.4 s with "¡Buenos días! Voy con prisa, pero ¿qué tal estás?" (voice,
gloss, `greeting`); the spoken turn was heard as "Hola, buenos días." and answered with a follow-up question (6.2 s);
**Hint** answered with an example and an English explanation; **Hang up** showed the evaluation (+4 XP, goals met 1 of 5,
one correction: "Bien, ¿y tú?") after 17 s. 0 page errors. The mission's five goals came with empty descriptions (the
seeded goals have no English description), so the app shows them as progress dots and lists none by name.
`flutter test`: 153 passed (session, turns, retries, no-speech, commands, end and failures against a fake API; the call
screen walked by voice and in writing, at 200 % text, with Flutter's tap-target and label guidelines; portraits
byte-identical to the art roster).

### Audio lessons and the AI voice (follow-up, 2026-11-11)

Release build, test learner, live Worker. Headless Chromium has no speech voices at all, so the course is read by the
server's AI voice: the **Audio** tab appeared ("Read by an AI voice"), the lesson of *Greet and introduce yourself*
played (intro as a caption, then each line synthesized by `/v1/speech/synthesize` — 0.6 s per line once warm, clips of
about 1.9 s, distinct per line), paused at once, and the scene's Listen button became "Listen (AI voice)". 0 page errors.
The lesson now prefetches the next two lines while one plays. The course page lists the audio lessons ("read by an AI
voice (with a free account)") and, for Darija, an AI voice for the dialect with the server's "limited" caveat.
`flutter test`: 158 passed (lesson structure, the player's order / pause / next / previous / slow / turn countdown, the
Audio tab and a lesson heard to the end, no tab without a voice, the course page).

### Speak tab and immersive motion (follow-up, 2026-11-11)

**Speak** tab (when live calls back the course): the course's characters from its manifest, each opening a free call
(`characterId`, no mission: no goals, no path stop). Motion, where it is on: confetti and a counting-up XP when a
mission completes (checked in Chromium on the release build: the burst, Melo's pop and "+50 XP" counting, 0 errors), a
call ends with goals met, or an audio lesson is heard to the end; a wrong option shakes and the right one pops; scene
lines arrive from their speaker's side; a speaking character's badge pulses. All decorative and absent with reduced
motion. `flutter test`: 162 passed.
