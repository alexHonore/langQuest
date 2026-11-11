# Dataset and third-party resource attribution inventory

_Spec §9.1 (source inventory), §9.2–9.4 (acquisition), §9.9 (DO / DON'T), §7.6 (publishing gate) · Written 2026-10-15 from the
files under `data/` and the importers in `scripts/`. Nothing in this inventory has been **published** to learners: every
imported or generated item is `review_needed`, `nativeReviewed: false`, with an **unverified** rights record
(`data/derived/license-report.md`: 1,220 items, verified 0, redistributable now 0)._

Rules of the inventory: one row per resource that was touched (downloaded, cloned, read, generated from) or explicitly
considered and rejected; license as found on the acquisition date with the evidence file; what the app actually does with
it; the attribution text the app must display; status.

## 1. Inventory

| # | Resource | Snapshot / version | License (as recorded) | Evidence | What we did | Usage in the app | Status |
|---|---|---|---|---|---|---|---|
| 1 | **Tatoeba** sentence exports (https://tatoeba.org/en/downloads, host https://downloads.tatoeba.org/exports/per_language/) | `data/raw/tatoeba/SNAPSHOT_DATE.txt` = **2026-10-14T22:31:10Z**; files `{ara,deu,eng,fra,ita,jpn,por,rus,spa}_sentences.tsv.bz2`, `*_links.tsv.bz2` (ara/deu/fra/ita/jpn/por/rus/spa × eng, ara/jpn/rus/spa × fra), `{ara,eng,fra,spa}_sentences_with_audio.tsv.bz2` | Sentences **CC BY 2.0 FR** (default); a subset **CC0 1.0** (`sentences_CC0.tsv`); **audio per recording** — license chosen by the contributor, "If the license field is empty, you may not reuse the audio outside the Tatoeba project" | `data/raw/evidence/tatoeba-terms-of-use.html`, `data/raw/evidence/tatoeba-downloads.html` (saved pages) | `scripts import-tatoeba` → `ExpressionDraft` JSONL with per-row license/author/source, snapshot id and SHA-256 of every input; drafts: `fra-fr` (400 + 60), `spa-es-ES` (400, variety operator-declared), `ara-arb` (300, operator-declared) under `data/drafts/tatoeba/` | **Curation aid only** for beginner expression drafts by communicative intent (match rate ≈ 10–15 % of linked sentences); translations `qaState: needs_review`; audio **never downloaded** — recordings are referenced with their own license flag (`withAudio` 56/12/305/0, `audioRedistributable` 8/4/0/0 across the four runs); `--apply` upserts `content_rights` (`verified: false`) + `expressions` / `expression_forms` / `expression_translations` idempotently | imported as drafts; **not published**; attribution per contributor needs `sentences_detailed.tsv` (plain exports carry no username) — drafts record `licenseSource: 'export_default'` honestly |
| 1b | **Tatoeba — real examples in the Flutter app** (same source) | export of **2026-11-07** (`SNAPSHOT_DATE.txt`); per-language `{spa,jpn,ary,eng}_sentences_detailed`, links to `eng`/`fra`/`rus`, `{eng,fra,rus}_sentences_detailed`, `{spa,jpn,eng}_sentences_with_audio` (no `ary` audio export); SHA-256 of every input in `apps/mobile_flutter/assets/content/examples.json` → `courses.<track>.inputs` | Sentences **CC BY 2.0 FR**, attributed per sentence (id + contributor); recordings: only **CC BY 4.0 / CC BY-SA 4.0 / CC0** (no NC, no ND-restricted commercial use, no unlicensed recording) | Tatoeba terms of use (https://tatoeba.org/en/terms_of_use), per-recording license column of `*_sentences_with_audio` | `scripts attach-tatoeba-examples` (`scripts/src/lib/tatoeba-examples.ts`): for each of the bundle's 170 phrases, the Tatoeba sentence that *is* the phrase (attested) and up to two short sentences using it (≤ 9 words, toxic filter, translated into the course's instruction languages, oldest translation kept). 80 phrases have something; 64 are attested as written. Licensed recordings: 4 (all English; Spanish has 11 CC BY recordings in all of Tatoeba, none for our sentences; Japanese 27, none matching; Moroccan Arabic none) downloaded to `apps/mobile_flutter/assets/audio/tatoeba/<audio id>.mp3` | Learn cards and Practise saying: **Real examples** sheet with the attested note, examples + translation, `Tatoeba #<id> by <contributor>`, the recording's contributor and license, and the export credit. Spanish examples carry a note that Tatoeba does not record the country. | **in the app**; examples are evidence of real use, not native review of the course's own lines |
| 2 | **Google Taskmaster-1 (TM-1-2019)** https://github.com/google-research-datasets/Taskmaster | shallow clone in `data/raw/taskmaster/`, commit **d92cb6af3005f1dc09c39e75e7daf4a04905e00b**; inputs `TM-1-2019/self-dialogs.json` (sha256 `1e590ed0…858d`, 65.7 MB) and `woz-dialogs.json` (sha256 `cd3bc4e9…bf72f`, 37.2 MB) | **CC BY 4.0** (`TM-1-2019/README.md`: "made available under the Creative Commons Attribution 4.0 License", https://creativecommons.org/licenses/by/4.0/) | `data/derived/taskmaster/attribution.json` | `scripts import-taskmaster` read 13,202 dialogues (54 unmapped domain) and extracted **structure only** (turn counts, slot order, abstract dialogue acts, revision/clarification rates) into `data/derived/taskmaster/scenario-skeletons.{json,md}` | Pattern library for mission blueprints (`@langquest/curriculum`); **no utterance text leaves `data/raw/`** and none is redistributed | derived skeletons in repo; attribution must accompany any skeleton-derived scenario |
| 3 | Taskmaster TM-2-2020, TM-3-2020, TM-4-2024 | present in the same clone | CC BY 4.0 per repo | — | **not read** by any importer | none | not ingested |
| 4 | **Mozilla Common Voice / Mozilla Data Collective** https://commonvoice.mozilla.org/ · https://mozilladatacollective.com/datasets | none acquired; only a synthetic fixture (`scripts/src/fixtures/corpora/common-voice/cv-corpus-20/fr`) with a fixture `LICENSE_ACKNOWLEDGEMENT.md` | CC0 release terms **plus** platform terms requesting no reposting/mirroring | — | adapter `scripts import-corpora` exists; refuses to run without an operator-written `LICENSE_ACKNOWLEDGEMENT.md`; always marks Common Voice **internal-benchmark-only** | none | **not ingested** — obtain via MDC with accepted terms; benchmark use only; never mirrored (spec §16.3) |
| 5 | **Google FLEURS** https://huggingface.co/datasets/google/fleurs | none acquired; fixture `scripts/src/fixtures/corpora/fleurs/fr_fr` only | CC BY 4.0 (dataset card) | — | adapter ready (`import-corpora`, layout `data/raw/fleurs/<locale>/{train,dev,test}.tsv` + `audio/`) | none | **not ingested** — STT evaluation/reference only when acquired; derivative redistribution to be reviewed |
| 6 | **OpenSLR** https://www.openslr.org/resources.php | none acquired | per-corpus (never uniformly CC0) | — | adapter requires the resource's own LICENSE file under `data/raw/openslr/SLR<n>/` | none | **not ingested** |
| 7 | **Darija Open Dataset (DODa)** https://github.com/darija-open-dataset/dataset | not acquired | maintainers request contacting rights holders for commercial use | — | — | none | **rights-blocked** (traceability B-RIGHTS) |
| 8 | **AtlasIA DODa audio** https://huggingface.co/datasets/atlasia/DODa-audio-dataset | not acquired | gated, advertised MIT, upstream text/voice rights unclear | — | — | none | **rights-blocked** until contributor contracts exist |
| 9 | **MADAR** https://sites.google.com/nyu.edu/madar/ | not acquired | research / noncommercial | — | — | none | **rights-blocked** (permission required) |
| 10 | DVoice Darija, Peace Corps Moroccan Arabic archive, OPUS, Wiktionary, Wikimedia Commons, Openverse, FLORES-200 / NLLB-MD, CEFR can-do | not acquired | see spec §9.1 table | — | — | none | not acquired; FLORES-200 (CC BY-SA 4.0) and NLLB-MD (CC BY-NC) must stay separate if ever used |
| 11 | **AI-generated drafts (OpenRouter)** | `data/drafts/content-factory/arabic-moroccan-fr-chapter-2026-10-15T01-49-04Z.{json,jsonl}`; provenance `content-factory@1.0.0/anthropic/claude-haiku-5.5`, prompt templates `2026-10-14.1`, 6 calls, est. $0.022 | provider terms (OpenRouter / model vendor); LangQuest original material | the draft's `generation` ledger (trace ids, tokens, cost) | `scripts content-factory --live` chapter 1 for `arabic-moroccan` from `fr` (5 blueprints, 46 expressions accepted by validators) | `review_needed` missions/expressions; the same pipeline runs in the admin Content factory (`content_generate` job) | drafts only; **never published without native review** (§9.8, §16.3) |
| 12 | **Original LangQuest artwork** (mascot, characters, scene art, covers) | in-code SVG renderers `packages/ui/src/art/*`, covers rendered by the `generate_cover` job | original work (`LICENSE_NAMES.original`) | `docs/mascot-style-guide.md` | — | mascot states, scene art, generated covers | no third-party dependency |
| 13 | **Owner's commercial MP3 courses** (e.g. Pimsleur) | none uploaded in this checkout | purchase ≠ redistribution right (§7.6) | — | upload pipeline + rights gate ready | owner-only staging; public publish blocked by `no_redistribution_right` / `rights_unverified` | awaiting owner rights documentation |

## 2. Attribution text to display

- **Tatoeba sentence** (generated by `scripts license-report` / `buildAttributionText` in `@langquest/media`):
  `Sentence #<id> from Tatoeba (https://tatoeba.org/sentences/show/<id>), CC BY 2.0 FR` — plus the contributor's username when
  `sentences_detailed.tsv` is available. CC0 sentences need no attribution but keep the source link.
- **Taskmaster-1**: `Dialogue structure patterns derived from Taskmaster-1 (Byrne et al., 2019), Google LLC, CC BY 4.0.`
  Citation: Byrne et al., "Taskmaster-1: Toward a Realistic and Diverse Dialog Dataset", EMNLP-IJCNLP 2019.
- Where to show it: `content_rights.attribution_text` is returned by `GET /v1/admin/licenses/attributions`, included in course
  and audio manifests, and rendered on the mobile Audio lesson screen (author/rights attribution, Phase 3) — the publish gate
  refuses `attribution_required` records without text/authors (`rights_unverified`).

## 3. DO / DON'T (§9.9) — and where each rule is enforced

**DO**

| Rule | Enforcement |
|---|---|
| Original texts/speech with assignments or clear licenses | `content_rights.permission_grant` is **required**; `license_id` free-text with `LICENSE_NAMES`; `voice_rights` separate (`none / playback_only / synthesis_permitted`) |
| Attribute each third-party item | `attribution_required` + `attribution_text` in `content_rights`; `license-report` flags `missing attribution text`; gate code `rights_unverified` |
| Keep license restrictions | `commercial_redistribution`, `alterations_permitted`, `ai_processing_permitted`, `expires_at`, `revoked_at`; `canPublish` codes `no_redistribution_right`, `rights_expired`, `rights_revoked`; takedown propagation `unpublish → rights_unverified` and manifest invalidation (`packages/media/src/rights.ts`) |
| Consult counsel for ambiguous high-value collections | documented as owner action (`provisioning.md`, §11); nothing ambiguous was published |
| Differentiate analytics access from redistribution | Common Voice adapter is always internal-benchmark-only; `redistributionPermitted` per recording in Tatoeba drafts |
| Respect contributor rights and platform terms | `LICENSE_ACKNOWLEDGEMENT.md` required by `import-corpora`; no mirroring; speaker `consent_state` on `speakers` |
| Maintain audit and takedown workflow | `audit_logs` (append-only), `publication_events`, admin **Unpublish** with reason `rights_revoked / takedown`, offline eligibility revoked, "Unresolved takedowns" metric in Analytics |

**DON'T**

| Rule | Enforcement / status |
|---|---|
| Rip Pimsleur / Duolingo / Rosetta Stone audio or texts | not done; owner uploads stay private until a verified license with redistribution exists (`no_redistribution_right`) |
| Upload purchased lessons for public playback without authorization | publish gate (`rights_missing` / `rights_unverified` / `no_redistribution_right`); `visibility` defaults to `private` |
| Scrape commercial subtitles and call them open data | no OPUS/subtitle importer exists |
| Treat `MIT` / `CC0` labels as proof of upstream ownership | AtlasIA/DODa recorded as rights-blocked; Tatoeba audio treated per recording, not per dataset |
| Infer speaker identity / clone speakers without written consent | speakers are `pseudonymous` by default; `voice_rights = 'synthesis_permitted'` is an explicit flag; Common Voice re-identification is forbidden by the adapter notes |
| Assume CC BY-NC is fine because the app is free | `license-report` flags NC/ND/unknown; MADAR and NLLB-MD listed as blocked |
| Publish unreviewed model-created minority-language speech as authentic | `native_review_missing` is a **blocker** for missions/expressions (`requireNativeReview: true`); `PROMPT_PACKS[*].nativeReviewed` is `false` everywhere, so nothing claims native quality |

## 4. Reproducing the inventory

```bash
pnpm --filter @langquest/scripts import-tatoeba -- --target fra --source eng --dry-run
pnpm --filter @langquest/scripts import-taskmaster -- --dry-run
pnpm --filter @langquest/scripts license-report -- --drafts data/drafts/tatoeba   # → data/derived/license-report.{md,json}
pnpm --filter @langquest/scripts validate-course-coverage                          # → docs/provider-matrix/coverage-report.md
```

Re-run with a new `SNAPSHOT_DATE.txt` whenever exports are refreshed; every draft embeds the input hashes so a snapshot can be
audited later (§9.2). When a license changes or a contributor withdraws, follow §15: audit provenance by `snapshotId`, unpublish
with reason `rights_revoked`, regenerate from cleared material.
