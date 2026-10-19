/**
 * §7.4 AI organisation suggestions (`adminAssetSuggestion*`): a review queue over `asset_suggestions`. Nothing
 * is ever applied without a human decision: `generate` only enqueues `infer_metadata` jobs; `decide` / `bulk-decide`
 * record `approved` / `rejected` (the DB trigger stamps reviewer + time) and, on approval, the API applies the
 * suggested value to the lesson for the kinds it knows how to map — `applied` is true ONLY when a lesson field was
 * actually written and a `content_revisions` row recorded. Confidence is shown as reported, never turned into a score.
 */
import {
  AssetSuggestionDecideRequestSchema,
  AssetSuggestionDecideResponseSchema,
  AssetSuggestionResponseSchema,
  AssetSuggestionsBulkDecideRequestSchema,
  AssetSuggestionsBulkDecideResponseSchema,
  AssetSuggestionsGenerateRequestSchema,
  AssetSuggestionsGenerateResponseSchema,
  AssetSuggestionsListQuerySchema,
  AssetSuggestionsListResponseSchema,
  UuidSchema,
  isSourceLanguageCode,
  isVarietyId,
  type AssetSuggestionDto,
  type ContentRevisionRef,
  type LearnerLevel,
} from '@langquest/contracts';
import type { AssetSuggestionRow } from '@langquest/db/repositories/asset-suggestions';
import type { Row, Update } from '@langquest/db/types';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { currentRevision, recordRevision } from '../../lib/content';
import type { RequestServices } from '../../services/context';

const IdParams = z.object({ id: UuidSchema });
const PENDING = new Set(['draft', 'review_needed', 'in_review']);
const LEVELS = new Set(['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced']);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Current value of the lesson field(s) a suggestion targets (null when unknown / no lesson). */
function currentValueFor(row: AssetSuggestionRow, lesson: Row<'audio_lessons'> | null): unknown {
  if (!lesson) return null;
  switch (row.kind) {
    case 'level':
      return { value: lesson.level };
    case 'tags':
      return { tags: lesson.tags };
    case 'topics':
      return { topic: lesson.topic };
    case 'language':
      return { instructionLanguageCode: lesson.instruction_language_code, spokenLanguageCodes: lesson.spoken_language_codes };
    case 'variety':
      return { varietyId: lesson.target_variety_id, regionalDialect: lesson.regional_dialect };
    case 'description':
      return { descriptionTranslations: lesson.description_translations };
    case 'lesson_structure':
      return { titleTranslations: lesson.title_translations, sortOrder: lesson.sort_order, episodeNumber: lesson.episode_number, chapterId: lesson.chapter_id };
    case 'metadata':
      return { titleTranslations: lesson.title_translations, descriptionTranslations: lesson.description_translations, topic: lesson.topic, tags: lesson.tags, level: lesson.level };
    default:
      return null;
  }
}

function toDto(row: AssetSuggestionRow, lesson: Row<'audio_lessons'> | null): AssetSuggestionDto {
  return AssetSuggestionResponseSchema.parse({
    id: row.id,
    mediaAssetId: row.media_asset_id,
    lessonId: row.lesson_id,
    jobId: row.job_id,
    kind: row.kind,
    suggestion: obj(row.suggestion),
    currentValue: currentValueFor(row, lesson),
    confidence: row.confidence,
    provenance: obj(row.provenance),
    reviewStatus: row.review_status,
    reviewerId: row.reviewer_id,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function lessonsById(s: RequestServices, rows: readonly AssetSuggestionRow[]): Promise<Map<string, Row<'audio_lessons'>>> {
  const ids = [...new Set(rows.map((r) => r.lesson_id).filter((v): v is string => v !== null))];
  if (!ids.length) return new Map();
  const res = await s.service.from('audio_lessons').select('*').in('id', ids);
  return new Map((res.data ?? []).map((l) => [l.id, l]));
}

/**
 * Translate an approved suggestion into a lesson patch. Returns null when the kind has no safe mapping (the decision is
 * still recorded; the editor applies it by hand). Language-tagged text is only written under its OWN language code.
 */
function lessonPatchFor(kind: string, suggestion: Json, lesson: Row<'audio_lessons'>): Update<'audio_lessons'> | null {
  switch (kind) {
    case 'level': {
      const value = typeof suggestion.value === 'string' ? suggestion.value : null;
      return value && LEVELS.has(value) ? { level: value as LearnerLevel } : null;
    }
    case 'tags': {
      const tags = strings(suggestion.tags).map((t) => t.trim()).filter(Boolean);
      return tags.length ? { tags: [...new Set([...lesson.tags, ...tags])] } : null;
    }
    case 'topics': {
      const topics = strings(suggestion.topics).map((t) => t.trim()).filter(Boolean);
      return topics.length ? { topic: topics[0]!, tags: [...new Set([...lesson.tags, ...topics.slice(1)])] } : null;
    }
    case 'description': {
      const text = typeof suggestion.text === 'string' ? suggestion.text.trim() : '';
      const code = typeof suggestion.languageCode === 'string' ? suggestion.languageCode : null;
      if (!text || !code || !isSourceLanguageCode(code)) return null;
      return { description_translations: { ...obj(lesson.description_translations), [code]: text } as never };
    }
    case 'language': {
      const instruction = obj(suggestion.instructionLanguage);
      const code = typeof instruction.code === 'string' ? instruction.code : null;
      const spoken = (Array.isArray(suggestion.likelyLanguages) ? suggestion.likelyLanguages : []).map((l) => (typeof (l as Json).code === 'string' ? ((l as Json).code as string) : null)).filter((v): v is string => v !== null);
      const patch: Update<'audio_lessons'> = {};
      if (code && isSourceLanguageCode(code)) patch.instruction_language_code = code;
      if (spoken.length) patch.spoken_language_codes = [...new Set(spoken)];
      return Object.keys(patch).length ? patch : null;
    }
    case 'variety': {
      const varietyId = typeof suggestion.varietyId === 'string' ? suggestion.varietyId : null;
      return varietyId && isVarietyId(varietyId) ? { target_variety_id: varietyId } : null;
    }
    case 'lesson_structure': {
      const code = typeof suggestion.languageCode === 'string' ? suggestion.languageCode : null;
      const patch: Update<'audio_lessons'> = {};
      if (typeof suggestion.title === 'string' && suggestion.title.trim() && code && isSourceLanguageCode(code)) patch.title_translations = { ...obj(lesson.title_translations), [code]: suggestion.title.trim() } as never;
      if (typeof suggestion.episodeNumber === 'number' && Number.isInteger(suggestion.episodeNumber) && suggestion.episodeNumber >= 0) patch.episode_number = suggestion.episodeNumber;
      return Object.keys(patch).length ? patch : null;
    }
    default:
      return null;
  }
}

/** Approve + apply one pending suggestion; returns the written revision (null when nothing could be applied). */
async function applyApproved(s: RequestServices, row: AssetSuggestionRow): Promise<ContentRevisionRef | null> {
  if (!row.lesson_id) return null;
  const lesson = (await s.service.from('audio_lessons').select('*').eq('id', row.lesson_id).maybeSingle()).data;
  if (!lesson) return null;
  if (lesson.state === 'published') return null; // published content changes only through the publish flow
  const patch = lessonPatchFor(row.kind, obj(row.suggestion), lesson);
  if (!patch) return null;
  await s.repos.audioLibrary.updateLesson(lesson.id, patch);
  const revision = await recordRevision(s, 'audio_lessons', lesson.id, { suggestionApplied: row.id, kind: row.kind, patch: patch as Record<string, unknown> }, `asset suggestion ${row.id}`);
  return { entityTable: 'audio_lessons', entityId: lesson.id, revision };
}

export function registerSuggestionRoutes(define: DefineRoute): void {
  define('adminAssetSuggestionsList', {}, async (c) => {
    const q = parseQuery(c, AssetSuggestionsListQuerySchema);
    const s = c.get('services')!;
    const page = await s.repos.assetSuggestions.listPaged({ reviewStatus: q.reviewStatus, kind: q.kind, mediaAssetId: q.mediaAssetId, lessonId: q.lessonId, jobId: q.jobId, minConfidence: q.minConfidence, cursor: q.cursor, limit: q.limit });
    const lessons = await lessonsById(s, page.items);
    return respondOk(c, AssetSuggestionsListResponseSchema.parse({ items: page.items.map((r) => toDto(r, r.lesson_id ? (lessons.get(r.lesson_id) ?? null) : null)), nextCursor: page.nextCursor, total: null }));
  });

  define('adminAssetSuggestionsGenerate', { role: 'contentEditor', timeoutMs: 55_000 }, async (c) => {
    const body = await parseBody(c, AssetSuggestionsGenerateRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    let assetIds = body.assetIds ?? [];
    if (body.filter) {
      let query = s.service.from('media_assets').select('id').eq('kind', 'audio').neq('disposition', 'deleted').limit(500);
      if (body.filter.status) query = query.eq('state', body.filter.status);
      if (body.filter.legacyPathPrefix) query = query.like('legacy_path', `${body.filter.legacyPathPrefix}%`);
      if (body.filter.uploadedAfter) query = query.gte('created_at', body.filter.uploadedAfter);
      if (body.filter.uploadedBefore) query = query.lte('created_at', body.filter.uploadedBefore);
      const res = await query;
      if (res.error) throw problem.internal(`Could not select assets: ${res.error.message}`);
      assetIds = [...new Set([...assetIds, ...(res.data ?? []).map((a) => a.id)])];
    }
    const skipped: { assetId: string; reason: string }[] = [];
    const jobIds: string[] = [];
    let queuedAssets = 0;
    let replayed = true;
    for (const assetId of assetIds.slice(0, 500)) {
      const asset = await s.repos.rights.getAsset(assetId);
      if (!asset) {
        skipped.push({ assetId, reason: 'asset not found' });
        continue;
      }
      if (asset.disposition !== 'active') {
        skipped.push({ assetId, reason: `asset is ${asset.disposition}` });
        continue;
      }
      if (asset.kind !== 'audio') {
        skipped.push({ assetId, reason: `asset is ${asset.kind}; suggestions need audio` });
        continue;
      }
      if (!body.force) {
        const pending = await s.repos.assetSuggestions.listForAsset(assetId, { reviewStatus: 'review_needed' });
        if (pending.some((p) => body.kinds.includes(p.kind as (typeof body.kinds)[number]))) {
          skipped.push({ assetId, reason: 'pending suggestions exist (pass force to re-run)' });
          continue;
        }
      }
      const key = `infer_metadata:${assetId}:${body.idempotencyKey}`;
      const before = (await s.service.from('processing_jobs').select('id').eq('idempotency_key', key).maybeSingle()).data;
      const job = await s.repos.processingJobs.enqueue({ jobType: 'infer_metadata', idempotencyKey: key, parentAssetId: assetId, requestedBy: principal.userId, provider: 'openrouter', params: { assetId, mode: 'all', kinds: body.kinds, force: body.force } });
      if (!before) replayed = false;
      if (s.config.env.JOBS_BACKEND === 'cloudflare_queues' && s.config.bindings.JOBS_QUEUE && !before) await s.config.bindings.JOBS_QUEUE.send({ jobId: job.id, jobType: 'infer_metadata' });
      jobIds.push(job.id);
      queuedAssets += 1;
    }
    if (jobIds.length === 0) replayed = false;
    s.audit({ action: 'asset_suggestions.generate', entityTable: 'processing_jobs', entityId: null, after: { idempotencyKey: body.idempotencyKey, kinds: body.kinds, queuedAssets, skipped: skipped.length, replayed } });
    return respondOk(c, AssetSuggestionsGenerateResponseSchema.parse({ jobIds, queuedAssets, skipped: skipped.slice(0, 200), replayed }), replayed ? 200 : 202);
  });

  define('adminAssetSuggestionsBulkDecide', { role: 'contentEditor', timeoutMs: 55_000 }, async (c) => {
    const body = await parseBody(c, AssetSuggestionsBulkDecideRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const rows = await s.repos.assetSuggestions.getByIds(body.suggestionIds);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const skipped: { id: string; reason: string }[] = [];
    const decidable: string[] = [];
    let alreadyDecided = 0;
    for (const id of body.suggestionIds) {
      const row = byId.get(id);
      if (!row) skipped.push({ id, reason: 'not found' });
      else if (!PENDING.has(row.review_status)) {
        alreadyDecided += 1;
        skipped.push({ id, reason: `already ${row.review_status}` });
      } else decidable.push(id);
    }
    const status = body.decision === 'approve' ? 'approved' : 'rejected';
    const decided = await s.repos.assetSuggestions.decideMany(decidable, { reviewStatus: status, reviewerId: principal.userId, note: body.note ?? null });
    const revisions: ContentRevisionRef[] = [];
    if (body.decision === 'approve') for (const row of decided) {
      const ref = await applyApproved(s, row);
      if (ref) revisions.push(ref);
    }
    const replayed = decided.length === 0 && alreadyDecided > 0 && alreadyDecided === body.suggestionIds.length - skipped.filter((k) => k.reason === 'not found').length;
    s.audit({ action: 'asset_suggestions.bulk_decide', entityTable: 'asset_suggestions', entityId: null, after: { idempotencyKey: body.idempotencyKey, decision: body.decision, decided: decided.length, applied: revisions.length, skipped: skipped.length } });
    return respondOk(c, AssetSuggestionsBulkDecideResponseSchema.parse({ approved: status === 'approved' ? decided.length : 0, rejected: status === 'rejected' ? decided.length : 0, skipped: skipped.slice(0, 200), revisions, replayed }));
  });

  define('adminAssetSuggestionGet', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    const row = await s.repos.assetSuggestions.getById(id);
    if (!row) throw problem.notFound('Asset suggestion');
    const lessons = await lessonsById(s, [row]);
    return respondOk(c, toDto(row, row.lesson_id ? (lessons.get(row.lesson_id) ?? null) : null));
  });

  define('adminAssetSuggestionDecide', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, AssetSuggestionDecideRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    let row = await s.repos.assetSuggestions.getById(id);
    if (!row) throw problem.notFound('Asset suggestion');
    const status = body.decision === 'approve' ? 'approved' : 'rejected';
    if (!PENDING.has(row.review_status)) {
      // Already decided: a matching decision replays the stored outcome, a different one is a conflict.
      if (row.review_status !== status) throw problem.conflict(`Suggestion was already ${row.review_status}`, { reviewStatus: row.review_status });
      const lessons = await lessonsById(s, [row]);
      return respondOk(c, AssetSuggestionDecideResponseSchema.parse({ suggestion: toDto(row, row.lesson_id ? (lessons.get(row.lesson_id) ?? null) : null), applied: false, revision: null, replayed: true }));
    }
    if (body.expectedRevision !== undefined) {
      // Suggestions are not versioned in content_revisions; `expectedRevision` guards the TARGET lesson's revision.
      if (!row.lesson_id) throw problem.validation('expectedRevision needs a suggestion that targets a lesson');
      const current = await currentRevision(s, 'audio_lessons', row.lesson_id);
      if (current !== body.expectedRevision) throw problem.precondition(`Lesson revision is ${current}, expected ${body.expectedRevision}`, { currentRevision: current });
    }
    if (body.overrideSuggestion && body.decision === 'approve') {
      row = await s.repos.assetSuggestions.update(id, { suggestion: body.overrideSuggestion as never });
    }
    const decided = await s.repos.assetSuggestions.decide(id, { reviewStatus: status, reviewerId: principal.userId, note: body.note ?? null });
    const revision = body.decision === 'approve' ? await applyApproved(s, decided) : null;
    const lessons = await lessonsById(s, [decided]);
    s.audit({ action: 'asset_suggestion.decide', entityTable: 'asset_suggestions', entityId: id, before: { reviewStatus: row.review_status }, after: { idempotencyKey: body.idempotencyKey, decision: body.decision, overridden: Boolean(body.overrideSuggestion), applied: revision !== null, revision } });
    return respondOk(c, AssetSuggestionDecideResponseSchema.parse({ suggestion: toDto(decided, decided.lesson_id ? (lessons.get(decided.lesson_id) ?? null) : null), applied: revision !== null, revision, replayed: false }));
  });
}
