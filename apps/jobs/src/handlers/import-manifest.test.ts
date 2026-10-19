import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMasterKey } from '@langquest/media';
import { createTestServices, runHandler, type TestServices } from '../test-support/fakes';
import { importManifestHandler, lessonPatchFromRow } from './import-manifest';

describe('import_manifest', () => {
  let t: TestServices;
  beforeEach(async () => {
    t = await createTestServices();
  });
  afterEach(() => t.cleanup());

  async function seed() {
    const id = crypto.randomUUID();
    const asset = t.db.seedAsset({ id, storage_key: buildMasterKey({ assetId: id, contentHash: 'e'.repeat(64), mimeType: 'audio/mpeg' }), checksum_sha256: 'e'.repeat(64), mime_type: 'audio/mpeg', byte_length: 10, legacy_path: 'imports/x/Unit 1/01 - Hello.mp3' });
    const collection = t.db.seedCollection();
    const chapter = t.db.seedChapter(collection.id);
    const lesson = t.db.seedLesson(chapter.id, { tags: ['old'], title_translations: { en: 'Hello' } });
    await t.db.attachLessonAsset({ lesson_id: lesson.id, asset_id: id, asset_type: 'master' });
    return { asset, lesson, collection };
  }

  it('dry run matches rows without writing', async () => {
    const { asset } = await seed();
    const { result } = await runHandler(importManifestHandler, t, { rows: [{ assetId: asset.id, lessonTitle: 'Hi there' }, { legacyPath: 'nope.mp3' }, { storageKey: 'x' }], dryRun: true });
    const out = result.output as Record<string, unknown>;
    expect(out).toMatchObject({ rowCount: 3, matched: 1, applied: 0 });
    expect((out.unmatched as unknown[]).length).toBe(2);
    expect(t.db.tables.audit_logs.size).toBe(0);
  });

  it('applies rows by assetId / legacyPath, unions tags, keeps an audit trail, and reads CSV manifests from the store', async () => {
    const { asset, lesson } = await seed();
    const { result } = await runHandler(importManifestHandler, t, { rows: [{ legacyPath: 'imports/x/Unit 1/01 - Hello.mp3', lessonTitle: 'Hello!', tags: ['new'], level: 'beginner', lessonOrder: 7, instructionLanguage: 'fr' }], dryRun: false });
    expect((result.output as Record<string, unknown>).applied).toBe(1);
    const updated = (await t.db.getLesson(lesson.id))!.lesson;
    // The row declares instructionLanguage=fr, so its title lands under fr (no English default).
    expect(updated.title_translations).toEqual({ en: 'Hello', fr: 'Hello!' });
    expect(updated.tags).toEqual(['old', 'new']);
    expect(updated.level).toBe('beginner');
    expect(updated.sort_order).toBe(7);
    expect(updated.instruction_language_code).toBe('fr');
    const audit = [...t.db.tables.audit_logs.values()][0]!;
    expect(audit.action).toBe('import_manifest.update_lesson');
    expect((audit.before as Record<string, unknown>).sort_order).toBe(0);
    expect(result.outputAssetIds).toEqual([asset.id]);

    await t.store.put('uploads/manifest.csv', `assetId,topic,description\n${asset.id},greetings,"Say hi"\n`, { contentType: 'text/csv' });
    const { result: r2 } = await runHandler(importManifestHandler, t, { format: 'csv', manifestKey: 'uploads/manifest.csv', dryRun: false });
    expect((r2.output as Record<string, unknown>).applied).toBe(1);
    expect((await t.db.getLesson(lesson.id))!.lesson.topic).toBe('greetings');
  });

  it('skips title / description fields whose language cannot be resolved and reports them instead of defaulting to English', async () => {
    const { asset, lesson } = await seed();
    const { result } = await runHandler(importManifestHandler, t, { rows: [{ assetId: asset.id, lessonTitle: 'Untitled language', description: 'Some blurb', topic: 'greetings' }], dryRun: false });
    const out = result.output as Record<string, unknown>;
    expect(out.applied).toBe(1);
    expect(out.validationErrors).toEqual([
      { row: 0, field: 'lessonTitle', message: expect.stringMatching(/^title_language_missing/) },
      { row: 0, field: 'description', message: expect.stringMatching(/^title_language_missing/) },
    ]);
    const updated = (await t.db.getLesson(lesson.id))!.lesson;
    expect(updated.title_translations).toEqual({ en: 'Hello' });
    expect(updated.description_translations).toEqual({});
    expect(updated.topic).toBe('greetings');

    const explicit = await runHandler(importManifestHandler, t, { rows: [{ assetId: asset.id, lessonTitle: 'Hallo' }], titleLanguage: 'de', dryRun: false });
    expect((explicit.result.output as Record<string, unknown>).validationErrors).toEqual([]);
    expect((await t.db.getLesson(lesson.id))!.lesson.title_translations).toEqual({ en: 'Hello', de: 'Hallo' });
  });

  it('reports validation errors from malformed rows', async () => {
    const { result } = await runHandler(importManifestHandler, t, { rows: [{ lessonTitle: 'no key' }], dryRun: true });
    const out = result.output as Record<string, unknown>;
    expect(out.rowCount).toBe(0);
    expect((out.validationErrors as unknown[]).length).toBeGreaterThan(0);
  });

  it('lessonPatchFromRow only touches provided fields', () => {
    const lesson = t.db.seedLesson(t.db.seedChapter(t.db.seedCollection().id).id, { tags: ['a'] });
    expect(lessonPatchFromRow({ storageKey: 'k' }, lesson, 'en')).toEqual({});
    expect(lessonPatchFromRow({ storageKey: 'k', tags: ['a', 'b'], scene: 'cafe' }, lesson, 'en')).toEqual({ tags: ['a', 'b'], scene: 'cafe' });
    expect(lessonPatchFromRow({ storageKey: 'k', lessonTitle: 'T', description: 'D', scene: 'cafe' }, lesson, null)).toEqual({ scene: 'cafe' });
  });
});
