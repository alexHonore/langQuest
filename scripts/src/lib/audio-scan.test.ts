import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvManifest } from '@langquest/media';
import { findDuplicates, listAudioFiles, scanTree, toManifestCsv } from './audio-scan';

const ROOT = resolve(__dirname, '../fixtures/audio');

describe('bulk audio scan', () => {
  it('lists only audio files, skipping sidecars', () => {
    const files = listAudioFiles(ROOT);
    expect(files.map((f) => f.rel)).toEqual(['Course A/01 - Unit One/01 Greetings.wav', 'Course A/01 - Unit One/02 Numbers.wav', 'Course A/02 - Unit Two/01 At the cafe.wav', 'Course A/02 - Unit Two/03 Greetings copy.wav', 'Course A/02 - Unit Two/broken.mp3']);
    expect(listAudioFiles(ROOT, 2)).toHaveLength(2);
  });

  it('hashes, extracts metadata, infers hierarchy and renders a manifest the admin importer parses', async () => {
    const files = await scanTree({ root: ROOT, prefix: 'uploads/legacy/course-a', defaults: { targetVarietyId: 'fr', instructionLanguage: 'en', licenseId: 'owner-private', rightsOwner: 'Alex' } });
    const greetings = files.find((f) => f.legacyFilename === '01 Greetings.wav')!;
    expect(greetings.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(greetings.mimeType).toBe('audio/wav');
    expect(greetings.durationMs).toBeGreaterThan(400);
    expect(greetings.sampleRateHz).toBe(8000);
    expect(greetings.channels).toBe(1);
    expect(greetings.storageKey).toBe('uploads/legacy/course-a/Course A/01 - Unit One/01 Greetings.wav');
    expect(greetings.manifestRow).toMatchObject({ collectionTitle: 'Course A', chapterTitle: 'Unit One', chapterOrder: 1, lessonTitle: 'Greetings', lessonOrder: 1, targetVarietyId: 'fr', instructionLanguage: 'en', licenseId: 'owner-private', rightsOwner: 'Alex' });
    expect(greetings.provenanceOfFields.chapterTitle).toBe('inherited');
    expect(greetings.provenanceOfFields.targetVarietyId).toBe('default');
    const broken = files.find((f) => f.legacyFilename === 'broken.mp3')!;
    expect(broken.error).toBeTruthy();
    expect(broken.sha256).toMatch(/^[0-9a-f]{64}$/);

    const dups = findDuplicates(files);
    expect(dups).toHaveLength(1);
    expect(dups[0]!.paths).toHaveLength(2);

    const csv = toManifestCsv(files);
    const parsed = parseCsvManifest(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.rows[0]).toMatchObject({ legacyPath: 'Course A/01 - Unit One/01 Greetings.wav', storageKey: 'uploads/legacy/course-a/Course A/01 - Unit One/01 Greetings.wav', collectionTitle: 'Course A', chapterOrder: 1, lessonOrder: 1, targetVarietyId: 'fr' });
    expect(parsed.unknownColumns).toEqual(expect.arrayContaining(['sha256', 'durationMs', 'mimeType']));
  });

  it('list-only mode skips hashing', async () => {
    const files = await scanTree({ root: ROOT, listOnly: true, maxFiles: 1 });
    expect(files).toHaveLength(1);
    expect(files[0]!.sha256).toBeNull();
    expect(files[0]!.byteLength).toBeGreaterThan(0);
  });
});
