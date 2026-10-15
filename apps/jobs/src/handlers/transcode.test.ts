import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMasterKey, parseObjectKey, sha256HexSync } from '@langquest/media';
import { createTestServices, makeToneFixture, runHandler, type TestServices } from '../test-support/fakes';
import { transcodeHandler, type RenditionRecord } from './transcode';

describe('transcode', () => {
  let t: TestServices;
  beforeEach(async () => {
    t = await createTestServices();
  });
  afterEach(() => t.cleanup());

  async function seedMaster(format: 'wav' | 'mp3', channels: 1 | 2 = 1) {
    const path = await makeToneFixture(t.ffmpeg, t.root, { seconds: 2, format, channels, name: `master-${channels}.${format}` });
    const bytes = new Uint8Array(await readFile(path));
    const checksum = sha256HexSync(bytes);
    const mime = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    const id = crypto.randomUUID();
    const key = buildMasterKey({ assetId: id, contentHash: checksum, mimeType: mime });
    await t.store.put(key, bytes, { contentType: mime });
    const asset = t.db.seedAsset({ id, storage_key: key, checksum_sha256: checksum, mime_type: mime, byte_length: bytes.byteLength, channels });
    const collection = t.db.seedCollection();
    const chapter = t.db.seedChapter(collection.id);
    const lesson = t.db.seedLesson(chapter.id);
    await t.db.attachLessonAsset({ lesson_id: lesson.id, asset_id: id, asset_type: 'master' });
    return { asset, lesson, bytes, key };
  }

  it('produces AAC + Opus + slow renditions, waveform peaks, attaches them to the lesson and never touches the master', async () => {
    const { asset, lesson, bytes, key } = await seedMaster('wav');
    const { result } = await runHandler(transcodeHandler, t, {}, { parent_asset_id: asset.id });
    const out = result.output as { renditions: RenditionRecord[]; waveform: { key: string; peaks: number } | null; masterUntouched: boolean };
    const byVariant = Object.fromEntries(out.renditions.map((r) => [r.variant, r]));
    expect(byVariant.aac?.status).toBe('created');
    expect(byVariant.opus?.status).toBe('created');
    expect(byVariant.slow_075?.status).toBe('created');
    expect(byVariant.slow_085?.status).toBe('created');
    expect(byVariant.aac?.bitrateKbps).toBe(64);
    for (const r of out.renditions) {
      expect(parseObjectKey(r.key!)?.scope).toBe('derived');
      expect(await t.store.head(r.key!)).not.toBeNull();
    }
    expect(out.waveform?.peaks).toBeGreaterThan(10);
    const peaks = JSON.parse(new TextDecoder().decode((await t.store.getBytes(out.waveform!.key))!)) as { version: number; peaks: number[] };
    expect(peaks.version).toBe(1);
    // ffmpeg's `sine` source is deliberately quiet (≈ -18 dBFS); a real signal must still show up as non-zero peaks.
    expect(Math.max(...peaks.peaks)).toBeGreaterThan(0.05);
    // master bytes unchanged
    expect(sha256HexSync((await t.store.getBytes(key))!)).toBe(asset.checksum_sha256);
    expect(sha256HexSync(bytes)).toBe(asset.checksum_sha256);
    // derived rows + lesson links
    const derived = await t.db.listDerivedAssets(asset.id);
    expect(derived.length).toBe(5);
    const links = [...t.db.tables.audio_lesson_assets.values()].filter((l) => l.lesson_id === lesson.id);
    expect(links.filter((l) => l.asset_type === 'mobile_encoded').length).toBe(2);
    expect(links.filter((l) => l.asset_type === 'slow').length).toBe(2);
    expect(result.outputAssetIds?.length).toBe(5);
    expect([...t.db.tables.asset_provenance_events.values()][0]?.event_type).toBe('transcoded');
  });

  it('is idempotent: a second run reuses existing derivatives', async () => {
    const { asset } = await seedMaster('mp3');
    await runHandler(transcodeHandler, t, { slow: false, waveform: false, cover: false }, { parent_asset_id: asset.id });
    const before = t.db.tables.media_assets.size;
    const { result } = await runHandler(transcodeHandler, t, { slow: false, waveform: false, cover: false }, { parent_asset_id: asset.id });
    const out = result.output as { renditions: RenditionRecord[] };
    expect(out.renditions.every((r) => r.status === 'reused' || r.status === 'skipped')).toBe(true);
    expect(t.db.tables.media_assets.size).toBe(before);
  });

  it('refuses non-audio assets', async () => {
    const asset = t.db.seedAsset({ kind: 'image', storage_key: buildMasterKey({ assetId: crypto.randomUUID(), contentHash: 'b'.repeat(64), mimeType: 'image/png' }), checksum_sha256: 'b'.repeat(64), mime_type: 'image/png', byte_length: 10 });
    await expect(runHandler(transcodeHandler, t, {}, { parent_asset_id: asset.id })).rejects.toMatchObject({ code: 'not_audio' });
  });
});
