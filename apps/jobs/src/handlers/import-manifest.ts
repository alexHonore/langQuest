/**
 * `import_manifest` — apply CSV/JSON label rows (§7.3 import/export CSV) to already-imported assets and
 * their lessons. Rows match by `assetId`, `storageKey` or `legacyPath`; recognised fields are merged onto
 * the lesson (tags are unioned, existing titles kept unless the row provides one). Every change is written
 * to `audit_logs` with before/after so it stays reversible. `dryRun` (default) only reports matches.
 *
 * Titles / descriptions are stored under an explicit language: `params.titleLanguage`, else the row's
 * `instructionLanguage`, else the lesson's `instruction_language_code`. There is no English default (§2.1):
 * a row whose text fields have no resolvable language keeps its other fields and reports a
 * `title_language_missing` validation error for the skipped ones.
 */
import { z } from 'zod';
import { ImportManifestRowSchema, type ImportManifestRow } from '@langquest/contracts';
import type { Update } from '@langquest/db';
import { parseCsvManifest, parseJsonManifest } from '@langquest/media';
import type { LessonRow, MediaAssetRow } from '../db';
import { JobFailure, type JobContext, type JobHandler } from '../queue/types';

export const ImportManifestParamsSchema = z
  .object({
    format: z.enum(['csv', 'json']).default('json'),
    rows: z.array(z.unknown()).max(5000).optional(),
    /** Object-store key of the manifest file (e.g. the key an admin upload landed on). */
    manifestKey: z.string().max(1024).optional(),
    /** Upload session whose object holds the manifest. */
    uploadId: z.string().uuid().optional(),
    dryRun: z.boolean().default(true),
    /** Language of `lessonTitle` / `description` / `chapterTitle` in the rows; defaults to each row's `instructionLanguage`, then the lesson's. Never English by default. */
    titleLanguage: z.string().min(2).max(8).optional(),
  })
  .refine((v) => v.rows !== undefined || v.manifestKey !== undefined || v.uploadId !== undefined, { message: 'rows, manifestKey or uploadId is required' });
export type ImportManifestParams = z.infer<typeof ImportManifestParamsSchema>;

async function loadRows(ctx: JobContext<ImportManifestParams>): Promise<{ rows: ImportManifestRow[]; validationErrors: Array<{ row: number; field: string; message: string }> }> {
  const p = ctx.params;
  const validationErrors: Array<{ row: number; field: string; message: string }> = [];
  if (p.rows) {
    const rows: ImportManifestRow[] = [];
    p.rows.forEach((raw, i) => {
      const parsed = ImportManifestRowSchema.safeParse(raw);
      if (parsed.success) rows.push(parsed.data);
      else for (const issue of parsed.error.issues) validationErrors.push({ row: i, field: issue.path.join('.') || '(row)', message: issue.message });
    });
    return { rows, validationErrors };
  }
  let key = p.manifestKey ?? null;
  if (!key && p.uploadId) {
    const upload = await ctx.services.db.getUpload(p.uploadId);
    if (!upload) throw new JobFailure('upload_not_found', `upload ${p.uploadId} not found`, { retry: false });
    key = upload.storage_key;
  }
  const bytes = key ? await ctx.services.store.getBytes(key) : null;
  if (!bytes) throw new JobFailure('manifest_missing', `manifest object ${key ?? '(none)'} not found`, { retry: false });
  ctx.cost.storage('get', bytes.byteLength);
  const text = new TextDecoder().decode(bytes);
  const parsed = p.format === 'csv' || (key && key.toLowerCase().endsWith('.csv')) ? parseCsvManifest(text) : parseJsonManifest(text);
  return { rows: parsed.rows, validationErrors: parsed.errors };
}

/** Language the row's free-text fields are written in (`null` = unknown → those fields are skipped). */
export function titleLanguageFor(row: Pick<ImportManifestRow, 'instructionLanguage'>, lesson: Pick<LessonRow, 'instruction_language_code'> | null, explicit: string | null | undefined): string | null {
  return explicit ?? row.instructionLanguage ?? lesson?.instruction_language_code ?? null;
}

/** Lesson patch for a row. With `titleLanguage === null` the title / description fields are left untouched (reported by the caller). */
export function lessonPatchFromRow(row: ImportManifestRow, lesson: LessonRow, titleLanguage: string | null): Update<'audio_lessons'> {
  const patch: Update<'audio_lessons'> = {};
  if (row.lessonTitle && titleLanguage) patch.title_translations = { ...((lesson.title_translations as object) ?? {}), [titleLanguage]: row.lessonTitle } as never;
  if (row.description && titleLanguage) patch.description_translations = { ...((lesson.description_translations as object) ?? {}), [titleLanguage]: row.description } as never;
  if (row.lessonOrder !== undefined) patch.sort_order = row.lessonOrder;
  if (row.episodeNumber !== undefined) patch.episode_number = row.episodeNumber;
  if (row.level) patch.level = row.level;
  if (row.targetVarietyId) patch.target_variety_id = row.targetVarietyId;
  if (row.instructionLanguage) patch.instruction_language_code = row.instructionLanguage;
  if (row.spokenLanguageCodes) patch.spoken_language_codes = row.spokenLanguageCodes;
  if (row.regionalDialect) patch.regional_dialect = row.regionalDialect;
  if (row.topic) patch.topic = row.topic;
  if (row.tags) patch.tags = [...new Set([...(lesson.tags ?? []), ...row.tags])];
  if (row.scene) patch.scene = row.scene;
  return patch;
}

export const importManifestHandler: JobHandler<ImportManifestParams> = {
  name: 'import_manifest',
  jobTypes: ['import_manifest'],
  runtime: 'any',
  paramsSchema: ImportManifestParamsSchema,
  async run(ctx) {
    const { db } = ctx.services;
    const p = ctx.params;
    const { rows, validationErrors } = await loadRows(ctx);
    await ctx.progress(10, `${rows.length} rows`);

    const unmatched: Array<{ row: number; reason: string }> = [];
    const matches: Array<{ row: number; assetId: string; lessonIds: string[]; patch: Update<'audio_lessons'>; chapterMove: string | null }> = [];
    const touchedAssets: string[] = [];
    let applied = 0;

    for (const [i, row] of rows.entries()) {
      let asset: MediaAssetRow | null = null;
      if (row.assetId) asset = await db.getAsset(row.assetId);
      if (!asset && row.storageKey) asset = (await db.findAssetByStorageKey(row.storageKey)) ?? (await db.findAssetByLegacyPath(row.storageKey));
      if (!asset && row.legacyPath) asset = await db.findAssetByLegacyPath(row.legacyPath);
      if (!asset) {
        unmatched.push({ row: i, reason: 'no asset matches assetId / storageKey / legacyPath' });
        continue;
      }
      const lessonIds = await db.findLessonIdsForAsset(asset.id);
      if (!lessonIds.length) {
        unmatched.push({ row: i, reason: `asset ${asset.id} is not attached to a lesson` });
        continue;
      }
      for (const lessonId of lessonIds) {
        const detail = await db.getLesson(lessonId);
        if (!detail) continue;
        const titleLanguage = titleLanguageFor(row, detail.lesson, p.titleLanguage);
        if (!titleLanguage) {
          for (const field of ['lessonTitle', 'description', 'chapterTitle'] as const) {
            if (row[field]) validationErrors.push({ row: i, field, message: 'title_language_missing: set titleLanguage, the row instructionLanguage or the lesson instruction language (no English default)' });
          }
        }
        const patch = lessonPatchFromRow(row, detail.lesson, titleLanguage);
        let chapterMove: string | null = null;
        if (row.chapterTitle || row.chapterOrder !== undefined || row.collectionId) {
          // Chapter moves need the collection; look it up through the current chapter.
          const collectionId = row.collectionId ?? null;
          if (row.chapterTitle && collectionId && titleLanguage) {
            const chapter = (await db.findChapterByTitle(collectionId, row.chapterTitle, titleLanguage)) ?? (await db.upsertChapter({ collection_id: collectionId, title_translations: { [titleLanguage]: row.chapterTitle } as never, sort_order: row.chapterOrder ?? 0, state: 'imported_draft' } as never));
            if (chapter.id !== detail.lesson.chapter_id) {
              patch.chapter_id = chapter.id;
              chapterMove = chapter.id;
            }
          } else if (row.chapterTitle && !collectionId) unmatched.push({ row: i, reason: 'chapterTitle needs collectionId to resolve the chapter' });
        }
        matches.push({ row: i, assetId: asset.id, lessonIds: [lessonId], patch, chapterMove });
        if (!p.dryRun && Object.keys(patch).length) {
          const before = { ...detail.lesson };
          const after = await db.updateLesson(lessonId, patch);
          await db.recordAudit({ actor_id: ctx.job.requested_by, actor_role: ctx.job.requested_by ? 'content_editor' : 'jobs', action: 'import_manifest.update_lesson', entity_table: 'audio_lessons', entity_id: lessonId, before: before as never, after: after as never, request_id: ctx.job.id });
          applied += 1;
          touchedAssets.push(asset.id);
        }
      }
      await ctx.progress(10 + Math.round(((i + 1) / Math.max(1, rows.length)) * 88));
    }
    await ctx.progress(100);
    return {
      output: { dryRun: p.dryRun, rowCount: rows.length, matched: matches.length, applied, unmatched: unmatched.slice(0, 200), validationErrors: validationErrors.slice(0, 200), sample: matches.slice(0, 50) },
      outputAssetIds: [...new Set(touchedAssets)],
    };
  },
};
