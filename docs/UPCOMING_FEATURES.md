# Upcoming / hidden features (developer-facing)

Per the "visible means usable" rule (docs/CONVENTIONS.md §8), these features exist in code but are hidden from learners
until their unlock condition is met. Nothing in the learner app says "not available", "coming soon" or shows a greyed
placeholder for them: the enrollment wizard (and the onboarding confirm step) discloses the relevant items per
course × instruction language BEFORE enrolling, and Account → "What this course includes" (`/account/includes`, also
inside the per-course editor `/enrollment/[id]`) lists them AFTER enrolling.

## Where the decision comes from

The API attaches a `CourseCapabilities` snapshot (`packages/contracts/src/capabilities.ts`) to:

- `GET /v1/courses/:trackId/coverage?source=` → `data.capabilities` — read by the wizard before enrolling
  (`useCourseCapabilities` in `apps/mobile/src/features/session/queries.ts`; public, `Cache-Control: max-age=60`).
- `EnrollmentDto.capabilities` on `/v1/me`, `POST/GET/PATCH /v1/me/enrollments` — read after enrolling
  (`useEnrollmentNavigation` in `apps/mobile/src/features/session/use-capabilities.ts`). Capabilities are per
  (track, source) pair; a `PATCH sourceLanguageCode` refetches the DTO, so the tabs follow the new pair.
- `CourseManifest.capabilities` — informational; clients treat it as a short-lived overlay, not versioned content
  (the manifest ETag carries a 12-hex capabilities fingerprint).

The mobile mapping is the pure module `apps/mobile/src/features/session/capabilities.ts` (`resolveNavigation`,
`visibleTabs`, `homeCta`, `buildDisclaimer`, `buildIncludes`, `completeUiLocales`, `withoutNumericScore`), unit-tested
in `capabilities.test.ts`. **Unknown snapshot (offline first run, a DTO cached by an older build) → everything optional
is hidden**, never shown; the snapshot is cached with the enrollment, so offline behaviour equals the last online state.

## Hidden features and unlock conditions

| Feature | Where it lives | Hidden when | Unlock condition | `missing[].key` disclosed |
|---|---|---|---|---|
| Audio library tab, player, "Continue audio" button, global mini player | apps/mobile/src/features/audio, `(tabs)/audio/**` | `audioLibrary.available` is false: no **published** `audio_course_collections` for the track whose `instruction_language_code` equals the enrollment's source (collections with a NULL instruction language do not count) | admin publishes a rights-verified collection for that track with the instruction language set | `no_audio_library` |
| Mission pathway / story map, Home mission card | apps/mobile/src/features/missions, `(tabs)/missions` | `missions.available` is false: coverage status not `partial`/`complete`, or `publishedCount` = 0, or `localizedCount` = 0 (a `planned` pair hides missions even with drafts) | editor sets the course × source coverage to `partial` or `complete` (admin → Languages) + `seed-curriculum --apply` / editorial publish; the API purges its 60 s counts cache on `invalidateCourse` | `no_missions` |
| Home primary CTA | `(tabs)/index` | — (never hidden): mission card when missions exist, else "Quick speak" when live conversation exists, else nothing | — | — |
| Live AI conversation (Speak tab quick-speak, character cards, `/characters`, `/conversation`) | apps/mobile/src/features/conversation, `(tabs)/speak` | `liveConversation.available` is false: `OPENROUTER_API_KEY` unset or no published characters for the variety | key set + characters seeded (migration 130) + `ai_model_profiles` enabled | `no_live_conversation` |
| Voice in the conversation (mic, hands-free, replay/slower, speak-mode card) | `/conversation`, `(tabs)/speak` | `liveConversation.mode` is `text_only` (STT or TTS not usable in the `@langquest/ai` matrix); the session is forced `text_only` | STT and TTS providers usable for the variety | `text_only_conversation` |
| Pronunciation coach (`/pronunciation`) and mission mic coaching | apps/mobile pronunciation coach, `/mission/[id]` | `pronunciationScoring.mode` is `none` (no `OPENROUTER_API_KEY`) or the pair has no missions; missions then take typed answers only | key set (→ `reference_comparison`) | `no_pronunciation_feedback` |
| Numeric pronunciation score | `PronunciationFeedback` (ui) | `pronunciationScoring.mode` is not `acoustic` (Darija never is); the client also strips `numericScore`/`wordScores` from results | `AZURE_SPEECH_KEY/REGION` set and the locale is documented (ADR-006) | `no_pronunciation_scoring` |
| Offline download pack (download button, storage line, `/audio/downloads`, per-lesson controls) | apps/mobile/src/features/audio/downloads | `offlineDownloads.available` is false (no R2 binding / S3 creds, or no audio library) or the platform is web (`expo-file-system` `Directory` is native-only) | R2 enabled + secrets set; native build | `no_offline_downloads` (only emitted when audio exists but media storage is off) |
| Speak tab as a whole | `(tabs)/_layout` | neither live conversation nor pronunciation drills exist | either of the two above | — |
| Full-duplex realtime voice | packages/ai realtime | always (DuplexProviderStub) | a benchmarked duplex provider is configured (ADR-002) | — |
| Partial interface languages (es, ru) in the UI-language pickers | packages/locales, `account/index`, `onboarding/language` | catalog completeness < 100% (`COVERAGE_METADATA`); they remain selectable as **instruction** languages wherever a course has coverage | catalogs completed and reviewed (`coverage.json` regenerated) | `partial_interface_language` |
| Instruction-language editorial status | wizard + account disclaimer | never hidden; shown as a status line (`enrollment.coverage.*`) with the native-review caption | — | `instruction_language_draft` (partial, or complete but not native-reviewed), `instruction_language_planned`, `instruction_language_unavailable` (both blocking) |
| Account export / deletion | apps/mobile account screen | never hidden (always usable) | — | — |
| Review session button (Home, Progress) | `(tabs)/index`, `(tabs)/progress` | `dueCount` is 0 (nothing to review right now); the Progress review calendar stays | an expression becomes due | — |
| Transcript toggle in the audio player | `packages/ui` `AudioPlayer`, `(tabs)/audio/lesson/[id]` | the lesson has no transcript (`transcript.available` false) | a transcript is published for the lesson | — |
| Character "Talk" button on `/characters/[id]` | apps/mobile characters | no active enrollment (the screen is reached from a stale link) | an enrollment is active | — |
| Realtime-voice notice in the conversation | `/conversation` | always: turn-by-turn is the only mode, so no "live voice is not available" line is rendered | a duplex provider is configured (ADR-002); the mode line would then describe it | — |
| "No numeric score yet" line under pronunciation feedback | `packages/ui` `PronunciationFeedback` | always when the mode is not acoustic: only the assessment-mode line (what WAS compared) is shown | `acoustic` mode (see "Numeric pronunciation score") | `no_pronunciation_scoring` |

Tabs are removed with `href: null` (route stays registered); each hidden screen also redirects Home, so a stale deep
link never lands on an empty tab. The confirm button in the wizard stays enabled whatever the disclaimer says: the
learner decides.

## Hidden in the admin Studio (same rule)

| Feature | Where it lives | Hidden when | Unlock condition |
|---|---|---|---|
| Analytics timeline charts whose series the API does not compute (recall 7d / 30d, any all-null series) | `apps/admin/app/(studio)/analytics` `TimelineChart` | `timelineHasValues(data)` is false: the chart (and its label) is not rendered, nothing is estimated in its place | the API computes the metric (`adminAnalyticsQuality` returns non-null points) |
| Stored visual-asset preview (detail screen, focal-point editor) | `visual-assets/[id]`, `src/components/focal-point.tsx` | the Studio has no signed-URL route for stored visual assets: metadata only, no "no preview" caption; the local preview exists while uploading | a signed-URL route for visual assets is added to the API and the Studio proxy |
| "Cost today" dashboard card | `(studio)/page.tsx` | the signed-in role cannot read `ai_requests` (admin-only): the card is not rendered | admin role |
| Job cancel | jobs screen | always (no worker-side cancel RPC; pending jobs are deprioritised through the API instead) | a worker-side cancel RPC |
| Model discovery count / benchmark column (AI models) | `ai-models-screen` | the API is unreachable (`SetupCard` shows the missing step instead); a failed discovery call reads as an error, not as "unavailable" | API reachable + `OPENROUTER_API_KEY` |

_This file is maintained by the polish pass; the enrollment wizard reads the live capability snapshot from the API, not this file._
