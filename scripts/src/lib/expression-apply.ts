/**
 * Upsert expression drafts (Tatoeba imports, content-factory chapters) into the database
 * (`content_rights`, `expressions`, `expression_forms`, `expression_translations`) through
 * the `@langquest/db` service client.
 *
 * Idempotent: a draft whose `draftId` already exists in `expressions.script_annotations`
 * is skipped. Rows land with the caller's `origin` (`public_dataset` / `ai_generated`),
 * `state = 'review_needed'`, `reviewed = false`, translations as `qa_state = 'needs_review'`.
 * Audio is recorded as a reference inside `script_annotations.audioRefs` (never downloaded,
 * no `media_assets` row).
 */
import type { ContentOrigin } from '@langquest/contracts';
import type { DbClient, Insert } from '@langquest/db';
import { createRepositories } from '@langquest/db';
import type { ExpressionDraft } from './drafts';
import { ensureIntents } from './db';
import { SCRIPT_FOR_LANGUAGE } from './scripts-map';

export interface ApplyResult {
  inserted: number;
  skippedExisting: number;
  skippedNoVariety: number;
  skippedNoIntent: number;
  rightsCreated: number;
  translationsUpserted: number;
  errors: Array<{ draftId: string; message: string }>;
}

const rightsKey = (r: ExpressionDraft['rights']): string => `${r.licenseId}|${r.authors.join(',')}|${r.originUrl ?? ''}`;

export interface ApplyOptions {
  dryRun?: boolean;
  /** `public_dataset` for corpus imports, `ai_generated` for content-factory drafts. */
  origin?: ContentOrigin;
}

export async function applyExpressionDrafts(db: DbClient, drafts: readonly ExpressionDraft[], options: ApplyOptions = {}): Promise<ApplyResult> {
  const repos = createRepositories(db);
  const result: ApplyResult = { inserted: 0, skippedExisting: 0, skippedNoVariety: 0, skippedNoIntent: 0, rightsCreated: 0, translationsUpserted: 0, errors: [] };
  const intentIds = options.dryRun ? new Map<string, string>() : await ensureIntents(db);
  const rightsCache = new Map<string, string>();

  for (const draft of drafts) {
    if (!draft.target.varietyId) {
      result.skippedNoVariety += 1;
      continue;
    }
    if (!draft.curation.intentKey) {
      result.skippedNoIntent += 1;
      continue;
    }
    try {
      const existing = await db.from('expressions').select('id').contains('script_annotations', { provenance: { draftId: draft.draftId } }).limit(1);
      if (existing.error) throw new Error(existing.error.message);
      if (existing.data && existing.data.length > 0) {
        result.skippedExisting += 1;
        continue;
      }
      if (options.dryRun) {
        result.inserted += 1;
        continue;
      }
      const intentId = intentIds.get(draft.curation.intentKey);
      if (!intentId) throw new Error(`intent ${draft.curation.intentKey} missing in communicative_intents`);

      const key = rightsKey(draft.rights);
      let rightsId = rightsCache.get(key);
      if (!rightsId) {
        const row: Insert<'content_rights'> = {
          origin_url: draft.rights.originUrl,
          authors: draft.rights.authors,
          speakers: [],
          permission_grant: `${draft.provenance.dataset} export ${draft.provenance.snapshotId}: ${draft.rights.licenseId} (${draft.rights.licenseSource})`,
          license_id: draft.rights.licenseId,
          license_version: draft.rights.licenseVersion,
          commercial_redistribution: draft.rights.commercialRedistribution,
          attribution_required: draft.rights.attributionRequired,
          attribution_text: draft.rights.attributionText,
          alterations_permitted: draft.rights.alterationsPermitted,
          ai_processing_permitted: draft.rights.aiProcessingPermitted,
          voice_rights: 'none',
          verified: false,
        };
        const created = await repos.rights.create(row);
        rightsId = created.id;
        rightsCache.set(key, rightsId);
        result.rightsCreated += 1;
      }

      const expression = await repos.curriculum.insertExpression({
        intent_id: intentId,
        target_variety_id: draft.target.varietyId,
        canonical_text: draft.target.text,
        register: draft.curation.register,
        difficulty: draft.curation.difficulty,
        scenario_tags: draft.curation.scenarioTags,
        script_annotations: {
          provenance: { draftId: draft.draftId, dataset: draft.provenance.dataset, snapshotId: draft.provenance.snapshotId, upstreamId: draft.target.upstreamId, importer: draft.provenance.importer, importedAt: draft.provenance.importedAt },
          curation: { intentConfidence: draft.curation.intentConfidence, alternativeIntentKeys: draft.curation.alternativeIntentKeys, flags: draft.curation.flags, varietyAssignment: draft.target.varietyAssignment },
          audioRefs: draft.audio,
        },
        phonetic_annotations: {},
        reviewed: false,
        content_rights_id: rightsId,
        origin: options.origin ?? 'public_dataset',
        state: 'review_needed',
      });

      const forms = draft.forms && draft.forms.length ? draft.forms : (() => {
        const script = SCRIPT_FOR_LANGUAGE[draft.target.languageCode] ?? null;
        return script ? [{ script, transliterationScheme: null, text: draft.target.text }] : [];
      })();
      for (const f of forms) {
        const form = await db.from('expression_forms').insert({ expression_id: expression.id, script: f.script, transliteration_scheme: f.transliterationScheme, text: f.text, word_alignment: [], tone_markers: null, ipa: null });
        if (form.error) throw new Error(`expression_forms: ${form.error.message}`);
      }

      for (const t of draft.translations) {
        await repos.curriculum.upsertExpressionTranslation({
          expression_id: expression.id,
          source_language_code: t.sourceLanguageCode,
          natural_meaning: t.text,
          context_note: t.contextNote ?? t.rights?.attributionText ?? null,
          literal_gloss: t.literalGloss ?? null,
          qa_state: 'needs_review',
        });
        result.translationsUpserted += 1;
      }
      result.inserted += 1;
    } catch (err) {
      result.errors.push({ draftId: draft.draftId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
