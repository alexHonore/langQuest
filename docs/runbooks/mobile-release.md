# Mobile release runbook — `apps/mobile` (Expo SDK 57)

_Spec §13 Phase 3 (audio app acceptance), §13 Phase 12, ADR-001 (audio runtime) · Written 2026-10-15 against `apps/mobile`
as built. Companion: `developer-setup.md` §7, `docs/reference/expo-audio-sdk57.md`._

## 1. What the app is

Expo SDK 57 / Expo Router learner app (`apps/mobile/app.json`): name **LangQuest**, slug `langquest`, version `1.0.0`,
scheme `langquest`, portrait, `userInterfaceStyle: automatic`, iOS `bundleIdentifier` **`org.langquest.app`**
(`supportsTablet: true`), Android `package` **`org.langquest.app`** (adaptive icon set, predictive back disabled), web
`output: single`. Experiments: `typedRoutes`, `reactCompiler`. Routes live in `src/app/` (tabs Home / Missions / Audio /
Speak / Progress, onboarding, auth, catalog + enrollment, mission player, live conversation, pronunciation coach, characters,
review, account/*). Free for every learner — no paywalls, tiers or meters anywhere.

## 2. Required environment (public values only)

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | hosted Supabase project URL (auth only; RLS protects learner rows) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon/publishable key |
| `EXPO_PUBLIC_API_BASE_URL` | deployed Worker base URL (`https://langquest-api.<subdomain>.workers.dev` or custom domain); routes under `/v1` |
| `EXPO_PUBLIC_OAUTH_PROVIDERS` | optional, e.g. `google,apple`; OAuth buttons appear only when set **and** the providers are enabled in Supabase Auth |
| `EXPO_PUBLIC_APP_VERSION` | optional; shown in telemetry/About (defaults to `1.0.0`) |

Read in `apps/mobile/src/config/env.ts`. Server secrets (OpenRouter, service role, R2) never enter the bundle; a missing value
renders an explicit "not configured" state. For EAS, put these in `eas.json` build profiles (`env`) or EAS project secrets —
they are public by design, so `eas.json` is fine.

**Blocker:** there is no hosted Supabase project or deployed API yet (`provisioning.md`), so a production build would point at
nothing. Build against a staging deployment first.

## 3. Native configuration already in `app.json`

- **Background audio:** iOS `infoPlist.UIBackgroundModes: ["audio"]`; Android permissions
  `android.permission.FOREGROUND_SERVICE` and `android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK`; `expo-audio` plugin
  `enableBackgroundPlayback: true`, `enableBackgroundRecording: false`. At runtime `src/audio/expo-adapter.ts` sets the audio
  mode `playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix', allowsRecording: false` for
  library playback and activates lock-screen / Now Playing metadata (`setActiveForLockScreen`, `updateLockScreenMetadata`).
- **Microphone permission strings:** iOS `NSMicrophoneUsageDescription` = "LangQuest uses the microphone so you can practise
  speaking. Recordings are kept only if you choose to keep them."; `expo-audio` plugin `microphonePermission` = "LangQuest uses
  the microphone so you can practise speaking."; Android `android.permission.RECORD_AUDIO`. Permission is requested in context
  by `src/lib/recorder.ts` (`getMicPermission` / `requestMicPermission`; states `granted | denied | undetermined | unavailable`).
- **Plugins:** `expo-router`, `expo-splash-screen` (background `#208AEF`, `splash-icon.png`), `expo-audio`, `expo-sqlite`
  (offline document store), `expo-localization`, `expo-secure-store` (session), `expo-web-browser` (OAuth), `expo-notifications`
  (opt-in reminders, §10.4). Icons: `assets/images/icon.png`, iOS `assets/expo.icon`, Android adaptive set.
- **Not configured:** `expo-updates` / OTA (`runtimeVersion`, `updates.url` absent), `extra.eas.projectId` (absent → run
  `eas init`), `ios.buildNumber` / `android.versionCode` (EAS can auto-increment), App Store / Play privacy manifests beyond the
  permission strings, universal links / app links for `auth/callback` (deep link scheme `langquest://` only).

## 4. EAS build and submit

There is **no `eas.json` in `apps/mobile` yet** — create it on first release. Minimal starting point (adjust before use):

```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal",
      "env": { "EXPO_PUBLIC_SUPABASE_URL": "<staging>", "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<staging anon>", "EXPO_PUBLIC_API_BASE_URL": "<staging api>" } },
    "preview": { "distribution": "internal", "autoIncrement": true,
      "env": { "EXPO_PUBLIC_SUPABASE_URL": "<staging>", "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<staging anon>", "EXPO_PUBLIC_API_BASE_URL": "<staging api>" } },
    "production": { "autoIncrement": true,
      "env": { "EXPO_PUBLIC_SUPABASE_URL": "<prod>", "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<prod anon>", "EXPO_PUBLIC_API_BASE_URL": "<prod api>" } }
  },
  "submit": { "production": { "ios": { "appleId": "<apple id>", "ascAppId": "<app store connect id>", "appleTeamId": "<team>" },
                               "android": { "serviceAccountKeyPath": "./play-service-account.json", "track": "internal" } } }
}
```

Steps (run from `apps/mobile`; use `npx eas-cli@latest` per `AGENTS.md`, never hand-edit `ios/` / `android/` — Continuous
Native Generation):

```bash
npx eas-cli@latest login
npx eas-cli@latest init                                   # writes extra.eas.projectId into app.json
npx expo-doctor && npx expo install --fix                 # dependency / config sanity
pnpm --filter @langquest/mobile typecheck && pnpm --filter @langquest/mobile lint && pnpm --filter @langquest/mobile test
npx eas-cli@latest build --profile development --platform ios     # dev client for device QA (and android)
npx eas-cli@latest build --profile preview --platform all         # internal testers
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --platform ios --profile production     # App Store Connect (needs Apple developer account)
npx eas-cli@latest submit --platform android --profile production # Play Console (needs service account + first manual upload)
```

Local alternative for QA: `npx expo run:ios` / `npx expo run:android` (requires Xcode / Android Studio).

Store prerequisites not yet done (owner actions): Apple Developer Program + App Store Connect record for `org.langquest.app`,
Google Play Console app + service account, privacy policy URL and the §11 provider disclosure (third-party AI processors,
regions, retention) in the listing, age-rating / youth-account decision (§11: "do not assert COPPA/GDPR compliance without
implementing it"), Play "Data safety" and Apple "App Privacy" answers (microphone, account, diagnostics).

## 5. What was verified in the build session

| Check | Evidence |
|---|---|
| Web export | `pnpm --filter @langquest/mobile export:web` → `apps/mobile/dist/index.html` (2026-10-15); all screens render on web; one non-blocking React #418 hydration text-mismatch at first paint (`cross-package-gaps.md`) |
| Unit tests (vitest, Node environment, nothing imports React Native) | 17 test files under `src/**`: stores (`document-store`, `outbox`, `sync`), API client, lesson machine, conversation controller + VAD, missions story, audio engine (`AudioEngine`, `engine-state`, `transcript-sync`, `url-renewal`), audio features (`bookmarks`, `download-manager`, `library-search`, `listening-progress`, `queue`) |
| Typecheck + lint | `tsc --noEmit`, `expo lint` (eslint-config-expo + React Compiler rules) |
| Pronunciation honesty | shared `PronunciationFeedback` (`packages/ui`) shows a number only for `assessmentMode: 'acoustic-assessor'`; `src/app/pronunciation/index.tsx` otherwise shows "No numeric score for this language yet" (ADR-006) |
| Offline logic | outbox events `step_completed`, `review_result`, `activity_minutes`, `mission_abandoned`, `enrollment_opened` replay with the same client ids; server dedupes (API integration test A27 against the local stack) |
| Signed-URL renewal logic | `url-renewal.test.ts` (proactive before expiry, reactive on 403 / playback error, resume at last position) — with a **fake** player |

## 6. Not verified — device QA still owed (§13 Phase 3 acceptance, ADR-001 gate)

None of the following ran on a real iOS or Android device or simulator in the build session (no development build was
produced; native modules cannot run in Expo Go or on web):

- Play a **60-minute uploaded original track**, seek at 45 minutes, lock-screen controls, headphone disconnect/reconnect,
  Bluetooth route change, phone-call interruption and resume.
- Background playback on both platforms (iOS `UIBackgroundModes`, Android foreground media service) and sleep timer.
- Rate change with pitch correction, slow 0.75/0.85 renditions, A/B loop, chapter play queue.
- Download a lesson, listen in **airplane mode**, resume on another device with minimal position loss.
- Expired signed-media URL mid-stream → renewal → resume (needs R2, which is not enabled).
- Microphone permission prompt, `expo-audio` recorder metering (hands-free VAD), push-to-talk, recording retention choice.
- `expo-sqlite` native store, `expo-secure-store` session persistence, I18nManager RTL restart for Arabic/Hebrew UI.
- Notifications permission and quiet hours; OAuth round-trip through `expo-web-browser`.
- Accessibility pass with VoiceOver / TalkBack, font scaling, reduce-motion (mascot off).

Record results in a QA log (ADR-001 names `docs/provider-matrix/mobile-audio-qa.md`, which does not exist yet) before any
store submission; if `expo-audio` fails an item, the `AudioEngine` interface stays and the native adapter is swapped.

## 7. Known mismatches to fix before release

- **Account export / deletion:** the API exposes `GET /v1/me/export` and `DELETE /v1/me` (`packages/contracts` `meExport`,
  `meDelete`; integration test A28), but `src/app/account/danger.tsx` still states "Data export is not available in this
  build" and only wipes local caches — wire the screen to the routes. Hard delete also depends on a `delete_account` RPC in
  Supabase (append-only ledgers block cascades; `cross-package-gaps.md`).
- `MeResponseSchema.defaultSourceLanguageCode` is nullable in the API but required in contracts; the app uses a lenient local
  schema (`src/lib/api/me-schema.ts`).
- Course manifests carry no scene id; the pathway infers scene art heuristically (`src/features/missions/story.ts`).
- No crash/analytics sink is wired in production builds (`src/lib/telemetry.ts` drops events outside `__DEV__`); decide on
  PostHog/Sentry before launch (`../provider-matrix/provider-setup-and-cost.md` §2.8).

## 8. Rollback

Store builds cannot be rolled back; keep the previous build in TestFlight / Play internal track and re-promote it. Since OTA
updates are not configured, a bad release needs a new build with an incremented build number. Server-side rollback
(API Worker `wrangler rollback`, manifests regenerated from DB) does not require an app update.
