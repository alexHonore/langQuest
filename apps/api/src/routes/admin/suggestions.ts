/**
 * §7.4 AI organisation suggestions (`adminAssetSuggestion*`): a review queue over `asset_suggestions`. Nothing
 * is ever applied without a human decision: `generate` only enqueues `infer_metadata` jobs; `decide` / `bulk-decide`
 * record `approved` / `rejected` (the DB trigger stamps reviewer + time) and, on approval, the API applies the
 * suggested value to the lesson for the kinds it knows how to map — `applied` is true ONLY when a lesson field was
 * actually written and a `content_revisions` row recorded. Confidence is shown as reported, never turned into a score.
 *
 * An applied suggestion is a lesson edit like any other (R-7.3-04): the lesson write is conditional on the row version
 * that was read (`updateIfUnchanged`; a concurrent edit is re-read and the patch recomputed on the current row, never
 * overwritten), and its `audio_lessons` revision carries the restorable snapshot of the lesson as written, so
 * `POST /v1/admin/content/:id/rollback` undoes it. Suggestions themselves are not versioned.
 *
 * A single decision is ONE conditional UPDATE (`assetSuggestions.decide`, pending status in the filter) that also carries
 * the editor's payload override, so the payload of record is always the one the deciding editor saw, and the lesson is
 * written only after that decision landed (decide, then apply). Of two editors deciding at the same moment exactly one
 * decision lands; the other is a replay when it asked for the same outcome (same status and, for an approval, the payload
 * now stored is the one it approved) and a 409 with the stored status otherwise.
 *
 * `expectedRevision` on the single decide route holds the apply to THAT lesson revision (`guardedEdit`: revision
 * `expectedRevision + 1` is claimed before the conditional write). A lesson already past it is a 412 with nothing
 * decided; a lesson edited in the moment between that check and the apply leaves the decision recorded and nothing
 * applied (`applied: false`), never written over a revision the editor did not see. There is no re-read.
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
import { SuggestionAlreadyDecidedError, type AssetSuggestionRow } from '@langquest/db/repositories/asset-suggestions';
import type { Row, Update } from '@langquest/db/types';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { ApiProblem, problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { currentRevision } from '../../lib/content';
import type { RequestServices } from '../../services/context';
import { RowChangedError, guardedEdit, recordRestorableRevision, restorableSnapshot, updateIfUnchanged } from './content';

const IdParams = z.object({ id: UuidSchema });
const PENDING = new Set(['draft', 'review_needed', 'in_review']);
const LEVELS = new Set(['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced']);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Structural JSON equality, key order ignored (jsonb stores object keys in its own order). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const [ka, kb] = [Object.keys(a), Object.keys(b)];
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual((a as Json)[k], (b as Json)[k]));
}

/**
 * A decision on a suggestion that is no longer pending is a replay when it asks for what is stored: the same status and,
 * for an approval, the same payload (`approvedPayload`: the editor's override, else the payload as their request read it).
 * Anything else is a different decision (409). So an approval that lost to an approval of ANOTHER payload (an override on
 * either side) is not a replay: the payload of record is not the one it approved.
 */
const isReplayOf = (stored: AssetSuggestionRow, status: 'approved' | 'rejected', approvedPayload: AssetSuggestionRow['suggestion'] | undefined): boolean =>
  stored.review_status === status && (status !== 'approved' || jsonEqual(approvedPayload, stored.suggestion));

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

/** Reads of the lesson an approved suggestion is applied to while other writers keep changing it. */
const APPLY_ATTEMPTS = 3;

/**
 * Approve + apply one pending suggestion; returns the written revision (null when nothing could be applied). The patch
 * is computed from the lesson as read and written only if that row is unchanged. The revision snapshot is the lesson as
 * written.
 * - Without `expectedRevision`: a concurrent edit makes it re-read the lesson and recompute (tags merge into the
 *   CURRENT tags), up to `APPLY_ATTEMPTS` reads.
 * - With `expectedRevision`: `guardedEdit` claims revision `expectedRevision + 1` before the conditional write, so a
 *   revision recorded or a row written in between is a 412 (the claim is voided); no re-read, no retry. The caller has
 *   already recorded the decision, so it turns that 412 into `applied: false`.
 */
async function applyApproved(s: RequestServices, row: AssetSuggestionRow, expectedRevision?: number): Promise<ContentRevisionRef | null> {
  if (!row.lesson_id) return null;
  for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt += 1) {
    const read = await s.service.from('audio_lessons').select('*').eq('id', row.lesson_id).maybeSingle();
    if (read.error) throw problem.internal(`Could not read the lesson: ${read.error.message}`);
    const lesson = read.data;
    if (!lesson) return null;
    if (lesson.state === 'published') return null; // published content changes only through the publish flow
    const patch = lessonPatchFor(row.kind, obj(row.suggestion), lesson);
    if (!patch) return null;
    const diff = { suggestionApplied: row.id, kind: row.kind, patch: patch as Record<string, unknown> };
    const note = `asset suggestion ${row.id}`;
    if (expectedRevision !== undefined) {
      const snapshot = restorableSnapshot('audio_lessons', { ...lesson, ...patch } as Record<string, unknown>);
      const { revision } = await guardedEdit(s, { table: 'audio_lessons', id: lesson.id, what: 'Lesson', expected: expectedRevision, diff, snapshot, note }, () => updateIfUnchanged(s, 'audio_lessons', lesson, patch as Record<string, unknown>, 'Lesson'));
      return { entityTable: 'audio_lessons', entityId: lesson.id, revision };
    }
    let written: Row<'audio_lessons'>;
    try {
      written = (await updateIfUnchanged(s, 'audio_lessons', lesson, patch as Record<string, unknown>, 'Lesson')) as Row<'audio_lessons'>;
    } catch (error) {
      if (error instanceof RowChangedError) continue;
      throw error;
    }
    const revision = await recordRestorableRevision(s, 'audio_lessons', lesson.id, diff, { row: written, note });
    return { entityTable: 'audio_lessons', entityId: lesson.id, revision };
  }
  // The decision stands (it is the reviewer's); the lesson kept changing, so nothing was applied and `applied` says so.
  s.log.warn('asset_suggestion.apply_contended', { suggestionId: row.id, lessonId: row.lesson_id, attempts: APPLY_ATTEMPTS });
  return null;
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
    const row = await s.repos.assetSuggestions.getById(id);
    if (!row) throw problem.notFound('Asset suggestion');
    const approve = body.decision === 'approve';
    const status = approve ? 'approved' : 'rejected';
    // An override only means something on an approval (it is the payload being approved).
    const override = approve && body.overrideSuggestion ? (body.overrideSuggestion as AssetSuggestionRow['suggestion']) : undefined;
    // What this editor approves: their override, else the payload as this request read it.
    const approvedPayload = approve ? (override ?? row.suggestion) : undefined;
    const replay = async (stored: AssetSuggestionRow) => {
      const lessons = await lessonsById(s, [stored]);
      return respondOk(c, AssetSuggestionDecideResponseSchema.parse({ suggestion: toDto(stored, stored.lesson_id ? (lessons.get(stored.lesson_id) ?? null) : null), applied: false, revision: null, replayed: true }));
    };
    if (!PENDING.has(row.review_status)) {
      // Already decided: a matching decision replays the stored outcome, a different one is a conflict.
      if (!isReplayOf(row, status, approvedPayload)) throw problem.conflict(`Suggestion was already ${row.review_status}`, { reviewStatus: row.review_status });
      return replay(row);
    }
    if (body.expectedRevision !== undefined) {
      // Suggestions are not versioned in content_revisions; `expectedRevision` guards the TARGET lesson's revision.
      if (!row.lesson_id) throw problem.validation('expectedRevision needs a suggestion that targets a lesson');
      const current = await currentRevision(s, 'audio_lessons', row.lesson_id);
      if (current !== body.expectedRevision) throw problem.precondition(`Lesson revision is ${current}, expected ${body.expectedRevision}`, { currentRevision: current });
    }
    // Decide first, in one conditional UPDATE that also stores the override; only a decision that landed is applied.
    let decided: AssetSuggestionRow;
    try {
      decided = await s.repos.assetSuggestions.decide(id, { reviewStatus: status, reviewerId: principal.userId, note: body.note ?? null, ...(override !== undefined ? { suggestion: override } : {}) });
    } catch (error) {
      if (!(error instanceof SuggestionAlreadyDecidedError)) throw error;
      // Another decision landed between our read and our write. The same outcome is a replay (e.g. two editors who
      // approved the same payload at the same moment); a different one keeps the 409 with the stored status.
      const stored = error.currentStatus === status ? await s.repos.assetSuggestions.getById(id) : null;
      if (stored && isReplayOf(stored, status, approvedPayload)) return replay(stored);
      throw error;
    }
    let revision: ContentRevisionRef | null = null;
    if (approve) {
      try {
        revision = await applyApproved(s, decided, body.expectedRevision);
      } catch (error) {
        // `expectedRevision` only: the lesson moved past the revision the editor saw after the check above. The decision
        // is the editor's and stands; nothing was written over a revision they did not see, and `applied` says so.
        if (!(body.expectedRevision !== undefined && error instanceof ApiProblem && error.code === 'precondition_failed')) throw error;
        s.log.warn('asset_suggestion.apply_stale', { suggestionId: id, lessonId: decided.lesson_id, expectedRevision: body.expectedRevision });
      }
    }
    const lessons = await lessonsById(s, [decided]);
    s.audit({ action: 'asset_suggestion.decide', entityTable: 'asset_suggestions', entityId: id, before: { reviewStatus: row.review_status }, after: { idempotencyKey: body.idempotencyKey, decision: body.decision, overridden: override !== undefined, applied: revision !== null, revision } });
    return respondOk(c, AssetSuggestionDecideResponseSchema.parse({ suggestion: toDto(decided, decided.lesson_id ? (lessons.get(decided.lesson_id) ?? null) : null), applied: revision !== null, revision, replayed: false }));
  });
}
