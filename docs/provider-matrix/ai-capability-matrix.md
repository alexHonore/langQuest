# AI capability matrix — all 30 course tracks

Generated 2026-10-14 by `@langquest/ai` engineering. Source of truth in code: `packages/ai/src/capability/matrix.ts`
(`TRACK_CAPABILITY_MATRIX`), `packages/ai/src/capability/azure-locales.ts`, `packages/ai/src/speech/voices.ts`.
The runtime registry (`DefaultCapabilityRegistry`) re-checks every adapter's `supports()` and refuses any route whose
effective locale resolves to a different variety (no ary→arb, yue→cmn, ht→fr, pt-PT↔pt-BR, es-ES↔es-419).

## Evidence legend

| Status | Meaning |
|---|---|
| **verified** | Exercised live by us on 2026-10-14 (smoke level: one or two synthetic samples; **not** native-reviewed). |
| **vendor-documented** | The provider documents the locale/model (OpenRouter model catalog `supported_voices`, Whisper language list, Gemini TTS language list, ElevenLabs flash v2.5 32-language list, Azure pronunciation-assessment list). Not exercised by us. |
| **limited** | Something works but dialect fidelity is not established (pan-Arabic ASR for Darija, generic Arabic voice reading Levantine, Gemini voicing Cantonese/Kreyòl/Swahili text without vendor documentation). Learners must see it labelled as limited. |
| **unavailable** | No configured provider claims support. Never fabricated. |

## What was verified live today (OpenRouter, total spend ≈ $0.004)

| Check | Model | Result |
|---|---|---|
| Structured chat, `response_format: json_schema`, `models: [haiku-5.5, gemini-3.8-flash]` | `anthropic/claude-haiku-5.5` (served by Azure) | 200 in 2.7 s; Darija reply `صباح الخير، لاباس عليك؟` + Arabizi; `usage.cost` 0.0000661 reported inline; `/generation` endpoint confirms cost. |
| Fallback array with an **unknown** primary id | — | OpenRouter rejects up front: `400 "bogus/… is not a valid model ID"` (and `whisper-large-v3 is a transcription model and cannot be used with chat/completions`). ⇒ the client performs **client-side** sequential fallback by dropping the rejected id; server-side `models` routing only covers provider errors. |
| TTS French | `google/gemini-3.8-flash-lite-tts` voice `Kore` | **Only `response_format=pcm`** is accepted (mp3 → 400). 120 KB PCM, `audio/pcm;rate=24000;channels=1`, 1.7 s. |
| TTS French | `hexgrad/kokoro-82m` voice `ff_siwis` | mp3, 14.7 KB, 543 ms. |
| TTS European Portuguese | `microsoft/mai-voice-2.1-flash` voice `pt-PT-Rui:MAI-Voice-2.1-Flash` | mp3, 49 KB, 527 ms. |
| STT (JSON base64, `verbose_json` + word timestamps) | `openai/whisper-large-v3` | Exact French transcript, segments + words, `usage.seconds` 2.52, cost 0.0000189. |
| STT (multipart `file`) | `google/gemini-3.5-transcribe` | Exact transcript, token-priced usage (64 in / 9 out), 6.8 s. |
| STT (JSON base64) | `elevenlabs/scribe-v2` | Exact transcript of the Kokoro mp3, 509 ms. |
| Dialect round-trips Gemini TTS → Whisper | arz / ary / yue / ht / sw | arz exact; ary `لاباس`→`لبس`; yue exact (`language=yue`); ht `Bonjou`→`Monjou`, `jodi a`→`jodia` (17.5 s!); sw word-boundary errors. |

Azure Speech was **not** exercised (no `AZURE_SPEECH_KEY` in this environment). The Azure REST adapter is implemented and
covered by fixture tests; locale support comes from the vendor table only.

## Azure pronunciation-assessment locales (fetched 2026-10-14)

The "Pronunciation assessment" tab lists exactly **33** locales: ar-EG, ar-SA, ca-ES, zh-HK, zh-CN, zh-TW, da-DK, nl-NL,
en-AU, en-CA, en-IN, en-GB, en-US, fi-FI, fr-CA, fr-FR, de-DE, hi-IN, it-IT, ja-JP, ko-KR, ms-MY, nb-NO, pl-PL, pt-BR, pt-PT,
ru-RU, es-MX, es-ES, sv-SE, ta-IN, th-TH, vi-VN.

**Not covered:** ar-MA (Darija), ar-SY/LB/JO/PS (Levantine), ht-HT, rw-RW, ln-CD, sw-KE/TZ, he-IL, el-GR, uk-UA, ro-RO.
⚠️ The earlier scrape `azure-pronunciation-locales-2026-10-14.md` pasted the *video translation* grid (which does list ar-MA,
sw-KE, he-IL …) under phoneme/prosody headings; those rows are **not** pronunciation-assessment support and are ignored.

## Per-track matrix

Realtime = our turn-based STT→LLM→TTS pipeline (`PipelineRealtimeProvider`, barge-in via cancellation tokens). A full-duplex
provider is **unavailable** on every track (`DuplexProviderStub` reports `supports()=false`). Pronunciation columns describe the
Azure acoustic assessor; when Azure is not configured every track falls back to `ReferenceComparisonAssessor`
(`numericScore: null`, `assessmentMode: 'reference-comparison'`, `confidence: 'limited'`).

| # | Track | Variety | STT | TTS | Realtime pipeline | Pron. word/phoneme | Tone | Prosody |
|---|---|---|---|---|---|---|---|---|
| 01 | arabic-eastern | ar-levant | limited (Whisper `ar`, pan-Arabic) | limited (generic Arabic voices; not Shami) | limited | unavailable (no Azure Levantine locale) | n/a | unavailable |
| 02 | arabic-moroccan | ary | limited (verified smoke: `لاباس` misheard) | limited (verified smoke, Gemini; not native-reviewed) | limited | unavailable (ar-MA not in Azure list) | n/a | unavailable |
| 03 | arabic-egyptian | arz | limited (verified smoke exact; pan-Arabic model) | vendor-documented (Gemini ar-EG; smoke verified) | limited | vendor-documented (ar-EG) | n/a | limited |
| 04 | arabic-msa | arb | vendor-documented (Whisper `ar`) | vendor-documented (ElevenLabs Arabic) | vendor-documented | limited (ar-SA used, labelled limited) | n/a | limited |
| 05 | chinese-cantonese | yue | verified smoke (Whisper `yue` exact) | limited (Gemini reads 粵語; no vendor doc) | limited | vendor-documented (zh-HK) | limited (derived) | vendor-documented |
| 06 | chinese-mandarin | cmn | vendor-documented (Whisper `zh`) | vendor-documented (MAI zh-CN, Kokoro) | vendor-documented | vendor-documented (zh-CN) | limited (derived) | vendor-documented |
| 07 | chinese-simplified | cmn | = 06 | = 06 | = 06 | = 06 | = 06 | = 06 |
| 08 | english | en | vendor-documented | vendor-documented (MAI en-US/en-GB) | vendor-documented | vendor-documented (en-US/en-GB) | n/a | vendor-documented |
| 09 | danish | da | vendor-documented | vendor-documented (MAI da-DK) | vendor-documented | vendor-documented (da-DK) | n/a | limited |
| 10 | french | fr | **verified** (3 engines exact) | **verified** (Gemini, Kokoro; MAI fr-FR listed); fr-CA voice limited | verified components | vendor-documented (fr-FR / fr-CA) | n/a | vendor-documented |
| 11 | german | de | vendor-documented | vendor-documented (MAI de-DE) | vendor-documented | vendor-documented (de-DE) | n/a | vendor-documented |
| 12 | greek | el | vendor-documented | vendor-documented (ElevenLabs) | vendor-documented | unavailable (el-GR not in Azure list) | n/a | unavailable |
| 13 | haitian-creole | ht | limited (verified smoke with errors, 17 s) | limited (Gemini, no vendor doc; never French voices) | limited | unavailable | n/a | unavailable |
| 14 | hebrew | he | vendor-documented | limited (eleven-v3 unverified; not in flash v2.5 list) | limited | unavailable (he-IL not in Azure list) | n/a | unavailable |
| 15 | hindi | hi | vendor-documented | vendor-documented (MAI hi-IN) | vendor-documented | vendor-documented (hi-IN) | n/a | limited |
| 16 | italian | it | vendor-documented | vendor-documented (MAI it-IT) | vendor-documented | vendor-documented (it-IT) | n/a | vendor-documented |
| 17 | japanese | ja | vendor-documented | vendor-documented (Gemini, Kokoro) | vendor-documented | vendor-documented (ja-JP) | n/a | vendor-documented |
| 18 | korean | ko | vendor-documented | vendor-documented (MAI ko-KR) | vendor-documented | vendor-documented (ko-KR) | n/a | vendor-documented |
| 19 | portuguese-brazilian | pt-BR | vendor-documented | vendor-documented (MAI pt-BR) | vendor-documented | vendor-documented (pt-BR) | n/a | vendor-documented |
| 20 | portuguese-european | pt-PT | vendor-documented (no EU/BR switch in Whisper) | **verified** (MAI pt-PT-Rui) | vendor-documented | vendor-documented (pt-PT) | n/a | limited |
| 21 | romanian | ro | vendor-documented | vendor-documented (MAI ro-RO, Gemini) | vendor-documented | unavailable (ro-RO not in Azure list) | n/a | unavailable |
| 22 | russian | ru | vendor-documented | vendor-documented (MAI ru-RU) | vendor-documented | vendor-documented (ru-RU) | n/a | limited |
| 23 | spanish-latin-american | es-419 | vendor-documented | vendor-documented (MAI es-MX) | vendor-documented | vendor-documented (es-MX; CO/AR/PE/CL scored with es-MX, surfaced) | n/a | vendor-documented |
| 24 | spanish-spain | es-ES | vendor-documented | vendor-documented (MAI es-ES-Marta) | vendor-documented | vendor-documented (es-ES) | n/a | vendor-documented |
| 25 | swahili | sw | limited (verified smoke with errors) | limited (Gemini, no vendor doc) | limited | unavailable (sw-* not in Azure list) | n/a | unavailable |
| 26 | kinyarwanda | rw | limited (not in Whisper list; Scribe/Gemini unverified, auto-detect) | **unavailable** (native recordings required) | unavailable | unavailable | n/a | unavailable |
| 27 | swedish | sv | vendor-documented | vendor-documented (MAI sv-SE) | vendor-documented | vendor-documented (sv-SE) | n/a | limited |
| 28 | lingala | ln | limited (Whisper lists `ln`; unbenchmarked) | **unavailable** (native recordings required; never French) | unavailable | unavailable | n/a | unavailable |
| 29 | ukrainian | uk | vendor-documented | vendor-documented (Gemini uk-UA, ElevenLabs) | vendor-documented | unavailable (uk-UA not in Azure list) | n/a | unavailable |
| 30 | vietnamese | vi | vendor-documented | vendor-documented (MAI vi-VN, Gemini) | vendor-documented | vendor-documented (vi-VN) | limited (derived) | limited |

"Tone: limited (derived)" means Azure returns per-phoneme accuracy for the tonal locale but no explicit tone labels; tone feedback is
inferred, not measured, and the adapter advertises `features.tone=true` only for zh-HK / zh-CN / vi-VN with that caveat in `notes`.

## Model routing defaults (`DEFAULT_PROFILES`)

| Task | Primary | Fallbacks | Notes |
|---|---|---|---|
| character_dialogue | openai/gpt-6-luna | claude-sonnet-5.5, gemini-3.8-flash | ary/arz/ar-levant/yue/ht/rw/ln/sw: claude-sonnet-5.5 primary, then gpt-6-luna, gemini-3.8-flash (since 2026-11-11, see `dialogue-models-2026-11-11.md`) |
| learner_evaluation | google/gemini-3.8-flash | haiku-5.5, deepseek-v4.1-flash | same low-resource override → sonnet-5.5 |
| meaning_assessment | google/gemini-3.8-flash | haiku-5.5, deepseek-v4.1-flash | temperature 0 |
| source_explanation / scene_planning | anthropic/claude-haiku-5.5 | gemini-3.8-flash, deepseek-v4.1-flash | |
| content_generation | anthropic/claude-sonnet-5.5 | gemini-3.8-flash | batch |
| language_quality_check | google/gemini-3.5-flash-lite | haiku-5.5 | guard verifier |
| speech_recognition / transcription_alignment | openai/whisper-large-v3 | elevenlabs/scribe-v2, google/gemini-3.5-transcribe | rw prefers scribe-v2 first |
| speech_synthesis | google/gemini-3.8-flash-lite-tts | elevenlabs/eleven-flash-v2.5, microsoft/mai-voice-2.1-flash | per-variety voice registry decides |
| realtime_conversation | pipeline:stt_llm_tts | — | duplex unavailable |
| pronunciation_assessment | azure:pronunciation-assessment | reference-comparison | Azure only with credentials + listed locale |

Prices are seeded from `openrouter-models-snapshot-2026-10-14.json` and refreshed at runtime via `client.models.refreshPricing()`;
the provider-reported `usage.cost` always wins for the `ai_requests` ledger.

### Profile overlay semantics (`ModelProfileRegistry.refresh`)

The registry keeps two layers per `task × variety × source` scope: the package default above and an optional DB overlay.
`refresh()` applies **only `enabled: true`** rows from `ai_model_profiles`; a disabled row is skipped (and, if an earlier
refresh had overlaid that scope, the scope reverts to the package default). The catalog seed ships every row disabled
until an admin smoke-tests it, so a disabled row can never switch a task off. Every resolved profile carries a
`resolvedSource` marker (`'db'` | `'package-default'`); `ledgerProfileId()` returns the id only for `'db'` profiles, because
package-default ids are deterministic hashes, not `ai_model_profiles.id` values.

### Behaviour notes (adapters)

- **Text-only sessions.** `PipelineRealtimeProvider.createSession` returns pipeline `text_only` whenever the session mode is
  `text_only`, even when STT + TTS are available for the variety: the learner's choice wins. Text-only still requires the
  locale to resolve to a single variety (`es`, `pt`, `zh` are refused, never guessed). Voice modes require full STT + TTS.
- **STT language hint policy.** `OpenRouterSpeechRecognizer` sends the matrix hint by default (`languageHint: 'matrix'`).
  Pass `languageHint: 'auto'` (adapter option or per `transcribe()` call) to omit the hint for **code-switched audio** —
  the model then detects the language itself; the detected code is reported in `detectedLanguage` and `languageMismatch`
  is set honestly when it differs from the target variety. Any other string is sent verbatim as an ISO-639-1 hint. The
  `supports()` notes name the effective hint and policy (`languageHint=ar (policy=matrix)`) and the code-switch guidance.
- **Ledger attribution.** Every adapter (`OpenRouterTextReasoner`, STT, TTS, Azure pronunciation) accepts an
  `attribution` context `{ userId, profileId, enrollmentId }` (static or a per-request resolver; `createAiServices` passes
  `deps.attribution` to all of them). The default stays pseudonymous (`userId: null`); `profileId` must be a DB uuid —
  the reasoner fills it from `resolvedSource === 'db'` and otherwise writes `null`.

## Open items before any "native quality" claim (§14.2)

1. Native review of every prompt pack (`PROMPT_PACKS[*].nativeReviewed` is `false` everywhere).
2. Per-track STT WER/CER on human recordings (only synthetic smoke samples exist today).
3. Azure calibration run per listed locale once credentials exist; confirm prosody availability per locale.
4. Native-recorded audio pipelines for rw and ln (no TTS), and native review of Gemini voicing for ary / yue / ht / sw before
   those move from "limited".
5. A real duplex provider behind `RealtimeConversationProvider` if the pipeline's time-to-first-audio misses the latency target.
