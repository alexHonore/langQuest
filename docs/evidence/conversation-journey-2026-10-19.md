# Conversation journey — 2026-10-19 (local API, live OpenRouter)

End-to-end proof of the Speak-tab journey the live walkthrough broke on ("Character not found", see
`ux-observations-2026-10-19.md`): the character ids the client now takes from the course manifest resolve in
`POST /v1/ai/conversation/session`, and a text-only Darija-from-French session runs to `/end` against the real
provider. Recorded from the repository root on 2026-10-19, 21:03–21:04 local time (UTC in the timestamps below).

## Environment

| Item | Value |
|---|---|
| API | `wrangler dev` on `http://127.0.0.1:8787` (`apps/api/.dev.vars`: local stack keys + `OPENROUTER_API_KEY`), already running; not restarted |
| Local stack | Docker `supabase_db_langquest` (healthy, up 5 h), auth/kong/rest/pg_meta/inbucket up; `SUPABASE_URL=http://127.0.0.1:54321` |
| Driver | `node journey.mjs` (scratchpad script, plain `fetch`): GoTrue admin API with the service key → password sign-in with the anon key → `/v1` calls with the learner's Bearer token → `purge_test_user` RPC with the service key |
| Model profile | `character_dialogue` × `ary` → `anthropic/claude-sonnet-5.5` (package default); `learner_evaluation` × `ary` → same model |
| Spend | 4 `ai_requests` rows, estimated total **$0.0317** (2 dialogue calls, 2 evaluator/summary calls); first attempt earlier that evening (see §Regression) cost a further $0.021 |

Tokens are redacted (`<redacted N chars>`); every other byte is as returned. Ids are from this run and no longer
exist (the learner was purged at the end).

## 1. Learner (GoTrue admin API, service role) → `200`

```json
POST <SUPABASE_URL>/auth/v1/admin/users
{"email":"journey-7f0474bd@langquest.test","password":"<redacted>","email_confirm":true,
 "user_metadata":{"ui_locale":"fr-CA","default_source_language_code":"fr"}}
→ {"id":"b99a3bd0-ef1c-43e6-b7cf-8dfcc20991b6","aud":"authenticated","role":"authenticated",
   "email":"journey-7f0474bd@langquest.test","email_confirmed_at":"2026-10-19T21:03:46.175594965Z", …}
```

## 2. Sign-in (anon key) → `200`

```json
POST <SUPABASE_URL>/auth/v1/token?grant_type=password   {"email":"journey-7f0474bd@langquest.test","password":"<redacted>"}
→ {"access_token":"<redacted 864 chars>","token_type":"bearer","expires_in":3600,"expires_at":1792447426,
   "refresh_token":"<redacted 12 chars>","user":{"id":"b99a3bd0-ef1c-43e6-b7cf-8dfcc20991b6", …},"weak_password":null}
```

## 3. `POST /v1/me/enrollments` → `201` (120 ms)

```json
{"courseTrackId":"arabic-moroccan","sourceLanguageCode":"fr","scriptMode":"both"}
→ {"ok":true,"data":{"id":"b2842678-12f1-46cf-9097-18607dacfdd8","courseTrackId":"arabic-moroccan",
   "sourceLanguageCode":"fr","targetVarietyId":"ary","preferredTargetVariantId":null,"regionalPreference":null,
   "scriptMode":"both","learnerLevel":"beginner","status":"active","preferredLearningSpeed":"regular",
   "activeMissionId":null,"translationPeekLanguageCode":null,"addedAt":"2026-10-19T21:03:46.328295+00:00",
   "lastOpenedAt":null,"coverage":{"status":"partial","nativeReviewed":false,
   "editorialNoteKey":"enrollment.coverage.draftAvailable","fallbackSourceLanguageCode":null}}}
```

## 4. `GET /v1/courses/arabic-moroccan/manifest?source=fr` → `200` (16 ms, `X-Cache: HIT`, `ETag: "b961356b6d655b1a1389c104d92f7997"`)

`data.version = 1`, `data.characters.length = 52` (non-empty). Keys present: `formatVersion, version, checksum,
courseTrackId, sourceLanguageCode, targetVarietyId, chapters, characters, generatedAt, coverArt, cacheTtlSeconds`.

The two published roster characters (the ones `@langquest/ui`'s art roster knows) are in the list with their
deterministic ids and `syntheticVoice: true`:

```json
{"id":"58835d74-6c1e-5735-a386-62b6af2dd06b","characterKey":"ary-cafe-staff-nadia","name":"Nadia","role":"Café staff",
 "region":"Casablanca, Morocco","regionalOption":"casablanca","varietyId":"ary","portrait":null,
 "portraitKey":"ary-cafe-staff-nadia","syntheticVoice":true}
{"id":"c89e9332-3491-5c7a-8977-e566d97f5934","characterKey":"ary-neighbour-youssef","name":"Youssef","role":"Neighbour",
 "region":"Rabat, Morocco","regionalOption":"casablanca","varietyId":"ary","portrait":null,
 "portraitKey":"ary-neighbour-youssef","syntheticVoice":true}
```

The other 50 entries are **leaked test characters** of this local database (`hard.test.*`, `tests.char_*`, `fix.*`,
`live.test.*`, all `state = published`, `voice_profile = {"synthetic": true}`), left behind by earlier test runs —
see §Regression 2. `characters[0]` on this database is therefore one of them:

```json
{"id":"b88224fc-ce57-4529-8a31-679f659e3220","characterKey":"hard.test.2aa384843b","name":"Khadija","role":"café owner",
 "region":"Casablanca","regionalOption":null,"varietyId":"ary","portrait":null,"portraitKey":"hard.test.2aa384843b",
 "syntheticVoice":true}
```

The session below uses it, exactly as "first character in the manifest" was asked; the lookup path is the same for
every manifest id (`characters.id` uuid → `resolveCharacterRef` → published row under RLS).

## 5. `POST /v1/ai/conversation/session` → `201` (3389 ms, real OpenRouter call)

```json
{"enrollmentId":"b2842678-12f1-46cf-9097-18607dacfdd8","characterId":"b88224fc-ce57-4529-8a31-679f659e3220",
 "clientSessionId":"5eaca436-8526-48f8-b934-10b022d24d9b","mode":"text_only"}
→ {"ok":true,"data":{
   "session":{"sessionId":"5eaca436-8526-48f8-b934-10b022d24d9b","state":"listening","mode":"text_only",
     "targetVarietyId":"ary","turnCount":1,"lastLearnerTurnId":null,
     "lastCharacterTurnId":"2950e0f6-4808-404f-9a48-fa1d390aff8c","lastSeq":1,"objectivesCompleted":[],
     "startedAt":"2026-10-19T21:03:46.409054+00:00","updatedAt":"2026-10-19T21:03:49.749663+00:00","endedAt":null},
   "provider":{"sessionId":"5eaca436-8526-48f8-b934-10b022d24d9b","provider":"pipeline_stt_llm_tts",
     "clientToken":"<redacted 334 chars>","connectUrl":null,"expiresAt":"2026-10-19T21:18:46.000Z",
     "pipeline":"text_only","vad":null},
   "character":{"id":"b88224fc-ce57-4529-8a31-679f659e3220","name":"Khadija","role":"café owner",
     "targetVarietyId":"ary","syntheticVoice":true,"portraitAssetId":null},
   "capabilities":{"realtime":{"supported":true,"reasons":["not_benchmarked"],…,"effectiveLocale":"ar-MA","qualityEstimate":0.35,
     "provider":"pipeline_stt_llm_tts"},"recognition":{"supported":true,…,"provider":"openrouter"},
     "synthesis":{"supported":true,…,"notes":[…,"voice=ary-f-1","model=google/gemini-3.8-flash-lite-tts","synthetic=true"]},
     "pronunciation":{"supported":true,"reasons":["feature_unsupported"],…}},
   "objectives":[],
   "openingTurn":{"turnId":"2950e0f6-4808-404f-9a48-fa1d390aff8c","characterId":"b88224fc-ce57-4529-8a31-679f659e3220",
     "text":"مرحبا بيك! لاباس عليك؟ شنو بغيتي تشرب؟",
     "transliteration":"Mr7ba bik! Labas 3lik? Chno bghiti tchrab?",
     "sourceGloss":"Bienvenue ! Ça va ? Qu'est-ce que tu veux boire ?",
     "expression":"greeting","respondsToCommand":null,"tentativeObjectiveIds":[],"audio":null,
     "endsConversation":false,"model":null,"latencyMs":3297}}}
```

**Opening Darija line:** `مرحبا بيك! لاباس عليك؟ شنو بغيتي تشرب؟` — **French gloss:** `Bienvenue ! Ça va ? Qu'est-ce que tu veux boire ?`

(`capabilities` abbreviated with `…`; the full object is the same shape the integration tests assert.)

## 6. `POST /v1/ai/conversation/5eaca436-…/turn` (text) → `200` (4109 ms)

```json
{"clientTurnId":"17c43b82-76c5-4129-a37b-80561fe4be5d","input":{"kind":"text","text":"سلام، كيف داير؟"},
 "clientState":{"state":"listening","lastSeq":1,"lastCharacterTurnId":"2950e0f6-4808-404f-9a48-fa1d390aff8c"}}
→ {"ok":true,"data":{
   "session":{"sessionId":"5eaca436-8526-48f8-b934-10b022d24d9b","state":"listening","mode":"text_only",
     "targetVarietyId":"ary","turnCount":3,"lastLearnerTurnId":"af1620be-b650-487a-83f0-2db7e758cee9",
     "lastCharacterTurnId":"c11057d9-07db-4ca7-a499-8268758bad1c","lastSeq":2,"objectivesCompleted":[],
     "startedAt":"2026-10-19T21:03:46.409054+00:00","updatedAt":"2026-10-19T21:03:53.859603+00:00","endedAt":null},
   "learnerTranscript":{"text":"سلام، كيف داير؟","confidence":null},
   "characterTurn":{"turnId":"c11057d9-07db-4ca7-a499-8268758bad1c","characterId":"b88224fc-ce57-4529-8a31-679f659e3220",
     "text":"الحمد لله، لاباس! شنو بغيتي تشرب؟",
     "transliteration":"L7amdulillah, labas! Chno bghiti tchrab?",
     "sourceGloss":"Ça va bien, merci ! Qu'est-ce que tu veux boire ?",
     "expression":"follow_up_question","respondsToCommand":null,"tentativeObjectiveIds":[],"audio":null,
     "endsConversation":false,"model":null,"latencyMs":4045},
   "replayed":false,"evaluationPending":false,"objectivesCompleted":[]}}
```

**Reply (Darija):** `الحمد لله، لاباس! شنو بغيتي تشرب؟` — **French coaching gloss:** `Ça va bien, merci ! Qu'est-ce que tu veux boire ?`

## 7. `POST /v1/ai/conversation/5eaca436-…/end` → `200` (14 971 ms: evaluator + summary)

```json
{"reason":"learner_ended","clientState":{"lastSeq":2,"turnCount":3},"clientEventId":"faed12ba-21fd-44b0-89cf-0551b756ba6e"}
→ {"ok":true,"data":{
   "session":{"sessionId":"5eaca436-8526-48f8-b934-10b022d24d9b","state":"finished","mode":"text_only","targetVarietyId":"ary",
     "turnCount":3,"lastLearnerTurnId":null,"lastCharacterTurnId":null,"lastSeq":3,"objectivesCompleted":[],
     "startedAt":"2026-10-19T21:03:46.409054+00:00","updatedAt":"2026-10-19T21:04:08.808181+00:00","endedAt":"2026-10-19T21:04:08.805+00:00"},
   "evaluation":{"objectivesCompleted":[],"skillsExercised":["greetings.basic","greetings.how_are_you"],
     "observations":[
       {"skillKey":"greetings.how_are_you","observationType":"spoken_production","autonomy":"unaided","hintsUsed":0,"outcome":"success",
        "utteranceConfidence":null,"uncertainty":0.2,
        "note":"L'apprenant a salué et demandé des nouvelles en darija (« سلام، كيف داير؟ »), de façon compréhensible et naturelle. « كيداير » est aussi très courant."},
       {"skillKey":"greetings.basic","observationType":"semantic_success","autonomy":"unaided","hintsUsed":0,"outcome":"success",
        "utteranceConfidence":null,"uncertainty":0.25,"note":"Échange de salutations réussi avec le personnage, registre neutre adapté."},
       {"skillKey":"ordering.cafe","observationType":"listening_comprehension","autonomy":"unaided","hintsUsed":0,"outcome":"unclear",
        "utteranceConfidence":null,"uncertainty":0.7,
        "note":"La question « شنو بغيتي تشرب؟ » n'a pas encore reçu de réponse ; la compréhension n'est pas encore évaluable."}],
     "priorityCorrections":[],
     "summary":"Début de conversation au café : l'apprenant salue et demande des nouvelles en darija de façon naturelle. Il n'a pas encore répondu à la question sur la boisson.",
     "reviewTriggers":["ordering.cafe","bghit_boisson"],
     "relationshipMemoryUpdate":"L'apprenant a salué chaleureusement le patron du café en darija et s'apprête à commander une boisson.",
     "confidence":0.8},
   "xpAwarded":2,
   "scheduledReviews":[{"cardId":"eae19359-eb10-4961-8534-9b7383eb3e61","targetKind":"skill","targetId":"ordering.cafe","due":"2026-10-19T21:05:03.73+00:00"},
                       {"cardId":"325e356d-6880-4ca9-ae4e-45d6da809af1","targetKind":"skill","targetId":"bghit_boisson","due":"2026-10-19T21:05:03.73+00:00"}],
   "summary":"Objectif : saluer et commander une boisson dans un café en arabe marocain (darija). Points positifs : tu as répondu à la salutation et demandé « كيف داير؟ » de façon naturelle. À travailler : répondre à la question « شنو بغيتي تشرب؟ » en disant par exemple « بغيت قهوة …",
   "transcriptRetained":false}}
```

(The observation rows also carry `scenarioId`/`conversationSessionId` = the session id and `missionId`/`missionAttemptId`/`expressionId` = null; omitted above for width. `summary` is cut at the width of this page only.)

Every learner-facing string in the evaluation is French (the enrollment's source language); every character line is
Darija in Arabic script with an Arabizi transliteration (script mode `both`); no numeric pronunciation score
(`utteranceConfidence: null`, text-only session); `priorityCorrections` ≤ 2 (0 here); `transcriptRetained: false`.

## 8. Ledger (service role, `ai_requests` for this learner) → `200`

| created_at (UTC) | task | success | model | in / out tokens | finish | max_tokens | est. USD |
|---|---|---|---|---:|---|---:|---:|
| 21:03:49.719 | character_dialogue | true | anthropic/claude-sonnet-5.5 | 1887 / 157 | stop | 1000 | 0.005344 |
| 21:03:53.833 | character_dialogue | true | anthropic/claude-sonnet-5.5 | 1920 / **402** | stop | 1000 | 0.007860 |
| 21:04:03.668 | learner_evaluation | true | anthropic/claude-sonnet-5.5 | 2639 / 901 | stop | 1200 | 0.014288 |
| 21:04:08.787 | learner_evaluation | true | anthropic/claude-sonnet-5.5 | 664 / 291 | stop | 1200 | 0.004238 |

Total **$0.03173** (< $0.05).

## 9. `purge_test_user` (service role RPC) → `200`

```json
{"p_user_id":"b99a3bd0-ef1c-43e6-b7cf-8dfcc20991b6"}
→ {"counts":{"profiles":1,"xp_ledger":1,"ai_requests":4,"account_settings":1,"conversation_turns":3,"user_skill_mastery":3,
   "conversation_sessions":1,"learning_observations":3,"user_course_enrollments":1,"user_expression_reviews":2, …all others 0},
   "userId":"b99a3bd0-ef1c-43e6-b7cf-8dfcc20991b6","deletedAt":"2026-10-19T21:04:10.362705+00:00",
   "authUserDeleted":true,"authUserDeletable":true,"recordingsDeleted":0,
   "anonymisedTables":["ai_requests","audit_logs","asset_provenance_events","moderation_incidents","feedback_reports","processing_jobs (requested_by cleared)"],
   "retainedForLegalReasons":["audit_logs (actor anonymised, 5-year retention)","ai_requests (pseudonymous cost ledger, user reference removed)","moderation_incidents (safety record, user reference removed)"]}
```

`select count(*) from auth.users where email like 'journey-%@langquest.test'` → `0` afterwards.

## Regressions found by this journey (and fixed)

### 1. Text turn answered `503 provider_unavailable` ("The AI provider returned an unusable answer") — fixed

The first run of the same script (20:56 UTC) got the opening line but the learner turn failed:

```json
→ 503 {"ok":false,"error":{"code":"provider_unavailable","message":"The AI provider returned an unusable answer. Please retry.","traceId":"f26a4a23-c42e-45f8-b9d1-bfd57e626b7a"}}
```

Ledger rows of that attempt: two `character_dialogue` calls, both `success = false`, `error_code = schema_validation_failed`,
**`finishReason: "length"`, `output_tokens = 400`** (attempt 0 and the repair attempt 1). The `character_dialogue`
profiles capped output at `maxOutputTokens: 400`; a Darija reply with `text` + `transliteration` + French `sourceGloss`
needs more (the successful reply above used 402), so the JSON was cut off before it could validate, and the repair retry
re-asked under the same cap. Fix (`packages/ai`):

- `src/profiles.ts`: `character_dialogue` output budget 400 → 1000 (global profile, the variety-scoped `ary/arz/ar-levant/yue/ht/rw/ln/sw` profiles, and the `dialogue_character` role params).
- `src/reasoner.ts`: when an attempt finishes with `length`, the repair attempt runs with twice the budget (capped at 4000), the repair message says the reply was cut off (no reasoning/commentary, keep strings short) instead of listing schema issues, the ledger row carries `error_code = output_truncated` and `maxTokens`, and the `StructuredOutputError` names the limit.
- `src/reasoner.test.ts`: two regression tests (budget raised on the retry + truncation note; error message when both attempts are truncated).

### 2. Local database full of leaked test rows (50 published `ary` test characters, 218 `@test.local` auth users, 107 sessions) — harness fixed, data NOT cleaned

`apps/api/src/__tests__/harness.ts` created `@test.local` users and deleted them with the GoTrue admin API, which the
append-only ledgers refuse once the account has XP / sync / ai_requests rows; the refusal was swallowed (`.catch(() => undefined)`).
The suites then deleted their published test character *before* the user, which `conversation_sessions.character_id
ON DELETE RESTRICT` refuses too (result unchecked). Every conversation suite therefore leaked one auth user, its sessions
and one published `ary` character, and the course manifest (built from `public.characters`) grew by one entry per run.
The cross-cutting `tests/` suites had the same ordering (`seeder.cleanup()` before `deleteTestUsers()`), leaking the
`tests.char_*` rows. Fixes:

- `apps/api/src/__tests__/harness.ts`: users are `@langquest.test` and are purged through `purge_test_user` (GoTrue delete as a logged fallback); new `deleteStackRows()` warns instead of hiding a refused delete.
- `apps/api/src/__tests__/integration/hardening.test.ts`, `integration/review-fixes.test.ts`, `live/conversation.test.ts`: purge users first, then characters / sessions / missions.
- `tests/src/harness/seed.ts`: `cleanup()` warns on a refused delete; 14 suites under `tests/integration` and `tests/security` now purge users before `seeder.cleanup()`.

Verification after the fixes (`LANGQUEST_REQUIRE_LOCAL_STACK=1 LANGQUEST_REQUIRE_STACK=1`): `@langquest/api` 10 files
passed, 1 skipped (live) / 90 tests passed, 1 skipped, 49.25 s; `@langquest/tests` 21 files / 127 tests passed, 56.37 s;
`@langquest/ai` 12 files passed, 1 skipped / 145 tests passed, 4 skipped (two new). No harness warning was printed, and
the counters `@langquest.test users = 2, @test.local users = 218, test characters = 50, conversation_sessions = 107`
were identical before and after both suites (nothing new leaked). The full workspace run before the fixes
(`pnpm -r typecheck`: 14/14 clean; `pnpm -r test`: 172 files / 1375 tests passed, 3 files / 6 tests skipped as live-only)
is in `test-run-2026-10-19.md`'s format and was green as well.

The rows already leaked in the local database were **not** deleted: the bulk purge (`delete_account` over the 218
`@test.local` users, then the orphaned `hard.test.* / tests.char_* / fix.* / live.test.*` characters) is a mass delete
and needs the owner's go-ahead. Until then the local manifest for `arabic-moroccan × fr` lists 52 characters instead of 2.
A hosted database never had these rows (they come from local test runs only).
