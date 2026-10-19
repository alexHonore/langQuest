/**
 * `render_cover` — course / audio-collection cover art from the original in-code vector system
 * (`@langquest/ui` covers, §10.2A). The SVG is always stored; a PNG raster is produced ONLY when a
 * rasteriser (`sharp`, which bundles librsvg) is importable — otherwise the job says so and stores the
 * SVG alone. Covers are original, locale-neutral artwork, so they are explicitly public-eligible
 * (`public/image/…`) and recorded as `visual_assets` (+ `audio_cover_art` for collections).
 */
import { z } from 'zod';
import { CourseTrackIdSchema, getCourseTrack, isCourseTrackId } from '@langquest/contracts';
// `@langquest/ui/art` re-exports the react-native renderers, which cannot load in Node; the pure string
// renderer lives in `covers.ts`, which the package does not expose as a subpath yet (cross-package gap).
import { courseCoverSvgString } from '../../../../packages/ui/src/art/covers';
import { ART_STYLE_VERSION } from '../../../../packages/ui/src/art/manifest';
import { buildPublicKey, sha256HexSync } from '@langquest/media';
import type { Insert } from '@langquest/db';
import { JobFailure, type JobHandler } from '../queue/types';

export const RenderCoverParamsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('course'), courseTrackId: CourseTrackIdSchema, width: z.number().int().min(150).max(3000).default(900), format: z.enum(['auto', 'svg', 'png']).default('auto') }),
  z.object({ kind: z.literal('audio_collection'), collectionId: z.string().uuid(), courseTrackId: CourseTrackIdSchema.optional(), width: z.number().int().min(150).max(3000).default(900), format: z.enum(['auto', 'svg', 'png']).default('auto') }),
]);
export type RenderCoverParams = z.infer<typeof RenderCoverParamsSchema>;

export type Rasterizer = (svg: string, width: number, height: number) => Promise<Uint8Array>;

/** Try to load `sharp` (optional, not a declared dependency). Returns null when unavailable. */
export async function loadRasterizer(): Promise<Rasterizer | null> {
  try {
    const mod = (await import('sharp' as string)) as { default?: unknown };
    const sharp = (mod.default ?? mod) as (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } };
    if (typeof sharp !== 'function') return null;
    return async (svg) => new Uint8Array(await sharp(Buffer.from(svg, 'utf8')).png().toBuffer());
  } catch {
    return null;
  }
}

export interface RenderCoverDeps {
  /** `undefined` = autodetect `sharp`; `null` = no rasteriser; a function = injected (tests). */
  rasterizer?: Rasterizer | null;
}

export function createRenderCoverHandler(deps: RenderCoverDeps = {}): JobHandler<RenderCoverParams> {
  return {
    name: 'render_cover',
    jobTypes: ['generate_cover', 'render_cover'],
    runtime: 'any',
    paramsSchema: RenderCoverParamsSchema,
    async run(ctx) {
      const { db, store } = ctx.services;
      const p = ctx.params;
      let trackId = p.courseTrackId ?? null;
      let collectionId: string | null = null;
      if (p.kind === 'audio_collection') {
        const collection = await db.getCollection(p.collectionId);
        if (!collection) throw new JobFailure('collection_not_found', `collection ${p.collectionId} not found`, { retry: false });
        collectionId = collection.id;
        trackId = trackId ?? (collection.course_track_id && isCourseTrackId(collection.course_track_id) ? collection.course_track_id : null);
        if (!trackId) throw new JobFailure('no_cover_recipe', 'collection has no course track; there is no cover recipe to render (set courseTrackId)', { retry: false });
      }
      if (!trackId) throw new JobFailure('track_missing', 'courseTrackId is required', { retry: false });
      const track = getCourseTrack(trackId);
      const width = p.width;
      const height = Math.round((width * 2) / 3);
      const svg = courseCoverSvgString(track.id, { width, height });
      await ctx.progress(30, 'svg rendered');

      const stored: Array<{ format: 'svg' | 'png'; key: string; visualAssetId: string; byteLength: number; reused: boolean }> = [];
      const altTextKey = `catalog.cover.${track.id.replace(/-/g, '_')}`;
      const persist = async (format: 'svg' | 'png', bytes: Uint8Array, mimeType: string): Promise<void> => {
        const hash = sha256HexSync(bytes);
        const existing = await db.findVisualByHash(hash);
        if (existing) {
          stored.push({ format, key: existing.storage_key, visualAssetId: existing.id, byteLength: bytes.byteLength, reused: true });
          if (collectionId) await db.upsertCoverArt({ collection_id: collectionId, visual_asset_id: existing.id, generated_from_template: true, template_id: `course_cover:${track.id}`, review_status: 'draft' } as Insert<'audio_cover_art'>);
          return;
        }
        const id = ctx.services.newId();
        const key = buildPublicKey({ assetId: id, contentHash: hash, mimeType, kind: 'image', visibility: 'public' });
        if (!(await store.head(key))) {
          await store.put(key, bytes, { contentType: mimeType });
          ctx.cost.storage('put', bytes.byteLength);
        }
        const row = await db.insertVisualAsset({
          id,
          storage_key: key,
          type: 'course_cover',
          style_version: ART_STYLE_VERSION,
          content_hash: hash,
          alt_text_key: altTextKey,
          dimensions: { width, height } as never,
          locale_neutral: true,
          review_status: 'draft',
          origin: 'in_code_vector',
          mime_type: mimeType,
          byte_length: bytes.byteLength,
          variants: [] as never,
          generation_brief: { kind: p.kind, courseTrackId: track.id, format, jobId: ctx.job.id } as never,
          prompt_template_id: null,
        } as Insert<'visual_assets'>);
        stored.push({ format, key, visualAssetId: row.id, byteLength: bytes.byteLength, reused: false });
        if (collectionId) await db.upsertCoverArt({ collection_id: collectionId, visual_asset_id: row.id, generated_from_template: true, template_id: `course_cover:${track.id}`, review_status: 'draft' } as Insert<'audio_cover_art'>);
      };

      if (p.format !== 'png') await persist('svg', new TextEncoder().encode(svg), 'image/svg+xml');
      await ctx.progress(60, 'svg stored');

      let png: 'stored' | 'unavailable' | 'skipped' = 'skipped';
      let pngReason: string | null = null;
      if (p.format !== 'svg') {
        // undefined → autodetect `sharp`; null → explicitly none (tests); function → injected rasteriser.
        const raster = deps.rasterizer === undefined ? await loadRasterizer() : deps.rasterizer;
        if (!raster) {
          png = 'unavailable';
          pngReason = 'no SVG rasteriser available (install `sharp` to produce PNG covers); SVG stored instead';
          if (p.format === 'png') throw new JobFailure('rasterizer_unavailable', pngReason, { retry: false });
        } else {
          try {
            const bytes = await raster(svg, width, height);
            await persist('png', bytes, 'image/png');
            png = 'stored';
          } catch (error) {
            png = 'unavailable';
            pngReason = `rasteriser failed: ${(error as Error).message}`;
            if (p.format === 'png') throw new JobFailure('raster_failed', pngReason, { retry: false, cause: error });
          }
        }
      }
      await ctx.progress(100);
      return { output: { kind: p.kind, courseTrackId: track.id, collectionId, width, height, styleVersion: ART_STYLE_VERSION, stored, png, pngReason, reviewStatus: 'draft' } };
    },
  };
}

export const renderCoverHandler = createRenderCoverHandler();
