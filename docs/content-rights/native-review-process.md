# Native-speaker review process — as implemented

_Spec §9.7 (contributor program), §9.8 (content factory stages), §14.2 (native quality evaluation sets), §7.6 (states),
§15 (failure rules) · Written 2026-10-15. This describes the workflow the code enforces today and names what is still a
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
| `expressions` | `reviewed boolean`, `reviewer_id → auth.users` | admin decision route on **Approve** (`apps/admin/app/api/admin/content/[id]/decision/route.ts`) |
| `content_rights` | `verified`, `reviewer_id`, `reviewed_at` | Rights screen (rights review is a separate gate from language review) |
| `course_source_localizations` | `native_reviewed`, `reviewer_id` (column-level grant), `status` | Coverage editor (`PUT /api/admin/coverage`) |
| `transcripts` / `transcript_segments` | `status = 'reviewed'`, per-segment `reviewed`; `transcript_translations.qa_state` | Transcript editor (new revision each save) |
| `content_revisions` | `editor_id` (not null), `diff`, `snapshot`, `note` | every decision/edit |
| `ai_model_benchmarks` | `reviewer_id`, `passed`, `notes` | model benchmark |
| `audit_logs` | `actor_id`, `actor_role`, `action` | API and local routes |

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
   **language guard** rejecting wrong-variety / wrong-script / source-language leaks), the admin Content factory
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
   Request native review (stays `review_needed`; the note records who was asked). For audio lessons the reviewer also sets
   `quality_review_status` through `PATCH /v1/admin/audio/lessons/:id`.
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

- Three model calls (`content_factory.fixture.expressions | .dialogues | .intents`, template version `2026-10-14.1`,
  `scripts/src/lib/content-factory.ts`): **25** short beginner expressions (forms, meaning in the source language, intent key,
  register, pronunciation note), **10** small natural dialogues (unexpected responses, regional wording, politeness),
  **5** beginner intents with acceptable paraphrases and unacceptable answers, and **1 explicit confusion test** against the
  closest commonly confused variety (MSA vs Darija, pt-PT vs pt-BR, Mandarin vs Cantonese, es-ES vs es-419, French vs
  Haitian Creole; otherwise formal vs colloquial), ≥ 5 pairs.
- Output `data/drafts/content-factory/fixtures/<track>-<source>-<stamp>.{json,jsonl}` with
  `kind: 'fixture_suite'`, `requirements: { expressions: 25, dialogues: 10, intents: 5, confusionTests: 1 }`, actual `counts`,
  validation `gaps` (e.g. "only 23/25 expressions passed validation", "confusion test missing"), and **every item carries
  `reviewed: false`, `verdict: null`** for the native reviewer to fill.
- STT/TTS examples from §14.2 are **not** part of the suite yet (they need licensed recordings or native speakers;
  `ai-capability-matrix.md` "Open items").
- Reviewer workflow for a suite today: open the JSON, set `verdict` (`correct | incorrect | …` as agreed with the reviewer)
  and `reviewed: true` per item, add notes, and commit the reviewed file next to the draft. **There is no admin UI or
  database table that ingests fixture verdicts** — the coverage editor's `native_reviewed` flag is the only machine-readable
  sign-off, so the reviewed file is the evidence behind that flag.

## 5. Gating rules the code enforces (what "native quality" may be claimed)

- Learners see honest coverage: `course_source_localizations.status` drives availability UI
  (`planned` / `partial` / `complete` / `unavailable`; catalog copy "Not yet available from {source}. Planned.").
- No numeric pronunciation without an acoustic assessor (ADR-006); no fallback across a variety boundary
  (`DefaultCapabilityRegistry`, `varietyBoundaryViolation`).
- `PROMPT_PACKS[*].nativeReviewed` is `false` for all 30 tracks; the AI capability matrix labels every dialect as
  `limited` / `vendor-documented` until native review happens (`ai-capability-matrix.md` "Open items before any native
  quality claim").
- Publishing a mission or expression without a recorded native review is impossible (`native_review_missing` blocker).

## 6. Not implemented / manual today

- Reviewer **assignment** and workload views (who reviews what, due dates) — decisions are recorded, assignment is not.
- Back-translation / second-model review stage (§9.8 "optional second-model review") — only the `language_quality_check`
  guard runs automatically.
- Ingestion of fixture-suite verdicts into the database; STT/TTS evaluation samples per track; WER/CER tracking
  (`benchmark_model` job has no runner handler).
- Contributor agreements and recording specifications (§9.7) — owner/legal action; `content_rights.permission_grant` is the
  place to paste the executed terms.
- Native reviewers for all 30 tracks — external dependency (traceability `B-NATIVE`).
