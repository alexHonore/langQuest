# Recording specification for native-speaker contributors

_Spec §9.7 (requirement R-9.7-03), with §7.2–7.6 (audio pipeline, transcripts, rights) and §4.4 (renditions).
Written 2026-10-20._

This is what a contributor delivers and how LangQuest stores it. Every technical value below is either:

- **enforced or consumed by code**, cited with its path, or
- **a production requirement of this spec**, marked _(spec)_. Contributors must meet it, but the pipeline does not
  measure it today.

No recording is published until a native reviewer and a rights reviewer have signed off
(`docs/content-rights/native-review-process.md` §2–3).

## 1. Scope

- **What is recorded:** original prompts and answers for missions, expressions (pronunciation references), dialogues
  from scenario briefs (`docs/content-rights/scenario-brief-template.md`), and audio-library lessons.
- **Who records:** verified native speakers and competent tutors of the exact variety and region, with signed written
  terms (§6). Spread recordings across speakers of different genders and ages where appropriate, casual and polite
  registers, and urban and rural accents within the variety (MASTER_SPEC §9.7).
- **Adults only** until counsel has reviewed recordings of children's voices (traceability R-11-11).
- **Never recorded:** a different variety standing in for the target one. For example, MSA is not Darija, French is
  not Haitian Creole, Mandarin is not Cantonese and es-419 is not es-ES. Each variety's `mustNotSubstitute` list is in
  `packages/contracts/src/catalog.ts`.

## 2. Room and recording technique _(spec)_

| Item | Requirement |
|---|---|
| Room | A quiet, soft-furnished room (carpet, curtains, a closet of clothes). No fan, air conditioning, fridge hum, traffic, open window, other voices, TV or radio. |
| Background | **No music of any kind**, no copyrighted audio in the background, no notification sounds. A recording with audible third-party audio is rejected, because it cannot be cleared for redistribution (§6). |
| Noise floor | Room tone measured below −60 dBFS on the recorder's meter. Record 3 seconds of silence at the start of each session as evidence. |
| Microphone | One microphone per speaker, 15–25 cm from the mouth, slightly off-axis. Use a pop filter for plosives. Use the same microphone and position for the whole session. |
| Phone recordings | Allowed only when no microphone is available. Use the phone's built-in voice-memo app, held still and close (not speakerphone), with "voice isolation" and "noise reduction" effects turned off. |
| Pace | Natural conversational speed. Do **not** slow down for learners: the pipeline generates pitch-preserving 0.75× and 0.85× renditions itself (`SLOW_FACTORS`, `packages/media/src/ffmpeg.ts`, `apps/jobs/src/handlers/transcode.ts`). Record a slow "teaching variant" only when the brief asks for one, as a separate take. |
| Pauses | Keep natural pauses and hesitations. The pipeline never removes silence ("no silence removal anywhere", `packages/media/src/ffmpeg.ts`). Leave 0.5–1 s of room tone before the first and after the last word of every take. |

## 3. Levels and headroom

| Item | Requirement | Where it matters in code |
|---|---|---|
| Peak level | Speech peaks between −12 and −6 dBFS. **Never clip** (0 dBFS). Re-record any clipped take. _(spec)_ | — |
| Headroom | At least 6 dB between the loudest peak and 0 dBFS. _(spec)_ | — |
| Processing on the master | **None.** No compression, limiting, noise reduction, EQ, de-essing, normalisation or reverb. Masters are kept untouched; LangQuest only derives renditions from them. | `packages/media/src/ffmpeg.ts` ("keep masters untouched") |
| Loudness | Do not normalise yourself. When an editor enables it per job, the renditions (never the master) are normalised to EBU R128 integrated −16 LUFS, true peak −1.5 dBTP, LRA 11. It is off by default so that instructional dynamics survive. | `LOUDNESS_TARGET` in `packages/media/src/ffmpeg.ts`; `loudnessNormalize` (default `false`) in `TranscodeParamsSchema`, `apps/jobs/src/handlers/transcode.ts` |

## 4. File format

### 4.1 Masters (what you deliver)

| Item | Requirement | Pipeline behaviour (code) |
|---|---|---|
| Container and codec | **WAV (PCM)** or **FLAC**. Never MP3, AAC or Opus for new recordings: those are lossy, and the pipeline would encode them a second time. | Uploads accept `audio/wav`, `audio/x-wav`, `audio/flac`, `audio/mpeg`, `audio/mp4`, `audio/x-m4a`, `audio/aac` and `audio/ogg` (`ALLOWED_UPLOAD_MIME_TYPES`, `packages/contracts/src/api/admin.ts`). The container is sniffed from the bytes (`sniffContainer`, `packages/media/src/metadata.ts`). Folder imports accept `mp3 m4a m4b wav aac flac ogg opus` (`AUDIO_EXTENSIONS`, `packages/media/src/imports.ts`). |
| Sample rate | **48 kHz** preferred, 44.1 kHz accepted, nothing below 44.1 kHz. | The AAC rendition keeps the master's rate up to 44.1 kHz and resamples anything higher to 44.1 kHz. The Opus rendition is always 48 kHz. A 16 kHz master would therefore produce 16 kHz AAC renditions (`decideTranscodeProfile`, `packages/media/src/ffmpeg.ts`). |
| Bit depth | **24-bit** preferred, 16-bit minimum. _(spec)_ | Not inspected: `ProbeSummary` records codec, rate, channels, bitrate and duration, but not bit depth. |
| Channels | **Mono, one voice per file or track.** For a dialogue, deliver one mono file per speaker plus a mono mix of the whole scene. Use stereo only for an ambience scene that a brief explicitly asks for. | Mono masters produce mono renditions (AAC 64 kbps, Opus 32 kbps). Stereo masters keep stereo (AAC 96 kbps, Opus 48 kbps) unless an editor sets `speechOnly`. Stereo carries no information for speech (`RENDITION_LADDER`, `decideTranscodeProfile`). |
| Size | Any length the session needs. Prefer one take per file for expressions and one file per scene or lesson for dialogues. | Audio uploads are capped at 8 GiB per object (`UPLOAD_LIMITS`, `packages/media/src/uploads.ts`). Transcription splits files longer than 10 minutes or larger than 20 MiB into chunks (`chunkSeconds`, `maxDirectBytes`, `apps/jobs/src/handlers/transcribe.ts`). |
| Embedded tags and cover art | Leave them empty. Metadata lives in the database and the sidecar (§5). | Renditions strip source tags (`-map_metadata -1`). An embedded cover is extracted, not re-encoded. |
| Integrity | Deliver a SHA-256 checksum per file (`sha256sum *.wav > SHA256SUMS`). | Uploads require `clientChecksumSha256` (`UploadInitiateRequestSchema`). A byte-identical upload is reported as `duplicateOfAssetId` and reuses the stored blob (`packages/media/src/uploads.ts`). `scripts bulk-audio-scan` flags duplicates without merging them. |

### 4.2 What LangQuest derives (for reference, nothing to deliver)

`transcode` derives these renditions (`apps/jobs/src/handlers/transcode.ts`):

- AAC `.m4a` and Opus `.ogg` mobile renditions at the audited ladder;
- pitch-preserving slow renditions at 0.75× and 0.85× (`atempo`);
- a waveform peaks JSON from 8 kHz PCM;
- the embedded cover, if present.

Each output is keyed by its own SHA-256, so re-running a job on identical bytes is a no-op. Clips are cut from the
master at sample accuracy (`buildClipCommand`).

## 5. Naming, folders and the sidecar manifest

### 5.1 Folders and file names

`parseImportPath` (`packages/media/src/imports.ts`) infers structure from the relative path:

- one folder level, `Collection/file`, gives the collection title;
- two or more levels, `Collection/Chapter/file`, give the collection and chapter.

A leading number becomes the order. `S01E03` and `Level 2` patterns are understood.

Use this layout:

```
<track-id>/<NN chapter title>/<NN take title>.wav
arabic-moroccan/01 At the café/03 Ordering mint tea.wav
```

- No personal names in file or folder names. The speaker is recorded in metadata (§7).
- No `..`, absolute paths or control characters: the importer rejects them as unsafe.

### 5.2 Sidecar manifest

Deliver one `manifest.csv` (or `.json`) per batch. Its columns are the `ImportManifestRowSchema` fields
(`packages/contracts/src/api/admin.ts`). Header aliases are case-, space- and underscore-insensitive. This is the same
format `scripts bulk-audio-scan` produces and `POST /v1/admin/library/import-manifest` accepts (dry run by default).

| Column | Required | Value |
|---|---|---|
| `legacyPath` | yes (or `storageKey` / `assetId`) | Relative path of the file, as above |
| `collectionTitle`, `chapterTitle`, `chapterOrder`, `lessonTitle`, `lessonOrder`, `episodeNumber` | as needed | Overrides what the path implies |
| `targetVarietyId` | yes | A canonical variety id (§8) |
| `instructionLanguage` | when a source-language voice is present | A source-language code (`en`, `fr`, `es`, `ru`, …) |
| `spokenLanguageCodes` | yes | Every language heard in the file, separated by `;` (the parser also accepts `,` and `\|`). Code-switching counts: Darija with French is `ary;fr`. |
| `regionalDialect` | yes | A regional option id (§8) or a precise free-text region |
| `speakerName` | yes | The speaker's **display name or pseudonym** as registered (§7), never a legal name unless the speaker chose it |
| `level`, `topic`, `tags`, `scene`, `description` | recommended | Learner level and editorial labels |
| `licenseId`, `rightsOwner` | yes | Must match the signed agreement (§6) |

## 6. Consent and rights (written terms)

Every recording must be covered by **written terms** before upload (MASTER_SPEC §9.7). These cover: scope,
ownership or licence, editing and adaptation, audiobook playback, multilingual translations, commercial and free
redistribution in the app, synthetic-voice use (**a separate, explicit permission**), privacy, withdrawal and
retention.

The executed terms become one `content_rights` row per grant (`packages/contracts/src/db/curriculum.ts`
`ContentRightsTable`; admin API `POST /v1/admin/content-rights`). The fields map as follows:

| `content_rights` column (API field) | What to record from the agreement |
|---|---|
| `permission_grant` (`permissionGrant`, required, ≤ 4000 chars) | The executed terms: grant text, parties, date and signature reference |
| `evidence_asset_id` (`evidenceAssetId`) | The uploaded scan or PDF of the signed agreement |
| `license_id`, `license_version` | `LangQuest-Contributor` and the agreement version (or the licence identifier the agreement grants) |
| `authors`, `speakers` | The author(s) of scripts and the speakers as named in the agreement (pseudonyms allowed) |
| `origin_url` | The source URL, if the recording is not original to this programme (otherwise empty) |
| `commercial_redistribution` | `true` only if the terms allow distribution inside the free app (the publish gate blocks without a redistribution right: `no_redistribution_right`, `packages/media/src/rights.ts`) |
| `alterations_permitted` | `true` only if editing is granted: cuts, clips, slow renditions, loudness normalisation, translations |
| `ai_processing_permitted` | `true` only if the speaker agreed to AI transcription, alignment and translation by third-party processors (`docs/reference/processor-disclosure-draft.md`) |
| `voice_rights` | `none`, `playback_only` or `synthesis_permitted`. `synthesis_permitted` **only** with the separate, explicit synthetic-voice permission. |
| `attribution_required`, `attribution_text` | As the terms require (shown in the attribution list, `GET /v1/admin/licenses/attributions`) |
| `expires_at` | The end of the licence term, if any. The gate blocks expired rights (`rights_expired`). |
| `verified`, `reviewer_id`, `reviewed_at` | Set by an admin rights reviewer after checking the evidence (only `admin`/`super_admin` may set `verified`) |
| `revoked_at` | Set by `POST /v1/admin/content-rights/:id/revoke` when consent is withdrawn. One transaction unpublishes every dependent item and revokes offline packs (`revoke_content_rights`, migration `120_admin_structure`). |

**Gap (honest).** `ai_processing_permitted` and `alterations_permitted` are stored and shown in the Studio Rights
screen, but the `transcribe`, `align`, `translate_transcript` and `transcode` jobs do not check them today
(`apps/jobs/src/handlers/*`). An operator must not queue AI jobs or derived renditions for a recording whose rights
row says `false`.

## 7. Speaker metadata and consent state

Register each person once as a `speakers` row (`SpeakerCreateRequestSchema`; admin `POST /v1/admin/speakers`) and link
them to lessons through `lesson_speakers`.

| Field | Value |
|---|---|
| `display_name` / `pseudonymous` | The name the speaker chose to be credited by. Pseudonymous is the default (`true`). |
| `target_variety_id` | The variety they speak natively (§8) |
| `region` | City or region of origin, e.g. `Casablanca`, `Fès`, `Tétouan (north)` |
| `consent_state` | `unknown`, `pending`, `granted` or `revoked`. **The publish gate blocks a lesson whose known speakers lack a name or have `unknown` or `revoked` consent** (`speaker_metadata_missing`, `packages/media/src/rights.ts`). |
| `content_rights_id` | The speaker's signed grant (§6) |
| `voice_description` | Neutral audio description (register, pitch range, pace). No sensitive data such as health or ethnicity. |
| `synthetic` | `false` for every human recording |
| `lesson_speakers.role` | `instructor`, `native_speaker`, `narrator`, `learner_model` or `other` |
| `lesson_speakers.voice_segments` | `[{ start_ms, end_ms }]`: when this speaker talks in the lesson |

For expression references, each take is an `expression_audio` row. It holds `speaker_id`, `regional_option`,
`speech_rate` (`slow`, `normal` or `fast`), `synthetic: false` and `reviewed`. Its `quality_flag` (`unreviewed`, `ok`,
`poor` or `wrong_variety`) is set by the reviewer.

## 8. Accent and variety tags

Use only the canonical ids in `packages/contracts/src/catalog.ts`.

**Variety ids (`VARIETY_IDS`):** `ar-levant`, `ary`, `arz`, `arb`, `yue`, `cmn`, `en`, `da`, `fr`, `de`, `el`, `ht`,
`he`, `hi`, `it`, `ja`, `ko`, `pt-BR`, `pt-PT`, `ro`, `ru`, `es-419`, `es-ES`, `sw`, `rw`, `sv`, `ln`, `uk`, `vi`.
`chinese-simplified` shares `cmn` assets.

**Regional option ids (`COURSE_TRACKS[*].regionalOptions`)**, used for `regionalDialect` and
`expression_audio.regional_option`:

| Track | Variety | Regional options (`id` → locale) |
|---|---|---|
| `arabic-eastern` | `ar-levant` | `SY` → ar-SY, `LB` → ar-LB, `PS` → ar-PS, `JO` → ar-JO |
| `arabic-moroccan` | `ary` | `casablanca`, `fes`, `marrakech`, `north` (all ar-MA) |
| `arabic-egyptian` | `arz` | `cairo` → ar-EG |
| `chinese-cantonese` | `yue` | `HK` → zh-HK |
| `chinese-mandarin` | `cmn` | `CN` → zh-CN, `TW` → zh-TW |
| `english` | `en` | `US` → en-US, `GB` → en-GB |
| `french` | `fr` | `FR` → fr-FR, `CA` → fr-CA |
| `spanish-latin-american` | `es-419` | `MX`, `CO`, `AR`, `PE`, `CL` (es-MX, es-CO, es-AR, es-PE, es-CL) |
| `swahili` | `sw` | `KE` → sw-KE, `TZ` → sw-TZ |
| `lingala` | `ln` | `CD` → ln-CD, `CG` → ln-CG |
| `vietnamese` | `vi` | `north`, `south` (vi-VN) |
| every other track | its variety | none: use `speakers.region` free text |

Rules:

- Tag what the speaker actually speaks, never the broader language. A segment's variety is never inferred from a
  language code (`SegmentSchema.varietyId`, `packages/media/src/transcripts.ts`).
- When a speaker code-switches (Darija with French, Hinglish, Sheng), tag each segment's language (§9) and list
  every language in `spokenLanguageCodes`.

## 9. Transcripts and time markers

Deliver a transcript for every file, in one of the formats `parseSubtitles` and `TranscriptJsonSchema` read
(`packages/media/src/transcripts.ts`):

- **TranscriptJson v1** (preferred, keeps every field):

  ```json
  {
    "version": 1,
    "languageMode": "target",
    "segments": [
      {
        "index": 0, "startMs": 480, "endMs": 2310,
        "text": "واخا، عطيني واحد أتاي بالنعناع",
        "transliteration": "wakha, 3tini wa7d atay b nna3na3",
        "speakerLabel": "S1", "languageCode": "ar-MA", "varietyId": "ary",
        "words": [], "reviewed": false
      }
    ]
  }
  ```

  The line above is an **illustrative draft**, not reviewed content.

- **SRT** (`HH:MM:SS,mmm --> HH:MM:SS,mmm`) or **WebVTT** (`HH:MM:SS.mmm`). These carry time, text and a speaker
  label. A WebVTT voice tag (`<v S1>`) or an `S1: ` prefix at the start of a cue is imported as the segment's
  `speakerLabel` (`parseSubtitles`). Without a voice tag, any cue that opens with up to 41 characters starting with a
  Latin letter (then Latin letters, digits, `_`, spaces, `.`, `'` or `-`) followed by `: ` loses that text to the
  speaker label, so do not start the spoken text itself that way. Neither format carries language or variety labels,
  transliterations or word timings. The Studio transcript editor sets every imported segment to the lesson's primary
  language and target variety (`apps/admin/app/(studio)/transcripts/[lessonId]/transcript-editor.tsx`), so tag
  code-switched segments there, or deliver TranscriptJson instead.

Conventions (from `SegmentSchema` and the `transcripts` / `transcript_segments` / `transcript_word_alignments` tables,
`packages/contracts/src/db/audio-library.ts`):

| Field | Convention |
|---|---|
| `startMs` / `endMs` | Integer milliseconds from the start of the file. Segments are sorted and must not overlap: overlaps are clamped to the previous end (`normalizeSegments`). |
| Segment length | One utterance or sentence per segment, at most about 10 s, split at natural pauses _(spec)_. Learners loop and practise per segment (`loopBounds`, `sentenceAnchors`). |
| `text` | Exactly what is said, in the variety's usual script (`Arab` for Arabic tracks, `Hant` for Cantonese, `Hans` for Mandarin, …). Keep false starts and fillers when they are audible. Mark unintelligible words as `[inaudible]` _(spec)_. Never "correct" dialect towards the standard language. |
| `transliteration` | Required where the track teaches a Latin script: Arabizi for `ary`, Jyutping for `yue`, Pinyin for `cmn`, romaji for `ja`, Revised Romanization for `ko`. Otherwise `null`. |
| `speakerLabel` | `S1`, `S2`, … consistently across a file, mapped to `speakers` rows in `lesson_speakers` |
| `languageCode` | BCP-47 tag of the speech in this segment (`ar-MA`, `fr`, `en-US`, …). A segment that mixes languages is `mul`. |
| `varietyId` | A canonical id (§8), or `null` if the segment is in the instruction language |
| `languageMode` | `target`, `source` or `mixed` for the whole transcript |
| `words` | Optional word timings `{ word, startMs, endMs }`, which drive karaoke highlighting. Alignment can also be produced by the `align` job; you do not need to hand-time words. |
| `reviewed` | Always `false` on delivery. Only the native reviewer sets it (`native-review-process.md` §3). |

Translations into instruction languages are separate rows (`transcript_translations`, `qa_state: needs_review`). Do
not put translations inside `text`.

## 10. Delivery checklist (per batch)

1. The signed terms are uploaded as evidence, and a `content_rights` row exists (unverified) (§6).
2. A `speakers` row exists per person, with `consent_state: granted` and a link to the rights row (§7).
3. Masters are WAV or FLAC, 48 or 44.1 kHz, 24- or 16-bit, mono per voice, unprocessed, peaks −12 to −6 dBFS, no
   clipping, 0.5–1 s room tone at head and tail, no music or third-party audio (§2–4).
4. There is one transcript per file (TranscriptJson v1 preferred) with integer-ms, non-overlapping segments and
   speaker, language and variety labels (§9).
5. `manifest.csv` has variety, regional option, spoken languages, speaker display name and licence (§5).
6. `SHA256SUMS` is included for every file.
7. Upload goes through Studio Uploads or the `scripts bulk-audio-scan` → `import-manifest` dry run. Items land in
   `imported_draft` / `review_needed`. Nothing reaches learners before the native and rights reviews and the publish
   checklist (`native-review-process.md` §2–3).
