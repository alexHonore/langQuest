/**
 * `import_r2_prefix` — reconcile a bulk `rclone` migration (§7.2): list objects under a prefix, parse
 * folder/file names into inherited metadata (`@langquest/media` imports), merge optional CSV/JSON sidecar
 * rows, then create draft assets (copied to hashed master keys; the legacy path is kept as metadata,
 * never as the key) plus draft collection → chapter → lesson rows. Idempotent: objects already imported
 * (by legacy path / key / content hash) are reported as `known` and skipped. `dryRun` (default) only reports.
 */
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { CourseTrackIdSchema, LearnerLevelSchema, SourceLanguageCodeSchema, VarietyIdSchema, getCourseTrack, isCourseTrackId } from '@langquest/contracts';
import type { ImportManifestRow } from '@langquest/contracts';
import type { Insert } from '@langquest/db';
import { buildMasterKey, extractAudioMetadata, parseCsvManifest, parseJsonManifest, reconcilePrefix, type ImportDefaults, type ReconciledObject } from '@langquest/media';
import type { CollectionRow, ChapterRow, MediaAssetRow } from '../db';
import { JobFailure, type JobContext, type JobHandler } from '../queue/types';
import { downloadToWorkDir, hashFile, keyHash, localized } from './common';

export const ImportR2PrefixParamsSchema = z.object({
  prefix: z.string().min(1).max(1024),
  dryRun: z.boolean().default(true),
  inheritFolderMetadata: z.boolean().default(true),
  manifestKey: z.string().max(1024).optional(),
  defaultTrackId: CourseTrackIdSchema.optional(),
  defaultVarietyId: VarietyIdSchema.optional(),
  defaultInstructionLanguage: SourceLanguageCodeSchema.optional(),
  defaultCollectionId: z.string().uuid().optional(),
  defaultCollectionTitle: z.string().max(200).optional(),
  defaultLicenseId: z.string().max(100).optional(),
  rightsOwner: z.string().max(200).optional(),
  defaultLevel: LearnerLevelSchema.optional(),
  /** Language code of the parsed titles (folder names). */
  titleLanguage: z.string().min(2).max(8).default('en'),
  maxObjects: z.number().int().min(1).max(200_000).default(20_000),
  /** Extract ID3/container metadata per file (slower on huge prefixes; always on for non-dry runs). */
  extractMetadata: z.boolean().default(true),
});
export type ImportR2PrefixParams = z.infer<typeof ImportR2PrefixParamsSchema>;

const MIME_BY_EXT: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg' };

async function loadSidecar(ctx: JobContext<ImportR2PrefixParams>, key: string): Promise<{ rows: ImportManifestRow[]; errors: Array<{ row: number; field: string; message: string }> }> {
  const bytes = await ctx.services.store.getBytes(key);
  if (!bytes) throw new JobFailure('manifest_missing', `manifest ${key} not found`, { retry: false });
  ctx.cost.storage('get', bytes.byteLength);
  const text = new TextDecoder().decode(bytes);
  const parsed = key.toLowerCase().endsWith('.json') ? parseJsonManifest(text) : parseCsvManifest(text);
  return { rows: parsed.rows, errors: parsed.errors };
}

export const importR2PrefixHandler: JobHandler<ImportR2PrefixParams> = {
  name: 'import_r2_prefix',
  jobTypes: ['import_prefix'],
  runtime: 'node',
  paramsSchema: ImportR2PrefixParamsSchema,
  async run(ctx) {
    const { db, store } = ctx.services;
    const p = ctx.params;
    const prefix = p.prefix.endsWith('/') ? p.prefix : `${p.prefix}/`;
    const listing = await store.listAll(prefix, { maxObjects: p.maxObjects });
    ctx.cost.storage('list');
    await ctx.progress(5, `listed ${listing.length} objects`);

    const sidecarKey = p.manifestKey ?? listing.find((o) => /\.(csv|json)$/i.test(o.key) && !o.key.slice(prefix.length).includes('/'))?.key ?? null;
    const sidecar = sidecarKey ? await loadSidecar(ctx, sidecarKey) : { rows: [], errors: [] };

    // Idempotency: assets already carrying a legacy path under this prefix + the audit ledger of every object
    // this handler processed before (covers duplicate blobs linked to a second lesson, whose asset row keeps
    // the first legacy path only).
    const known = await db.listAssetsByPrefix(prefix);
    const knownKeys = new Set<string>(await db.listImportedObjectKeys(prefix));
    for (const a of known) {
      if (a.legacy_path) knownKeys.add(a.legacy_path);
      knownKeys.add(a.storage_key);
    }
    const defaults: ImportDefaults = {
      ...(p.defaultVarietyId ? { targetVarietyId: p.defaultVarietyId } : p.defaultTrackId ? { targetVarietyId: getCourseTrack(p.defaultTrackId).targetVarietyId } : {}),
      ...(p.defaultInstructionLanguage ? { instructionLanguage: p.defaultInstructionLanguage } : {}),
      ...(p.defaultCollectionId ? { collectionId: p.defaultCollectionId } : {}),
      ...(p.defaultCollectionTitle ? { collectionTitle: p.defaultCollectionTitle } : {}),
      ...(p.defaultLicenseId ? { licenseId: p.defaultLicenseId } : {}),
      ...(p.rightsOwner ? { rightsOwner: p.rightsOwner } : {}),
      ...(p.defaultLevel ? { level: p.defaultLevel } : {}),
    };
    const { entries, summary } = reconcilePrefix(
      listing.map((o) => ({ key: o.key, byteLength: o.byteLength, etag: o.etag, lastModified: o.lastModified })),
      { prefix, sidecarRows: sidecar.rows, defaults, knownKeys },
    );
    const sample = entries.slice(0, 50).map((e) => ({ key: e.key, byteLength: e.byteLength, status: e.status, skipReason: e.skipReason, inferred: e.merged.values, provenance: e.merged.provenance }));
    const base = { prefix, dryRun: p.dryRun, sidecarKey, sidecarRows: sidecar.rows.length, sidecarErrors: sidecar.errors.slice(0, 100), discovered: { objects: listing.length, audio: entries.filter((e) => e.parsed.isAudio).length, sidecars: entries.filter((e) => e.parsed.isSidecar).length, alreadyImported: summary.known, unsupported: entries.filter((e) => e.status === 'skipped' && !e.parsed.isSidecar).length }, summary, sample };
    if (p.dryRun) {
      await ctx.progress(100);
      return { output: { ...base, imported: 0, linked: 0, failed: 0, failures: [] } };
    }

    // --- real import ---
    const collections = new Map<string, CollectionRow>();
    const chapters = new Map<string, ChapterRow>();
    const failures: Array<{ key: string; reason: string }> = [];
    const createdAssetIds: string[] = [];
    let imported = 0;
    let linked = 0;
    const work = entries.filter((e) => e.status === 'new');

    const ensureCollection = async (entry: ReconciledObject): Promise<CollectionRow> => {
      const v = entry.merged.values;
      if (v.collectionId) {
        const cached = collections.get(v.collectionId);
        if (cached) return cached;
        const row = await db.getCollection(v.collectionId);
        if (!row) throw new JobFailure('collection_not_found', `collection ${v.collectionId} not found`, { retry: false });
        collections.set(row.id, row);
        return row;
      }
      const title = v.collectionTitle ?? p.defaultCollectionTitle ?? prefix.replace(/\/$/, '').split('/').pop() ?? 'Imported';
      const cacheKey = `title:${title}`;
      const cached = collections.get(cacheKey);
      if (cached) return cached;
      const existing = await db.findCollectionByTitle(title, p.titleLanguage);
      const track = p.defaultTrackId && isCourseTrackId(p.defaultTrackId) ? p.defaultTrackId : null;
      const row = existing ?? (await db.upsertCollection({ title_translations: { [p.titleLanguage]: title } as never, course_track_id: track, target_variety_id: v.targetVarietyId ?? null, instruction_language_code: v.instructionLanguage ?? null, state: 'imported_draft' } as Insert<'audio_course_collections'>));
      collections.set(cacheKey, row);
      collections.set(row.id, row);
      return row;
    };
    const ensureChapter = async (collection: CollectionRow, entry: ReconciledObject): Promise<ChapterRow> => {
      const v = entry.merged.values;
      const title = v.chapterTitle ?? localized(collection.title_translations, p.titleLanguage) ?? 'Chapter 1';
      const cacheKey = `${collection.id}:${title}`;
      const cached = chapters.get(cacheKey);
      if (cached) return cached;
      const existing = await db.findChapterByTitle(collection.id, title, p.titleLanguage);
      const row = existing ?? (await db.upsertChapter({ collection_id: collection.id, title_translations: { [p.titleLanguage]: title } as never, sort_order: v.chapterOrder ?? 0, state: 'imported_draft' } as Insert<'audio_chapters'>));
      chapters.set(cacheKey, row);
      return row;
    };

    for (const [i, entry] of work.entries()) {
      if (ctx.signal.aborted) throw new JobFailure('aborted', 'import aborted; re-run to continue (idempotent)', { retry: true, backoffSeconds: 60 });
      try {
        const v = entry.merged.values;
        const ext = entry.parsed.extension ?? 'bin';
        const mimeType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
        const local = await downloadToWorkDir(ctx, entry.key, `import-${i}.${ext}`);
        const { sha256, byteLength } = await hashFile(local.path);
        let durationMs: number | null = null;
        let channels: number | null = null;
        let sampleRateHz: number | null = null;
        let bitrateKbps: number | null = null;
        let sniffedMime = mimeType;
        let tags: unknown = null;
        if (p.extractMetadata) {
          try {
            const meta = await extractAudioMetadata(createReadStream(local.path), entry.parsed.legacyFilename, { exactDuration: true });
            durationMs = meta.durationMs;
            channels = meta.channels;
            sampleRateHz = meta.sampleRateHz;
            bitrateKbps = meta.bitrateKbps;
            if (meta.sniffed?.mimeType) sniffedMime = meta.sniffed.mimeType;
            tags = meta.tags;
          } catch (error) {
            failures.push({ key: entry.key, reason: `metadata: ${(error as Error).message}` });
            continue;
          }
        }

        let asset: MediaAssetRow | null = await db.findAssetByChecksum(sha256);
        let status: 'imported' | 'linked' = 'imported';
        if (asset) {
          status = 'linked';
          linked += 1;
          if (!asset.legacy_path) await db.updateAsset(asset.id, { legacy_path: entry.key, legacy_filename: entry.parsed.legacyFilename });
        } else {
          const assetId = ctx.services.newId();
          const masterKey = buildMasterKey({ assetId, contentHash: sha256, mimeType: sniffedMime });
          if (!(await store.head(masterKey))) {
            await store.copy(entry.key, masterKey, { contentType: sniffedMime });
            ctx.cost.storage('copy', byteLength);
          }
          asset = await db.insertAsset({
            id: assetId,
            storage_key: masterKey,
            bucket: store.bucket,
            owner_id: ctx.job.requested_by,
            kind: 'audio',
            checksum_sha256: sha256,
            mime_type: sniffedMime,
            byte_length: byteLength,
            duration_ms: durationMs,
            channels,
            sample_rate_hz: sampleRateHz,
            bitrate_kbps: bitrateKbps,
            visibility: 'private',
            disposition: 'active',
            legacy_filename: entry.parsed.legacyFilename,
            legacy_path: entry.key,
            state: 'imported_draft',
          } as Insert<'media_assets'>);
          createdAssetIds.push(asset.id);
          imported += 1;
        }

        const collection = await ensureCollection(entry);
        const chapter = await ensureChapter(collection, entry);
        const lessonTitle = v.lessonTitle ?? entry.parsed.legacyFilename.replace(/\.[^.]+$/, '');
        const lesson = await db.upsertLesson({
          chapter_id: chapter.id,
          title_translations: { [p.titleLanguage]: lessonTitle } as never,
          description_translations: (v.description ? { [p.titleLanguage]: v.description } : {}) as never,
          sort_order: v.lessonOrder ?? i,
          episode_number: v.episodeNumber ?? null,
          level: v.level ?? null,
          target_variety_id: v.targetVarietyId ?? collection.target_variety_id ?? null,
          instruction_language_code: v.instructionLanguage ?? collection.instruction_language_code ?? null,
          spoken_language_codes: v.spokenLanguageCodes ?? [],
          regional_dialect: v.regionalDialect ?? null,
          topic: v.topic ?? null,
          tags: v.tags ?? [],
          scene: v.scene ?? null,
          state: 'imported_draft',
          transcript_status: 'none',
          listen_length_ms: durationMs,
          visibility: 'private',
        } as Insert<'audio_lessons'>);
        await db.attachLessonAsset({ lesson_id: lesson.id, asset_id: asset.id, asset_type: 'master', sort_order: 0 });
        await db.recordProvenance({
          asset_id: asset.id,
          event_type: 'imported',
          actor_id: ctx.job.requested_by,
          job_id: ctx.job.id,
          details: { action: status, prefix, legacyPath: entry.key, lessonId: lesson.id, chapterId: chapter.id, collectionId: collection.id, merged: v, provenance: entry.merged.provenance, sidecar: entry.sidecar !== null, licenseId: v.licenseId ?? null, rightsOwner: v.rightsOwner ?? null, tags, importKey: keyHash(prefix, entry.key) } as never,
        });
        await db.recordAudit({ actor_id: ctx.job.requested_by, actor_role: 'jobs', action: 'import_r2_prefix.object', entity_table: 'media_assets', entity_id: asset.id, before: null, after: { key: entry.key, prefix, status, assetId: asset.id, lessonId: lesson.id } as never, request_id: ctx.job.id });
      } catch (error) {
        if (error instanceof JobFailure && error.code === 'aborted') throw error;
        failures.push({ key: entry.key, reason: (error as Error).message });
        ctx.log.warn('import.object_failed', { key: entry.key, error });
      }
      await ctx.progress(5 + Math.round(((i + 1) / Math.max(1, work.length)) * 93), `${i + 1}/${work.length}`);
    }
    await ctx.progress(100);
    return { output: { ...base, imported, linked, failed: failures.length, failures: failures.slice(0, 200), createdCollections: [...new Set([...collections.values()].map((c) => c.id))], sourceObjectsRetained: true }, outputAssetIds: createdAssetIds };
  },
};
