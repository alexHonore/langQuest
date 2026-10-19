import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMasterKey, sha256HexSync } from '@langquest/media';
import { FakeRecognizer, createTestServices, makeToneFixture, runHandler, type TestServices } from '../test-support/fakes';
import { mergeChunkResults, rawTranscriptKey, transcribeHandler, transcriptRecipeHash, type RawTranscriptJson } from './transcribe';

async function seed(t: TestServices, seconds = 3, format: 'wav' | 'mp3' = 'mp3') {
  const path = await makeToneFixture(t.ffmpeg, t.root, { seconds, format, name: `src-${seconds}.${format}` });
  const bytes = new Uint8Array(await readFile(path));
  const checksum = sha256HexSync(bytes);
  const mime = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
  const id = crypto.randomUUID();
  const key = buildMasterKey({ assetId: id, contentHash: checksum, mimeType: mime });
  await t.store.put(key, bytes, { contentType: mime });
  const asset = t.db.seedAsset({ id, storage_key: key, checksum_sha256: checksum, mime_type: mime, byte_length: bytes.byteLength, duration_ms: seconds * 1000 });
  const collection = t.db.seedCollection({ target_variety_id: 'es-ES' });
  const chapter = t.db.seedChapter(collection.id);
  const lesson = t.db.seedLesson(chapter.id, { target_variety_id: 'es-ES', instruction_language_code: 'en' });
  await t.db.attachLessonAsset({ lesson_id: lesson.id, asset_id: id, asset_type: 'master' });
  return { asset, lesson };
}

describe('transcribe', () => {
  let t: TestServices;
  let stt: FakeRecognizer;
  beforeEach(async () => {
    const calls: FakeRecognizer['calls'] = [];
    t = await createTestServices({ recognizer: (sink) => (stt = new FakeRecognizer({ sink, calls })) });
  });
  afterEach(() => t.cleanup());

  it('transcribes a short file in one chunk, stores rows + raw json, flags the mixed-language hint and chains align', async () => {
    const { asset, lesson } = await seed(t);
    const { result, events } = await runHandler(transcribeHandler, t, { translateTo: ['en'] }, { parent_asset_id: asset.id });
    const out = result.output as Record<string, unknown>;
    expect(stt.calls.length).toBe(1);
    expect(stt.calls[0]?.locale).toBe('es-ES');
    expect(out.segmentCount).toBe(2);
    expect(out.languageMode).toBe('mixed'); // lesson instruction language en ≠ es → honest mixed flag
    expect(out.wordTimestamps).toBe(true);
    const transcript = (await t.db.getTranscript(out.transcriptId as string))!;
    expect(transcript.status).toBe('machine');
    expect(transcript.revision).toBe(0);
    expect(transcript.source_asset_id).toBe(asset.id);
    const segments = await t.db.listSegments(transcript.id);
    expect(segments.map((s) => s.text)).toEqual(['Hola, buenos días.', 'Quiero un café, por favor.']);
    expect(segments[0]?.target_variety_id).toBeNull(); // mixed mode never asserts a variety per segment
    expect((await t.db.getLesson(lesson.id))!.lesson.transcript_status).toBe('machine');
    const raw = JSON.parse(new TextDecoder().decode((await t.store.getBytes(out.rawKey as string))!)) as RawTranscriptJson;
    expect(raw.segments[1]?.words.length).toBe(5);
    expect(events.map((e) => e.type)).toContain('transcript.ready');
    const chained = [...t.db.tables.processing_jobs.values()];
    expect(chained.map((j) => j.job_type).sort()).toEqual(['align', 'translate_transcript']);
    expect(chained.find((j) => j.job_type === 'translate_transcript')?.params).toMatchObject({ sourceLanguages: ['en'] });
    expect(t.aiRequests.length).toBe(1);
  });

  it('chunks long audio with ffmpeg and offsets timestamps onto the master timeline', async () => {
    const { asset } = await seed(t, 130, 'wav');
    const { result } = await runHandler(transcribeHandler, t, { chunkSeconds: 60, mixedLanguage: false }, { parent_asset_id: asset.id });
    const out = result.output as Record<string, unknown>;
    expect(stt.calls.length).toBe(3);
    const segments = await t.db.listSegments(out.transcriptId as string);
    expect(segments.length).toBe(6);
    expect(segments[2]!.start_ms).toBeGreaterThanOrEqual(59_000);
    expect(segments[4]!.start_ms).toBeGreaterThanOrEqual(119_000);
    expect(segments.every((s, i) => i === 0 || s.start_ms >= segments[i - 1]!.end_ms)).toBe(true);
    expect(out.languageMode).toBe('target');
    expect(segments[0]?.target_variety_id).toBe('es-ES');
  });

  it('reuses a previous result for identical bytes instead of calling STT again', async () => {
    const { asset } = await seed(t);
    const first = await runHandler(transcribeHandler, t, {}, { parent_asset_id: asset.id });
    expect(stt.calls.length).toBe(1);
    // same lesson, same recipe → existing transcript returned
    const second = await runHandler(transcribeHandler, t, {}, { parent_asset_id: asset.id });
    expect((second.result.output as Record<string, unknown>).reused).toBe(true);
    expect(stt.calls.length).toBe(1);
    // a twin asset (same bytes, new logical asset + new lesson) reuses the raw JSON
    const twinId = crypto.randomUUID();
    const twin = t.db.seedAsset({ id: twinId, storage_key: buildMasterKey({ assetId: twinId, contentHash: asset.checksum_sha256, mimeType: asset.mime_type }), checksum_sha256: asset.checksum_sha256, mime_type: asset.mime_type, byte_length: asset.byte_length });
    await t.store.copy(asset.storage_key, twin.storage_key);
    const chapter = t.db.seedChapter(t.db.seedCollection().id);
    const lesson2 = t.db.seedLesson(chapter.id, { target_variety_id: 'es-ES' });
    await t.db.attachLessonAsset({ lesson_id: lesson2.id, asset_id: twinId, asset_type: 'master' });
    const third = await runHandler(transcribeHandler, t, {}, { parent_asset_id: twinId });
    expect(stt.calls.length).toBe(1);
    expect((third.result.output as Record<string, unknown>).segmentCount).toBe(2);
    expect((first.result.output as Record<string, unknown>).rawKey).toBe(rawTranscriptKey(asset.id, transcriptRecipeHash(asset.checksum_sha256, ['fake-stt'])));
  });

  it('fails honestly without a resolvable variety or when STT is unsupported', async () => {
    const { asset, lesson } = await seed(t);
    await t.db.updateLesson(lesson.id, { target_variety_id: null });
    await expect(runHandler(transcribeHandler, t, {}, { parent_asset_id: asset.id })).rejects.toMatchObject({ code: 'variety_missing', retry: false });
    await expect(runHandler(transcribeHandler, t, { locale: 'es' }, { parent_asset_id: asset.id })).rejects.toMatchObject({ code: 'variety_unresolved' });
    const unsupported = await createTestServices({ recognizer: new FakeRecognizer({ supported: false }) });
    try {
      const s = await seed(unsupported);
      await expect(runHandler(transcribeHandler, unsupported, {}, { parent_asset_id: s.asset.id })).rejects.toMatchObject({ code: 'capability_unsupported', retry: false });
    } finally {
      await unsupported.cleanup();
    }
  });

  it('stores raw json but no rows when the asset has no lesson', async () => {
    const { asset, lesson } = await seed(t);
    for (const [id, l] of t.db.tables.audio_lesson_assets) if (l.lesson_id === lesson.id) t.db.tables.audio_lesson_assets.delete(id);
    const { result } = await runHandler(transcribeHandler, t, { locale: 'spanish-spain' }, { parent_asset_id: asset.id });
    const out = result.output as Record<string, unknown>;
    expect(out.transcriptId).toBeNull();
    expect(out.warning).toBe('no_lesson_linked');
    expect(await t.store.head(out.rawKey as string)).not.toBeNull();
  });
});

describe('mergeChunkResults', () => {
  it('offsets, drops empty text and keeps monotonic order', () => {
    const base = { confidence: null, detectedLanguage: null, requestedLocale: 'x', provider: 'p', model: 'm', durationMs: null, languageMismatch: false, text: '' };
    const merged = mergeChunkResults([
      { offsetMs: 0, result: { ...base, segments: [{ index: 0, text: ' a ', startMs: 0, endMs: 500, confidence: null, speakerLabel: null, language: 'es', words: [] }, { index: 1, text: '', startMs: 500, endMs: 600, confidence: null, speakerLabel: null, language: null, words: [] }] } },
      { offsetMs: 1000, result: { ...base, segments: [{ index: 0, text: 'b', startMs: 100, endMs: 400, confidence: 0.5, speakerLabel: 'speaker_1', language: null, words: [{ text: 'b', startMs: 100, endMs: 400, confidence: 0.4 }] }] } },
    ]);
    expect(merged.map((s) => [s.text, s.startMs, s.endMs])).toEqual([['a', 0, 500], ['b', 1100, 1400]]);
    expect(merged[1]?.words[0]).toMatchObject({ word: 'b', startMs: 1100, endMs: 1400 });
  });
});
