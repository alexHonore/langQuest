/**
 * JSONL draft record shapes written by the importers and the content factory and read by
 * `license-report` / `validate-course-coverage`. Every record is honest by construction:
 * `status` is always `review_needed`, `nativeReviewed` is literally `false`, and the
 * provenance block names the dataset snapshot and the SHA-256 of every input file.
 */
import { z } from 'zod';
import { KeySchema, RegisterSchema, ScriptIdSchema, SourceLanguageCodeSchema, TransliterationSchemeIdSchema, VarietyIdSchema } from '@langquest/contracts';

export const DRAFT_FORMAT_VERSION = 1 as const;

export const InputFileHashSchema = z.object({ file: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/), byteLength: z.number().int().nonnegative() });
export type InputFileHash = z.infer<typeof InputFileHashSchema>;

export const ProvenanceSchema = z.object({
  dataset: z.enum(['tatoeba', 'taskmaster', 'fleurs', 'common_voice', 'openslr', 'content_factory', 'curriculum_seed']),
  /** Snapshot identifier (export date, git commit, dataset version). */
  snapshotId: z.string().min(1),
  inputs: z.array(InputFileHashSchema),
  /** URL of the license evidence page saved locally (data/raw/evidence/*) and/or the upstream terms page. */
  evidence: z.array(z.string()),
  importedAt: z.string(),
  importer: z.string(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const RightsRecordSchema = z.object({
  licenseId: z.string().min(1),
  licenseVersion: z.string().nullable(),
  /** Where the license came from: an explicit per-row field or the export's default license. */
  licenseSource: z.enum(['per_row', 'export_default', 'dataset_card', 'operator_acknowledgement']),
  authors: z.array(z.string()),
  originUrl: z.string().nullable(),
  attributionRequired: z.boolean(),
  attributionText: z.string().nullable(),
  /** False for any NC / ND / unknown license, and for every Common Voice item (platform terms). */
  commercialRedistribution: z.boolean(),
  alterationsPermitted: z.boolean(),
  aiProcessingPermitted: z.boolean(),
  verified: z.literal(false),
  notes: z.array(z.string()),
});
export type RightsRecord = z.infer<typeof RightsRecordSchema>;

export const DraftFormSchema = z.object({
  script: ScriptIdSchema.nullable(),
  transliterationScheme: TransliterationSchemeIdSchema.nullable(),
  text: z.string().min(1),
});
export type DraftForm = z.infer<typeof DraftFormSchema>;

export const DraftTranslationSchema = z.object({
  sourceLanguageCode: SourceLanguageCodeSchema,
  text: z.string().min(1),
  contextNote: z.string().nullable().default(null),
  literalGloss: z.string().nullable().default(null),
  /** Upstream id (e.g. Tatoeba sentence id) of the translation. */
  upstreamId: z.string().nullable(),
  rights: RightsRecordSchema.nullable(),
  qaState: z.literal('needs_review'),
});

export const DraftAudioRefSchema = z.object({
  upstreamId: z.string(),
  /** Tatoeba audio id / corpus clip path — never downloaded by the importer. */
  locator: z.string(),
  speaker: z.string().nullable(),
  licenseId: z.string().nullable(),
  attributionUrl: z.string().nullable(),
  /** Whether the license, as recorded, permits playback inside a free-but-commercial app (NC/ND/empty → false). */
  redistributionPermitted: z.boolean(),
  note: z.string().nullable(),
});

export const ExpressionDraftSchema = z.object({
  formatVersion: z.literal(DRAFT_FORMAT_VERSION),
  kind: z.literal('expression_draft'),
  draftId: z.string().min(1),
  status: z.literal('review_needed'),
  nativeReviewed: z.literal(false),
  provenance: ProvenanceSchema,
  target: z.object({
    languageCode: z.string().min(2),
    /** Null when the corpus does not disambiguate the variety (es, pt, ar…) and the operator did not declare one. */
    varietyId: VarietyIdSchema.nullable(),
    varietyAssignment: z.enum(['corpus', 'operator_declared', 'unresolved']),
    upstreamId: z.string(),
    rawText: z.string(),
    text: z.string().min(1),
    script: z.string(),
  }),
  /** Script/transliteration forms (empty → the default script form is derived on apply). */
  forms: z.array(DraftFormSchema).default([]),
  translations: z.array(DraftTranslationSchema),
  audio: z.array(DraftAudioRefSchema),
  rights: RightsRecordSchema,
  curation: z.object({
    intentKey: KeySchema.nullable(),
    intentConfidence: z.number().min(0).max(1),
    alternativeIntentKeys: z.array(KeySchema),
    scenarioTags: z.array(z.string()),
    register: RegisterSchema,
    difficulty: z.number().min(0).max(1),
    wordCount: z.number(),
    flags: z.array(z.string()),
  }),
  checks: z.object({
    languageSanity: z.object({ ok: z.boolean(), reason: z.string().nullable() }),
    toxicity: z.object({ toxic: z.boolean(), matches: z.array(z.string()) }),
    relevance: z.object({ relevant: z.boolean(), reasons: z.array(z.string()) }),
  }),
});
export type ExpressionDraft = z.infer<typeof ExpressionDraftSchema>;

/** Minimal rights projection used by `license-report` for any record kind. */
export const RightsBearingRecordSchema = z.object({ kind: z.string(), draftId: z.string().optional(), rights: RightsRecordSchema.optional(), audio: z.array(DraftAudioRefSchema).optional() });

/** Normalise a license string to a stable id and derive what it allows. Unknown → nothing permitted. */
export function classifyLicense(raw: string | null | undefined): Pick<RightsRecord, 'licenseId' | 'licenseVersion' | 'commercialRedistribution' | 'alterationsPermitted' | 'attributionRequired' | 'aiProcessingPermitted'> & { known: boolean } {
  const text = (raw ?? '').trim();
  if (!text) return { licenseId: 'unknown', licenseVersion: null, commercialRedistribution: false, alterationsPermitted: false, attributionRequired: true, aiProcessingPermitted: false, known: false };
  const upper = text.toUpperCase().replace(/\s+/g, ' ');
  const version = /(\d+\.\d+)/.exec(upper)?.[1] ?? null;
  const cc0 = /CC0|PUBLIC DOMAIN|CC-0/.test(upper);
  const nc = /\bNC\b|NON-?COMMERCIAL/.test(upper);
  const nd = /\bND\b|NO-?DERIV/.test(upper);
  const sa = /\bSA\b|SHARE-?ALIKE/.test(upper);
  const by = /\bBY\b|ATTRIBUTION/.test(upper);
  let licenseId: string;
  if (cc0) licenseId = 'CC0';
  else if (by) licenseId = `CC-BY${nc ? '-NC' : ''}${nd ? '-ND' : ''}${sa ? '-SA' : ''}`;
  else if (/MIT/.test(upper)) licenseId = 'MIT';
  else if (/APACHE/.test(upper)) licenseId = 'Apache-2.0';
  else licenseId = text;
  const known = cc0 || by || licenseId === 'MIT' || licenseId === 'Apache-2.0';
  return {
    licenseId,
    licenseVersion: version,
    commercialRedistribution: known && !nc,
    alterationsPermitted: known && !nd,
    attributionRequired: !cc0,
    aiProcessingPermitted: known && !nd,
    known,
  };
}
