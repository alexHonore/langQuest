import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMasterKey, sha256HexSync } from '@langquest/media';
import { FakeReasoner, FakeRecognizer, createTestServices, makeToneFixture, runHandler, type TestServices } from '../test-support/fakes';
import { inferMetadataHandler, type MetadataSuggestion } from './infer-metadata';

const suggestion: MetadataSuggestion = {
  likelyLanguages: [{ code: 'es', confidence: 0.9 }, { code: 'en', confidence: 0.6 }, { code: 'zz', confidence: 0.2 }],
  likelyVariety: { varietyId: 'es-419', confidence: 0.7, note: 'ustedes, carro' },
  instructionLanguage: { code: 'en', confidence: 0.8 },
  voiceRoles: [{ label: 'mixed', confidence: 0.8, evidence: 'English prompts followed by Spanish answers' }],
  lessonGuess: { title: 'Ordering coffee', chapterTitle: 'Unit 1', lessonOrder: 3, episodeNumber: null, confidence: 0.5 },
  description: { text: 'A short lesson about ordering coffee.', languageCode: 'en', confidence: 0.7 },
  tags: [{ tag: 'cafe', confidence: 0.9 }, { tag: 'ordering', confidence: 0.8 }],
  topics: [{ topicKey: 'restaurant', confidence: 0.8 }, { topicKey: 'introductions', confidence: 0.3 }],
  level: { value: 'beginner', confidence: 0.6 },
};

describe('infer_metadata', () => {
  let t: TestServices;
  let reasoner: FakeReasoner;
  let stt: FakeRecognizer;
  beforeEach(async () => {
    const calls: FakeRecognizer['calls'] = [];
    t = await createTestServices({ reasoner: (sink) => (reasoner = new FakeReasoner(() => suggestion, sink)), recognizer: (sink) => (stt = new FakeRecognizer({ sink, calls })) });
  });
  afterEach(() => t.cleanup());

  async function seed(withTranscript: boolean) {
    const path = await makeToneFixture(t.ffmpeg, t.root, { seconds: 2, format: 'mp3' });
    const bytes = new Uint8Array(await readFile(path));
    const checksum = sha256HexSync(bytes);
    const id = crypto.randomUUID();
    const key = buildMasterKey({ assetId: id, contentHash: checksum, mimeType: 'audio/mpeg' });
    await t.store.put(key, bytes, { contentType: 'audio/mpeg' });
    const asset = t.db.seedAsset({ id, storage_key: key, checksum_sha256: checksum, mime_type: 'audio/mpeg', byte_length: bytes.byteLength, legacy_path: 'imports/Unit 1/03 - Ordering coffee.mp3', legacy_filename: '03 - Ordering coffee.mp3' });
    const lesson = t.db.seedLesson(t.db.seedChapter(t.db.seedCollection().id).id, { target_variety_id: 'es-ES', title_translations: { en: 'Original title' } });
    await t.db.attachLessonAsset({ lesson_id: lesson.id, asset_id: id, asset_type: 'master' });
    if (withTranscript) {
      const transcript = t.db.seedTranscript(lesson.id, { source_asset_id: id });
      await t.db.replaceSegments(transcript.id, [{ sort_index: 0, start_ms: 0, end_ms: 1000, text: 'Quiero un café', language_code: 'es' }]);
    }
    return { asset, lesson };
  }

  it('uses the existing transcript as evidence, stores suggestions with provenance and never edits the lesson', async () => {
    const { asset, lesson } = await seed(true);
    const { result } = await runHandler(inferMetadataHandler, t, {}, { job_type: 'describe', parent_asset_id: asset.id });
    const out = result.output as Record<string, unknown>;
    expect((out.evidence as Record<string, unknown>).source).toBe('transcript');
    expect(stt.calls.length).toBe(0);
    expect(reasoner.calls[0]?.task).toBe('scene_planning');
    expect(reasoner.calls[0]?.prompt.user).toMatch(/Quiero un café/);
    expect(reasoner.calls[0]?.prompt.user).toMatch(/Ordering coffee/);
    const s = out.suggestion as MetadataSuggestion;
    expect(s.likelyLanguages.map((l) => l.code)).toEqual(['es', 'en']);
    expect(out.dropped).toEqual(['language:zz']);
    expect(out.varietyConflict).toBe(true); // expected es-ES, model says es-419 → surfaced, never applied
    expect(out.applied).toBe(false);
    expect((out.provenance as Record<string, unknown>).reviewStatus).toBe('review_needed');
    const stored = (await t.db.getLesson(lesson.id))!.lesson;
    expect(stored.title_translations).toEqual({ en: 'Original title' });
    expect(stored.target_variety_id).toBe('es-ES');
    const topics = [...t.db.tables.lesson_topics.values()];
    expect(topics.map((x) => [x.topic_key, x.provenance, x.confidence])).toEqual([['restaurant', 'ai_suggested', 0.8], ['introductions', 'ai_suggested', 0.3]]);
    const prov = [...t.db.tables.asset_provenance_events.values()][0]!;
    expect((prov.details as Record<string, unknown>).action).toBe('ai_metadata_suggested');
  });

  it('transcribes a short sample when no transcript exists, and skips STT when told to', async () => {
    const { asset } = await seed(false);
    const { result } = await runHandler(inferMetadataHandler, t, { sampleSeconds: 15 }, { job_type: 'detect_language', parent_asset_id: asset.id });
    const out = result.output as Record<string, unknown>;
    expect((out.evidence as Record<string, unknown>).source).toBe('stt_sample');
    expect(stt.calls.length).toBe(1);
    expect(stt.calls[0]?.locale).toBe('es-ES');
    expect((out.sttSample as Record<string, unknown>).detectedLanguage).toBe('es');

    const { result: r2 } = await runHandler(inferMetadataHandler, t, { allowStt: false }, { job_type: 'detect_language', parent_asset_id: asset.id });
    expect(((r2.output as Record<string, unknown>).evidence as Record<string, unknown>).source).toBe('metadata_only');
    expect(((r2.output as Record<string, unknown>).sttSample as Record<string, unknown>).skipped).toBe('allowStt=false');
    expect(stt.calls.length).toBe(1);
  });

  it('needs an asset or a lesson', async () => {
    await expect(runHandler(inferMetadataHandler, t, {}, { job_type: 'describe' })).rejects.toMatchObject({ code: 'target_missing' });
  });
});
