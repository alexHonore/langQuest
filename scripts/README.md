# @langquest/scripts — data / ops CLIs

Operator tooling for corpus acquisition, bulk audio migration, rights reporting, catalog seeding, coverage
validation and the generative content factory (spec §4.2, §7.2, §9, §12.2, §14.2). Every CLI:

- answers `--help` (usage generated from the flag declaration);
- has a first-class `--dry-run` that validates and reports without writing files or touching the database;
- is a thin wrapper around a tested library module under `src/lib/` (`pnpm --filter @langquest/scripts test`);
- never downloads corpora, never mirrors Common Voice, never publishes content: every output is
  `review_needed` / `nativeReviewed: false` until a native reviewer and a rights review say otherwise.

Run from the repo root: `pnpm --filter @langquest/scripts <name> -- [flags]` (the forwarded `--` is tolerated).

| CLI | What it does | Writes |
|---|---|---|
| `import-tatoeba` | Streams `data/raw/tatoeba/*.tsv(.bz2)` (system `bzip2`), joins `<target>-<source>_links`, keeps per-row license/author/source + snapshot id + SHA-256 of inputs, NFC-normalises safely, script/language sanity, toxic/irrelevant filter, intent heuristics (target text + English translation) → `ExpressionDraft` JSONL. Ambiguous corpus languages (`spa`, `por`, `ara`) need `--variety`; the dialect is recorded as *operator-declared*, never guessed. `--apply` upserts `content_rights` / `expressions` / `expression_forms` / `expression_translations` (idempotent on the draft id). | `data/drafts/tatoeba/<target>-<variety>-<stamp>.jsonl` + `.summary.json` |
| `import-taskmaster` | Extracts dialogue *structure* (turn counts, slot order, abstract dialogue acts, revision/unavailable/clarification rates) from Taskmaster-1 into per-domain scenario skeletons mapped to curriculum blueprints, with the CC BY 4.0 attribution record. No utterance text leaves `data/raw/`. | `data/derived/taskmaster/scenario-skeletons.{json,md}`, `attribution.json` |
| `import-corpora` | Adapters for FLEURS / Common Voice / OpenSLR drops under `data/raw/<source>/`. Requires `LICENSE_ACKNOWLEDGEMENT.md` (format below), validates layout, hashes transcripts, counts audio, maps locales to varieties explicitly. Common Voice is always internal-benchmark-only. `--apply` inserts one unverified `content_rights` row. | `data/derived/<source>/inventory.json`, `rights.jsonl` |
| `bulk-audio-scan` | Scans a local tree (what `rclone` will upload): SHA-256 + byte length, container/duration/ID3 via `@langquest/media`, hierarchy inferred from the path (`parseImportPath`), duplicates flagged (never merged). CSV columns match the admin `import-manifest` endpoint (extra provenance columns are ignored by it). | `data/derived/manifests/<folder>-<stamp>.csv` (+ `.jsonl`) |
| `license-report` | Attribution / rights summary from `content_rights` (+ usage counts) and/or JSONL drafts; flags unverified, no-redistribution, NC/ND/unknown, expired, revoked, missing attribution text, audio without a usable license. | `data/derived/license-report.md` (+ JSON) |
| `seed-languages` | Idempotent catalog seed (generated SQL from `@langquest/db`: languages, writing systems, varieties, 30 tracks, model profiles) + `communicative_intents` / `skills` from `@langquest/curriculum` + honest `course_source_localizations` rows from `@langquest/locales` × curriculum coverage. Target: `DATABASE_URL`, else the local stack. | database (or `--sql-out` file) |
| `seed-curriculum` | Loads the authored chapters of `@langquest/curriculum` (`content/*`) into `content_rights` / `lesson_courses` / `chapters` / `missions` / `mission_steps` / `mission_localizations` / `expressions` / `expression_forms` / `expression_translations` and raises `course_source_localizations` to `partial` from measured overlay counts. Deterministic ids (UUID v5 of content keys, `@langquest/db/seed/curriculum-uuid`) make re-runs update in place. The four flagship AI-draft chapters are published with every honesty flag kept (`reviewed=false`, `needs_review` overlays, unverified rights) so learners get the draft disclosure; skeleton chapters (no target text) stay `review_needed`; no audio rows are faked. `--apply` then rebuilds and checks the manifest of every published (track, source) pair. | database |
| `validate-course-coverage` | Per track × source report (missions, expressions, audio, native review, localization) combining curriculum coverage, locale catalogs, JSONL drafts and DB counts. Exits non-zero on catalog drift. | `docs/provider-matrix/coverage-report.md` (+ `--json`) |
| `content-factory` | Drafts chapter 1 (one `content_generation` call per blueprint) or the §14.2 fixture suite (25 expressions, 10 dialogues, 5 intents with paraphrases, 1 confusion test) for `--track × --source` through `@langquest/ai`, validates (blueprint slots, intents, script/transliteration forms, language guard — wrong variety/script/source-language leaks are rejected), writes JSONL drafts. Live calls only with `--live` / `LANGQUEST_LIVE_TESTS=1`, capped by `--max-usd` (default $0.30). `--from-seed` exports the hand-authored curriculum draft without a model call. | `data/drafts/content-factory/<track>-<source>-chapter-<stamp>.{jsonl,json}`, `fixtures/<track>-<source>-<stamp>.{json,jsonl}` |

## Database access

`--apply` and the DB-backed reports resolve a service-role client from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
(hosted URLs only when `LANGQUEST_DB_TARGET=hosted`) or the local stack (`pnpm supabase start`, discovered via
`supabase status`). The repo-root `.env` is loaded (never overriding the environment). Nothing is written without
`--apply`; `--dry-run` always wins.

## `LICENSE_ACKNOWLEDGEMENT.md` (import-corpora)

The operator writes this file after reading the dataset's actual license/terms; the adapter refuses to run without it.

```
dataset: FLEURS
version: 2.0
license: CC BY 4.0
license_url: https://huggingface.co/datasets/google/fleurs
source_url: https://huggingface.co/datasets/google/fleurs
acquired_at: 2026-10-14
acquired_by: <name>
terms_accepted: yes
redistribution_permitted: no
locales: fr_fr, ar_eg
notes: read speech; evaluation only
```

Expected layouts: FLEURS `data/raw/fleurs/<locale>/{train,dev,test}.tsv` + `audio/`; Common Voice
`data/raw/common-voice/<cv-corpus-version>/<locale>/{validated,invalidated,other}.tsv` + `clips/`; OpenSLR
`data/raw/openslr/SLR<n>/…` with the resource's own LICENSE file.

## Draft record formats

- `ExpressionDraft` (`src/lib/drafts.ts`): `status: review_needed`, `nativeReviewed: false`, provenance (dataset,
  snapshot id, input hashes, evidence URLs), target text + variety assignment (`corpus` / `operator_declared` /
  `unresolved`), forms, translations (`qaState: needs_review`), audio references (never downloaded; license and
  `redistributionPermitted` per recording), rights (`verified: false`), curation (intent, confidence, flags) and checks.
- `chapter_draft` (`src/lib/content-factory.ts`): a `@langquest/curriculum` `SeedChapter` (`provenance: ai_draft`,
  `reviewStatus: review_needed`) plus generation ledger (models, trace ids, tokens, estimated cost, prompt template
  versions) and per-mission validation results.
- `fixture_suite`: the §14.2 suite with per-item `reviewed: false`, `verdict: null` for the native reviewer to fill.

## Fixtures and tests

`src/fixtures/` holds tiny Tatoeba exports (plain + `.bz2`), a 50-dialogue Taskmaster sample with its ontology,
synthetic WAV files in a numbered folder tree, and FLEURS / Common Voice drops with acknowledgements. Tests never
call OpenRouter (the content factory is exercised with a fake `TextReasoner`) and never need a database.
