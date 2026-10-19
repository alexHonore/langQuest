import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AudioCollectionManifest } from '@langquest/contracts';
import { buildCourseManifest, buildMasterKey, verifyManifestChecksum } from '@langquest/media';
import { createTestServices, runHandler, type TestServices } from '../test-support/fakes';
import { manifestKeys, manifestRef, regenerateManifestHandler } from './regenerate-manifest';

describe('regenerate_manifest', () => {
  let t: TestServices;
  beforeEach(async () => {
    t = await createTestServices();
  });
  afterEach(() => t.cleanup());

  async function seedCollection() {
    const collection = t.db.seedCollection({ title_translations: { en: 'Street Spanish' }, target_variety_id: 'es-419', instruction_language_code: 'en', state: 'published' });
    const chapter = t.db.seedChapter(collection.id, { state: 'published', title_translations: { en: 'Chapter 1' } });
    const hidden = t.db.seedChapter(collection.id, { state: 'imported_draft', sort_order: 1 });
    const id = crypto.randomUUID();
    const asset = t.db.seedAsset({ id, storage_key: buildMasterKey({ assetId: id, contentHash: 'f'.repeat(64), mimeType: 'audio/mpeg' }), checksum_sha256: 'f'.repeat(64), mime_type: 'audio/mpeg', byte_length: 1234, duration_ms: 90_000, state: 'published' });
    const lesson = t.db.seedLesson(chapter.id, { state: 'published', title_translations: { en: 'Greetings' }, listen_length_ms: 90_000, level: 'beginner' });
    t.db.seedLesson(chapter.id, { state: 'review_needed', sort_order: 1 });
    t.db.seedLesson(hidden.id, { state: 'published' });
    await t.db.attachLessonAsset({ lesson_id: lesson.id, asset_id: id, asset_type: 'master' });
    t.db.seedTranscript(lesson.id, { primary_language_code: 'es' });
    return { collection, chapter, lesson, asset };
  }

  it('builds an audio-collection manifest from published rows only, stores it and emits manifest.invalidated', async () => {
    const { collection, lesson, asset } = await seedCollection();
    const { result, events } = await runHandler(regenerateManifestHandler, t, { kind: 'audio_collection', collectionId: collection.id }, { job_type: 'describe' });
    const out = result.output as Record<string, unknown>;
    expect(out.changed).toBe(true);
    expect(out.version).toBe(1);
    expect(out.counts).toEqual({ chapters: 1, lessons: 1 });
    const keys = manifestKeys({ kind: 'audio_collection', collectionId: collection.id, reason: 'published' }, 1);
    const stored = JSON.parse(new TextDecoder().decode((await t.store.getBytes(keys.latest))!)) as AudioCollectionManifest;
    expect(verifyManifestChecksum(stored)).toBe(true);
    expect(stored.chapters[0]!.lessons[0]).toMatchObject({ id: lesson.id, title: 'Greetings', durationMs: 90_000, transcriptAvailable: true, transcriptLanguages: ['es'], offlineEligible: false });
    expect(stored.chapters[0]!.lessons[0]!.assets[0]).toMatchObject({ assetId: asset.id, publicUrl: null, contentHash: asset.checksum_sha256 });
    expect(await t.store.head(keys.versioned)).not.toBeNull();
    expect(events.at(-1)).toMatchObject({ type: 'manifest.invalidated', payload: { kind: 'audio_collection', collectionId: collection.id, newVersion: 1, reason: 'published' } });
    // ADR-004 stored copy: one audio_collection_manifests row per version, same bytes as the object store, linked to the job.
    expect(out.stored).toMatchObject({ table: 'audio_collection_manifests', version: 1, checksum: stored.checksum, written: true });
    const rows = [...t.db.tables.audio_collection_manifests.values()];
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ collection_id: collection.id, instruction_language_code: 'any', version: 1, checksum: stored.checksum, generated_by_job_id: expect.any(String) });
    expect(rows[0]!.published_at).not.toBeNull();
    expect(rows[0]!.manifest).toEqual(stored);
    expect(await t.db.getLatestStoredManifest(manifestRef({ kind: 'audio_collection', collectionId: collection.id, reason: 'published' }))).toMatchObject({ version: 1 });
  });

  it('falls back to the stored row as the previous build when the object store copy is missing, and never duplicates a version row', async () => {
    const { collection } = await seedCollection();
    const first = await runHandler(regenerateManifestHandler, t, { kind: 'audio_collection', collectionId: collection.id }, { job_type: 'regenerate_manifest' });
    expect((first.result.output as Record<string, unknown>).previousSource).toBeNull();
    // Wipe the object store copy: the next run must still see version 1 through the stored row and stay at v1.
    const keys = manifestKeys({ kind: 'audio_collection', collectionId: collection.id, reason: 'published' }, 1);
    await t.store.delete(keys.latest);
    const second = await runHandler(regenerateManifestHandler, t, { kind: 'audio_collection', collectionId: collection.id }, { job_type: 'regenerate_manifest' });
    const out = second.result.output as Record<string, unknown>;
    expect(out).toMatchObject({ previousSource: 'stored_row', changed: false, version: 1 });
    expect((out.stored as Record<string, unknown>).written).toBe(false);
    expect(await t.store.head(keys.latest)).not.toBeNull(); // object store copy restored
    expect([...t.db.tables.audio_collection_manifests.values()].map((r) => r.version)).toEqual([1]);
    // A direct (queue-less) run stores the manifest without a dangling job link.
    const direct = await runHandler(regenerateManifestHandler, t, { kind: 'audio_collection', collectionId: collection.id, instructionLanguageCode: 'fr' }, { job_type: 'regenerate_manifest', idempotency_key: 'direct:abc' });
    expect((direct.result.output as Record<string, unknown>).version).toBe(1);
    expect([...t.db.tables.audio_collection_manifests.values()].find((r) => r.instruction_language_code === 'fr')?.generated_by_job_id).toBeNull();
  });

  it('keeps the version and stays silent when nothing changed, bumps it when content changes', async () => {
    const { collection, chapter } = await seedCollection();
    await runHandler(regenerateManifestHandler, t, { kind: 'audio_collection', collectionId: collection.id }, { job_type: 'describe' });
    const before = t.services.events.emitted.length;
    const same = await runHandler(regenerateManifestHandler, t, { kind: 'audio_collection', collectionId: collection.id }, { job_type: 'describe' });
    expect((same.result.output as Record<string, unknown>).changed).toBe(false);
    expect((same.result.output as Record<string, unknown>).version).toBe(1);
    expect(t.services.events.emitted.length).toBe(before);
    t.db.seedLesson(chapter.id, { state: 'published', sort_order: 5, title_translations: { en: 'Numbers' } });
    const changed = await runHandler(regenerateManifestHandler, t, { kind: 'audio_collection', collectionId: collection.id, reason: 'localization_updated' }, { job_type: 'describe' });
    expect((changed.result.output as Record<string, unknown>).version).toBe(2);
    expect(t.services.events.emitted.at(-1)?.payload).toMatchObject({ newVersion: 2, reason: 'localization_updated' });
  });

  it('never substitutes English: a language-agnostic collection gets empty titles and a null language, a declared language only its own translations', async () => {
    const collection = t.db.seedCollection({ title_translations: { en: 'Any language' }, instruction_language_code: null, state: 'published' });
    const chapter = t.db.seedChapter(collection.id, { state: 'published', title_translations: { en: 'Only English' } });
    t.db.seedLesson(chapter.id, { state: 'published', title_translations: { en: 'English title', fr: 'Titre français' }, description_translations: { en: 'English blurb' } });
    const agnostic = await runHandler(regenerateManifestHandler, t, { kind: 'audio_collection', collectionId: collection.id }, { job_type: 'regenerate_manifest' });
    expect((agnostic.result.output as Record<string, unknown>).localization).toEqual({ languageCode: null, missingTitles: 3 });
    const anyKeys = manifestKeys({ kind: 'audio_collection', collectionId: collection.id, reason: 'published' }, 1);
    expect(anyKeys.latest).toBe(`manifests/audio/${collection.id}/any/latest.json`);
    const stored = JSON.parse(new TextDecoder().decode((await t.store.getBytes(anyKeys.latest))!)) as AudioCollectionManifest;
    expect(stored.instructionLanguageCode).toBeNull();
    expect(stored.title).toBe('');
    expect(stored.chapters[0]).toMatchObject({ title: '', summary: null });
    expect(stored.chapters[0]!.lessons[0]).toMatchObject({ title: '', description: null });

    const fr = await runHandler(regenerateManifestHandler, t, { kind: 'audio_collection', collectionId: collection.id, instructionLanguageCode: 'fr' }, { job_type: 'regenerate_manifest' });
    expect((fr.result.output as Record<string, unknown>).localization).toEqual({ languageCode: 'fr', missingTitles: 2 });
    const frKeys = manifestKeys({ kind: 'audio_collection', collectionId: collection.id, instructionLanguageCode: 'fr', reason: 'published' }, 1);
    const storedFr = JSON.parse(new TextDecoder().decode((await t.store.getBytes(frKeys.latest))!)) as AudioCollectionManifest;
    expect(storedFr.instructionLanguageCode).toBe('fr');
    expect(storedFr.title).toBe('');
    expect(storedFr.chapters[0]!.title).toBe('');
    expect(storedFr.chapters[0]!.lessons[0]).toMatchObject({ title: 'Titre français', description: null });
    expect(JSON.stringify(storedFr)).not.toMatch(/English/);
  });

  it('stores course manifests built by the curriculum repository', async () => {
    t.db.courseManifest = buildCourseManifest({ courseTrackId: 'french', sourceLanguageCode: 'en', targetVarietyId: 'fr', version: 0, coverArt: null, chapters: [], characters: [] });
    const { result, events } = await runHandler(regenerateManifestHandler, t, { kind: 'course', courseTrackId: 'french', sourceLanguageCode: 'en' }, { job_type: 'describe' });
    expect((result.output as Record<string, unknown>).version).toBe(1);
    expect(events.at(-1)?.payload).toMatchObject({ kind: 'course', courseTrackId: 'french', sourceLanguageCode: 'en', newVersion: 1 });
    expect(await t.store.head('manifests/course/french/en/latest.json')).not.toBeNull();
    expect([...t.db.tables.course_manifests.values()]).toEqual([expect.objectContaining({ course_track_id: 'french', source_language_code: 'en', version: 1, checksum: (result.output as Record<string, unknown>).checksum })]);
  });
});
