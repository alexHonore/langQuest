# Native-speaker review process — as implemented

_Spec §9.7 (contributor program), §9.8 (content factory stages), §14.2 (native quality evaluation sets), §7.6 (states),
§15 (failure rules) · Written 2026-10-15; content-factory quality stages (§4.1, §4.2, §6) updated 2026-10-20. This describes the workflow the code enforces today and names what is still a
manual or missing step. **No native reviewer has been contracted and no track × source pair is `complete`**
(`docs/provider-matrix/coverage-report.md`)._

## 1. Who reviews

| Role (`public.user_roles`) | May do |
|---|---|
| `language_reviewer` | open Library, Languages/coverage, Transcripts, Content factory review queue, Quality review, Job queue; approve/reject/send-back drafts; mark transcript revisions reviewed; set `native_reviewed` on a coverage row |
| `content_editor` | everything above plus structure, uploads, rights records and publishing |
| `admin` / `super_admin` | everything, plus AI model profiles and audit log |

Reviewer identity is persisted, never free text:

| Table | Columns | Set by |
|---|---|---|
| `expressions` | `reviewed boolean`, `reviewer_id → auth.users` | Worker decision route on **Approve** (`POST /v1/admin/content/:id/decision`, `adminContentDecision` in `apps/api/src/routes/admin/editorial.ts`) |
| `content_rights` | `verified`, `reviewer_id`, `reviewed_at` | Rights screen (rights review is a separate gate from language review) |
| `course_source_localizations` | `native_reviewed`, `reviewer_id` (column-level grant), `status` | Coverage editor (`PUT /v1/admin/coverage`, `adminCoveragePut`) |
| `transcripts` / `transcript_segments` | `status = 'reviewed'`, per-segment `reviewed`; `transcript_translations.qa_state` | Transcript editor (new revision each save) |
| `content_revisions` | `editor_id` (not null), `diff`, `snapshot`, `note` | every decision/edit |
| `ai_model_benchmarks` | `reviewer_id`, `passed`, `notes` | model benchmark |
| `audit_logs` | `actor_id`, `actor_role`, `action` | Worker API routes (the Studio has no write routes of its own) |

## 2. Content states and allowed transitions (`packages/media/src/rights.ts`, CONVENTIONS §2.4)

```
imported_draft ──► metadata_needed ──► rights_unverified ──► transcription_pending ──► review_needed ──► approved ──► published
      │                 │                     │                       │                    │   ▲           │  ▲          │
      └────────────────►└────────────────────►└──────────────────────►└───────────────────►│   │           │  │          ▼
                                                                                      rejected ◄──────────┘  └──── unpublished
```

- `review_needed → approved | rejected` is the **editorial decision** (`approve | reject | request_review`), recorded as a
  revision; a `published` item must be unpublished before its decision changes.
- `approved → published` is the **publish gate** (`canPublish`): rights verified with redistribution, integrity, speaker
  consent, chapter link, title/language, and `native_review_missing` — a **blocker** for missions and expressions
  (`requireNativeReview: true`), a surfaced warning for audio lessons/collections/characters.
- `unpublished → review_needed | approved | published | rejected`; rights-driven unpublish sends approved items to
  `rights_unverified`.

## 3. The workflow end to end

1. **Draft creation** — any of: `scripts import-tatoeba` (`ExpressionDraft`, `status: review_needed`,
   `nativeReviewed: false`, variety `corpus | operator_declared | unresolved`), `scripts content-factory` (chapter draft or
   fixture suite through `@langquest/ai` with validators: blueprint slots, intents, script/transliteration forms,
   **language guard** rejecting wrong-variety / wrong-script / source-language leaks, then the **diversity gate** and,
   when a critic reasoner is passed, the advisory **second-model review**, §4.1), the admin Content factory
   (`POST /v1/admin/content/generate` → `content_generate` job → `review_needed` missions/expressions with provenance in
   `missions.scoring_rubric.provenance`, `expressions.script_annotations.provenance`, audit `content_factory.draft_created`),
   or audio: `transcribe` → `align` → `translate_transcript` (`transcript_translations` `needs_review` +
   `translation.review_requested` event) and `infer_metadata` (AI suggestions stored with confidence + provenance,
   **never applied, never published**).
2. **Queue** — Content factory → *Review queue* (draft missions/expressions), Quality review → lessons / transcripts /
   translations / visual assets, Languages → coverage rows. The review console shows the draft lesson, source examples,
   the learner-facing overlay per source language, prompt-pack name and version (prompt text stays server-side), QA comments,
   `Native reviewed` / `Approved for publishing` flags (§9.8 review-console requirements, partially: word timings and QA
   diff are shown only in the transcript editor).
3. **Decision** — Approve (sets `reviewed = true`, `reviewer_id`, state `approved`, revision + note), Reject (`rejected`),
   Request native review (stays `review_needed`; the note records who was asked). For audio lessons the decision also
   records `quality_review_status` (approved / rejected) in the same write. A decision on content whose state changed after
   it was read (for example, published in the meantime) is refused with 412 and writes nothing.
4. **Rights review** (separate reviewer identity) — Rights screen: verify the record, attribution text, redistribution,
   speaker consent (`speakers.consent_state`), expiry. Without it the gate blocks (`rights_*` codes).
5. **Coverage sign-off** — Languages → coverage editor: set metrics, `native_reviewed`, reviewer, status. `complete` is only
   allowed with a native review and every metric at 100 % (UI rule); `scripts validate-course-coverage` recomputes the
   honest report and exits non-zero on catalog drift.
6. **Publish** — Publishing screen: checklist + `POST /v1/admin/content/:id/publish`; blocked attempts are audited with
   `blockedBy`. Published content regenerates manifests.
7. **Incidents** (§15) — wrong-dialect or hallucinated output found later: Unpublish with reason `quality` or `editorial`,
   back to `review_needed`; rights issue: `rights_revoked` / `takedown`.

## 4. Fixture suites (§14.2) — `scripts content-factory --fixture-suite`

```bash
pnpm --filter @langquest/scripts content-factory -- --track japanese --source en --fixture-suite --dry-run   # plan only
pnpm --filter @langquest/scripts content-factory -- --track japanese --source en --fixture-suite --live --max-usd 0.3
```

- Three model calls (`content_factory.fixture.expressions | .dialogues | .intents`, template versions `2026-10-14.1`, dialogues
  `2026-10-20.1`, `scripts/src/lib/content-factory.ts`; up to five only when a caller opts into diversity regeneration, §4.1): **25** short beginner expressions (forms, meaning in the source language, intent key,
  register, pronunciation note), **10** small natural dialogues (unexpected responses, regional wording, politeness; each turn
  labelled with an `act` — `normal | unexpected | misunderstanding | repair | refusal` — and an optional `intentKey`; both
  labels are self-reported by the generator and unverified),
  **5** beginner intents with acceptable paraphrases and unacceptable answers, and **1 explicit confusion test** against the
  closest commonly confused variety (MSA vs Darija, pt-PT vs pt-BR, Mandarin vs Cantonese, es-ES vs es-419, French vs
  Haitian Creole; otherwise formal vs colloquial), ≥ 5 pairs.
- Output `data/drafts/content-factory/fixtures/<track>-<source>-<stamp>.{json,jsonl}` with
  `kind: 'fixture_suite'`, `requirements: { expressions: 25, dialogues: 10, intents: 5, confusionTests: 1 }`, actual `counts`,
  validation `gaps` (e.g. "only 23/25 expressions passed validation", "confusion test missing", "diversity gate: needs
  regeneration (…)"), `diversityGate`, `secondModelReview`, `nativeVerdictSheets: []`, `nativeVerdictSummary: null`, and
  **every reviewable item** (expressions, dialogues, acceptable and unacceptable phrasings, confusion pairs) **carries
  `reviewed: false`, `verdict: null`, `nativeReview: null`** plus `modelReview` (the critic's advisory verdict or null).
- STT/TTS examples from §14.2 are **not** part of the suite yet (they need licensed recordings or native speakers;
  `ai-capability-matrix.md` "Open items").
- Reviewer workflow for a suite: open the JSON, set `verdict` (`correct | correct_with_edit | incorrect | wrong_variety |
  unnatural | inappropriate`; on an `unacceptable` phrasing `correct` means "rightly rejected"), `correction` (required with
  `correct_with_edit`), optional `reviewNote` and `reviewed: true` per item, then commit the reviewed file next to the draft.
  The reviewed file is turned into a verdict sheet and ingested as described in §4.2. There is **no admin UI** for this yet,
  and the coverage editor's `native_reviewed` flag stays the only sign-off: ingesting verdicts never flips a suite, a
  coverage row or any content to native-reviewed.

### 4.1 Quality stages before a draft is written (`scripts/src/lib/content-factory.ts`, `content-review.ts`)

- **Diversity gate** (spec §9.8 "diverse dialogues, not a one-correct-answer quiz"; `scoreDialogueDiversity()` in
  `packages/curriculum/src/diversity/`, pure and deterministic). Script-aware tokens (words for spaced scripts incl.
  Arabizi digits; character bigrams for Han/kana/Thai runs; Arabic harakat, alef/yeh/teh-marbuta variants and Hebrew niqqud
  folded so a vocalised copy is not a "different" answer) feed six components: distinct acceptable phrasings per intent
  (exact and near duplicates, token Jaccard ≥ 0.8, collapse), lexical overlap between alternatives (mean pairwise Jaccard,
  distinct-1/2), lexical overlap between whole dialogues (a dialogue with Jaccard ≥ 0.8 to an earlier one is a copy; mean
  pairwise Jaccard > 0.5 means one script with swapped nouns), turn-structure variety (speaker × "does the turn ask
  something" signature per dialogue), share of dialogues with a misunderstanding → repair sequence, and question → answer
  drill shapes. Blocking flags (`single_phrasing`, `high_overlap_alternatives`, `repeated_dialogues`,
  `high_overlap_dialogues`, `uniform_turn_structure`, `no_repair_turns`, `quiz_shaped_set`, `score_below_threshold`, …)
  make the verdict `needs_regeneration`.
  - **Turn labels are self-reported.** The generator writes each turn's `act` and `intentKey` and nothing verifies them.
    The signatures, the drill-shape check and both overlap measures read the text only, so relabelling the same lines
    changes none of them (`diversity.test.ts` "does not let self-reported turn labels flip the verdict"). Labels count only
    for the repair check, and only as a sequence: a trouble turn (`act: misunderstanding`, or a `repair.*` intent such as
    `ask_repeat`) answered later by the other speaker with different text (`act: repair`, or any reply to a repair-intent
    request). A lone label never counts. A generator that labels a misunderstanding → repair pair on lines that contain
    none still passes the repair check; the other checks, the critic and the native reviewer are what catch it.
  - Fixture suites: the gate runs after the three calls and stores its result in `diversityGate` (`verdict`, `score`,
    `components`, `reasons`, per-intent, per-dialogue and cross-dialogue detail, `regenerated`, `regenerationSkipped`). A
    failing set is kept, marked with the reasons in `gaps`, never dropped and never published. Regeneration is **off by
    default** (`regenerationSkipped: "not requested …"`), so `scripts content-factory --fixture-suite --live` makes the 3
    calls its plan prints. A caller that passes `regenerateOnLowDiversity: true` re-runs the dialogues and/or intents call
    **once** with the gate's reasons (up to **two extra paid calls**, budget-checked against `--max-usd`) and keeps a retry
    only when it scores better; a dialogue retry with the same lines (only labels changed) is never kept. The CLI has no
    flag for this yet (§6).
  - Chapters: blueprint missions fix the turn structure, so the gate (`MISSION_DIVERSITY_THRESHOLDS`) only checks that some
    learner intent has real alternatives and that variants are not near copies. A failing mission gets the warning
    `diversity_gate:needs_regeneration:<reasons>` (written in the record's `validation[].warnings`) and a chapter note;
    `regenerateOnLowDiversity: true` re-runs it once with the reasons. `ChapterRunResult.quality.diversity` carries the
    detail; when a record carries `quality`, `--apply` writes `diversity_needs_regeneration` into
    `expressions.script_annotations.curation.flags`.
- **Second-model review** (spec §9.8 "optional second-model review"; `runSecondModelReview()`): when a critic
  `TextReasoner` is passed as `deps.reviewer`, it reviews the accepted expressions, acceptable phrasings, dialogues and
  confusion pairs in batches of 20 under task `language_quality_check` (prompt `content_factory.second_model_review`
  `2026-10-20.1`; the profile routes to a different model than `content_generation`), each batch budget-checked. Its output
  is validated with Zod (`ModelReviewLlmSchema`) and ingested: unknown/duplicate refs are reported, a `reject` without an
  issue or an `accept` with a blocking issue is downgraded to `revise`, a suggested wording must pass the language guard (MSA,
  wrong script or source-language suggestions are dropped), dialogues take no suggestion. Verdicts land on each item's
  `modelReview` (fixture suites) or as `second_model_<verdict>:expressions/<i>:<issues>` warnings plus
  `quality.secondModelReview.annotations` keyed by draft key (chapters; flags `second_model_<verdict>` /
  `second_model_issue:<kind>` on apply). The summary records reviewer and generator models, `independent` (false = the critic
  ran on a generator model, warning `self_review:<model>`), counts, unreviewed refs, ledger and `advisoryOnly: true`. **The
  critic never removes, approves, publishes or marks anything native-reviewed**; the native reviewer sees its rejects first.
  - **The critic needs a reasoner with a batch output budget.** `TextReasonerOptions` carries no output budget, and the
    package-default `language_quality_check` profile is an interactive one (200 output tokens, 8 s,
    `packages/ai/src/profiles.ts`), so the standard `OpenRouterTextReasoner` truncates every 20-item batch and spends paid
    repair calls on it. Use `ScriptsTextReasoner` (`scripts/src/lib/reasoner.ts`, `maxOutputTokens` override, 12 000 by
    default in the CLI) or a reasoner over a dedicated batch-latency profile. Until such a profile exists the stage is not
    suitable for `apps/jobs` `content_generate`, which uses the standard reasoner.
  - Spend is split: a suite's `generation` ledger holds the `content_generation` calls only (including any regeneration),
    `secondModelReview.ledger` holds the critic's calls, and the run ledger the CLI prints is the total.

### 4.2 Native verdict ingestion (`ingestNativeVerdicts`, `nativeVerdictsFromReviewedSuite`)

- A verdict sheet (`NativeVerdictSheetSchema`, strict Zod): `{ formatVersion: 1, kind: 'fixture_verdicts', suiteDraftId,
  reviewer: { reviewerId (auth.users uuid), role (language_reviewer | content_editor | admin | super_admin),
  nativeVarietyId }, reviewedAt (ISO datetime), verdicts: [{ ref, verdict, correction, note }] }`. Refs are item paths:
  `expressions/3`, `dialogues/0`, `intents/1/acceptablePhrasings/2`, `intents/1/unacceptable/0`, `confusionTest/pairs/4`.
  `nativeVerdictsFromReviewedSuite(file, reviewer, reviewedAt)` builds the sheet from a file edited in place; identity and
  time come from the caller, never from the file.
- The whole sheet is refused when it names another suite or the reviewer's native variety is not the suite's variety (no
  boundary crossing: an MSA reviewer cannot sign off Darija). Unknown and duplicate refs and `correct_with_edit` without a
  correction are reported and skipped; a later sheet that overrides another reviewer's verdict is recorded.
- The merge works on a copy: items get `reviewed`, `verdict` and `nativeReview { reviewerId, reviewedAt, correction, note }`,
  the confusion test is reviewed once all pairs are, `nativeVerdictSheets` lists every sheet and `nativeVerdictSummary` gives
  counts per verdict, accepted share, naturalness, dialect adherence and unreviewed refs. The suite stays `review_needed` /
  `nativeReviewed: false`.
- Database: `nativeVerdictBenchmarkRow()` maps the summary onto an **`ai_model_benchmarks`** row for the generating model
  (`model` and `cost_per_call_usd` from the generator-only `generation` ledger, never the critic's; `sample_set_id` = suite draft id, `evaluator_version` `native-fixture-verdicts@1`, `naturalness`, `dialect_adherence`,
  `cost_per_call_usd`, `reviewer_id`; `passed` only when every item is reviewed, ≥ 90 % are accepted and none is
  wrong-variety), and `recordNativeVerdictBenchmark()` writes it through `repos.aiProfiles.recordBenchmark` against the
  enabled `content_generation` profile for the suite's variety × source. Both are unit-tested with an in-memory repository
  (`scripts/src/lib/content-review.test.ts`); no CLI flag calls them yet (§6).

## 5. Gating rules the code enforces (what "native quality" may be claimed)

- Learners see honest coverage: `course_source_localizations.status` drives availability UI
  (`planned` / `partial` / `complete` / `unavailable`; catalog copy "Not yet available from {source}. Planned.").
- No numeric pronunciation without an acoustic assessor (ADR-006); no fallback across a variety boundary
  (`DefaultCapabilityRegistry`, `varietyBoundaryViolation`).
- `PROMPT_PACKS[*].nativeReviewed` is `false` for all 30 tracks; the AI capability matrix labels every dialect as
  `limited` / `vendor-documented` until native review happens (`ai-capability-matrix.md` "Open items before any native
  quality claim").
- Publishing a mission or expression without a recorded native review is impossible (`native_review_missing` blocker).

## 6. Implemented vs not implemented / manual today

Implemented and unit-tested with fake reasoners only (no model call has been made for these stages; status 2026-10-20):

- **Diversity gate** before drafts are written, with an opt-in single regeneration pass (§4.1) —
  `packages/curriculum/src/diversity/diversity.test.ts` (Darija, Japanese and Spanish good/bad sets; Mandarin, Greek, Hebrew
  tokenisation; relabelled drill copies still blocked),
  `scripts/src/lib/content-factory.quality.test.ts` (3 calls by default; regeneration on request; a labels-only retry is
  not kept).
- **Second-model review stage** behind the `TextReasoner` interface (§4.1) — advisory verdicts, Zod-validated ingestion,
  guard-checked suggestions, self-review detection; `scripts/src/lib/content-review.test.ts`,
  `scripts/src/lib/content-factory.quality.test.ts`.
- **Native verdict ingestion** for fixture suites and the mapping onto `ai_model_benchmarks` (§4.2), with model and cost
  per call from the generator calls only when a critic also ran — `scripts/src/lib/content-review.test.ts`.

Not implemented / manual:

- CLI wiring in `scripts/src/content-factory.ts`: no flag passes a critic reasoner (`deps.reviewer`), turns on diversity
  regeneration (`regenerateOnLowDiversity`; with it the plan text must say "up to 5 model calls"), sets
  `ChapterDraftRecord.quality` from `ChapterRunResult.quality`, or ingests a verdict sheet / records the benchmark row, so
  today these stages run only from code and tests. Without `quality` a chapter record still carries the gate and critic
  findings in `validation[].warnings` and the chapter notes. The live critic pass has never been run (it needs the owner's
  OK for OpenRouter spend).
- The admin Content factory job (`apps/jobs` `content_generate`) does not run the diversity gate or the second-model
  review; only the scripts library does. Its prompt asks for dialogue lines "alternating character/learner"
  (`apps/jobs/src/handlers/generate-content.ts`), which is the drill shape the gate flags. The critic also needs a
  batch-budget profile before it can run there (§4.1).
- Back-translation review (§9.7 "backtranslation/semantic agreement").
- Reviewer **assignment** and workload views (who reviews what, due dates) — decisions are recorded, assignment is not.
- Admin UI for fixture-suite verdicts (the sheet is a JSON file); STT/TTS evaluation samples per track; WER/CER tracking
  (`benchmark_model` job has no runner handler).
- The diversity metric measures lexical and structural variety only; whether alternatives are natural and mean the same
  thing is still the native reviewer's call (the critic only flags). Its repair check relies on the generator's own turn
  labels (as a sequence, §4.1); nothing verifies that a labelled misunderstanding is one.
- Contributor agreements and recording specifications (§9.7) — owner/legal action; `content_rights.permission_grant` is the
  place to paste the executed terms.
- Native reviewers for all 30 tracks — external dependency (traceability `B-NATIVE`).
