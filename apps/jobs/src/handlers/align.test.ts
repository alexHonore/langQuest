import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMasterKey } from '@langquest/media';
import { createTestServices, runHandler, type TestServices } from '../test-support/fakes';
import { alignHandler } from './align';
import { rawTranscriptKey, type RawTranscriptJson } from './transcribe';

describe('align', () => {
  let t: TestServices;
  beforeEach(async () => {
    t = await createTestServices();
  });
  afterEach(() => t.cleanup());

  async function seed(words: boolean) {
    const id = crypto.randomUUID();
    const asset = t.db.seedAsset({ id, storage_key: buildMasterKey({ assetId: id, contentHash: 'c'.repeat(64), mimeType: 'audio/mpeg' }), checksum_sha256: 'c'.repeat(64), mime_type: 'audio/mpeg', byte_length: 10, duration_ms: 2500 });
    const lesson = t.db.seedLesson(t.db.seedChapter(t.db.seedCollection().id).id);
    const transcript = t.db.seedTranscript(lesson.id, { source_asset_id: asset.id });
    // overlapping + overflowing boundaries on purpose
    const rows = await t.db.replaceSegments(transcript.id, [
      { sort_index: 0, start_ms: 0, end_ms: 1300, text: 'Hola', reviewed: false },
      { sort_index: 1, start_ms: 1200, end_ms: 3000, text: 'Adiós', reviewed: false },
    ]);
    const raw: RawTranscriptJson = {
      version: 1, handlerVersion: 'transcribe:v1', assetId: asset.id, contentHash: asset.checksum_sha256, recipeHash: 'r', provider: 'fake', model: 'fake-stt', models: ['fake-stt'], requestedLocale: 'es-ES', varietyId: 'es-ES', detectedLanguage: 'es', languageMismatch: false, confidence: 0.9, durationMs: 2500, mixedLanguageHint: false, instructionLanguage: null, chunks: [], wordTimestamps: words, generatedAt: new Date().toISOString(),
      segments: [
        { index: 0, startMs: 0, endMs: 1300, text: 'Hola', speakerLabel: null, languageCode: 'es', varietyId: null, transliteration: null, confidence: 0.9, reviewed: false, words: words ? [{ word: 'Hola', startMs: 0, endMs: 900, confidence: 0.9 }] : [] },
        { index: 1, startMs: 1200, endMs: 3000, text: 'Adiós', speakerLabel: null, languageCode: 'es', varietyId: null, transliteration: null, confidence: 0.9, reviewed: false, words: words ? [{ word: 'Adiós', startMs: 1300, endMs: 2400, confidence: 0.8 }] : [] },
      ],
    };
    const rawKey = rawTranscriptKey(asset.id, 'd'.repeat(64));
    await t.store.put(rawKey, JSON.stringify(raw), { contentType: 'application/json' });
    return { asset, transcript, rows, rawKey };
  }

  it('normalises sentence boundaries and stores word alignments when the STT returned words', async () => {
    const { transcript, rawKey } = await seed(true);
    const { result, events } = await runHandler(alignHandler, t, { transcriptId: transcript.id, rawKey });
    const out = result.output as Record<string, unknown>;
    expect(out.retimed).toBe(1);
    expect(out.wordAlignment).toBe('stored');
    const segs = await t.db.listSegments(transcript.id);
    expect(segs[1]!.start_ms).toBe(1300);
    expect(segs[1]!.end_ms).toBe(2500);
    const words = [...t.db.tables.transcript_word_alignments.values()];
    expect(words.length).toBe(2);
    expect(words.find((w) => w.word === 'Adiós')?.start_ms).toBe(1300);
    expect(events.at(-1)).toMatchObject({ type: 'transcript.ready', payload: { wordAligned: true } });
  });

  it('marks word alignment unavailable (with a reason) when no word timestamps exist, discovering the raw key itself', async () => {
    const { asset, transcript, rawKey } = await seed(false);
    await t.db.enqueueJob({ jobType: 'transcribe', idempotencyKey: 'x', parentAssetId: asset.id });
    const job = [...t.db.tables.processing_jobs.values()][0]!;
    t.db.tables.processing_jobs.set(job.id, { ...job, state: 'succeeded', output: { rawKey } as never });
    const { result } = await runHandler(alignHandler, t, { transcriptId: transcript.id });
    const out = result.output as Record<string, unknown>;
    expect(out.wordAlignment).toBe('unavailable');
    expect(out.reason).toMatch(/no word timestamps/);
    expect(out.rawKey).toBe(rawKey);
    expect(t.db.tables.transcript_word_alignments.size).toBe(0);
  });

  it('never retimes reviewed segments', async () => {
    const { transcript, rows, rawKey } = await seed(true);
    await t.db.updateSegment(rows[1]!.id, { reviewed: true });
    const { result } = await runHandler(alignHandler, t, { transcriptId: transcript.id, rawKey });
    expect((result.output as Record<string, unknown>).retimed).toBe(0);
    expect((await t.db.listSegments(transcript.id))[1]!.start_ms).toBe(1200);
  });
});
