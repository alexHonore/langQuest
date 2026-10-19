/**
 * `regenerate_manifest` — rebuild a versioned course manifest (ADR-004) or an audio-collection manifest
 * from published rows, store the JSON in the object store (`manifests/…/v{n}.json` + `latest.json`) and
 * emit `manifest.invalidated` so the API edge cache and mobile diff by version/checksum. Unchanged content
 * keeps its version and emits nothing. Job type `regenerate_manifest` (pre-migration-100 rows: `describe` +
 * `params.handler`).
 *
 * Audio-collection titles are localized STRICTLY in the collection's declared instruction language (or the
 * requested `instructionLanguageCode`): a language-agnostic collection (`instruction_language_code = null`)
 * or a missing translation yields `''` / `null`, never a silent English substitution (§2.1). The output's
 * `localization` block reports the language used and how many titles were missing so admins can fix them.
 */
import { z } from 'zod';
import type { AudioCollectionManifest, CourseManifest } from '@langquest/contracts';
import { AssetKindSchema, AssetVisibilitySchema, AudioCollectionManifestSchema, CourseManifestSchema, CourseTrackIdSchema, LearnerLevelSchema, SourceLanguageCodeSchema, getCourseTrack, isSourceLanguageCode, isVarietyId } from '@langquest/contracts';
import { buildAudioCollectionManifest, computeManifestChecksum, diffManifests, lazyAssetRef, nextManifestVersion } from '@langquest/media';
import { JobFailure, type JobContext, type JobHandler } from '../queue/types';
import { localizedExact } from './common';

export const RegenerateManifestParamsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('course'), courseTrackId: CourseTrackIdSchema, sourceLanguageCode: SourceLanguageCodeSchema, reason: z.enum(['published', 'unpublished', 'rights_revoked', 'localization_updated', 'asset_replaced']).default('published') }),
  z.object({ kind: z.literal('audio_collection'), collectionId: z.string().uuid(), instructionLanguageCode: z.string().min(2).max(8).optional(), reason: z.enum(['published', 'unpublished', 'rights_revoked', 'localization_updated', 'asset_replaced']).default('published') }),
]);
export type RegenerateManifestParams = z.infer<typeof RegenerateManifestParamsSchema>;

export const MANIFEST_PREFIX = 'manifests';

export function manifestKeys(input: RegenerateManifestParams, version: number): { versioned: string; latest: string } {
  const base = input.kind === 'course' ? `${MANIFEST_PREFIX}/course/${input.courseTrackId}/${input.sourceLanguageCode}` : `${MANIFEST_PREFIX}/audio/${input.collectionId}/${input.instructionLanguageCode ?? 'any'}`;
  return { versioned: `${base}/v${version}.json`, latest: `${base}/latest.json` };
}

async function loadPrevious<T>(ctx: JobContext<RegenerateManifestParams>, key: string, schema: z.ZodType<T>): Promise<T | null> {
  const bytes = await ctx.services.store.getBytes(key);
  if (!bytes) return null;
  ctx.cost.storage('get', bytes.byteLength);
  const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
  return parsed.success ? parsed.data : null;
}

export const regenerateManifestHandler: JobHandler<RegenerateManifestParams> = {
  name: 'regenerate_manifest',
  jobTypes: ['regenerate_manifest'],
  runtime: 'any',
  paramsSchema: RegenerateManifestParamsSchema,
  async run(ctx) {
    const { db, store } = ctx.services;
    const p = ctx.params;
    const { latest: latestKey } = manifestKeys(p, 0);

    let next: CourseManifest | AudioCollectionManifest;
    let previous: CourseManifest | AudioCollectionManifest | null;
    /** Audio collections only: which language titles were resolved in (`null` = none) and how many were missing. */
    let localization: { languageCode: string | null; missingTitles: number } | null = null;
    if (p.kind === 'course') {
      const track = getCourseTrack(p.courseTrackId);
      previous = await loadPrevious(ctx, latestKey, CourseManifestSchema);
      const built = await db.buildCourseManifest(track.id, p.sourceLanguageCode, track.targetVarietyId);
      const parsed = CourseManifestSchema.safeParse(built);
      if (!parsed.success) throw new JobFailure('manifest_invalid', `Course manifest failed validation: ${parsed.error.issues.slice(0, 3).map((i) => i.message).join('; ')}`, { retry: false });
      next = parsed.data;
    } else {
      previous = await loadPrevious(ctx, latestKey, AudioCollectionManifestSchema);
      const tree = await db.getCollectionTree(p.collectionId);
      if (!tree) throw new JobFailure('collection_not_found', `collection ${p.collectionId} not found`, { retry: false });
      // `null` = language-agnostic collection: no localization is applied (no English default).
      const lang: string | null = p.instructionLanguageCode ?? tree.collection.instruction_language_code ?? null;
      let missingTitles = 0;
      const titleIn = (translations: unknown): string => {
        const v = localizedExact(translations, lang);
        if (v === null) missingTitles += 1;
        return v ?? '';
      };
      const chapters = tree.chapters
        .filter(({ chapter }) => chapter.state === 'published')
        .map(({ chapter, lessons }) => ({
          id: chapter.id,
          order: chapter.sort_order,
          title: titleIn(chapter.title_translations),
          summary: localizedExact(chapter.summary_translations, lang),
          coverArt: null,
          lessons: lessons
            .filter((l) => l.lesson.state === 'published')
            .map((l) => ({
              id: l.lesson.id,
              order: l.lesson.sort_order,
              title: titleIn(l.lesson.title_translations),
              description: localizedExact(l.lesson.description_translations, lang),
              durationMs: l.lesson.listen_length_ms,
              level: l.lesson.level === null ? null : LearnerLevelSchema.parse(l.lesson.level),
              speakerNames: l.speakers.map((s) => s.display_name),
              assets: l.assets
                .filter((a) => a.media && a.media.disposition === 'active' && (a.media.state === 'published' || a.media.state === 'approved'))
                .map((a) => lazyAssetRef({ id: a.media!.id, kind: AssetKindSchema.parse(a.media!.kind), checksumSha256: a.media!.checksum_sha256, byteLength: Number(a.media!.byte_length), mimeType: a.media!.mime_type, durationMs: a.media!.duration_ms, visibility: AssetVisibilitySchema.parse(a.media!.visibility) })),
              transcriptAvailable: l.transcriptLanguages.length > 0,
              transcriptLanguages: l.transcriptLanguages,
              // Offline packs need verified redistribution rights; this job does not evaluate rights, so it never claims eligibility.
              offlineEligible: false,
            })),
        }));
      const varietyId = tree.collection.target_variety_id && isVarietyId(tree.collection.target_variety_id) ? tree.collection.target_variety_id : null;
      next = buildAudioCollectionManifest(
        {
          collectionId: tree.collection.id,
          title: titleIn(tree.collection.title_translations),
          targetVarietyId: varietyId,
          instructionLanguageCode: lang !== null && isSourceLanguageCode(lang) ? lang : null,
          version: previous?.version ?? 0,
          coverArt: null,
          attributionText: null,
          chapters,
        },
        ctx.services.now(),
      );
      localization = { languageCode: lang, missingTitles };
      if (missingTitles > 0) ctx.log.warn('manifest.titles_missing', { collectionId: p.collectionId, languageCode: lang, missingTitles });
    }
    await ctx.progress(60, 'built');

    const diff = previous ? diffManifests(previous, next) : null;
    const changed = !previous || diff === null || diff.addedIds.length > 0 || diff.removedIds.length > 0 || diff.changedIds.length > 0 || diff.assetsAdded.length > 0 || diff.assetsRemoved.length > 0;
    const version = changed ? nextManifestVersion(previous?.version ?? null) : (previous?.version ?? next.version);
    const body = { ...next, version };
    const { checksum: _drop, ...withoutChecksum } = body;
    const manifest = { ...withoutChecksum, checksum: computeManifestChecksum(withoutChecksum) } as typeof next;
    const keys = manifestKeys(p, version);
    const json = JSON.stringify(manifest);
    if (changed || !(await store.head(keys.latest))) {
      await store.put(keys.versioned, json, { contentType: 'application/json' });
      await store.put(keys.latest, json, { contentType: 'application/json' });
      ctx.cost.storage('put', json.length);
      ctx.cost.storage('put', json.length);
    }
    await ctx.progress(85, changed ? `version ${version}` : 'unchanged');

    if (changed) {
      await ctx.emit(
        'manifest.invalidated',
        p.kind === 'course'
          ? { kind: 'course', courseTrackId: p.courseTrackId, collectionId: null, sourceLanguageCode: p.sourceLanguageCode, newVersion: version, reason: p.reason }
          : { kind: 'audio_collection', courseTrackId: null, collectionId: p.collectionId, sourceLanguageCode: p.instructionLanguageCode && isSourceLanguageCode(p.instructionLanguageCode) ? p.instructionLanguageCode : null, newVersion: version, reason: p.reason },
        `manifest.invalidated:${p.kind}:${p.kind === 'course' ? `${p.courseTrackId}:${p.sourceLanguageCode}` : p.collectionId}:v${version}`,
      );
    }
    await ctx.progress(100);
    return { output: { kind: p.kind, version, changed, checksum: manifest.checksum, keys, diff, localization, counts: p.kind === 'course' ? { chapters: (manifest as CourseManifest).chapters.length, missions: (manifest as CourseManifest).chapters.reduce((n, c) => n + c.missions.length, 0) } : { chapters: (manifest as AudioCollectionManifest).chapters.length, lessons: (manifest as AudioCollectionManifest).chapters.reduce((n, c) => n + c.lessons.length, 0) } } };
  },
};
