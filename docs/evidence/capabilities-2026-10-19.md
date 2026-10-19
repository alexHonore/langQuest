# Capability snapshots — live local run (2026-10-19)

Verification pass for CONVENTIONS §8 ("visible means usable"). Recorded against the local stack
(`supabase_db_langquest` healthy, API dev server on `http://127.0.0.1:8787`, `OPENROUTER_API_KEY` set, no media
storage binding, no Azure Speech key). No AI request was made (enrol + read only; live spend $0.00).

## Procedure

1. Learner created through the GoTrue admin API (service key): `verify-caps-<uuid>@langquest.test`,
   `ui_locale=fr-FR`, `default_source_language_code=fr`; signed in with the anon key.
2. `POST /v1/me/enrollments` `{courseTrackId:"arabic-moroccan", sourceLanguageCode:"fr"}` → **201** (target `ary`, script `both`, status `active`).
3. `POST /v1/me/enrollments` `{courseTrackId:"swahili", sourceLanguageCode:"en"}` → **201** (target `sw`, script `native`, status `active`).
4. `GET /v1/courses/arabic-moroccan/coverage?source=fr` → **200**, `Cache-Control: public, max-age=60, stale-while-revalidate=120`.
5. `GET /v1/courses/swahili/coverage?source=en` → **200**, same cache header.
6. `GET /v1/me/enrollments` → **200**, 2 enrollments, both carrying a `capabilities` snapshot identical to the public coverage answer for the same pair.
7. `purge_test_user` RPC (service role) → **200**, `authUserDeleted: true`, `user_course_enrollments: 2` deleted, `profiles: 1`, `account_settings: 1`; nothing retained for this account beyond the anonymised ledgers listed by the RPC.

## arabic-moroccan × fr (before enrolling = `coverage.capabilities`; after = `EnrollmentDto.capabilities`, identical)

| Capability | Value |
|---|---|
| `instructionLanguage` | `partial`, not native-reviewed; mission_instructions 100 %, explanations 100 %, ui 100 %, subtitles 0 %, audio_overlays 0 % |
| `missions` | available, 6 published / 6 localized |
| `audioLibrary` | **not available** (0 published collections with `instruction_language_code = fr`) |
| `liveConversation` | available, 52 characters, mode `text_and_voice` |
| `pronunciationScoring` | `reference_comparison` (no numeric score) |
| `offlineDownloads` | **not available** (no media storage binding) |
| `scripts.modes` | `native`, `latin`, `both` |
| `regionalOptions` | casablanca, fes, marrakech, north (`ar-MA`) |

`missing` (what the wizard discloses, in order): `instruction_language_draft` (info), `no_audio_library` (info), `no_pronunciation_scoring` (info). No blocking item.

What the app renders for this enrollment: Home mission card + Missions tab, Speak tab with characters and voice, Account → "What this course includes". Hidden: Audio tab and mini player, download controls, numeric score, Home "Continue audio".

## swahili × en

| Capability | Value |
|---|---|
| `instructionLanguage` | `planned`, not native-reviewed; every metric 0 % |
| `missions` | **not available** (0 published / 0 localized) |
| `audioLibrary` | **not available** (0 collections) |
| `liveConversation` | available, 1 character, mode `text_and_voice` |
| `pronunciationScoring` | `reference_comparison` |
| `offlineDownloads` | **not available** |
| `scripts.modes` | `native` |
| `regionalOptions` | KE (`sw-KE`), TZ (`sw-TZ`) |

`missing`: `instruction_language_planned` (**blocking**), `no_missions` (info), `no_audio_library` (info), `no_pronunciation_scoring` (info).

What the app renders: Home with "Quick speak" as the primary CTA (no mission card), Speak tab (1 character), Account. Hidden: Missions tab and pathway, Audio tab, downloads, pronunciation coach (no missions), numeric score. The wizard shows the blocking "planned" line; the confirm button stays enabled (the learner decides).

## Counts

- Enrollments created: 2 (both 201) · coverage reads: 2 (both 200) · DTO snapshots: 2 (both non-null, equal to the public answer) · learners purged: 1 (auth row deleted).
- `missing` items: arabic-moroccan×fr = 3 (0 blocking), swahili×en = 4 (1 blocking).
- Pre-existing `@langquest.test` accounts in the local `auth.users` before this run: 3 (left untouched; not created by this pass).
