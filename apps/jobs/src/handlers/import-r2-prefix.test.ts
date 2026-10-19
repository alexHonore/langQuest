import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseObjectKey } from '@langquest/media';
import { createTestServices, makeToneFixture, runHandler, type TestServices } from '../test-support/fakes';
import { importR2PrefixHandler } from './import-r2-prefix';

describe('import_r2_prefix', () => {
  let t: TestServices;
  beforeEach(async () => {
    t = await createTestServices();
  });
  afterEach(() => t.cleanup());

  async function seedPrefix() {
    const mp3 = new Uint8Array(await readFile(await makeToneFixture(t.ffmpeg, t.root, { seconds: 1, format: 'mp3', name: 'a.mp3' })));
    const mp3b = new Uint8Array(await readFile(await makeToneFixture(t.ffmpeg, t.root, { seconds: 2, format: 'mp3', name: 'b.mp3' })));
    const prefix = 'imports/pimsleur-es/';
    await t.store.put(`${prefix}Spanish I/Unit 1/01 - Greetings.mp3`, mp3, { contentType: 'audio/mpeg' });
    await t.store.put(`${prefix}Spanish I/Unit 1/02 - Ordering.mp3`, mp3b, { contentType: 'audio/mpeg' });
    await t.store.put(`${prefix}Spanish I/Unit 2/01 - Directions.mp3`, mp3, { contentType: 'audio/mpeg' }); // same bytes as the first file
    await t.store.put(`${prefix}Spanish I/notes.txt`, 'ignored', { contentType: 'text/plain' });
    await t.store.put(`${prefix}manifest.csv`, 'legacyPath,lessonTitle,tags\n"Spanish I/Unit 1/02 - Ordering.mp3","Ordering a coffee","cafe;food"\n', { contentType: 'text/csv' });
    return { prefix };
  }

  it('dry run reports discovered objects and inferred metadata without writing anything', async () => {
    const { prefix } = await seedPrefix();
    const { result } = await runHandler(importR2PrefixHandler, t, { prefix, dryRun: true, defaultTrackId: 'spanish-spain', defaultInstructionLanguage: 'en' }, { job_type: 'import_prefix' });
    const out = result.output as Record<string, unknown>;
    expect(out.dryRun).toBe(true);
    expect(out.discovered).toMatchObject({ objects: 5, audio: 3, sidecars: 1, alreadyImported: 0, unsupported: 1 });
    const sample = out.sample as Array<{ key: string; status: string; inferred: Record<string, unknown> }>;
    const ordering = sample.find((s) => s.key.endsWith('02 - Ordering.mp3'))!;
    expect(ordering.inferred.lessonTitle).toBe('Ordering a coffee');
    expect(ordering.inferred.tags).toEqual(['cafe', 'food']);
    expect(ordering.inferred.collectionTitle).toBe('Spanish I');
    expect(ordering.inferred.chapterTitle).toMatch(/Unit 1/);
    expect(ordering.inferred.lessonOrder).toBe(2);
    expect(ordering.inferred.targetVarietyId).toBe('es-ES');
    expect(t.db.tables.media_assets.size).toBe(0);
  });

  it('imports drafts under hashed master keys, keeps legacy paths, links duplicates and is idempotent', async () => {
    const { prefix } = await seedPrefix();
    const { result } = await runHandler(importR2PrefixHandler, t, { prefix, dryRun: false, defaultTrackId: 'spanish-spain', defaultInstructionLanguage: 'en' }, { job_type: 'import_prefix' });
    const out = result.output as Record<string, unknown>;
    expect(out.imported).toBe(2);
    expect(out.linked).toBe(1);
    expect(out.failed).toBe(0);
    const assets = [...t.db.tables.media_assets.values()];
    expect(assets.length).toBe(2);
    for (const a of assets) {
      expect(parseObjectKey(a.storage_key)?.scope).toBe('master');
      expect(a.legacy_path).toMatch(new RegExp(`^${prefix}`));
      expect(a.state).toBe('imported_draft');
      expect(a.duration_ms).toBeGreaterThan(500);
      expect(await t.store.head(a.storage_key)).not.toBeNull();
    }
    // source objects stay where rclone put them
    expect(await t.store.head(`${prefix}Spanish I/Unit 1/01 - Greetings.mp3`)).not.toBeNull();
    const collections = [...t.db.tables.audio_course_collections.values()];
    expect(collections.length).toBe(1);
    expect(collections[0]?.title_translations).toEqual({ en: 'Spanish I' });
    expect(collections[0]?.course_track_id).toBe('spanish-spain');
    expect([...t.db.tables.audio_chapters.values()].length).toBe(2);
    const lessons = [...t.db.tables.audio_lessons.values()];
    expect(lessons.length).toBe(3);
    expect(lessons.map((l) => (l.title_translations as Record<string, string>).en).sort()).toEqual(['Directions', 'Greetings', 'Ordering a coffee']);
    expect(lessons.find((l) => (l.title_translations as Record<string, string>).en === 'Ordering a coffee')?.tags).toEqual(['cafe', 'food']);
    expect(lessons.every((l) => l.instruction_language_code === 'en' && l.target_variety_id === 'es-ES')).toBe(true);
    expect([...t.db.tables.audio_lesson_assets.values()].length).toBe(3);
    expect([...t.db.tables.asset_provenance_events.values()].every((p) => p.event_type === 'imported')).toBe(true);

    const again = await runHandler(importR2PrefixHandler, t, { prefix, dryRun: false, defaultTrackId: 'spanish-spain' }, { job_type: 'import_prefix' });
    const out2 = again.result.output as Record<string, unknown>;
    expect(out2.imported).toBe(0);
    expect(out2.linked).toBe(0);
    expect((out2.discovered as Record<string, number>).alreadyImported).toBe(3);
    expect(t.db.tables.media_assets.size).toBe(2);
    expect(t.db.tables.audio_lessons.size).toBe(3);
  });

  it('refuses to store parsed titles without a declared language (no English default) and imports them once a language is set', async () => {
    const { prefix } = await seedPrefix();
    const dry = await runHandler(importR2PrefixHandler, t, { prefix, dryRun: true, defaultTrackId: 'spanish-spain' }, { job_type: 'import_prefix' });
    expect(dry.result.output).toMatchObject({ titleLanguage: null, missingTitleLanguage: 3 });
    const { result } = await runHandler(importR2PrefixHandler, t, { prefix, dryRun: false, defaultTrackId: 'spanish-spain' }, { job_type: 'import_prefix' });
    const out = result.output as Record<string, unknown>;
    expect(out).toMatchObject({ imported: 0, linked: 0, failed: 3 });
    expect((out.failures as Array<{ reason: string }>).every((f) => f.reason.startsWith('title_language_missing'))).toBe(true);
    // Nothing was copied or inserted, so the objects are not "known" and a corrected re-run imports them.
    expect(t.db.tables.media_assets.size).toBe(0);
    expect(t.db.tables.audio_lessons.size).toBe(0);
    expect(t.db.tables.audio_course_collections.size).toBe(0);
    const fixed = await runHandler(importR2PrefixHandler, t, { prefix, dryRun: false, defaultTrackId: 'spanish-spain', titleLanguage: 'fr' }, { job_type: 'import_prefix' });
    expect(fixed.result.output).toMatchObject({ imported: 2, linked: 1, failed: 0 });
    const lessons = [...t.db.tables.audio_lessons.values()];
    expect(lessons.length).toBe(3);
    expect(lessons.every((l) => Object.keys(l.title_translations as object).join() === 'fr')).toBe(true);
    expect([...t.db.tables.audio_course_collections.values()][0]?.title_translations).toEqual({ fr: 'Spanish I' });
  });
});
