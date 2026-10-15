# Requirements traceability — LangQuest

Generated per `docs/MASTER_SPEC.md` §16.1 step 1 (one row per distinct requirement / acceptance criterion from §§0–15, plus §14.1 journeys A01–A35 and §14.3 automated test classes). Updated per §16.1 step 5 after each feature lands.

**Status vocabulary:** `not_started` · `in_progress` · `implemented_tested` · `blocked_by_external_dependency`

**Owner areas:** contracts, db, curriculum, ai, locales, ui, media, telemetry, api, jobs, admin, mobile, scripts, tests, docs, content, infra

**Conventions used in this file**

- `implemented_tested` is only claimed for rows whose evidence exists in the repo today (Phase 0 scaffold). Everything else starts `not_started` even where partial code is in flight; the row is updated when its tests pass.
- `blocked_by_external_dependency` is used only where the row cannot be completed at all without an owner action listed below. Rows that can be built and tested locally (local Supabase stack, local R2 emulation, recorded fixtures) but need the dependency for production verification stay `not_started` with the dependency named in the Blocker column.
- Evidence is a repo path (code, migration, test, screenshot, doc). `—` means none yet.

**External blockers (wording from `docs/runbooks/provisioning.md`, verified 2026-10-14)**

| Key | Blocker (as named in provisioning.md) | Owner action needed |
|---|---|---|
| B-R2 | **Cloudflare R2** — Not enabled (`10042 Please enable R2 through the Cloudflare Dashboard`) | Dashboard → R2 → Enable (requires a payment method on the account). Then create buckets `langquest-media` (private) and `langquest-public`, and an R2 API token → put `R2_ACCESS_KEY_ID/SECRET/ENDPOINT` in Worker secrets and `.env` |
| B-QUEUES | **Cloudflare Queues** — Endpoint reachable, none created; requires Workers Paid ($5/mo) | Optional. Default job backend is Postgres polling (`JOBS_BACKEND=postgres`) |
| B-SUPABASE | **Supabase** — Creating `langquest` was refused: _"maximum limits for the number of active free projects (2 project limit)"_ | (a) pause/delete one existing project, or (b) upgrade the org to Pro ($25/mo), then `pnpm supabase link --project-ref <ref>` and `pnpm supabase db push`. Until then the full stack runs locally with Docker (`pnpm supabase start`) |
| B-AZURE | **Azure Speech (pronunciation)** — no credentials | Optional for phoneme-level scoring on supported locales; set `AZURE_SPEECH_KEY/REGION` |
| B-RESEND | **Resend** — key valid, domain `alexhonore.com` verified | Optional: configure Supabase Auth SMTP to use Resend for branded emails (needs the hosted Supabase project, see B-SUPABASE) |
| B-CF-TOKEN | **Cloudflare account** — Global API key works | Prefer a scoped API token (Workers Scripts:Edit, R2:Edit, Queues:Edit) for CI instead of the Global key |
| B-NATIVE | **Native-speaker review** — not provisioned (no entry in provisioning.md; spec §9.7 contributor program) | Recruit/contract verified native speakers and tutors per track/region with written terms |
| B-LICENSE | **Licensed audio** — not provisioned (no entry in provisioning.md; spec §7.6, §9.7) | Supply recordings with verified redistribution/adaptation/AI-processing rights, or signed contributor agreements |
| B-RIGHTS | **Rights-holder permission** for research/noncommercial datasets (spec §9.1: DODa, AtlasIA upstream, MADAR) | Written permission from maintainers/rights holders before any commercial reuse |

**Row count by section (2026-10-14 baseline: 763 rows — 15 implemented_tested, 1 in_progress, 40 blocked_by_external_dependency, 707 not_started)**

| Section | Rows | Section | Rows |
|---|---|---|---|
| §0 Non-negotiables | 24 | §9 Data sourcing | 61 |
| §1 Personas / experience | 41 | §10 I18n, UX, visual design | 79 |
| §2 Language catalog | 51 | §11 Security / privacy | 11 |
| §3 Pedagogy | 59 | §12 Performance / cost | 16 |
| §4 Architecture | 45 | §13 Phased delivery | 80 |
| §5 Database | 61 | §14.1 Acceptance journeys | 35 |
| §6 API / events | 57 | §14.2 Native evaluation sets | 8 |
| §7 Audio library / CMS | 28 | §14.3 Automated tests | 44 |
| §8 AI system | 47 | §15 Failure rules | 16 |

---

## §0 Executive brief / non-negotiables

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-0.1-01 | Fun, rapid, listening/speaking-oriented app enabling real conversations; game-like immersion, not a grammar workbook | curriculum | not_started | — | — |
| R-0.1-02 | Grammar/conjugation acquired through patterns and usage; explanations short and optional | curriculum | not_started | — | — |
| R-0.1-03 | Learners speak in the very first session | curriculum | not_started | — | — |
| R-0.1-04 | Progress demonstrated through fresh unrehearsed communicative tasks, not tapping word tiles | curriculum | not_started | — | — |
| R-0.1-05 | Synthesize Duolingo loops, Pimsleur anticipation, Rosetta imagery, AI partners and audiobook player patterns | docs | not_started | — | — |
| R-0.2-01 | All features and tracks free; no premium flags, paid coins, metered UI, billing, subscriptions or checkout | mobile | not_started | — | — |
| R-0.2-02 | Accounts: email/password + optional OAuth, secure auth, profile, cloud sync, multi-device, deletion/export, settings | api | not_started | — | — |
| R-0.2-03 | Exactly 30 selectable learning tracks as enumerated in §2 | db | not_started | — | — |
| R-0.2-04 | Course-specific editable `source_language`; onboarding detection; EN first, FR second, then ES/RU, then others | db | not_started | — | — |
| R-0.2-05 | Speak-first: guided and free AI voice conversations, listening, reference speech, repeats, pronunciation evaluation with visual feedback | mobile | not_started | — | — |
| R-0.2-06 | Genuine conversational proficiency prioritized over grammar, literal matching, accent reduction or XP | curriculum | not_started | — | — |
| R-0.2-07 | OpenRouter is the configurable LLM gateway; STT/TTS via OpenRouter where tested; realtime and phoneme adapters independent | ai | not_started | — | — |
| R-0.2-08 | Own/manage large MP3 libraries: bulk upload, cloud transfer, labeling, hierarchy, publishing, player, offline, transcription, AI exercises | admin | not_started | — | — |
| R-0.2-09 | Cost-conscious scalability without user-facing caps; reuse content; async heavy work; monitor spend; prevent abuse | infra | not_started | — | — |
| R-0.2-10 | Legally sourced material only; no scraped courses, unauthorized MP3 publication or unlicensed voice cloning | content | not_started | — | — |
| R-0.2-11 | Mobile-first, fast, polished, accessible, responsive, privacy-conscious, RTL and script aware | mobile | not_started | — | — |
| R-0.2-12 | All 30 tracks genuinely discoverable with onboarding, instruction-language preference, audio/mission data, AI adapter config; honest per-track QA | content | not_started | — | — |
| R-0.3-01 | No paywall or product-imposed daily quota for normal users | api | not_started | — | — |
| R-0.3-02 | Enforce auth, request validation, anti-bot throttles, spam defenses, circuit breakers, provider-failure recovery, cost observability | api | not_started | — | — |
| R-0.3-03 | Security protection distinct from monetization; no credits economy; operator alerts on atypical spend | telemetry | not_started | — | — |
| R-0.3-04 | Never promise a feature underlying providers cannot deliver | ai | not_started | — | — |
| R-0.4-01 | Learner completion: pick any course, change instruction language, lessons, reference audio, genuine feedback, AI chats, recall, progress, library, offline, sync, delete | tests | not_started | — | — |
| R-0.4-02 | Admin completion: upload GBs of audio, batch labels, licenses, courses/dialects, review generated material and AI configs, publish, metrics | tests | not_started | — | — |
| R-0.4-03 | A feature counts as finished only when end-to-end tests pass | tests | not_started | — | — |

## §1 Personas, jobs-to-be-done and experience

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-1.1-01 | Complete beginner: visual comprehension, confidence, slow speech, short prompts, easy first win | curriculum | not_started | — | — |
| R-1.1-02 | Returning learner: active retrieval, varied scenarios, honest diagnostics | curriculum | not_started | — | — |
| R-1.1-03 | Audio-first learner: hands-free Pimsleur-style prompting and background playback | mobile | not_started | — | — |
| R-1.1-04 | Diaspora/heritage learner: regional dialects not taught conventionally; support hesitant speakers | content | not_started | — | — |
| R-1.1-05 | Multilingual learner: separate source-language preference per enrollment | db | not_started | — | — |
| R-1.1-06 | Advanced learner: spontaneous small talk, narration, argumentation, real accents, faster turns, less intrusive correction | ai | not_started | — | — |
| R-1.2-01 | First-minute achievement: hear, understand and say a meaningful phrase almost immediately | curriculum | not_started | — | — |
| R-1.2-02 | Comprehension scaffold: visual context, synonyms, replay, slow playback, optional translation, subtitles, highlights; fades over time | mobile | not_started | — | — |
| R-1.2-03 | Speech is the default action with accessibility and noisy-environment alternatives | mobile | not_started | — | — |
| R-1.2-04 | No worksheet-first onboarding; no grammar tables before conversations | curriculum | not_started | — | — |
| R-1.2-05 | Short 5–15 minute sessions with adjustable duration; longer audio/open conversations optional | curriculum | not_started | — | — |
| R-1.2-06 | Stories: recurring characters, relationship progression, surprises, consequences, regional settings | content | not_started | — | — |
| R-1.2-07 | Mistakes are useful: correct what blocks meaning, 1–2 priority issues, no accent shaming or constant interruption | ai | not_started | — | — |
| R-1.2-08 | High production values: expressive audio, clean design, tasteful animation, fast controls, consistent art and voices | ui | not_started | — | — |
| R-1.2-09 | Not a chatbot skin: exercises link to skills, scenes, success conditions, variations and spaced scheduling | curriculum | not_started | — | — |
| R-1.2-10 | Culturally authentic dialect speech, etiquette, non-stereotyped people and places; honor regional variants | content | not_started | — | — |
| R-1.3-01 | Five tabs Home / Missions / Audio / Speak / Progress; profile and settings reachable from Home | mobile | not_started | — | — |
| R-1.3-02 | Tab-specific search and a globally available course switcher | mobile | not_started | — | — |
| R-1.3-03 | Every screen shows the active target course, its saved `source_language` and an edit affordance | mobile | not_started | — | — |
| R-1.3-04 | Home: welcome, current course, daily adaptive mission, storyline, listening progress, due recall, optional streak/achievements, resume | mobile | not_started | — | — |
| R-1.3-05 | Home: quick target-course change; instruction language visible; no premium upsell | mobile | not_started | — | — |
| R-1.3-06 | Home daily feedback uses real learner data; no fictitious progress | mobile | not_started | — | — |
| R-1.3-07 | Catalog: search/filter all 30 tracks by region, script, level, availability and sound sample | mobile | not_started | — | — |
| R-1.3-08 | Catalog distinguishes spoken variety, locale, transliteration, writing system and instruction language | mobile | not_started | — | — |
| R-1.3-09 | Enrollment wizard: source language defaults from account, editable before enrolling and later without losing progress | mobile | not_started | — | — |
| R-1.3-10 | Multiple parallel enrollments, one active; remove/archive with confirmation; preserve progress unless deletion requested | api | not_started | — | — |
| R-1.3-11 | Missions: map/story or ordered cards with skill outcomes, durations and required speaking/listening actions | mobile | not_started | — | — |
| R-1.3-12 | Missions: immersive backgrounds, audio hints, context images, replay, slower speech, optional transcripts/translations | mobile | not_started | — | — |
| R-1.3-13 | Branching speech missions with adaptive difficulty and real conversational success criteria | curriculum | not_started | — | — |
| R-1.3-14 | Guided lesson and role-play modes with optional audio-only view | mobile | not_started | — | — |
| R-1.3-15 | Audio tab: authored and uploaded courses, chapters, tracks, bookmarks, continue-listening | mobile | not_started | — | — |
| R-1.3-16 | Player: speed, skip ±10/15 s, seek, chapter navigation, sleep timer, background/lock-screen controls, offline download, history sync | mobile | not_started | — | — |
| R-1.3-17 | Original audio always playable unaltered; optional transcripts, translated transcript, karaoke, A/B loop, vocabulary, speak-after-listen, AI mission | mobile | not_started | — | — |
| R-1.3-18 | Audio search by learning and instruction language, accent, speaker, chapter and subject | api | not_started | — | — |
| R-1.3-19 | Speak tab: drills, shadowing, phrase repeats, guided dialogues, free-form partner, impromptu challenge | mobile | not_started | — | — |
| R-1.3-20 | Character selection by persona/region/voice; feedback after conversation; detailed feedback in pronunciation mode | mobile | not_started | — | — |
| R-1.3-21 | Hands-free mode, push-to-talk fallback, audio device permissions and recovery | mobile | not_started | — | — |
| R-1.3-22 | Progress: can-do mastery per skill across listening, spoken response, intelligibility, fluency and retention | mobile | not_started | — | — |
| R-1.3-23 | Progress: due-recall calendar, expression history, weak areas, mission successes, speaking-time (secondary), achievements | mobile | not_started | — | — |
| R-1.3-24 | No fabricated fluency score; show evidence, uncertainty and next actions | mobile | not_started | — | — |
| R-1.3-25 | Settings: auth/recovery, notifications, audio quality/downloads, text scaling, contrast, accessibility, speech, transliteration, source default, per-course overrides, transcript privacy, export/delete, help | mobile | not_started | — | — |

## §2 Required language / dialect catalog

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-2-00 | Model track (display entry), spoken variety, BCP-47 locale, scripts and orthography separately; instruction language ≠ target | db | not_started | — | — |
| R-2-T01 | Track 01 `arabic-eastern`: Levantine umbrella `ar-levant`, editable SY/LB/PS/JO regional selector, documented assumption, Arabic RTL | content | not_started | — | — |
| R-2-T02 | Track 02 `arabic-moroccan`: Darija `ary`, Arabic RTL + Latin Arabizi toggle, French code-switch | content | not_started | — | B-NATIVE (native validation mandatory) |
| R-2-T03 | Track 03 `arabic-egyptian`: `arz`/`ar-EG`, Egyptian colloquial not MSA, Arabic RTL | content | not_started | — | — |
| R-2-T04 | Track 04 `arabic-msa`: `arb`/`ar`, formal register, not a substitute for colloquial tracks | content | not_started | — | — |
| R-2-T05 | Track 05 `chinese-cantonese`: `yue`/`zh-HK`, Traditional default, optional Jyutping, tone-rich, ≠ Mandarin | content | not_started | — | — |
| R-2-T06 | Track 06 `chinese-mandarin`: `cmn`/`zh-CN`, Simplified default, Traditional option, Pinyin with tones, regional voices | content | not_started | — | — |
| R-2-T07 | Track 07 `chinese-simplified`: separate selectable track, Mandarin speech, Simplified script focus, shares Mandarin assets | content | not_started | — | — |
| R-2-T08 | Track 08 `english`: `en-US` default, GB option; taught FROM French/Spanish/Russian etc. | content | not_started | — | — |
| R-2-T09 | Track 09 `danish`: `da-DK`, Latin | content | not_started | — | — |
| R-2-T10 | Track 10 `french`: `fr-FR` default, `fr-CA` option, regional pronunciation | content | not_started | — | — |
| R-2-T11 | Track 11 `german`: `de-DE`, Latin | content | not_started | — | — |
| R-2-T12 | Track 12 `greek`: `el-GR`, Greek script | content | not_started | — | — |
| R-2-T13 | Track 13 `haitian-creole`: `ht-HT`, Haitian orthography, never replaced by French | content | not_started | — | — |
| R-2-T14 | Track 14 `hebrew`: `he-IL`, RTL, optional transliteration/vowel points | content | not_started | — | — |
| R-2-T15 | Track 15 `hindi`: `hi-IN`, Devanagari, optional romanization | content | not_started | — | — |
| R-2-T16 | Track 16 `italian`: `it-IT`, Latin | content | not_started | — | — |
| R-2-T17 | Track 17 `japanese`: `ja-JP`, kana/kanji, optional romaji and furigana | content | not_started | — | — |
| R-2-T18 | Track 18 `korean`: `ko-KR`, Hangul, optional Revised Romanization | content | not_started | — | — |
| R-2-T19 | Track 19 `portuguese-brazilian`: `pt-BR` voice, diction and lexicon | content | not_started | — | — |
| R-2-T20 | Track 20 `portuguese-european`: `pt-PT` speech and lexicon | content | not_started | — | — |
| R-2-T21 | Track 21 `romanian`: `ro-RO`, Latin | content | not_started | — | — |
| R-2-T22 | Track 22 `russian`: `ru-RU`, Cyrillic, optional transliteration, stress handling | content | not_started | — | — |
| R-2-T23 | Track 23 `spanish-latin-american`: `es-419` umbrella with regional voices (e.g. `es-MX`); not one universal accent | content | not_started | — | — |
| R-2-T24 | Track 24 `spanish-spain`: `es-ES` Castilian voice and lexicon, distinguished from Latin American | content | not_started | — | — |
| R-2-T25 | Track 25 `swahili`: `sw` with Kenyan/Tanzanian selector and usage distinctions | content | not_started | — | — |
| R-2-T26 | Track 26 `kinyarwanda`: `rw-RW`, native-validated speech, limited automated scoring disclosed | content | not_started | — | B-NATIVE |
| R-2-T27 | Track 27 `swedish`: `sv-SE`, Latin | content | not_started | — | — |
| R-2-T28 | Track 28 `lingala`: `ln` with DRC/Congo regional option, native-validated speech, limited scoring disclosed | content | not_started | — | B-NATIVE |
| R-2-T29 | Track 29 `ukrainian`: `uk-UA`, Cyrillic, optional transliteration | content | not_started | — | — |
| R-2-T30 | Track 30 `vietnamese`: `vi-VN`, tone-rich, northern/southern voice variants | content | not_started | — | — |
| R-2.1-01 | Registration: choose UI language (device default, overridable), default instruction language (EN/FR preferred, independent of UI), optional proficiency | mobile | not_started | — | — |
| R-2.1-02 | Adding any course prefills instruction language from account preference and exposes a selector of supported languages | mobile | not_started | — | — |
| R-2.1-03 | Explicit `source_language_code` NOT NULL on every `user_course_enrollments` row, even when equal to profile default | db | not_started | — | — |
| R-2.1-04 | A later profile-language update does not silently rewrite existing enrollments | api | not_started | — | — |
| R-2.1-05 | Per-enrollment edit control; change any time without clearing progress, bookmarks or mastery | api | not_started | — | — |
| R-2.1-06 | Source change triggers new teaching overlays/audio where available and invalidates stale language-specific caches | api | not_started | — | — |
| R-2.1-07 | Learner can temporarily show translations in a third language without changing the enrollment | mobile | not_started | — | — |
| R-2.1-08 | Production priority EN → FR → ES/RU → other catalog sources; system language-pair agnostic, never hard-codes `en` | locales | not_started | — | — |
| R-2.1-09 | Reverse-direction English target paths FR→EN, ES→EN, RU→EN are explicit acceptance tests | tests | not_started | — | — |
| R-2.1-10 | Insufficient source coverage shows editorial status in the enrollment, routes to native review; no silent English fallback, opt-in only | api | not_started | — | — |
| R-2.2-01 | Reusable language-independent intents/missions with layered target utterances, scripts, source overlays, instructions and UI labels; no 30×30 courses | curriculum | not_started | — | — |
| R-2.2-02 | Equivalent ideas linked by semantic concept IDs, not text equality | curriculum | not_started | — | — |
| R-2.2-03 | Translation/localization quality workflow so dynamic pairs scale as reusable layers | admin | not_started | — | — |
| R-2.2-04 | Preserve politeness forms, idioms, cultural routines and dialect-specific responses; no naive word-for-word output | content | not_started | — | — |
| R-2.3-01 | Dialect tracks have authentic pronunciation examples and validated conversational prompts; a script renderer is not a dialect | content | blocked_by_external_dependency | — | B-NATIVE |
| R-2.3-02 | Tone-aware coaching for Mandarin, Cantonese and Vietnamese where supported; no claims of unavailable phoneme precision | ai | not_started | — | — |
| R-2.3-03 | RTL handling: bidi text, punctuation, mixed Arabic/Latin, selection, numerals, transliteration toggle, screen-reader support | ui | not_started | — | — |
| R-2.3-04 | Content script selected independently of source language; target writing shown with optional source translation | locales | not_started | — | — |
| R-2.3-05 | Teach culturally natural code-switching (Darija/French) without excusing incorrect translations | content | not_started | — | — |
| R-2.3-06 | Version and reviewer identity/region recorded for every language asset; re-evaluate on dialect normalization changes | db | not_started | — | — |

## §3 Full learning experience and pedagogy

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-3.1-01 | Loop step Context: useful scene/situation with comprehensible speech | curriculum | not_started | — | — |
| R-3.1-02 | Loop step Understand: optional image cues, translations, target text, slow playback, repeated listening | curriculum | not_started | — | — |
| R-3.1-03 | Loop step Anticipate: prompt a spoken response before revealing the model reply (Pimsleur-style) | curriculum | not_started | — | — |
| R-3.1-04 | Loop step Pronounce: compare attempt with authentic sample; specific, not excessive, sound guidance | curriculum | not_started | — | — |
| R-3.1-05 | Loop step Communicate: guided role-play with branching and semi-open response acceptance | curriculum | not_started | — | — |
| R-3.1-06 | Loop step Improvise: fresh scenario with unrehearsed response (transfer assessment) | curriculum | not_started | — | — |
| R-3.1-07 | Loop step Retrieve again: fragile skills reintroduced in new conversations, drills and later sessions via spaced recall | curriculum | not_started | — | — |
| R-3.1-08 | Loop step Prove mastery: progress requires handling an interaction with decreasing assistance, not tap counts | curriculum | not_started | — | — |
| R-3.2-01 | Lesson type: listen and identify meaningful intent with visual options | mobile | not_started | — | — |
| R-3.2-02 | Lesson type: listen, pause, anticipate and speak, reveal, compare, repeat | mobile | not_started | — | — |
| R-3.2-03 | Lesson type: shadowing with waveform/short repeat or A/B loop and optional delayed playback | mobile | not_started | — | — |
| R-3.2-04 | Lesson type: guided role-play with bounded objective and multiple semantically valid answers | ai | not_started | — | — |
| R-3.2-05 | Lesson type: free conversation with level-aware AI partner and interesting follow-ups | ai | not_started | — | — |
| R-3.2-06 | Lesson type: listening comprehension with real voices at normal/slow speed and different accents | content | not_started | — | — |
| R-3.2-07 | Lesson type: mission story with branching characters, scene stakes, persistent relationships | curriculum | not_started | — | — |
| R-3.2-08 | Lesson type: pronunciation micro-drill for consonants, tones, vowels, stress/rhythm where supported | ai | not_started | — | — |
| R-3.2-09 | Lesson type: situational tasks (restaurant, introductions, jobs, directions, shopping, emergencies, travel, family, plans, debates) | curriculum | not_started | — | — |
| R-3.2-10 | Lesson type: audio-only/Pimsleur mode with answer pauses, background audio, optional voice response, safe interactions | mobile | not_started | — | — |
| R-3.2-11 | Lesson type: adaptive 1–3 minute reviews interleaved with new lessons; no compulsory grammar unit | curriculum | not_started | — | — |
| R-3.2-12 | Lesson type: audio-course-linked lesson (listen to MP3 chapter → select phrases → practise → role-play variant) | curriculum | not_started | — | — |
| R-3.2-13 | Lesson type: optional writing/reading support for scripts without making the core conjugation exercises | mobile | not_started | — | — |
| R-3.3-01 | ~8-minute mission template: 1 min context, 1.5 min modeled expressions, 1.5 min anticipation, 3 min conversation, 1 min feedback | curriculum | not_started | — | — |
| R-3.3-02 | Mission duration configurable; depends on learner pace; pause/resume supported | mobile | not_started | — | — |
| R-3.3-03 | AI varies situations and natural phrasings instead of a deterministic script | ai | not_started | — | — |
| R-3.4-01 | Reusable communicative skill units (`greet_politely`, `ask_price`, `request_item`, `repair_misunderstanding`, …) | curriculum | not_started | — | — |
| R-3.4-02 | Evidence dimensions stored separately: listening, independent production, semantic success/register, intelligibility, fluency, retention/transfer | db | not_started | — | — |
| R-3.4-03 | Observation schema: skill, type, scenario ID, autonomy/hints, confidence, scorer version, timestamp, uncertainty | contracts | not_started | — | — |
| R-3.4-04 | Transparent mastery state `not_attempted/emerging/practiced/independent/durable`; numeric mastery internal only | curriculum | not_started | — | — |
| R-3.4-05 | Transcript matching the reference is never treated as evidence of good pronunciation | ai | not_started | — | — |
| R-3.4-06 | Optional periodic human evaluation to calibrate AI assessments | admin | not_started | — | — |
| R-3.4-07 | Proficiency labels aligned with CEFR can-do descriptors without claiming certification | curriculum | not_started | — | — |
| R-3.5-01 | FSRS-like or evidence-weighted scheduler for expressions AND communicative skills | curriculum | not_started | — | — |
| R-3.5-02 | Record response quality, hints, effort/replay, actual interval, next due; algorithm pluggable and testable | curriculum | not_started | — | — |
| R-3.5-03 | Reintroduce skills in meaningful varied contexts (different characters/situations), not identical flashcards | curriculum | not_started | — | — |
| R-3.5-04 | Targeted review path for repeated misunderstandings, low-confidence speech, code-switch difficulty, vowel/tone problems | curriculum | not_started | — | — |
| R-3.5-05 | Avoid excessive reviews crowding out novel content; diversify difficulty | curriculum | not_started | — | — |
| R-3.5-06 | Progress branches and adapts; optional manual lesson browsing and practice selection | mobile | not_started | — | — |
| R-3.6-01 | Coach: listen to authentic sample, tap/hold mic, repeat; recording states visualized honestly | mobile | not_started | — | — |
| R-3.6-02 | Coach: intelligibility feedback, word-level alignment, phoneme/tone/stress where available, rhythm, phrasing, slow/normal replay | ai | not_started | — | — |
| R-3.6-03 | Coach: highlight relevant segment with actionable mouth/stress/tone guidance; rerecord and measure improvement | mobile | not_started | — | — |
| R-3.6-04 | Dedicated practice detailed; conversations give only 1–2 meaningful corrections after the mission | ai | not_started | — | — |
| R-3.6-05 | Evaluate provider support per language/accent; honest lower-fidelity assistance; never fabricate phoneme scores | ai | not_started | — | — |
| R-3.6-06 | Respect dialect and learner accents; intelligibility primary, native-like refinement optional | ai | not_started | — | — |
| R-3.6-07 | Explicit fallback logic for multi-speaker audio and code-switch assessment; no indiscriminate single-language scorer | ai | not_started | — | — |
| R-3.6-08 | Mic permission, optional recording storage, no default long-term retention, deletion/export | mobile | not_started | — | — |
| R-3.7-01 | Persistent named characters with role, region, dialect, personality, voice, speech speed and relationship memory | curriculum | not_started | — | — |
| R-3.7-02 | Missions carry controllable objectives, scene facts, tools/hints, consequences and branching paths | curriculum | not_started | — | — |
| R-3.7-03 | Conversations react to unexpected answers, clarification requests, hesitation, interruptions and mistakes; no dead ends | ai | not_started | — | — |
| R-3.7-04 | Commands slower / repeat / translate / example / meaning / hint / skip available, including reliable voice commands | mobile | not_started | — | — |
| R-3.7-05 | Multi-turn assessment identifies objectives completed and skills exercised, not turn counts | ai | not_started | — | — |
| R-3.7-06 | Persist safe concise learning/story summaries; raw transcripts opt-in with retention controls | api | not_started | — | — |
| R-3.7-07 | Scenario personalization only with consent; characters supportive, never manipulative or dependency-forming | ai | not_started | — | — |
| R-3.7-08 | Optional character voice/dialect selection; relationship mini-stories; story progression tied to can-do proficiency | curriculum | not_started | — | — |
| R-3.7-09 | Text-only fallback for accessibility/noisy environments; speaking remains primary | mobile | not_started | — | — |
| R-3.8-01 | XP, can-do achievements, optional streaks, levels/regions, narrative unlocks, celebrations, optional social/leaderboard with opt-out | curriculum | not_started | — | — |
| R-3.8-02 | XP validated server-side; XP never proof of proficiency; mastery recorded separately | api | not_started | — | — |
| R-3.8-03 | No shaming missed days or manipulative streak punishment; configurable notifications | mobile | not_started | — | — |
| R-3.8-04 | Missions may visually unlock scenes but all free content reachable by browsing | mobile | not_started | — | — |
| R-3.8-05 | Offline progress synchronized idempotently; achievements not farmable by resubmission | api | not_started | — | — |

## §4 Architecture

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-4.1-01 | Mobile: React Native + Expo + TypeScript; polished audio/background, offline data, microphone, realtime voice | mobile | not_started | — | — |
| R-4.1-02 | Admin: Next.js + TypeScript private CMS for GBs of audio, courses, generation, review, publishing | admin | not_started | — | — |
| R-4.1-03 | Identity/DB: Supabase Auth + PostgreSQL with RLS for profiles, enrollments, curricula, mastery, rights, jobs | db | not_started | — | B-SUPABASE (hosted project; local Docker stack unaffected) |
| R-4.1-04 | Media: Cloudflare R2 Standard private buckets for masters, renditions, thumbnails, download packages | infra | blocked_by_external_dependency | — | B-R2 |
| R-4.1-05 | API: Cloudflare Workers (TypeScript) for auth'd API, signed media, model routing, validation, cache dispatch, concurrency | api | not_started | — | — |
| R-4.1-06 | Async processing: on-demand FFmpeg/audio workers with retries (Postgres-polling queue by default) | jobs | not_started | — | — |
| R-4.1-07 | Optional Cloudflare Queues job backend (`JOBS_BACKEND=cloudflare_queues`) | infra | blocked_by_external_dependency | — | B-QUEUES |
| R-4.1-08 | AI text: OpenRouter API configurable by task and locale | ai | not_started | — | — |
| R-4.1-09 | STT/TTS: OpenRouter speech APIs when compatible, pluggable specialist fallback | ai | not_started | — | — |
| R-4.1-10 | Realtime voice: pluggable duplex provider or streaming STT→LLM→TTS pipeline; measured latency and dialect quality | ai | not_started | — | — |
| R-4.1-11 | Pronunciation: specialized adapter (e.g. Azure) plus reference-audio/manual alternatives; never fake precision | ai | not_started | — | B-AZURE (phoneme-level path only) |
| R-4.1-12 | Mobile audio runtime: Expo-compatible SDK passing QA for background, lock screen, downloads, seek, rate, interruptions, Bluetooth | mobile | not_started | — | — |
| R-4.1-13 | Analytics: privacy-conscious event telemetry (PostHog or self-managed); never ad targeting by default | telemetry | not_started | — | — |
| R-4.1-14 | Error/observability: Sentry or equivalent plus structured logs for crashes, model latency, queue, storage, API errors | telemetry | not_started | — | — |
| R-4.1-15 | i18n: ICU-compatible message framework; EN first, FR second; dynamic target/source; RTL | locales | not_started | — | — |
| R-4.1-16 | IaC/tooling: Wrangler, Supabase migrations CLI, CI/CD; versioned reproducible deployments; dev/staging/prod isolation | infra | not_started | — | B-SUPABASE, B-CF-TOKEN |
| R-4.1-17 | Avoid Kubernetes, premature microservices, GPU nodes, per-user DBs, streaming through Next.js, custom models, RevenueCat/Stripe | infra | not_started | — | — |
| R-4.2-01 | Monorepo tree: apps/{mobile,admin,api,jobs}, packages/{contracts,db,curriculum,ai,locales,ui,media,telemetry}, scripts, supabase, infra, tests, docs | infra | implemented_tested | `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `apps/*`, `packages/*`, `scripts/`, `supabase/`, `infra/cloudflare/`, `tests/{unit,integration,e2e,security,audio,locales,load}` | — |
| R-4.2-02 | Single pnpm workspace (turbo) shared by all apps and packages | infra | implemented_tested | `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `docs/CONVENTIONS.md` §1 | — |
| R-4.2-03 | Strongly typed shared contracts package (Zod + TS) consumed by every app | contracts | not_started | — | — |
| R-4.2-04 | Mobile works independently of admin; no full catalog download at startup | mobile | not_started | — | — |
| R-4.2-05 | Architectural decisions recorded as short ADRs with tested tradeoffs | docs | implemented_tested | `docs/decisions/ADR-001-mobile-audio-runtime.md`, `ADR-002-realtime-voice-interface.md`, `ADR-004-versioned-manifests.md`, `ADR-005-job-queue.md` | — |
| R-4.3-01 | Learner and admin reach only the Worker API with JWT; Worker performs verified queries, R2 auth, OpenRouter inference, speech adapters, realtime tickets | api | not_started | — | — |
| R-4.3-02 | Admin signed direct multipart upload to R2; object finalize → queue → on-demand processor → R2 outputs + Postgres state | jobs | not_started | — | B-R2 |
| R-4.3-03 | Provider keys live server-side; app-to-provider direct connection only via short-lived purpose-limited session tokens | api | not_started | — | — |
| R-4.3-04 | No OpenRouter master keys, R2 secrets, service-role keys or unrestricted credentials in the mobile bundle | mobile | not_started | — | — |
| R-4.4-01 | Preserve original masters; generate optimized AAC/Opus renditions only when audibly/size beneficial | jobs | not_started | — | — |
| R-4.4-02 | R2 keys from generated IDs and content hashes, never user filenames; DB owns labels; renames do not move objects | media | not_started | — | — |
| R-4.4-03 | Private R2 with per-file authorization; range-capable short-lived signed GET or Worker proxy; expiry handled during long playback | api | blocked_by_external_dependency | — | B-R2 |
| R-4.4-04 | HTTP byte-range, seek, resume, ETag, content-length, cache-control and correct content types | api | not_started | — | — |
| R-4.4-05 | Offline downloads: durable local index, checksums, progress, retry, cleanup, optional device encryption; no DRM claims | mobile | not_started | — | — |
| R-4.4-06 | Public bucket/cache only for explicitly approved assets; never expose private licensed files | infra | blocked_by_external_dependency | — | B-R2 (`langquest-public`) |
| R-4.4-07 | Compact versioned course manifests (chapters, tracks, lazy URLs, transcript IDs, locale, checksums) edge-cached | media | not_started | — | — |
| R-4.4-08 | Cost model accounts for R2 operations, processing, DB, AI, auth, cache and monitoring, not only egress | docs | not_started | — | — |
| R-4.5-01 | Local SQLite for downloaded metadata, bookmarks, positions, SRS due queue, completed exercises, unsent events | mobile | not_started | — | — |
| R-4.5-02 | Immutable client event IDs with revision metadata; server dedupes on replay; clock skew handled | contracts | not_started | — | — |
| R-4.5-03 | Offline: stored media, lesson packs, pre-generated prompts, deterministic SRS, local progress; dynamic AI needs connectivity | mobile | not_started | — | — |
| R-4.5-04 | Safe sync after reconnect; never double-award XP or delete progress on replay | api | not_started | — | — |
| R-4.5-05 | Auto-download only with opt-in; Wi-Fi/cellular controls and storage management | mobile | not_started | — | — |
| R-4.6-01 | Traffic classes (static catalogs, R2 media, progress updates, live AI/audio) with separate monitoring and targets | telemetry | not_started | — | — |
| R-4.6-02 | Measure concurrent sessions; autoscaling, queue backpressure and security defense, no paid quotas | infra | not_started | — | — |
| R-4.6-03 | Batch idempotent writes, cache shared data, index hot reads, paginate, compress JSON, avoid unnecessary transcript/audio fetches | api | not_started | — | — |
| R-4.6-04 | Provider fallback with typed capability checks; missing language/voice support never patched by switching dialect | ai | not_started | — | — |
| R-4.6-05 | Recover mid-lesson from network interruptions; preserve last interaction; retry short operations safely | mobile | not_started | — | — |
| R-4.6-06 | Concurrency/disaster tests: multi-device, upload failures, URL expiry mid-stream, revoked media, restarts, provider outages, overlong files, duplicate jobs | tests | not_started | — | — |

## §5 Database — detailed model

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-5.0-01 | PostgreSQL with UUID PKs, timestamptz, unique/index constraints, tenant-safe RLS, migrations, content revisions; no raw bytes in Postgres | db | not_started | — | — |
| R-5.1-01 | `profiles`: user_id PK → auth.users, display_name, ui_locale, default_source_language_code, time_zone, privacy/accessibility options | db | not_started | — | — |
| R-5.1-02 | `account_settings`: notifications, audio speed, devices, hint behavior, script/transliteration, offline download, retention | db | not_started | — | — |
| R-5.1-03 | `languages`: canonical language/family, ISO code, display names, default script, RTL flag, pluralization metadata | db | not_started | — | — |
| R-5.1-04 | `language_varieties`: language_id, dialect name, BCP-47 mapping, regional notes, code-switch norms, alternative names, voice settings | db | not_started | — | — |
| R-5.1-05 | `writing_systems`: script metadata (Arab, Latn, Hans, Hant, Cyrl, Grek, Hebr, Deva, Jpan, Kore…) and renderer rules | db | not_started | — | — |
| R-5.1-06 | `course_tracks`: the 30 entries with name, primary variety, scripts, default voices, teaching focus, publication state; Simplified linked to Mandarin | db | not_started | — | — |
| R-5.1-07 | `user_course_enrollments`: `source_language_code` NOT NULL, preferred_target_variant_id, script_mode, status, active_mission_id, speed; uniqueness rule; source change never resets mastery | db | not_started | — | — |
| R-5.1-08 | `course_source_localizations`: per (source, track) coverage metrics and native-reviewed flag driving honest availability | db | not_started | — | — |
| R-5.2-01 | `skills`: skill_key, descriptor, difficulty, target family, CEFR-like alignment, prerequisites | db | not_started | — | — |
| R-5.2-02 | `skill_variants`: locale/dialect realization and reviewer state | db | not_started | — | — |
| R-5.2-03 | `communicative_intents`: language-independent concept IDs, constraints, social meaning, polarity/politeness | db | not_started | — | — |
| R-5.2-04 | `expressions`: intent, target variety, canonical form, register, difficulty, scenario tags, annotations, reviewed flag, rights ID | db | not_started | — | — |
| R-5.2-05 | `expression_forms`: script/transliteration/orthography forms, word alignment, tone markers, optional IPA | db | not_started | — | — |
| R-5.2-06 | `expression_translations`: expression, source language, natural meaning, context note, QA state | db | not_started | — | — |
| R-5.2-07 | `expression_audio`: expression, voice, asset, speech rate, accent/quality/review flags | db | not_started | — | — |
| R-5.2-08 | `lesson_courses`: collections with track, cover, description, editor state, order, rights | db | not_started | — | — |
| R-5.2-09 | `chapters`: course, title/description translations, index, scene, region | db | not_started | — | — |
| R-5.2-10 | `missions`: chapter/template, type, goals, target variant, minutes, published revision, prerequisites, difficulty, narrative, rubric | db | not_started | — | — |
| R-5.2-11 | `mission_localizations`: mission, source language, instructions/hints/help, QA status | db | not_started | — | — |
| R-5.2-12 | `mission_steps`: phase/type, prompt assets, examples, success conditions, hint scaffold, valid responses, branching, media | db | not_started | — | — |
| R-5.2-13 | `mission_graph_edges`: prerequisite/next mission, branch, reward, character memory change | db | not_started | — | — |
| R-5.2-14 | `dialogue_scenarios`: scene, role, character, difficulty bounds, expected intents, interruption policy, safety/topic rules | db | not_started | — | — |
| R-5.2-15 | `dialogue_variants`: human-reviewed sample dialogues, alternatives, accents, localized support | db | not_started | — | — |
| R-5.2-16 | `characters`: identity, personality, home region/variety, voice, storyline facts, avatar, safety rules, relationships | db | not_started | — | — |
| R-5.2-17 | `story_arcs`: character/region narratives with milestone conditions and learner memory schema | db | not_started | — | — |
| R-5.2-18 | `media_assets`: object ID, owner, checksum, MIME, size, duration, channels, bitrate, source/derived, visibility, rights, disposition | db | not_started | — | — |
| R-5.2-19 | `content_rights`: origin URL, authors/speakers, permission, license version, redistribution, attribution, alterations, voice rights, expiry, evidence, sign-off | db | not_started | — | — |
| R-5.2-20 | `content_revisions` + `publication_events`: version, edits, reviewer, status, timestamps, rollback | db | not_started | — | — |
| R-5.3-01 | `audio_course_collections`: display course, parent language, instruction language, region, instructor, description, license, publish status | db | not_started | — | — |
| R-5.3-02 | `audio_chapters`: collection, localized title/summary, order, cover | db | not_started | — | — |
| R-5.3-03 | `audio_lessons`: chapter, localized title/description, order, level, speakers, both language fields, tags, status, transcript status, length | db | not_started | — | — |
| R-5.3-04 | `audio_lesson_assets`: lesson, asset, type (`master`, `mobile_encoded`, `review`, `slow`, `clip`, `cover`), order | db | not_started | — | — |
| R-5.3-05 | `speakers`: pseudonymous/consented name, dialect/region, consent/rights record, voice description; never inferred identity | db | not_started | — | — |
| R-5.3-06 | `lesson_speakers`: multiple speakers per lesson with role and voice segments | db | not_started | — | — |
| R-5.3-07 | `transcripts`: lesson, language mode, revision, coverage, QA status, access rights | db | not_started | — | — |
| R-5.3-08 | `transcript_segments`: start/end ms, text, speaker label, language/dialect, script variant, confidence, translation link | db | not_started | — | — |
| R-5.3-09 | `transcript_translations`: segment, source/UI language, quality flags, meaning | db | not_started | — | — |
| R-5.3-10 | `transcript_word_alignments`: optional word timestamps linked to expressions | db | not_started | — | — |
| R-5.3-11 | `lesson_tags`, `lesson_topics`, `bookmarks`, `user_audio_progress`, `user_download_manifests` | db | not_started | — | — |
| R-5.3-12 | `uploads`: asset draft, upload ID, multipart session, original filename, user, client checksum, finalize status, idempotency key | db | not_started | — | — |
| R-5.3-13 | `processing_jobs`: type, parent asset, state (`pending/running/succeeded/failed/review_needed`), retries, progress, provider, cost, failure code, outputs | db | not_started | — | — |
| R-5.3-14 | `asset_provenance_events`: audit history of source license and processing transformations | db | not_started | — | — |
| R-5.4-01 | `ai_model_profiles`: task, variety, preferred model/voice/STT, fallbacks, capabilities, budgets, provider, enabled, version, benchmark status; no plaintext secrets | db | not_started | — | — |
| R-5.4-02 | `ai_model_benchmarks`: naturalness/intelligibility/dialect/latency/cost scores, sample set, evaluator version, reviewer | db | not_started | — | — |
| R-5.4-03 | `ai_requests`: user (where safe), task, model/provider, latency, tokens/audio seconds, cost, outcome, redacted logs, trace ID | db | not_started | — | — |
| R-5.4-04 | `conversation_sessions`: enrollment, mission, character, dialect, turns, start/end, summary, privacy preference, rubric outcomes, revision | db | not_started | — | — |
| R-5.4-05 | `conversation_turns`: opt-in retention, no default raw audio, sanitized text/hashes, timestamps, goals, hints, confidence | db | not_started | — | — |
| R-5.4-06 | `character_relationship_memory`: user + character concise story summary and consented durable preferences | db | not_started | — | — |
| R-5.4-07 | `user_skill_mastery`: enrollment, skill, state, last practiced/due, evidence count, uncertainty | db | not_started | — | — |
| R-5.4-08 | `user_expression_reviews`: enrollment, expression, schedule parameters, result, hint count, next due | db | not_started | — | — |
| R-5.4-09 | `learning_observations`: semantic evaluation, listening outcome, target, speaker/ASR version, pronunciation confidence, feedback evidence | db | not_started | — | — |
| R-5.4-10 | `mission_attempts`, `mission_progress`, `user_achievements`, `streak_activity`, `xp_ledger` (append-only/idempotent), `daily_learning_metrics` | db | not_started | — | — |
| R-5.4-11 | `device_sync_events`: client UUID, user, payload type/revision, conflict resolution, applied timestamp, unique idempotency key | db | not_started | — | — |
| R-5.4-12 | `notification_settings`, `notification_deliveries`, `feedback_reports`, `moderation_incidents`, `audit_logs` | db | not_started | — | — |
| R-5.5-01 | Every user-owned row readable/writable only by owner or narrowly authorized admin functions; reviewed RLS with automated negative tests | db | not_started | — | — |
| R-5.5-02 | Roles `super_admin`, `admin`, `content_editor`, `language_reviewer`, `support_readonly`; only admin/editor roles create/publish/delete shared content, modify models, grant rights | db | not_started | — | — |
| R-5.5-03 | Admin actions require server-validated role claims and are audit logged; hidden controls are not authorization | api | not_started | — | — |
| R-5.5-04 | Learners cannot forge rights/license records or files; user-contributed material pending review with consent | db | not_started | — | — |
| R-5.5-05 | `source_language_code` mandatory per enrollment; retained on resumption, UI change, reinstall or course switch | db | not_started | — | — |
| R-5.5-06 | User deletion cascades/anonymizes recordings, summaries, derived data per disclosed policy; publication/audit assets keep legal retention | db | not_started | — | — |

## §6 External API / event contracts

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-6.0-01 | All request/response shapes in shared Zod schemas with generated TS types, error codes and JSON validation; examples are contracts | contracts | not_started | — | — |
| R-6.1-01 | `POST /v1/auth/session/refresh` (via Supabase Auth where appropriate) | api | not_started | — | — |
| R-6.1-02 | `GET /v1/me` | api | not_started | — | — |
| R-6.1-03 | `PATCH /v1/me/settings` | api | not_started | — | — |
| R-6.1-04 | `GET /v1/languages` (metadata + target tracks) | api | not_started | — | — |
| R-6.1-05 | `GET /v1/courses?source=&target=` | api | not_started | — | — |
| R-6.1-06 | `GET /v1/courses/:trackId/coverage?source=` | api | not_started | — | — |
| R-6.1-07 | `POST /v1/me/enrollments` (trackId, sourceLanguageCode) | api | not_started | — | — |
| R-6.1-08 | `GET /v1/me/enrollments` | api | not_started | — | — |
| R-6.1-09 | `PATCH /v1/me/enrollments/:id` (sourceLanguageCode, scriptMode, dialect…) | api | not_started | — | — |
| R-6.1-10 | `GET /v1/courses/:trackId/manifest?source=&version=` | api | not_started | — | — |
| R-6.1-11 | `GET /v1/missions/:id?source=` | api | not_started | — | — |
| R-6.1-12 | `POST /v1/missions/:id/attempts` | api | not_started | — | — |
| R-6.1-13 | `POST /v1/missions/:id/evaluate` | api | not_started | — | — |
| R-6.1-14 | `GET /v1/me/reviews/due?enrollmentId=` | api | not_started | — | — |
| R-6.1-15 | `POST /v1/me/progress/sync` (idempotent batch events) | api | not_started | — | — |
| R-6.1-16 | `GET /v1/me/skills?enrollmentId=` | api | not_started | — | — |
| R-6.1-17 | `GET /v1/me/progress` | api | not_started | — | — |
| R-6.2-01 | `POST /v1/ai/conversation/session` (scoped session config/token) | api | not_started | — | — |
| R-6.2-02 | `POST /v1/ai/conversation/:id/turn` (text/audio reference + short state) | api | not_started | — | — |
| R-6.2-03 | `POST /v1/ai/conversation/:id/end` (outcomes, summaries, scheduling) | api | not_started | — | — |
| R-6.2-04 | `POST /v1/speech/transcribe` (target variety + recording/upload reference) | api | not_started | — | — |
| R-6.2-05 | `POST /v1/speech/pronunciation-assess` (reference expression, locale, asset) | api | not_started | — | — |
| R-6.2-06 | `POST /v1/speech/synthesize` (target variety, approved text, voice) | api | not_started | — | — |
| R-6.2-07 | `GET /v1/ai/model-capabilities?trackId=` | api | not_started | — | — |
| R-6.3-01 | `GET /v1/audio/collections?language=&instructionLanguage=` | api | not_started | — | — |
| R-6.3-02 | `GET /v1/audio/collections/:id/chapters` | api | not_started | — | — |
| R-6.3-03 | `GET /v1/audio/lessons/:id` | api | not_started | — | — |
| R-6.3-04 | `POST /v1/audio/assets/:id/playback-url` (authorized private time-limited URL) | api | not_started | — | B-R2 (production signing) |
| R-6.3-05 | `GET /v1/audio/lessons/:id/transcript?language=` | api | not_started | — | — |
| R-6.3-06 | `PUT /v1/me/audio-progress/:lessonId` | api | not_started | — | — |
| R-6.3-07 | `POST /v1/me/audio-bookmarks` | api | not_started | — | — |
| R-6.3-08 | `GET /v1/me/audio-download-pack/:lessonId` | api | not_started | — | — |
| R-6.4-01 | `POST /v1/admin/uploads/initiate` (signed multipart upload) | api | not_started | — | B-R2 (production signing) |
| R-6.4-02 | `POST /v1/admin/uploads/:id/parts/sign` | api | not_started | — | B-R2 (production signing) |
| R-6.4-03 | `POST /v1/admin/uploads/:id/complete` (checksum/size verification) | api | not_started | — | — |
| R-6.4-04 | `POST /v1/admin/uploads/:id/abort` | api | not_started | — | — |
| R-6.4-05 | `POST /v1/admin/library/import-r2-prefix` (reconcile bulk rclone uploads) | api | not_started | — | B-R2 |
| R-6.4-06 | `POST /v1/admin/library/import-manifest` (CSV or JSON labels) | api | not_started | — | — |
| R-6.4-07 | `POST /v1/admin/assets/bulk-label` | api | not_started | — | — |
| R-6.4-08 | `GET /v1/admin/assets?status=&q=` | api | not_started | — | — |
| R-6.4-09 | `PATCH /v1/admin/audio/lessons/:id` | api | not_started | — | — |
| R-6.4-10 | `POST /v1/admin/assets/:id/process` (transcribe/transcode/align) | api | not_started | — | — |
| R-6.4-11 | `GET /v1/admin/processing-jobs/:id` | api | not_started | — | — |
| R-6.4-12 | `POST /v1/admin/content/generate` (content factory draft jobs) | api | not_started | — | — |
| R-6.4-13 | `POST /v1/admin/content/:id/request-review` | api | not_started | — | — |
| R-6.4-14 | `POST /v1/admin/content/:id/publish` | api | not_started | — | — |
| R-6.4-15 | `POST /v1/admin/content/:id/unpublish` | api | not_started | — | — |
| R-6.4-16 | `GET /v1/admin/licenses/attributions` | api | not_started | — | — |
| R-6.4-17 | `GET /v1/admin/models` | api | not_started | — | — |
| R-6.4-18 | `PUT /v1/admin/models/:task/config` | api | not_started | — | — |
| R-6.4-19 | `POST /v1/admin/models/:task/benchmark` | api | not_started | — | — |
| R-6.4-20 | `GET /v1/admin/analytics/{quality,cost,usage,errors}` | api | not_started | — | — |
| R-6.4-21 | Domain events `upload.finalized`, `asset.verified`, `transcode.requested`, `transcript.ready`, `translation.review_requested`, `lesson.published`, `manifest.invalidated`, `conversation.finished`, `skill.observed`, `review.due` | contracts | not_started | — | — |
| R-6.4-22 | At-least-once event delivery with idempotent handlers | jobs | not_started | — | — |
| R-6.5-01 | Enrollment payload contract: courseTrackId, sourceLanguageCode, targetVarietyId, scriptMode | contracts | not_started | — | — |
| R-6.5-02 | Speech evaluation result contract: semanticIntentMatched, meaningConfidence, intelligibility, pronunciation {assessmentMode, numericScore null when ungrounded, confidence, feedback}, shouldAdvanceConversation | contracts | not_started | — | — |

## §7 Audio library + administrator CMS

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-7.1-01 | Admin IA: Dashboard, Uploads, Library, Collections, Chapters, Lessons, Speakers, Languages, Transcripts, Rights, Content Factory, AI Models, Quality Review, Job Queue, Publishing, Analytics, Users/Roles, Settings, Audit Log; role-restricted | admin | not_started | — | — |
| R-7.2-01 | Drag/drop individual files and nested folders; select thousands of files without freezing the browser | admin | not_started | — | — |
| R-7.2-02 | Support MP3/M4A/WAV/AAC/FLAC where practical; detect format and extract canonical metadata incl. ID3 | media | not_started | — | — |
| R-7.2-03 | Direct browser → private R2 presigned multipart upload: resumable parts, per-file/overall progress, retry, pause/cancel, SHA-256 dedupe | admin | blocked_by_external_dependency | — | B-R2 |
| R-7.2-04 | Dedupe never silently merges recordings with distinct rights/metadata; physical blob vs logical asset distinguished | media | not_started | — | — |
| R-7.2-05 | rclone corpus migration with read-only audit/import job, CSV manifest / sidecar JSON, path parsing, folder-level inheritance; legacy path kept as metadata | jobs | not_started | — | B-R2 |
| R-7.2-06 | Upload pipeline: initiate → parts → commit checksum → verify MIME/size/duration → draft asset → queue → editorial review → publish | api | not_started | — | — |
| R-7.2-07 | Upload security: no unrestricted R2 write, path traversal, ZIP bombs, filename injection, content-type spoofing or user-created public objects | api | not_started | — | — |
| R-7.2-08 | Show upload failures and recovery; orphan multipart cleanup; storage lifecycle policies | admin | not_started | — | B-R2 (lifecycle policies) |
| R-7.2-09 | Background transcode with real FFmpeg in a CPU-capable runtime; never assume Workers run FFmpeg | jobs | not_started | — | — |
| R-7.2-10 | Preserve original masters and intentional instructional pauses (Pimsleur recordings) | jobs | not_started | — | — |
| R-7.3-01 | Editable metadata: target/instruction/spoken languages, dialect, accent, speaker, course/chapter/lesson titles and orders, episode, level, topic, tags, scene, description, cover, rights, status, review flags, visibility | admin | not_started | — | — |
| R-7.3-02 | Every field bulk-editable for selections or folder imports; hierarchical inheritance reversible and visible | admin | not_started | — | — |
| R-7.3-03 | Bulk ops: select-by-filter, multi-edit, move/renumber, auto-sort from filenames, CSV import/export, clone, fix language codes, attach multiple files, merge references, split lesson | admin | not_started | — | — |
| R-7.3-04 | Version history and rollback for metadata edits | db | not_started | — | — |
| R-7.4-01 | Optional post-upload AI job: sample/transcribe, suggest languages/dialect, instruction vs target voice, lessons/chapters, description, keywords, timestamps, topics, draft missions | jobs | not_started | — | — |
| R-7.4-02 | Every suggestion carries confidence, provenance and review status; never auto-published without rights and QA | admin | not_started | — | — |
| R-7.4-03 | Expensive audio analysis runs async on demand and reuses prior results by content hash | jobs | not_started | — | — |
| R-7.5-01 | Transcription for multilingual and code-switched speech incl. original script/transliteration; manual transcript upload supported | jobs | not_started | — | — |
| R-7.5-02 | Sentence-level timestamps baseline; optional word-level forced alignment where reliable | jobs | not_started | — | — |
| R-7.5-03 | Editable transcript text, markers, speaker IDs, language labels, synchronized translations, clip bounds, reviewed version | admin | not_started | — | — |
| R-7.5-04 | Playback UI: follow-along highlight, jump-to-sentence, loop phrase, save expression, speak/repeat/feedback, comprehension quiz, role-play from chapter | mobile | not_started | — | — |
| R-7.5-05 | Never truncate/replace authentic recording sections without flagging; 'Listen to original' always exact | media | not_started | — | — |
| R-7.6-01 | Content states `imported_draft`, `metadata_needed`, `rights_unverified`, `transcription_pending`, `review_needed`, `approved`, `published`, `unpublished`, `rejected` | contracts | not_started | — | — |
| R-7.6-02 | Publishing checks: title, language, file integrity, accessible audio, speaker metadata, chapter relationship, verified redistribution rights | api | not_started | — | — |
| R-7.6-03 | Revoked/expired assets unpublish rapidly and invalidate caches and offline eligibility | api | not_started | — | — |
| R-7.6-04 | Attributions displayed wherever required | mobile | not_started | — | — |
| R-7.6-05 | User-owned commercial MP3s never published without verified license; owner-only staging/private player allowed; AI-processing terms preserved | admin | not_started | — | — |

## §8 AI system — OpenRouter, realtime voice, pronunciation

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-8.1-01 | AI task: text/dialogue generation for missions and content factory | ai | not_started | — | — |
| R-8.1-02 | AI task: persona/scene planning and difficulty adaptation | ai | not_started | — | — |
| R-8.1-03 | AI task: conversational reasoning and natural response generation | ai | not_started | — | — |
| R-8.1-04 | AI task: meaning/intent/objective assessment independent of exact words | ai | not_started | — | — |
| R-8.1-05 | AI task: source-language translation/explanation/hints with dialect fidelity | ai | not_started | — | — |
| R-8.1-06 | AI task: learner skill evaluation and concise progress/character memory | ai | not_started | — | — |
| R-8.1-07 | AI task: ASR/STT appropriate to target variety | ai | not_started | — | — |
| R-8.1-08 | AI task: TTS appropriate to target variety and speaker | ai | not_started | — | — |
| R-8.1-09 | AI task: low-latency live audio conversation with interruption handling and streaming | ai | not_started | — | — |
| R-8.1-10 | AI task: pronunciation assessment with calibrated confidence; phoneme/tone/stress only where supported | ai | not_started | — | B-AZURE (phoneme-level path) |
| R-8.1-11 | AI task: audiobook transcription/forced alignment and speech-to-lesson conversion | jobs | not_started | — | — |
| R-8.1-12 | AI task: multilingual language/script/dialect quality checks | ai | not_started | — | — |
| R-8.2-01 | `AiGateway`/`ModelRouter` with server-side OpenRouter adapter; all text reasoning via abstraction; no model IDs in UI/mobile | ai | not_started | — | — |
| R-8.2-02 | Per task × dialect × source defaults and fallbacks configured in admin; model discovery, capability metadata, cost benchmarks, logs, quality feedback | admin | not_started | — | — |
| R-8.2-03 | Validate model, provider and endpoint modality per use; text competence ≠ dialect/voice/realtime competence | ai | not_started | — | — |
| R-8.2-04 | Ordinary text LLM never substituted for acoustic pronunciation scorer or assumed duplex-capable | ai | not_started | — | — |
| R-8.2-05 | Cache static prompts and TTS for identical approved content; learner inputs private and cache-scope separated | ai | not_started | — | — |
| R-8.2-06 | Structured response schemas, bounded retries/backoff, timeouts, validation, uncertainty, safety/cultural constraints | ai | not_started | — | — |
| R-8.2-07 | Model profile editor: task, dialect, instruction language, route, model IDs/fallbacks, STT language, voice, sampling, context budget, tests, cost projection, enabled | admin | not_started | — | — |
| R-8.2-08 | Credentials in environment/secret manager; rotation; redacted request records; minimal personal payloads; provider privacy options verified | infra | not_started | — | — |
| R-8.2-09 | Capability-aware fallback (`supportsLocale/Accent/Audio/Streaming/PhonemeAssessment`); never turns Darija into MSA silently | ai | not_started | — | — |
| R-8.2-10 | `TextReasoner.generateStructured(task, locale, prompt, schema)` adapter interface | ai | not_started | — | — |
| R-8.2-11 | `SpeechRecognizer.supports/transcribe` adapter interface | ai | not_started | — | — |
| R-8.2-12 | `SpeechSynthesizer.supports/synthesize` adapter interface | ai | not_started | — | — |
| R-8.2-13 | `RealtimeConversationProvider.supports/createSession` adapter interface with short-lived sessions | ai | not_started | — | — |
| R-8.2-14 | `PronunciationAssessor.supports(locale, feature)/assess` adapter interface | ai | not_started | — | — |
| R-8.2-15 | Typed capability registry with graceful fallbacks, not a paper facade | ai | not_started | — | — |
| R-8.3-01 | Conversation state machine: preparing → connecting → listening → speech_detected → interpreting → responding, plus paused/interrupted/recoverable_error/finished | ai | not_started | — | — |
| R-8.3-02 | Push-to-talk and hands-free VAD; barge-in stops TTS, captures new turn; no overlapping audio or duplicate LLM responses | mobile | not_started | — | — |
| R-8.3-03 | Retry from safe state after disconnect; never silently lose the learner's last turn | mobile | not_started | — | — |
| R-8.3-04 | Character agent: natural engaging partner within scene constraints, realistic length, dialect, personality; not grammar homework | ai | not_started | — | — |
| R-8.3-05 | Evaluator/learning planner: extracts meaning, goals, weaknesses, review triggers asynchronously or with smaller model; no flow interruption | ai | not_started | — | — |
| R-8.3-06 | Compact safe context (variety, source language, level, weaknesses, scene facts, turn summary); technical token/time limits; summary truncation | ai | not_started | — | — |
| R-8.4-01 | Native-reviewed per-dialect prompt exemplars and speech style; ban MSA-for-dialect and English-for-French substitution | content | blocked_by_external_dependency | — | B-NATIVE |
| R-8.4-02 | Benchmarks for code switching and typical register (Darija + French etc.) | tests | not_started | — | — |
| R-8.4-03 | Model swaps require regression evaluation on a fixed suite per variety and source before promotion | tests | not_started | — | — |
| R-8.4-04 | Check Unicode script, transliteration, semantic equivalence, naturalness, cultural appropriateness, false-correction rate | tests | not_started | — | — |
| R-8.4-05 | Localized error messages, source-language hints and graceful rephrase strategies | locales | not_started | — | — |
| R-8.5-01 | Pronunciation support matrix populated via test calls and vendor docs per locale/feature; no invented coverage | ai | blocked_by_external_dependency | `docs/provider-matrix/azure-pronunciation-locales-2026-10-14.md` (docs only, no test calls) | B-AZURE |
| R-8.5-02 | Without a validated scorer: reference audio, intelligibility/semantic check, human phonetic tips; show 'detailed phoneme assessment not yet available' | ai | not_started | — | — |
| R-8.6-01 | Primary pipeline streaming audio → STT → OpenRouter reply → streaming TTS; measure first-audio latency, interruptions, turn quality | ai | not_started | — | — |
| R-8.6-02 | Dedicated duplex provider via `RealtimeConversationProvider` with short-lived tokens; evaluation kept separate; low latency is a hard requirement | ai | not_started | — | — |
| R-8.6-03 | Structured exercises use pre-generated audio and small ASR/forced alignment, never realtime sessions | ai | not_started | — | — |
| R-8.6-04 | Switch between native speaker, AI voice and subtitles; synthetic speakers disclosed | mobile | not_started | — | — |
| R-8.7-01 | Admin AI settings: provider/model/pricing, fallbacks, test harness, translation tests, dialect ratings, WER/CER, ASR errors, TTS review, naturalness, latency histograms, outages, uncertainty, cost per feature | admin | not_started | — | — |
| R-8.7-02 | Publishing model changes requires successful language-specific smoke tests | admin | not_started | — | — |
| R-8.7-03 | Internal prompts and secrets never exposed publicly | api | not_started | — | — |

## §9 Data sourcing — rights and ingestion

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-9.0-01 | Obtain/create genuine expressions, dialogues, audio, references and evaluation data across the catalog; a text corpus is not a curriculum | content | not_started | — | — |
| R-9.1-01 | Check each dataset's LICENSE, contributor terms and per-asset provenance at acquisition; record evidence URL and rights in `content_rights` | content | not_started | — | — |
| R-9.1-02 | Tatoeba: sentences/links/translations under CC BY/CC0; per-recording audio license; attribution and version preserved | scripts | not_started | — | — |
| R-9.1-03 | Mozilla Common Voice via MDC only; CC0 release but no reposting/mirroring; research/benchmark use unless cleared | scripts | not_started | — | — |
| R-9.1-04 | Google Taskmaster TM-1 (CC BY 4.0) as English dialogue pattern library with attribution | scripts | not_started | — | — |
| R-9.1-05 | Google FLEURS (CC BY 4.0) for STT evaluation/reference; derivative redistribution reviewed | scripts | not_started | — | — |
| R-9.1-06 | OpenSLR corpora: per-corpus license respected; never treated as uniformly CC0 | scripts | not_started | — | — |
| R-9.1-07 | OPUS parallel text: only cleared corpora ingested; subtitle data excluded unless safe | scripts | not_started | — | — |
| R-9.1-08 | Wiktionary definitions/phonetics under CC BY-SA/GFDL share-alike compliance; not the main curriculum | content | not_started | — | — |
| R-9.1-09 | Wikimedia Commons media with asset-specific licensing, credits and model releases | content | not_started | — | — |
| R-9.1-10 | Openverse discovery; search metadata not treated as legal verification | content | not_started | — | — |
| R-9.1-11 | FLORES-200 (CC BY-SA 4.0) for translation benchmarking; NLLB-MD (CC BY-NC) kept separate | scripts | not_started | — | — |
| R-9.1-12 | CEFR can-do reference paraphrased; no official certification implied | curriculum | not_started | — | — |
| R-9.1-13 | Peace Corps Moroccan lessons: confirm actual licensing/public-domain claims before redistribution | content | not_started | — | B-RIGHTS |
| R-9.1-14 | Darija Open Dataset (DODa): rights-blocked until maintainers/rights holders grant commercial permission | content | blocked_by_external_dependency | — | B-RIGHTS |
| R-9.1-15 | AtlasIA DODa audio: gated MIT label but upstream text/voice rights and contributor contracts required | content | blocked_by_external_dependency | — | B-RIGHTS |
| R-9.1-16 | DVoice Darija: verify exact snapshot license, provenance, restrictions and speaker consent | content | not_started | — | B-RIGHTS |
| R-9.1-17 | MADAR: research/noncommercial; permission required before commercial reuse | content | blocked_by_external_dependency | — | B-RIGHTS |
| R-9.1-18 | CAMeL Tools for Arabic normalization/reference; not a substitute for native review | ai | not_started | — | — |
| R-9.1-19 | Community speakers / contracted linguists: original recordings under written agreements (preferred flagship source) | content | blocked_by_external_dependency | — | B-NATIVE, B-LICENSE |
| R-9.1-20 | AI-generated material via OpenRouter with native review, provider terms, prompt/version provenance; never assumed accurate | content | not_started | — | — |
| R-9.2-01 | Tatoeba importer: per-language TSV join, per-row license, Unicode normalization, language detection/filtering, intent curation, sha256 + snapshot ID | scripts | not_started | — | — |
| R-9.3-01 | Taskmaster extraction of intent structure, interruptions, slot filling, clarification; no mechanical translation as authentic dialogue | scripts | not_started | — | — |
| R-9.4-01 | Common Voice acquisition via MDC with terms; internal benchmarks only; no mirroring, re-identification or cloning | scripts | not_started | — | — |
| R-9.5-01 | Curated phrase units from intents: greetings, requests, prices, directions, small talk, preferences, refusals, repairs, emotion, plans, invitations, professionals | curriculum | not_started | — | — |
| R-9.5-02 | Conversation usefulness weighted over raw corpus frequency | curriculum | not_started | — | — |
| R-9.5-03 | Multiple natural variants with register, gender/politeness, regional idioms, context constraints, pronunciation difficulty | content | not_started | — | — |
| R-9.5-04 | Favor short remixable expressions over dictionary word cards | curriculum | not_started | — | — |
| R-9.5-05 | Each expression paired with regional speaker or approved TTS audio, normal and slow, optional script/transliteration, source explanations | content | not_started | — | — |
| R-9.6-01 | MSA: formal reference and standalone beginner track; never replaces colloquial tracks | content | not_started | — | — |
| R-9.6-02 | Egyptian `arz`: original Egyptian speech/dialogues; test `ar-EG` providers; validate colloquial writing | content | not_started | — | — |
| R-9.6-03 | Moroccan `ary`: native-reviewed original Darija conversations, Arabic script + Arabizi, code-switching; no MSA scores as Darija | content | blocked_by_external_dependency | — | B-NATIVE |
| R-9.6-04 | Levantine `ar-levant`: distinguish SY/LB/PS/JO expressions and voices with explicit default and regional choice | content | not_started | — | — |
| R-9.6-05 | Mandarin: tone/pinyin/script-aware phrases, accents, formal vs colloquial; variant support | content | not_started | — | — |
| R-9.6-06 | Simplified Chinese entry emphasizes Simplified characters with shared Mandarin audio | content | not_started | — | — |
| R-9.6-07 | Cantonese: Jyutping, tone-rich `yue`, colloquial characters; never reuse Mandarin TTS; HK native partners | content | blocked_by_external_dependency | — | B-NATIVE |
| R-9.6-08 | Romance/Germanic/Slavic/Greek: cleared Tatoeba/OPUS subsets, FLEURS/Common Voice evaluation, locale reference voices, regional contrasts preserved | content | not_started | — | — |
| R-9.6-09 | English as target taught from FR/ES/RU and other sources, not merely an English interface | content | not_started | — | — |
| R-9.6-10 | Hindi: Devanagari, natural speech, optional romanization, formality | content | not_started | — | — |
| R-9.6-11 | Japanese: native dialogues, kana/kanji/furigana/romaji, politeness; conversations first | content | not_started | — | — |
| R-9.6-12 | Korean: Hangul, politeness levels, natural endings, optional romanization | content | not_started | — | — |
| R-9.6-13 | Hebrew: bidirectional text, RTL, optional vowels/transliteration | content | not_started | — | — |
| R-9.6-14 | Vietnamese: northern/southern preference, tone-aware pronunciation, STT/TTS tested per variant | content | not_started | — | — |
| R-9.6-15 | Haitian Creole: real Kreyòl dialogues and orthography with community validation; not a French accent mode | content | blocked_by_external_dependency | — | B-NATIVE |
| R-9.6-16 | Swahili: Kenyan/Tanzanian speaker data; avoid classroom-only Swahili | content | not_started | — | B-NATIVE |
| R-9.6-17 | Kinyarwanda: commissioned native lessons/audio; licensed corpora inspected; no invented phoneme scoring | content | blocked_by_external_dependency | — | B-NATIVE |
| R-9.6-18 | Lingala: community-created native dialogue/voice with DRC/Congo accents; no French/Swahili substitution | content | blocked_by_external_dependency | — | B-NATIVE |
| R-9.6-19 | Voice-provider coverage and evaluation limits documented for low-resource tracks; gaps are acquisition problems, not silent substitution | docs | not_started | — | — |
| R-9.7-01 | Recruit verified native speakers/tutors across gender, age, register, urban/rural with consent | content | blocked_by_external_dependency | — | B-NATIVE |
| R-9.7-02 | Scenario briefs (not sentence translation) eliciting natural turns, phrasings, misunderstandings, emotions, conventions | content | not_started | — | — |
| R-9.7-03 | Recording spec: headroom, quiet room, channel/sample-rate spec, transcript, time markers, accent tags; no copyrighted music | docs | not_started | — | — |
| R-9.7-04 | Written terms covering scope, ownership/license, adaptation, playback, translations, redistribution, separate synthetic-voice permission, privacy, withdrawal | content | blocked_by_external_dependency | — | B-LICENSE |
| R-9.7-05 | Human approval gate: native edit, back-translation agreement, sensitivity, accent, recording quality, reference correctness | admin | not_started | — | — |
| R-9.8-01 | Content factory stages: brief → cleared sources → constrained generation → source translations (en, fr, es, ru) → validators → second-model review → native review → rights approval → audio → QA → publish → manifest | jobs | not_started | — | — |
| R-9.8-02 | Generate diverse dialogues, not one-correct-answer quizzes | ai | not_started | — | — |
| R-9.8-03 | Review console shows sources, suggested lesson, translation, prompts, voice, word timings, comments and QA diff | admin | not_started | — | — |
| R-9.8-04 | Every generated item stores provenance: model version, prompt template version, timestamp, editor version, license marker | db | not_started | — | — |
| R-9.8-05 | Reject unnatural, overly formal, wrong-dialect, insensitive or conversationally useless scripted responses | admin | not_started | — | — |
| R-9.8-06 | Draft content schema (intentId, targetTrack, targetVariety, sourceLanguage, mission, expressions, publication gates); placeholders never go live | contracts | not_started | — | — |
| R-9.9-01 | DO: originals with licenses, attribution, restriction tracking, counsel for ambiguous collections, analytics vs redistribution distinction, takedown workflow | content | not_started | — | — |
| R-9.9-02 | DON'T: rip competitor audio, publish purchased lessons, scrape subtitles, treat MIT/CC0 as upstream clearance, infer identity, clone voices, assume NC OK, publish unreviewed minority-language speech | content | not_started | — | — |

## §10 I18n, UX, accessibility and visual design

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-10.1-01 | Three independent variables: `ui_locale`, per-enrollment `source_language_code`, `target_variety` with independent `target_script_mode` | locales | not_started | — | — |
| R-10.1-02 | `LanguageContext` object passed to all mission, AI, audio and scoring calls | contracts | not_started | — | — |
| R-10.1-03 | ICU message catalogs with pluralization, locale date/number formatting and accessible labels | locales | not_started | — | — |
| R-10.1-04 | French source-language instructions and audio review as a first-class pipeline, not machine-translation leftovers | content | not_started | — | — |
| R-10.2-01 | Game-quality uncluttered visuals: restrained palette, accessible typography, expressive characters, scenario artwork | ui | not_started | — | — |
| R-10.2-02 | Authentic cultural imagery with licensed/consented assets; no country stereotypes | content | not_started | — | — |
| R-10.2-03 | Original mascot present (learner can disable); meaningful XP/haptic celebrations; purposeful comprehension images | ui | not_started | — | — |
| R-10.2-04 | Speaking screens prioritize mic, transcript toggle, repeat, slow, hints, listening, next; no irrelevant controls | mobile | not_started | — | — |
| R-10.2-05 | Audio progress visible with immediate resume; graceful empty states; downloads organized by storage; skeleton loading | mobile | not_started | — | — |
| R-10.2-06 | Animations never block speak/listen; reduce-motion option; reliable low-end Android performance | mobile | not_started | — | — |
| R-10.2A-01 | Mascot presence mandatory; contextual images, illustrated worlds, lesson art and portraits genuinely render and flow through publishing | ui | not_started | — | — |
| R-10.2A-02 | Distinctive proprietary identity; no Duolingo owl/trade dress/tracing; documented asset provenance | ui | not_started | — | — |
| R-10.2A-03 | Theme-token system: semantic colors, typography, scales, radii, spacing, elevation, icon sizes, crops, state colors, dark/light, high contrast, reduced motion | ui | not_started | — | — |
| R-10.2A-04 | Design for small phones/tablets, RTL, varied script heights, enlarged text, French expansion; never meaning by color or flags alone | ui | not_started | — | — |
| R-10.2A-05 | Single original orbit-creature mascot: rounded body, expressive eyes, tiny limbs, asymmetric ribbon tail; curious, encouraging, never judgmental | ui | not_started | — | — |
| R-10.2A-06 | `mascot-style-guide.md`: silhouette, anatomy, expressions, personality, palette, light/dark, gestures, do-not rules, naming | docs | not_started | — | — |
| R-10.2A-07 | Editable vector master (SVG) plus optimized exports (SVG/WebP/PNG, Lottie/Rive); only appropriately licensed fonts | ui | not_started | — | — |
| R-10.2A-08 | Mascot states: neutral, welcome, happy, curious, listening, speaking, thinking, encouraging, try_again, celebrate, achievement, quiet_audio, sleep, offline, connection_error, success, gentle_hint | ui | not_started | — | — |
| R-10.2A-09 | Short optional animations (idle, reaction, anticipation, bounce, reveal, thinking, recovery); skippable; static equivalents always available | ui | not_started | — | — |
| R-10.2A-10 | Consistent size variants: 24–40 dp icon, 64–96 dp companion, medium welcome, full-screen celebration | ui | not_started | — | — |
| R-10.2A-11 | Accessible labels; mascot speech localized and following the enrollment `source_language`; never replaces target pronunciation samples | locales | not_started | — | — |
| R-10.2A-12 | Mascot guides real speaking; never guilts, shames, fakes scoring or interrupts live dialogue unnecessarily | ui | not_started | — | — |
| R-10.2A-13 | Original character roster with portraits, body art, expressions, clothing, voice identity, dialect profile, memory, arcs; `CharacterVisualProfile` + `CharacterVoiceProfile` stored in CMS/R2 | content | not_started | — | — |
| R-10.2A-14 | Characters are native interlocutors (cashier, neighbor, coworker…); original names/looks; no stereotyped costumes | content | not_started | — | — |
| R-10.2A-15 | Each cast authentically matches its linguistic setting (Darija speaks Darija, Cantonese speaks Cantonese); expert cultural/dialect review | content | not_started | — | B-NATIVE (review) |
| R-10.2A-16 | Lead character pose set: neutral, greeting, listening, talking, surprise, confusion, success, follow-up, optional mouth shapes; works static | ui | not_started | — | — |
| R-10.2A-17 | Character continuity across missions; character gallery / meet-the-locals; backstories unlocked by missions, never paid | mobile | not_started | — | — |
| R-10.2A-18 | Transparent speech status (speaking, waiting, mic active, thinking, reconnecting); no false waveform | mobile | not_started | — | — |
| R-10.2A-19 | Asset category: course cover/landscape art per track; localized overlay text separate | content | not_started | — | — |
| R-10.2A-20 | Asset category: mission scene/location art with place, dialect, prompt, composition, rights, variants, alt text metadata | content | not_started | — | — |
| R-10.2A-21 | Asset category: contextual object images with unambiguous referents and semantic labels | content | not_started | — | — |
| R-10.2A-22 | Asset category: character portraits and expressions with stable IDs and voice association | content | not_started | — | — |
| R-10.2A-23 | Asset category: mascot illustrations and animations pack with static alternatives | ui | not_started | — | — |
| R-10.2A-24 | Asset category: audio-course covers, admin-uploadable or template-generated; no unlicensed scans | admin | not_started | — | — |
| R-10.2A-25 | Asset category: map and progression artwork; fictional maps distinguished; accessible non-map navigation | ui | not_started | — | — |
| R-10.2A-26 | Asset category: feedback/celebration visuals that never mislead about proficiency | ui | not_started | — | — |
| R-10.2A-27 | Asset category: story panels/short clips, culturally reviewed, subtitled, no essential knowledge only in video | content | not_started | — | — |
| R-10.2A-28 | Asset category: achievement/profile assets with accessible text and no commerce mechanics | ui | not_started | — | — |
| R-10.2A-29 | Asset counts driven by curriculum: each mission ≥1 purposeful visual, every published course has cover art, every speaking character has an avatar | content | not_started | — | — |
| R-10.2A-30 | Reproducible art pipeline in admin: owner uploads, licensed stock with provenance, AI generation when rights allow; origin/usage/license in `visual_assets`/`content_rights` | admin | not_started | — | — |
| R-10.2A-31 | Without an image-generation tool, never claim generated images: in-code original vector art, asset manifests, generation queues, honest readiness | ui | not_started | — | — |
| R-10.2A-32 | Art-direction prompt templates (mission environment, character, mascot pack, context image) stored as project assets | docs | not_started | — | — |
| R-10.2A-33 | Never bake localized text into images; overlay via i18n catalogs incl. RTL/script variants | ui | not_started | — | — |
| R-10.2A-34 | Originals private; exports optimized/responsive with hashes, dominant colors, dimensions, alt text, moderation, cache headers; R2 delivery and prefetch of imminent art | media | not_started | — | B-R2 (delivery) |
| R-10.2A-35 | Admin actions: asset upload, preview, crop/focal point, assignment, batch labeling, rights audit, status, immutable-key replacement, safe removal | admin | not_started | — | — |
| R-10.2A-36 | Respect model/provider rights and talent consent for visual generation and likeness; no copied copyrighted work | content | not_started | — | — |
| R-10.2B-00 | Ten blueprint screens implemented as reusable RN components with real assets, actual-build screenshots and visual regression tests | mobile | not_started | — | — |
| R-10.2B-01 | Screen 1 Onboarding: mascot hero with localized promise; source picker first with French prominent; 30-entry target grid with native-script sample and dialect clarification | mobile | not_started | — | — |
| R-10.2B-02 | Screen 1 Onboarding: confirm "Learn [target] from [source]" per enrollment; beginner baseline listening/speaking sample; skippable; just-in-time mic permission | mobile | not_started | — | — |
| R-10.2B-03 | Screen 2 Home layout: mascot welcome, course switcher, profile, illustrated mission card with duration, speaking meter, continue audio, due reviews, 5-tab bar | mobile | not_started | — | — |
| R-10.2B-04 | Screen 2 Home: primary CTA launches a speakable mission in one tap; XP/streak secondary; never a grammar menu | mobile | not_started | — | — |
| R-10.2B-05 | Screen 3 Mission pathway: branching illustrated route with chapter labels, accessible linear list, objective/duration/focus/skill cards; no false geography | mobile | not_started | — | — |
| R-10.2B-06 | Screen 4 Listen→anticipate→speak layout: scene art, character line, replay/slow/translate, large mic, hint, reveal/compare, hidden word help | mobile | not_started | — | — |
| R-10.2B-07 | Screen 4: honest listening/speaking state animation; learner invited to answer before full model reveal; contextual hints | mobile | not_started | — | — |
| R-10.2B-08 | Screen 5 Live conversation: portrait with listening/talking states over scene; one primary mic/PTT; repeat, slow, hint, translation, transcript, leave/pause | mobile | not_started | — | — |
| R-10.2B-09 | Screen 5: character speaks target dialect, hints in source language; summary after conversation; transparent reconnect/permission/provider errors; no fake waveform | mobile | not_started | — | — |
| R-10.2B-10 | Screen 6 Pronunciation coach: large phrase with script/romanization toggle, reference audio, obvious record/retry | mobile | not_started | — | — |
| R-10.2B-11 | Screen 6: word/phoneme feedback with color-blind-safe labels only from a capable evaluator; numeric score never from transcription | mobile | not_started | — | — |
| R-10.2B-12 | Screen 7 Audio library: cover art for series/chapters/lessons; search/filter by target, instruction language, speaker, level, length, chapter | mobile | not_started | — | — |
| R-10.2B-13 | Screen 7 Player: artwork, seekbar, speed, skip, resume, download, transcript follow-along, bookmark, chapter nav, repeat sentence, "Practice this with AI"; licensed covers never overwritten | mobile | not_started | — | — |
| R-10.2B-14 | Screen 8 Characters/world/story gallery: look, region/dialect, backstory, voice, unlocked conversations; respectful region art | mobile | not_started | — | — |
| R-10.2B-15 | Screen 9 Progress/profile: can-do mastery with evidence, mission outcomes, trends, due recall, goals, badges; XP distinct from ability, no "fluent" from streaks | mobile | not_started | — | — |
| R-10.2B-16 | Screen 10 Admin studio: media library for MP3s and images with filters, previews, asset lineage, rights, assignments, bulk edit, publish workflow, AI jobs, metrics | admin | not_started | — | — |
| R-10.2B-17 | Screen 10: visual editor for scenes, poses, mascot placements, covers, story sequencing; publishes to mobile via versioned manifests | admin | not_started | — | — |
| R-10.2C-01 | Component library: AppShell, Mascot, CharacterPortrait, SceneArtwork, MissionCard, LessonProgress, AudioPlayer, SpeakButton, SpeechStateIndicator, HintSheet, PronunciationFeedback, LanguagePairPicker, StoryMap, AchievementCelebration, AssetPicker | ui | not_started | — | — |
| R-10.2C-02 | `visual_assets` (id, storage_key, type, style_version, content_hash, license_id, alt_text_key, focal_point, dimensions, locale_neutral, review_status) plus `mascot_animations`, `character_visual_variants`, `mission_visual_bindings`, `audio_cover_art` with migrations and typed contracts | db | not_started | — | — |
| R-10.2C-03 | Single style guide and production asset manifest before mass generation; pilot scene/mascot/object/character review | docs | not_started | — | — |
| R-10.2C-04 | Real visual artifacts in repo: mascot vectors/states, mission art, portraits, cover templates, icons, exports | ui | not_started | — | — |
| R-10.2C-05 | Screenshot snapshots of all ten screens, light/dark, one French-source, one Arabic RTL, one Chinese-script course, low-end narrow Android | tests | not_started | — | — |
| R-10.2C-06 | Verify R2/offline image loads, stable character art, reduced-motion behavior, accessibility descriptions, no copied assets, no blank panels | tests | not_started | — | — |
| R-10.2C-07 | Instrument load times, asset bytes, cache hit rate, failed image requests; correct dimensions, lazy loading, bounded Lottie/Rive instances | telemetry | not_started | — | — |
| R-10.2C-08 | No fake visual completeness: working pipeline plus genuine in-code art; mark art still requiring review | ui | not_started | — | — |
| R-10.3-01 | VoiceOver/TalkBack, control descriptions, focus order, contrast, font scaling/dyslexia options, reduced motion, colorblind-safe scoring, optional haptics | mobile | not_started | — | — |
| R-10.3-02 | Deaf/hard-of-hearing mode with transcripts and visual exercises; account remains usable | mobile | not_started | — | — |
| R-10.3-03 | Motor accessibility: larger record button, alternatives to press-and-hold, accessible mic controls | mobile | not_started | — | — |
| R-10.3-04 | Linguistic accessibility: selectable source language, script mode, RTL, slow audio, optional phonetic aids | locales | not_started | — | — |
| R-10.3-05 | No hidden timer pressure for beginner speech, no public embarrassment, no mandatory leaderboard | mobile | not_started | — | — |
| R-10.4-01 | Opt-in reminders (due expressions, new mission, continue audio, daily goal) with quiet hours and timezone; no manipulation | api | not_started | — | — |
| R-10.4-02 | Streaks pausable without guilt; multiple courses with course-specific due reviews | curriculum | not_started | — | — |

## §11 Security, privacy, safety, data retention

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-11-01 | Secure sign-up/auth, email verification, password reset, optional OAuth, suspicious-login checks, session rotation, multi-device logout | api | not_started | — | B-RESEND (branded emails only) |
| R-11-02 | Strict per-user RLS and admin role checks; API verifies JWT claims/scopes; cross-account transcript/progress/audio access denied in tests | api | not_started | — | — |
| R-11-03 | Mic permission requested in context; record only when intended with clear indicator; no default retention; consent + TTL + deletion if stored | mobile | not_started | — | — |
| R-11-04 | Minimize sensitive content in character history/AI context; redacted AI logs without tokens; privacy notice, consent controls, export, deletion | api | not_started | — | — |
| R-11-05 | Provider disclosure: third-party AI processors, data regions and actual retention policies | docs | not_started | — | — |
| R-11-06 | Child protection: eligible ages/youth requirements decided before production; no COPPA/GDPR claims without implementation; age-safe characters | docs | not_started | — | — |
| R-11-07 | Content moderation for harassment/safety; no manipulative characters; report/block; safe fallback conversation | ai | not_started | — | — |
| R-11-08 | Rate limits for auth/DDoS, model-call validation, anti-bot; explicitly not subscription quotas; no premium features exist | api | not_started | — | — |
| R-11-09 | Presigned uploads limited in scope, expiry, size/type and key; completion verifies object; private originals; rights-aware publishing; takedown | api | not_started | — | B-R2 |
| R-11-10 | Hardening: CSP/admin headers, CSRF, CORS allowlist, input/filename validation, dependency scans, encrypted secrets, audit logs, backups/restore drills, retention policy, RLS regression suite | infra | not_started | — | B-SUPABASE (hosted backups/restore) |
| R-11-11 | Jurisdictional privacy/copyright compliance; counsel consulted before broad release (children's voices, licensed audio) | docs | not_started | — | — |

## §12 Performance, cost control and operations

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-12.1-01 | Static voice/course content generated and reviewed once, stored in R2, shared/cached per course | media | not_started | — | B-R2 |
| R-12.1-02 | Reusable manifests, localized phrases and cached translations across users; no per-user writes for static browsing | api | not_started | — | — |
| R-12.1-03 | Lightweight spoken recall uploads short snippets to ASR/scoring; no full live AI call per fixed phrase | ai | not_started | — | — |
| R-12.1-04 | Guided tasks use preauthored prompts with a small model for interpretation and dynamic follow-ups | ai | not_started | — | — |
| R-12.1-05 | Free-form realtime conversations reserved for actual speaking; best cost/quality provider; lean context; efficient TTS; still free | ai | not_started | — | — |
| R-12.1-06 | Batch content processing offline/async; dedupe transcription and generation by version + hash | jobs | not_started | — | — |
| R-12.1-07 | Progress: local update then periodic idempotent sync; cached leaderboards and manifests | mobile | not_started | — | — |
| R-12.1-08 | Async media processing on demand, not 24/7 paid servers | jobs | not_started | — | — |
| R-12.1-09 | R2 Standard (not cold storage) for frequently played audio; periodic total-cost recalculation | infra | not_started | — | B-R2 |
| R-12.1-10 | Monitor AI cost per completed speaking mission, learning success, retries, latency, retention; cheapest model not preferred if quality causes retries | telemetry | not_started | — | — |
| R-12.2-01 | Cost dashboard: provider usage reconciliation, requests per task, audio-seconds, tokens, storage GB, Cloudflare ops, cost per learner/conversation/lesson | admin | not_started | — | — |
| R-12.2-02 | Performance metrics: cold start, first media frame, first AI audio, interruption latency, failed media/download rate, ASR confidence by language, errors, timeouts | telemetry | not_started | — | — |
| R-12.2-03 | Learning metrics: hint-free mission completion, transfer, 7/30-day recall, false corrections by language, listening comprehension, speaking time, D7/D30 retention | telemetry | not_started | — | — |
| R-12.2-04 | Editor quality metrics: native-reviewed fraction, rights coverage, localization coverage by source, live model capability by track, takedowns, transcript quality | admin | not_started | — | — |
| R-12.2-05 | Alerts for runaway cost or attack; graceful provider fallback; incident runbooks; no quiet freemium or dialect switch under degradation | telemetry | not_started | — | — |
| R-12.3-01 | Provider pricing (R2, Supabase, Workers, OpenRouter, Azure) never hard-coded; revalidated before configuration and deploy | docs | not_started | — | — |

## §13 Phased delivery plan

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-13.0-01 | Phase 0: initialize the monorepo described in §4.2 (no prior repository supplied) | infra | implemented_tested | `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `apps/{mobile,admin,api,jobs}`, `packages/*`, `docs/CONVENTIONS.md`, commit `3ffa214` | — |
| R-13.0-02 | Phase 0: choose versions after consulting current Expo/Cloudflare/OpenRouter/Supabase docs | docs | implemented_tested | `package.json` (TS ~5.9, Vitest 4, Turbo 2, Supabase CLI 2), `docs/reference/expo-audio-sdk57.md`, `docs/provider-matrix/openrouter-models-snapshot-2026-10-14.json`, `docs/provider-matrix/openrouter-speech-api-notes.md` | — |
| R-13.0-03 | Phase 0: ADR for mobile audio runtime | docs | implemented_tested | `docs/decisions/ADR-001-mobile-audio-runtime.md` | — |
| R-13.0-04 | Phase 0: ADR for realtime voice interface | docs | implemented_tested | `docs/decisions/ADR-002-realtime-voice-interface.md` | — |
| R-13.0-05 | Phase 0: ADR for data-access architecture | docs | not_started | — (no ADR-003 in `docs/decisions/`) | — |
| R-13.0-06 | Phase 0: ADR for versioned manifests | docs | implemented_tested | `docs/decisions/ADR-004-versioned-manifests.md` | — |
| R-13.0-07 | Phase 0: ADR for async job queue backend | docs | implemented_tested | `docs/decisions/ADR-005-job-queue.md` | — |
| R-13.0-08 | Phase 0: repo lint and format configuration | infra | implemented_tested | `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.editorconfig`, `package.json` scripts `lint`/`format` | — |
| R-13.0-09 | Phase 0: TypeScript strict checks across the workspace | infra | implemented_tested | `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`), `turbo.json` `typecheck` | — |
| R-13.0-10 | Phase 0: unit test runner | tests | implemented_tested | `package.json` (vitest ^4.1.0, `turbo run test`), `tests/package.json`, `tests/{unit,integration,security,e2e,audio,locales,load}` | — |
| R-13.0-11 | Phase 0: mobile iOS/Android, web admin, Worker and jobs local dev entry points | infra | implemented_tested | `apps/mobile/package.json` (`expo start`), `apps/admin/package.json` (`next dev`), `apps/api/package.json` (`wrangler dev`), `apps/jobs/package.json` (`tsx watch`), root `dev:*` scripts | — |
| R-13.0-12 | Phase 0: Supabase local database stack | db | implemented_tested | `supabase/config.toml`, `README.md` quick start (`pnpm supabase start`/`db reset`), `supabase/migrations/` (empty, Phase 1) | — |
| R-13.0-13 | Phase 0: CI skeleton | infra | not_started | — (no `.github/workflows`) | B-CF-TOKEN (deploy steps) |
| R-13.0-14 | Phase 0: central environment template with documented secrets (Supabase, R2, OpenRouter, speech, URLs, queues, monitoring) | infra | implemented_tested | `.env.example`, `.gitignore` (`.env`, `.dev.vars` excluded) | — |
| R-13.0-15 | Phase 0: dev/staging/prod isolation, backups, least-privilege roles, documented test fixtures | infra | blocked_by_external_dependency | — | B-SUPABASE, B-R2 |
| R-13.0-16 | Phase 0 accept: clone/setup documented, all apps compile, health checks pass, no secrets committed, consistent typed workspace | infra | in_progress | `README.md` (setup), `.gitignore` (no `.env` tracked); compile/health checks not yet recorded | — |
| R-13.1-01 | Phase 1: migrations for profiles, languages, varieties/scripts, 30 tracks, source localization, enrollments; seed exact §2 entries | db | not_started | — | — |
| R-13.1-02 | Phase 1: Supabase email signup/login/logout/recovery/verification, optional social login, profile, per-user RLS with security tests | api | not_started | — | — |
| R-13.1-03 | Phase 1: onboarding with default UI locale and default source language; visible target course and source choice | mobile | not_started | — | — |
| R-13.1-04 | Phase 1: per-course instruction-language selectors at enrollment and settings; persisted and synced; source change keeps progress | mobile | not_started | — | — |
| R-13.1-05 | Phase 1: full English/French i18n architecture, RTL, source/target/script distinctions, locale-aware fonts | locales | not_started | — | — |
| R-13.1-06 | Phase 1 accept: FR account enrolls Darija-from-FR and Japanese-from-EN, edits Japanese to FR, re-logs on another device with both settings/progress intact; RU learner English-from-RU; ES-from-EN learner adds course without overwriting profile; all 30 tracks list | tests | not_started | — | — |
| R-13.2-01 | Phase 2: protected admin login/role enforcement; dashboard, languages/courses/chapters/lessons/speakers/assets, filters, search, draft/review/publish states | admin | not_started | — | — |
| R-13.2-02 | Phase 2: R2 private buckets, signed multipart direct upload, progress, retry/cancel/resume, checksums; rclone + CSV/JSON manifest import | infra | blocked_by_external_dependency | — | B-R2 |
| R-13.2-03 | Phase 2: technical metadata extraction, safe media validation, dedupe, source origin/rights, required metadata fields | media | not_started | — | — |
| R-13.2-04 | Phase 2: bulk labeling (target/instruction language, chapter, lesson order, instructor, accent, title, description, tags, status); reorder and group ops | admin | not_started | — | — |
| R-13.2-05 | Phase 2: background job queue for inspection/transcode with progress, errors and audit log | jobs | not_started | — | — |
| R-13.2-06 | Phase 2 accept: import nested folder of thousands of MP3s (multi-GB), resume interrupted upload, bulk-edit languages/chapter, reorder, verify rights, publish, metadata visible in mobile API; Next.js not an upload bottleneck | tests | blocked_by_external_dependency | — | B-R2 |
| R-13.3-01 | Phase 3: entire Audio tab (collections, chapters, lessons, search, progress, mini-player, full player, transcript panel, attribution) | mobile | not_started | — | — |
| R-13.3-02 | Phase 3: signed R2 streaming, authorization, range seeks, background playback, media controls, rate, interruptions, skip, bookmarks, sleep timer, queue | mobile | not_started | — | B-R2 (production streaming) |
| R-13.3-03 | Phase 3: download manager with progress/cancel/retry, device/user-preference storage limits, offline index, position/bookmark sync | mobile | not_started | — | — |
| R-13.3-04 | Phase 3: original MP3 plays intact with pauses; R2 license policy; URL reissue mid-stream | media | not_started | — | — |
| R-13.3-05 | Phase 3 accept: iOS/Android play 60-minute original, seek at 45 min, lock screen, headphone reconnect, airplane-mode playback, cross-device resume, expired URL handled | tests | not_started | — | B-R2 (real signed URLs) |
| R-13.4-01 | Phase 4: content model for intents/skills, mission steps, expressions, script forms, translations, sources, audio, prerequisites, outcomes | curriculum | not_started | — | — |
| R-13.4-02 | Phase 4: standard lesson actions (listen, image, identify, anticipate, record/reveal/repeat, guided response, help, review, retry) | mobile | not_started | — | — |
| R-13.4-03 | Phase 4: real model audio playback, speech capture permissions, audio device handling | mobile | not_started | — | — |
| R-13.4-04 | Phase 4: FSRS-like scheduler, learning observations, adaptive next-mission planner, multi-device sync, offline deterministic packs | curriculum | not_started | — | — |
| R-13.4-05 | Phase 4: story/chapter navigation, progress and learning evidence; no grammar worksheets by default | mobile | not_started | — | — |
| R-13.4-06 | Phase 4 accept: beginner completes narrated lesson with several spoken responses, anticipates, receives observed outcomes, later retrieves expression in new scenario, replays audio offline | tests | not_started | — | — |
| R-13.5-01 | Phase 5: `TextReasoner` on OpenRouter with task-scoped configs, admin model selection, fallback, schema constraints, cost/latency tracking, benchmarks | ai | not_started | — | — |
| R-13.5-02 | Phase 5: level-aware dialogue generator, skill diagnosis, source-language hints, meaning-equivalence scoring, after-action feedback | ai | not_started | — | — |
| R-13.5-03 | Phase 5: separate fast character and evaluator roles; structured observations; privacy-preserving summaries and memories | ai | not_started | — | — |
| R-13.5-04 | Phase 5: per-variety quality fixtures, language-output guards and review process | tests | not_started | — | — |
| R-13.5-05 | Phase 5 accept: admin swaps conversation model without app update and compares; semantic equivalent passes while wrong meaning fails; Darija-from-FR gets Darija + French coaching; fallback never crosses dialect | tests | not_started | — | — |
| R-13.6-01 | Phase 6: STT, TTS and realtime adapters; OpenRouter default reasoner; OpenRouter speech where tested | ai | not_started | — | — |
| R-13.6-02 | Phase 6: low-latency interruption-aware session, VAD, push-to-talk, provider ticketing, dynamic character speech and scene state | ai | not_started | — | — |
| R-13.6-03 | Phase 6: guided and free-form speaking missions with hints, natural mistake handling, live listening state, robust connections | mobile | not_started | — | — |
| R-13.6-04 | Phase 6: explicit mission success rubric accepting genuine communicative goals without scripted answers | curriculum | not_started | — | — |
| R-13.6-05 | Phase 6: post-conversation summary with priority corrections; weak skills scheduled for review | ai | not_started | — | — |
| R-13.6-06 | Phase 6 accept: coherent 5-minute spoken exchange with interruption, slower/repeat requests, deviation handled, mission completed, accurate feedback; TTS quality and latency measured | tests | not_started | — | — |
| R-13.7-01 | Phase 7: scripted pronunciation practice, reference audio, short-recording assessment, word-level feedback, stress/tone/phoneme where supported, explanation audio, retry history | ai | not_started | — | B-AZURE (phoneme-level) |
| R-13.7-02 | Phase 7: provider capability registry for every track with documented fallback where precise scoring unsupported | ai | not_started | — | — |
| R-13.7-03 | Phase 7: native-speaker speech QA samples and tests for false-positive corrections / accent penalties | tests | blocked_by_external_dependency | — | B-NATIVE |
| R-13.7-04 | Phase 7: repeat errors feed next mission and review scheduler; accessible no-mic alternative | curriculum | not_started | — | — |
| R-13.7-05 | Phase 7 accept: supported languages get provider-grounded word-level feedback; unsupported varieties get no invented scores; Darija/Creole/Kinyarwanda/Lingala remain authentic | tests | blocked_by_external_dependency | — | B-AZURE, B-NATIVE |
| R-13.8-01 | Phase 8: MP3 transcription jobs, mixed-language transcripts, segment editing, consented speaker ID, word alignment, source translations, revisions | jobs | not_started | — | — |
| R-13.8-02 | Phase 8: follow-along captions, sentence looping, repeat-and-score, save-to-review, discussion questions, conversation mission from lesson | mobile | not_started | — | — |
| R-13.8-03 | Phase 8: rights-controlled 'audio chapter → learning unit' editorial workflow with review; original separately listenable | admin | not_started | — | — |
| R-13.8-04 | Phase 8 accept: permitted 30–60 min mixed-language course → editable synced transcript, phrase replay, French meaning, repeat recording, live practice, original pauses intact | tests | blocked_by_external_dependency | — | B-LICENSE |
| R-13.9-01 | Phase 9: produce and integrate the full §10.2A–C visual identity (mascot, characters, environments, covers, maps, layouts, CMS pipeline) with real screenshots | ui | not_started | — | — |
| R-13.9-02 | Phase 9: cohesive game UI, course map, mission progression, story chapters, recurring characters with persistent safe memory | mobile | not_started | — | — |
| R-13.9-03 | Phase 9: XP/achievement ledger, streak options, celebrations, optional leaderboard/social with privacy; no premium gating | api | not_started | — | — |
| R-13.9-04 | Phase 9: progress dashboard with can-do evidence, recall calendar, statistics, reminder notifications, course switcher | mobile | not_started | — | — |
| R-13.9-05 | Phase 9: content-neutral learning analytics and milestone evaluations | telemetry | not_started | — | — |
| R-13.9-06 | Phase 9 accept: mascot and art in real screens, accessible static/animated reactions, ten layouts tested, story advances via skill, character memory works, XP unforgeable, source change keeps story/level | tests | not_started | — | — |
| R-13.10-01 | Phase 10: importers for cleared Tatoeba/FLEURS/other resources with row-level license, attribution, snapshots; native review workflows; corpus QA scripts | scripts | not_started | — | — |
| R-13.10-02 | Phase 10: all 30 tracks have real course data on the same framework; EN and FR instruction complete; ES/RU and others via review pipelines | content | not_started | — | B-NATIVE |
| R-13.10-03 | Phase 10: per-variety benchmarks for character text, STT, TTS, pronunciation fallback, scripts, explanations; coverage dashboard | admin | not_started | — | — |
| R-13.10-04 | Phase 10: human-reviewed flagship mission, pronunciation and dialogue examples for every dialect and lower-resource language | content | blocked_by_external_dependency | — | B-NATIVE |
| R-13.10-05 | Phase 10 targets: ~40 coherent missions and ~800 practical expressions per track with variants and reference audio; quality over inflation | content | not_started | — | — |
| R-13.10-06 | Phase 10 accept: all 30 tracks and EN/FR flows pass native-review samples and journeys; remaining pairs disclosed; no fake speech passes | tests | blocked_by_external_dependency | — | B-NATIVE |
| R-13.11-01 | Phase 11: security audit (auth, CORS, RLS, escalation, media access, signing, uploads, prompt injection, key leaks, deletion/export, retention, licensing) | tests | not_started | — | — |
| R-13.11-02 | Phase 11: load tests (cached catalog, concurrent streaming, speech sessions, progress writes, failover, batch uploads, job retries) | tests | not_started | — | — |
| R-13.11-03 | Phase 11: iOS/Android audio QA, store compliance, crash reporting, backups/restore, cost monitoring, support/abuse reporting, compliance review | infra | not_started | — | B-SUPABASE (hosted backups) |
| R-13.11-04 | Phase 11: accessibility, EN/FR UI and source languages, RTL and script rendering, reduced motion, no-mic alternatives, device testing | tests | not_started | — | — |
| R-13.11-05 | Phase 11 accept: full E2E suite passes with real providers; no paywalls, minute credits, fake scoring, cross-user access or hidden functionality | tests | not_started | — | — |
| R-13.12-01 | Phase 12: README, ADRs, env setup, DB diagrams, OpenAPI, import runbooks, admin manual, provider cost matrix, pronunciation capability table, dataset attribution inventory | docs | not_started | — | — |
| R-13.12-02 | Phase 12: tests and fixtures; documented language/quality/provider blockers with remediation actions | docs | not_started | — | — |
| R-13.12-03 | Phase 12: acceptance checklist with evidence, environment URL/test build instructions, rollback plan, monitoring dashboard | docs | not_started | — | — |
| R-13.12-04 | Phase 12 accept: a second engineer reproduces builds/migrations, creates account, uploads licensed files, completes journeys, swaps models, understands remaining blockers | docs | not_started | — | — |

## §14.1 Core acceptance journeys

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| A01 | New EN-source learner enrolls in Spanish (Spain): target `es-ES`, source `en`, real speech, can-do mission, enrolled account | tests | not_started | — | — |
| A02 | New FR-source learner enrolls in Moroccan Darija: target `ary`, source `fr`, Arabic + Latin scripts, authentic Darija voice, French instructions | tests | not_started | — | B-NATIVE (voice validation) |
| A03 | One user holds Japanese-from-EN and Darija-from-FR simultaneously; per-enrollment settings persist after logoff/restart | tests | not_started | — | — |
| A04 | Change existing Arabic source EN → FR: translations/hints re-render; expressions, listening position, story and mastery preserved | tests | not_started | — | — |
| A05 | RU-source learner starts English target: Russian prompts, actual English audio, English conversation partner | tests | not_started | — | — |
| A06 | FR-source learner starts English target: French instructions, pronunciation coaching against English, not French speech | tests | not_started | — | — |
| A07 | Chinese (Simplified) enrollment: independent track, Mandarin speech, Simplified characters, shared Mandarin content | tests | not_started | — | — |
| A08 | Cantonese enrollment: genuine Cantonese/Jyutping; no Mandarin voice substitution | tests | not_started | — | — |
| A09 | Eastern Arabic selection: defined Levantine regional variants; no MSA substituted as spoken dialect | tests | not_started | — | — |
| A10 | Haitian Creole / Lingala / Kinyarwanda enrollment: honest fidelity, genuine review samples, capability-aware pronunciation feedback | tests | blocked_by_external_dependency | — | B-NATIVE |
| A11 | Beginner café paraphrase succeeds semantically; no exact phrase match required | tests | not_started | — | — |
| A12 | Beginner asks character to speak slower in target language: appropriate natural response, mission context kept | tests | not_started | — | — |
| A13 | Learner interrupts speaking AI: playback stops, turn state consistent, reply to new utterance | tests | not_started | — | — |
| A14 | Wrong pronunciation with correct transcript: pronunciation assessed separately; never reported perfect from transcription | tests | not_started | — | — |
| A15 | Target variety without phoneme assessment: no numeric fake score; reference audio and transparent feedback | tests | not_started | — | — |
| A16 | Pimsleur anticipation: learner attempts or chooses reveal before reference; later recall scheduled | tests | not_started | — | — |
| A17 | Spaced review due after days: skill presented in a varied scenario with updated interval | tests | not_started | — | — |
| A18 | Admin uploads interrupted 1 GB file: multipart resumes, no duplicate published asset, checksum verified | tests | blocked_by_external_dependency | — | B-R2 |
| A19 | Admin batch-imports 1000 mixed MP3s + CSV: labels, course, source language, chapter order, descriptions applied and editable | tests | blocked_by_external_dependency | — | B-R2 |
| A20 | Admin attempts to publish unclear-rights commercial audio: rights gate blocks and explains | tests | not_started | — | — |
| A21 | User listens to licensed 45-minute MP3: background controls, seek, optional transcript, bookmark, offline download | tests | blocked_by_external_dependency | — | B-LICENSE, B-R2 |
| A22 | Signed media URL expires mid-playback: player renews legitimately and continues | tests | blocked_by_external_dependency | — | B-R2 |
| A23 | Offline listening: downloaded track plays; progress syncs after reconnect | tests | not_started | — | B-R2 (download source) |
| A24 | French audio/lesson enrichment: transcript and AI explanation in French when supported/reviewed; original target unchanged | tests | not_started | — | — |
| A25 | Admin changes OpenRouter dialogue model: new model used without rebuild; fallback restores service after outage | tests | not_started | — | — |
| A26 | Arabic role-play unscripted follow-up handled by character without demanding scripted phrase | tests | not_started | — | — |
| A27 | Two devices submit same XP event: idempotent, no double XP, observation survives | tests | not_started | — | — |
| A28 | User deletes account and opted-in recordings: deletion per policy across app, DB, media and analytics | tests | not_started | — | B-R2 (media deletion) |
| A29 | Unauthenticated attacker tries admin upload / other user's recordings: denied at API, R2 and DB layers | tests | not_started | — | B-R2 (R2 layer) |
| A30 | Normal learner uses Speak/Audio/Missions indefinitely: no subscription, paywall, credits, limits or payment prompt | tests | not_started | — | — |
| A31 | Home/Lesson/Story in French UI: original mascot, context imagery, source-localized text, no broken or text-baked images | tests | not_started | — | — |
| A32 | Speaking mission in Moroccan Darija: reviewed locale art, portrait, appropriate voice, no MSA, RTL/Latin legible | tests | not_started | — | B-NATIVE (art/voice review) |
| A33 | Mascot disabled or reduced motion: flow works with static accessible alternatives, no forced animations | tests | not_started | — | — |
| A34 | Admin uploads/replaces character and lesson art: rights/alt-text checks, revisions, manifest update, offline/cache behavior | tests | not_started | — | B-R2 (asset storage) |
| A35 | Full visual regression of primary screens: consistent style, real assets, responsive layouts, no false score/recording UI, real-build screenshots | tests | not_started | — | — |

## §14.2 Native quality evaluation sets (per target track)

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-14.2-01 | 25+ short target expressions per track with verified script/transliteration and EN/FR meaning | content | blocked_by_external_dependency | — | B-NATIVE |
| R-14.2-02 | 10+ small natural conversations per track covering unexpected responses, regional wording, politeness | content | blocked_by_external_dependency | — | B-NATIVE |
| R-14.2-03 | STT examples (clear, noisy, varied voices) where permissible; dialect identification and misrecognition tracking | tests | blocked_by_external_dependency | — | B-NATIVE, B-LICENSE |
| R-14.2-04 | TTS and/or licensed native examples for hard phonetic contrasts; regional correctness test | content | blocked_by_external_dependency | — | B-NATIVE, B-LICENSE |
| R-14.2-05 | 5+ beginner intents with acceptable phrasings; semantic acceptance and inappropriate-answer rejection checks | tests | blocked_by_external_dependency | — | B-NATIVE |
| R-14.2-06 | ≥1 confusion test across related varieties (MSA/Darija, pt-PT/pt-BR, Mandarin/Cantonese, es-ES/es-419, French/Creole) | tests | not_started | — | — |
| R-14.2-07 | Translation QA examples with `en` and `fr` sources; `es`, `ru` and others as reviewed | content | blocked_by_external_dependency | — | B-NATIVE |
| R-14.2-08 | Release gating on reviewer reports and task success; failures block quality claims, not track visibility; sign-off for all tracks | admin | not_started | — | B-NATIVE |

## §14.3 Automated engineering tests

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| T-unit-01 | Unit: locale resolution | tests | not_started | — | — |
| T-unit-02 | Unit: per-course overrides | tests | not_started | — | — |
| T-unit-03 | Unit: SRS spacing | tests | not_started | — | — |
| T-unit-04 | Unit: scoring rubrics | tests | not_started | — | — |
| T-unit-05 | Unit: source-language independence | tests | not_started | — | — |
| T-unit-06 | Unit: license gating | tests | not_started | — | — |
| T-unit-07 | Unit: audio metadata extraction | tests | not_started | — | — |
| T-unit-08 | Unit: idempotent sync | tests | not_started | — | — |
| T-unit-09 | Unit: budget telemetry | tests | not_started | — | — |
| T-int-01 | Integration: Supabase RLS (positive and negative) | tests | not_started | — | — |
| T-int-02 | Integration: R2 multipart finalize and private signed GET | tests | blocked_by_external_dependency | — | B-R2 |
| T-int-03 | Integration: OpenRouter request schemas and fallback | tests | not_started | — | — |
| T-int-04 | Integration: STT/TTS adapters | tests | not_started | — | — |
| T-int-05 | Integration: rights publishing gate | tests | not_started | — | — |
| T-int-06 | Integration: job queue replay | tests | not_started | — | — |
| T-int-07 | Integration: transcript segment editing | tests | not_started | — | — |
| T-mobile-01 | Mobile E2E: auth | tests | not_started | — | — |
| T-mobile-02 | Mobile E2E: course enroll | tests | not_started | — | — |
| T-mobile-03 | Mobile E2E: switch source language | tests | not_started | — | — |
| T-mobile-04 | Mobile E2E: 8-minute mission | tests | not_started | — | — |
| T-mobile-05 | Mobile E2E: speak mic permissions | tests | not_started | — | — |
| T-mobile-06 | Mobile E2E: background audiobook seek | tests | not_started | — | — |
| T-mobile-07 | Mobile E2E: airplane mode | tests | not_started | — | — |
| T-mobile-08 | Mobile E2E: downloaded file reuse | tests | not_started | — | — |
| T-admin-01 | Admin E2E: bulk import | tests | not_started | — | B-R2 |
| T-admin-02 | Admin E2E: role separation | tests | not_started | — | — |
| T-admin-03 | Admin E2E: chapter reordering | tests | not_started | — | — |
| T-admin-04 | Admin E2E: publish | tests | not_started | — | — |
| T-admin-05 | Admin E2E: unpublish | tests | not_started | — | — |
| T-admin-06 | Admin E2E: license credits/attribution report | tests | not_started | — | — |
| T-admin-07 | Admin E2E: asset removal | tests | not_started | — | — |
| T-sec-01 | Security: token theft and cross-account attempts | tests | not_started | — | — |
| T-sec-02 | Security: forged progress | tests | not_started | — | — |
| T-sec-03 | Security: non-admin CMS calls | tests | not_started | — | — |
| T-sec-04 | Security: short-lived URL misuse | tests | not_started | — | B-R2 |
| T-sec-05 | Security: prompt injection from a transcript or dataset | tests | not_started | — | — |
| T-sec-06 | Security: content license gating | tests | not_started | — | — |
| T-perf-01 | Performance: app start | tests | not_started | — | — |
| T-perf-02 | Performance: 99th-percentile R2 start/seek | tests | blocked_by_external_dependency | — | B-R2 |
| T-perf-03 | Performance: Worker API p95 | tests | not_started | — | — |
| T-perf-04 | Performance: AI time-to-first-audio | tests | not_started | — | — |
| T-perf-05 | Performance: DB reads under 100k-MAU-like simulation | tests | not_started | — | B-SUPABASE (hosted sizing) |
| T-perf-06 | Performance: concurrent session load proportional to realistic active concurrency | tests | not_started | — | — |
| T-perf-07 | Performance: no exact capacity asserted without load-test evidence | docs | not_started | — | — |

## §15 Failure cases and product decision rules

| ID | Requirement | Owner area | Status | Evidence | Blocker |
|---|---|---|---|---|---|
| R-15-01 | AI responds in wrong dialect → re-prompt/retry with verified provider, flag quality incident, no silent mislabeling | ai | not_started | — | — |
| R-15-02 | Low-confidence voice transcript → concise clarifying question, replay short prompt, no score penalty | ai | not_started | — | — |
| R-15-03 | STT confuses short high-frequency phrases → use scenario/semantic evidence; no fabricated pronunciation fault | ai | not_started | — | — |
| R-15-04 | Speech service unavailable → offline/static lessons continue, clear status, retry, switch supported provider | mobile | not_started | — | — |
| R-15-05 | OpenRouter text model unavailable → configured compatible fallback preserving instruction/source/target constraints | ai | not_started | — | — |
| R-15-06 | Realtime voice provider unavailable → guided turn-based STT/LLM/TTS alternative, not a broken spinner | mobile | not_started | — | — |
| R-15-07 | Pronunciation scoring unsupported → authentic sample, listen/record/replay, honest coarse feedback, no fake phoneme data | ai | not_started | — | — |
| R-15-08 | MP3 rights unclear → store privately if lawful, block public publish, ask owner to document rights | admin | not_started | — | — |
| R-15-09 | Language-pair explanation not native-reviewed → show editorial confidence/availability, opt-in fallback, no polished-instruction claim | api | not_started | — | — |
| R-15-10 | AI hallucinated expression/translation → mark draft, route native review, block unapproved static publication | admin | not_started | — | — |
| R-15-11 | Offline player cannot renew signed URL → use authorized stored download or clear offline state; never cache master keys | mobile | not_started | — | — |
| R-15-12 | User removes a course → confirm archive vs delete; never erase other course progress | mobile | not_started | — | — |
| R-15-13 | User changes `source_language_code` → recompute source-language UI/hints/manifests, preserve target skill data | api | not_started | — | — |
| R-15-14 | Provider charges more than expected → alert operator, select economical compatible routing, no covert feature restriction | telemetry | not_started | — | — |
| R-15-15 | Hearing/motor constraints → text/visual alternatives and alternate controls without losing account access | mobile | not_started | — | — |
| R-15-16 | License change or contributor withdrawal → audit provenance, take down affected material, regenerate with cleared originals | admin | not_started | — | — |
