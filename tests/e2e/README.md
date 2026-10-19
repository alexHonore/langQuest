# Mobile E2E (Maestro) and where the other E2E suites live

| Surface | Tool | Location | Notes |
|---|---|---|---|
| Admin CMS | Playwright | `apps/admin/e2e/*.spec.ts`, `pnpm --filter @langquest/admin test:e2e` | login redirect, role gate, uploads page; needs `ADMIN_E2E_*` accounts |
| Mobile app | **Maestro** | `tests/e2e/maestro/*.yaml` (this folder) | flows below; run against a dev build on a simulator/emulator |
| API | Vitest (in-process) | `tests/integration`, `tests/security` | no network: the Hono app is imported from `apps/api` |

## Why Maestro

Expo SDK 57 + Expo Router; the app has **no `testID`s yet**, so flows select by the visible copy from
`@langquest/locales` (English catalog) and by `accessibilityLabel`s the screens already set. Every `tapOn: "…"`
string below is a real `en` catalog value (e.g. `onboarding.getStarted` = "Get started", `enrollment.editSource` =
"Change instruction language", `home.switchCourse` = "Switch course"). If copy changes, update the flow and the
catalog together. Flows are written for the English UI locale; set the simulator language to English.

## Prerequisites

1. Maestro CLI: `curl -Ls https://get.maestro.mobile.dev | bash` (needs Java 17+).
2. A **development build** of the app on a booted simulator/emulator (bundle id `org.langquest.app`):
   ```bash
   cd apps/mobile
   cp .env.example .env   # EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY / EXPO_PUBLIC_API_BASE_URL
   npx expo run:ios   # or: npx expo run:android
   ```
   The API base URL must point at a running `pnpm dev:api` (wrangler dev, :8787) bound to the same Supabase stack.
   On Android emulators use `http://10.0.2.2:8787` and `http://10.0.2.2:54321`.
3. Test accounts on that stack. Flows take credentials from env (never hard-coded):
   - `MAESTRO_EMAIL` / `MAESTRO_PASSWORD` — a learner **with no enrollments** for `onboarding.yaml` and
     `enroll.yaml` (create with `supabase auth` admin API or the sign-up flow once).
   - `MAESTRO_EMAIL_ENROLLED` / `MAESTRO_PASSWORD_ENROLLED` — a learner already enrolled in **Arabic (Moroccan)
     from French** with at least one published mission and one published audio lesson visible (seed through the admin
     CMS or the integration harness `Seeder` in `tests/src/harness/seed.ts`).
4. Content: the lesson/audio flows only pass when published content exists for that enrollment. They assert honest
   empty states otherwise and are expected to **fail** on an unseeded stack — there is no fake content path.

## Running

```bash
cd tests/e2e
export MAESTRO_EMAIL=... MAESTRO_PASSWORD=... MAESTRO_EMAIL_ENROLLED=... MAESTRO_PASSWORD_ENROLLED=...
maestro test maestro/onboarding.yaml
maestro test maestro/                     # all flows, alphabetical
maestro test --device <udid> maestro/airplane-mode.yaml   # Android only (setAirplaneMode)
```

Maestro Cloud / CI: `maestro cloud --app-file <build> maestro/` — not wired into the repo CI on purpose (needs a
device farm + seeded stack). Recordings: `maestro record maestro/lesson.yaml`.

## Flows

| File | Journey | Spec |
|---|---|---|
| `_sign-in.yaml` | shared sub-flow: sign in with `EMAIL`/`PASSWORD` parameters | — |
| `onboarding.yaml` | welcome → UI + instruction language → target track → confirm "Learn Arabic (Moroccan) from French" → warm-up (skippable) → Home shows the active course + source language | A02, §10.2B screen 1 |
| `enroll.yaml` | signed-in learner adds a second course (Japanese from English) from the catalog; both courses listed with their own instruction language | A03 |
| `switch-source-language.yaml` | open the enrollment, change instruction language fr → en, see "Now learning … from English", progress untouched (Progress tab still lists the course), switch back | A04 |
| `lesson.yaml` | open the first mission from the pathway, walk listen → anticipate (reveal and compare) → next step → leave mission with confirmation | A16, §3.3 |
| `audio-seek.yaml` | Audio tab → collection → lesson → play, skip forward/back, bookmark, pause; position label changes | A21 |
| `airplane-mode.yaml` | with a downloaded lesson, enable airplane mode (Android), app shows the offline banner, downloaded lesson still plays, re-enable network, progress syncs | A23, §4.5 |

Each flow starts from `launchApp` with `clearState: false` except `onboarding.yaml` (fresh state). Assertions are
on visible, honest UI: no numeric pronunciation score is ever expected, and offline/unsupported states are asserted by
their real copy (`errors.offlineLessonsAvailable`, `audio.player.transcriptUnavailable`).
