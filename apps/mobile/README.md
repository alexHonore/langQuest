# @langquest/mobile — learner app (Expo SDK 57, Expo Router)

Conversation-first learner app for iOS, Android and web. Everything is free to learners: there are no
paywalls, credits, tiers or usage meters anywhere in this app.

## Run

```bash
# from the repo root
pnpm dev:mobile                 # expo start (press i / a / w)
pnpm --filter @langquest/mobile typecheck
pnpm --filter @langquest/mobile lint       # expo lint (eslint-config-expo + React Compiler rules)
pnpm --filter @langquest/mobile test       # vitest (stores, outbox sync, lesson + conversation machines, API client)
pnpm --filter @langquest/mobile export:web # expo export --platform web
```

Microphone, SQLite and secure store are native modules: use a development build (`npx expo run:ios|android`
or `eas build --profile development`) rather than Expo Go.

### Environment (public values only)

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (auth only; RLS protects learner rows). |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key. |
| `EXPO_PUBLIC_API_BASE_URL` | LangQuest API base (`https://…/`, routes under `/v1`). |
| `EXPO_PUBLIC_OAUTH_PROVIDERS` | Optional, e.g. `google,apple`; OAuth buttons appear only when set. |

Server secrets (OpenRouter, service role, R2) never reach this bundle. When a value is missing the app
shows an explicit "not configured" state instead of failing silently.

## Architecture

```
src/app/                 Expo Router routes (onboarding, auth, (tabs): Home/Missions/Audio/Speak/Progress,
                         catalog + enrollment wizard, enrollment editor, course switcher, mission player,
                         live conversation, pronunciation coach, characters, review session, account/*)
src/components/          Screen (AppShell + course/source-language header on every learner screen), state views
src/features/            pure feature logic + hooks
  lesson/machine.ts        listen → anticipate → record → compare state machine (A16 reveal rule)
  conversation/            §8.3 controller on top of @langquest/ai's reducer; VAD from recorder metering
  missions/story.ts        manifest → pathway (never locks free content)
  session/queries.ts       react-query + offline cache (network first, cached fallback flagged `fromCache`)
src/lib/                 api client (ROUTES, Zod-validated envelope, retry/backoff), supabase, i18n,
                         recorder/clip player (expo-audio), telemetry, haptics, network
src/store/               offline-first document store (expo-sqlite native / localStorage web), typed cache,
                         outbox (client UUIDs + monotonic revisions, idempotent replay) and sync engine
src/state/               zustand: auth, device prefs (persisted)
src/features/audio/placeholder.ts  replaced by the audio-library agent (src/audio/**, src/app/(tabs)/audio/**)
```

Key rules implemented here:

- Every enrollment carries its own `sourceLanguageCode`; the header shows the active course and its instruction
  language with an edit affordance; changing it calls `PATCH /v1/me/enrollments/:id` and invalidates only that
  pair's cached manifests/missions (progress is untouched).
- Pronunciation numeric scores render only when `assessmentMode` is acoustic (the shared `PronunciationFeedback`
  enforces it); otherwise the honest "no numeric score for this language yet" line.
- No fake waveforms: hands-free mode shows the real recorder metering level only while the mic is on.
- Offline: cached enrollments/manifests/missions/reviews, local mission progress, outbox events
  (`step_completed`, `review_result`, `activity_minutes`, `mission_abandoned`, `enrollment_opened`) synced on
  reconnect/foreground with the same client ids (server dedupes).
