# ADR-006 — Pronunciation honesty: numeric scores only from an acoustic assessor

**Status:** accepted (2026-10-15) · **Scope:** `packages/contracts`, `packages/ai`, `apps/api`, `packages/ui`, `apps/mobile`

## Context
Spec §3.6 and §8.5 forbid fabricated pronunciation scores ("do not fabricate 87/100 phoneme scores"; §16.3 "Do not make
'pronunciation score' an LLM-generated random percentage") and require a per-track capability registry with a documented
fallback. The only acoustic scorer integrated is Azure Speech scripted pronunciation assessment, whose
"Pronunciation assessment" tab (fetched 2026-10-14) lists exactly **33 locales**: ar-EG, ar-SA, ca-ES, zh-HK, zh-CN, zh-TW,
da-DK, nl-NL, en-AU, en-CA, en-IN, en-GB, en-US, fi-FI, fr-CA, fr-FR, de-DE, hi-IN, it-IT, ja-JP, ko-KR, ms-MY, nb-NO, pl-PL,
pt-BR, pt-PT, ru-RU, es-MX, es-ES, sv-SE, ta-IN, th-TH, vi-VN (`packages/ai/src/capability/azure-locales.ts`;
`docs/provider-matrix/azure-pronunciation-locales-2026-10-14.md`, corrected after an earlier scrape pasted the video-translation
grid). Ten LangQuest tracks have **no** documented locale: Moroccan Arabic (ar-MA), Eastern Arabic (ar-SY/LB/JO/PS), Haitian
Creole, Kinyarwanda, Lingala, Swahili, Hebrew, Greek, Ukrainian, Romanian. Azure credentials were not available during the
build, so the adapter is fixture-tested, not live-exercised. STT confidence and LLM judgement are not acoustic evidence.

## Decision
1. **Assessment modes are typed and closed** (`packages/contracts/src/enums.ts`): `acoustic-assessor`,
   `reference-comparison`, `human-calibrated-reference-comparison`, `semantic-only`, `unavailable`.
   `ACOUSTIC_ASSESSMENT_MODES = ['acoustic-assessor']` is the **only** mode allowed to carry `numericScore`; every other
   mode is built through `referenceComparisonAssessment()` with `numericScore: null`, `confidence: 'limited'`, empty
   `wordScores` / `phonemeHints` / `toneHints`, `provider: null`.
2. **Routing never guesses** (`packages/ai/src/speech/pronunciation.ts`): `CompositeAssessor` asks each acoustic assessor
   `capability(locale)`; `AzurePronunciationAssessor.supports()` answers from the 33-locale table **and** only when
   `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` are set; a candidate whose effective locale crosses a variety boundary
   (`varietyBoundaryViolation`: no ary→ar-SA, no ht→fr-FR, no yue→zh-CN) is skipped; otherwise the
   `ReferenceComparisonAssessor` (STT transcript + semantic comparison against the published reference audio) is used.
   Track → Azure locale mapping lives in `packages/ai/src/capability/matrix.ts` (`pronunciation.azureLocale`), with explicit
   caveats: MSA (`arb`) maps to ar-SA and is labelled **limited**; es-419 regional preferences are scored with es-MX and
   surfaced; tonal locales (zh-HK, zh-CN, vi-VN) expose `tone` as *derived* from per-phoneme accuracy, not measured; prosody is
   advertised only for the locales Microsoft documents it for.
3. **The API records evidence only from acoustic results** (`apps/api/src/routes/speech/speech.ts`,
   `POST /v1/speech/pronunciation-assess`): a `speaking.pronunciation` learning observation with `scorerKind:
   'acoustic_assessor'` is written only when `isAcousticAssessmentMode(mode) && numericScore !== null`; meaning and
   pronunciation stay separate observations (A14). `GET /v1/ai/model-capabilities` (contracts `modelCapabilities`) reports `pronunciationScoring`
   `none | limited | partial | full` from `pronunciationScoringLevel(track, azureConfigured)`
   (`apps/api/src/lib/capabilities.ts`) so clients can label the coach before the learner records.
4. **The UI enforces it a second time** (`packages/ui/src/components/PronunciationFeedback.tsx`, `logic.ts`): a number and
   progress meter render only when `isAcousticAssessmentMode(assessmentMode) && numericScore !== null`; otherwise the copy is
   "No numeric score for this language yet" / "We only show a score when a speech assessor is actually available for
   {variety}. Compare with the reference instead." and "Detailed phoneme assessment not yet available for {variety}"
   (`packages/locales` `pronunciation.feedback.*`, en + fr). The mobile coach (`apps/mobile/src/app/pronunciation/index.tsx`)
   and lesson player use that component; no screen computes its own score.
5. **Model profiles cannot override the rule**: `DEFAULT_PROFILES` task `pronunciation_assessment` is
   `azure:pronunciation-assessment` with fallback `reference-comparison` (`packages/ai/src/profiles.ts`); an admin cannot
   point the task at an LLM, and the capability matrix marks pronunciation `unavailable` for the ten tracks above
   (`docs/provider-matrix/ai-capability-matrix.md`, per-track columns "Pron. word/phoneme", "Tone", "Prosody").

## Consequences
- Learners on ar-levant, ary, ht, rw, ln, sw, he, el, uk, ro — and on **every** track until Azure credentials exist — get
  listen / record / compare feedback with intelligibility and meaning checks, never a percentage. This is the spec's required
  "honest lower-fidelity assistance".
- Enabling Azure is a configuration change (two secrets) plus the calibration run listed in the capability matrix "Open
  items"; re-verify the locale list against the live Microsoft page before production.
- Adding another acoustic provider means implementing `PronunciationAssessor` with a truthful `supports()`; it joins the
  `CompositeAssessor` candidate list and inherits the variety-boundary check. Human-calibrated reference comparison
  (`human-calibrated-reference-comparison`) still carries no number — it only raises the wording from "limited".
- Analytics "false pronunciation corrections by target language" (§12.2) can only be computed where acoustic scores exist;
  elsewhere the metric is reported as unavailable rather than estimated.

Related: ADR-002 (realtime pipeline), `docs/provider-matrix/ai-capability-matrix.md`,
`docs/provider-matrix/azure-pronunciation-locales-2026-10-14.md`, `docs/provider-matrix/provider-setup-and-cost.md` §2.6.
