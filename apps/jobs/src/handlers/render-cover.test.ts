import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseObjectKey } from '@langquest/media';
import { createTestServices, runHandler, type TestServices } from '../test-support/fakes';
import { createRenderCoverHandler, loadRasterizer } from './render-cover';

describe('render_cover', () => {
  let t: TestServices;
  beforeEach(async () => {
    t = await createTestServices();
  });
  afterEach(() => t.cleanup());

  it('stores the SVG cover as a public visual asset and reports PNG as unavailable without a rasteriser', async () => {
    const handler = createRenderCoverHandler({ rasterizer: null });
    const { result } = await runHandler(handler, t, { kind: 'course', courseTrackId: 'japanese', width: 300 }, { job_type: 'generate_cover' });
    const out = result.output as { stored: Array<{ format: string; key: string; visualAssetId: string }>; png: string; pngReason: string | null };
    expect(out.stored.length).toBe(1);
    expect(out.stored[0]!.format).toBe('svg');
    expect(parseObjectKey(out.stored[0]!.key)).toMatchObject({ scope: 'public', kind: 'image' });
    expect(out.png).toBe('unavailable');
    expect(out.pngReason).toMatch(/rasteriser/);
    const svg = new TextDecoder().decode((await t.store.getBytes(out.stored[0]!.key))!);
    expect(svg).toMatch(/^<svg/);
    const visual = [...t.db.tables.visual_assets.values()][0]!;
    expect(visual).toMatchObject({ type: 'course_cover', origin: 'in_code_vector', review_status: 'draft', mime_type: 'image/svg+xml', locale_neutral: true, alt_text_key: 'catalog.cover.japanese' });
    expect(visual.dimensions).toEqual({ width: 300, height: 200 });
  });

  it('rasterises with an injected rasteriser, dedupes by hash and binds collection covers', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const handler = createRenderCoverHandler({ rasterizer: async () => png });
    const collection = t.db.seedCollection({ course_track_id: 'korean' });
    const { result } = await runHandler(handler, t, { kind: 'audio_collection', collectionId: collection.id }, { job_type: 'generate_cover' });
    const out = result.output as { stored: Array<{ format: string; reused: boolean }>; png: string };
    expect(out.png).toBe('stored');
    expect(out.stored.map((s) => s.format)).toEqual(['svg', 'png']);
    expect([...t.db.tables.audio_cover_art.values()].length).toBe(2);
    const again = await runHandler(handler, t, { kind: 'audio_collection', collectionId: collection.id }, { job_type: 'generate_cover' });
    expect((again.result.output as { stored: Array<{ reused: boolean }> }).stored.every((s) => s.reused)).toBe(true);
    expect(t.db.tables.visual_assets.size).toBe(2);
  });

  it('fails when png is demanded but no rasteriser exists, and when a collection has no track', async () => {
    const handler = createRenderCoverHandler({ rasterizer: null });
    await expect(runHandler(handler, t, { kind: 'course', courseTrackId: 'greek', format: 'png' }, { job_type: 'generate_cover' })).rejects.toMatchObject({ code: 'rasterizer_unavailable', retry: false });
    const collection = t.db.seedCollection();
    await expect(runHandler(handler, t, { kind: 'audio_collection', collectionId: collection.id }, { job_type: 'generate_cover' })).rejects.toMatchObject({ code: 'no_cover_recipe' });
  });

  it('loadRasterizer returns a function or null (never throws)', async () => {
    const r = await loadRasterizer();
    expect(r === null || typeof r === 'function').toBe(true);
  });
});
