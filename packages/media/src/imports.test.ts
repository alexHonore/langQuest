import { describe, expect, it } from 'vitest';
import { autoSortLessons, findSidecarRow, indexSidecarRows, mergeImportMetadata, naturalCompare, parseCsv, parseCsvManifest, parseImportPath, parseJsonManifest, parseNumberedSegment, reconcilePrefix, renumberChapters, renumberLessons } from './imports';

describe('parseNumberedSegment', () => {
  it.each([
    ['03 - Lesson 3', 3, 'Lesson 3'],
    ['Track 05', 5, 'Track 05'],
    ['Unit 2', 2, 'Unit 2'],
    ['01 Hello', 1, 'Hello'],
    ['Lesson_07', 7, 'Lesson 07'],
    ['S01E03 Greetings', 3, 'Greetings'],
    ['Chapitre 12 - Au marché', 12, 'Au marché'],
    ['Greetings 10', 10, 'Greetings'],
    ['Introduction', null, 'Introduction'],
    ['007', 7, '007'],
  ])('parses %s', (input, number, title) => {
    const r = parseNumberedSegment(input);
    expect(r.number).toBe(number);
    expect(r.title).toBe(title);
  });
  it('extracts season/unit numbers', () => {
    expect(parseNumberedSegment('S02E11 Market').unit).toBe(2);
  });
});

describe('parseImportPath', () => {
  it('infers collection/chapter/lesson from folders and numbered filenames', () => {
    const p = parseImportPath('Pimsleur French I/Unit 2/03 - Lesson 3.mp3');
    expect(p.legacyPath).toBe('Pimsleur French I/Unit 2/03 - Lesson 3.mp3');
    expect(p.legacyFilename).toBe('03 - Lesson 3.mp3');
    expect(p.extension).toBe('mp3');
    expect(p.isAudio).toBe(true);
    expect(p.inherited).toEqual({ collectionTitle: 'Pimsleur French I', chapterTitle: 'Unit 2', chapterOrder: 2, lessonTitle: 'Lesson 3', lessonOrder: 3, episodeNumber: 3, unitNumber: null });
    const flat = parseImportPath('Unit 2/Track 05.mp3');
    expect(flat.inherited.collectionTitle).toBe('Unit 2');
    expect(flat.inherited.chapterTitle).toBeNull();
    expect(flat.inherited.lessonOrder).toBe(5);
    const deep = parseImportPath('Course/Level 1/Chapter 4 - Food/12 Ordering.m4a');
    expect(deep.inherited.chapterTitle).toBe('Food');
    expect(deep.inherited.chapterOrder).toBe(4);
    expect(deep.inherited.lessonTitle).toBe('Ordering');
    expect(deep.folders).toEqual(['Course', 'Level 1', 'Chapter 4 - Food']);
    const sidecar = parseImportPath('Course/manifest.csv');
    expect(sidecar.isSidecar).toBe(true);
    expect(sidecar.isAudio).toBe(false);
    expect(parseImportPath('loose.mp3').inherited.collectionTitle).toBeNull();
  });
  it('rejects unsafe paths', () => {
    expect(() => parseImportPath('../x.mp3')).toThrow(/Unsafe/);
    expect(() => parseImportPath('/abs/x.mp3')).toThrow(/Unsafe/);
  });
});

describe('sidecar manifests', () => {
  const csv = `legacy_path,Course,Chapter,chapter_order,Lesson Title,lesson_order,target_variety_id,instruction_language,tags,speaker,license,description
"Pimsleur French I/Unit 2/03 - Lesson 3.mp3",French I,Unit Two,2,"Ordering, politely",3,fr,en,"food;cafe",Marie,CC-BY-4.0,"A ""quoted"" description"
"Pimsleur French I/Unit 2/04 - Lesson 4.mp3",French I,Unit Two,abc,Lesson Four,4,fr,en,,,,
`;
  it('parses CSV with quotes, aliases and reports errors by row', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\r\nlast,row')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['last', 'row']]);
    const r = parseCsvManifest(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ legacyPath: 'Pimsleur French I/Unit 2/03 - Lesson 3.mp3', collectionTitle: 'French I', chapterTitle: 'Unit Two', chapterOrder: 2, lessonTitle: 'Ordering, politely', lessonOrder: 3, targetVarietyId: 'fr', instructionLanguage: 'en', tags: ['food', 'cafe'], speakerName: 'Marie', licenseId: 'CC-BY-4.0', description: 'A "quoted" description' });
    expect(r.errors).toEqual([{ row: 2, field: 'chapterOrder', message: expect.stringContaining('integer') }]);
    expect(r.unknownColumns).toEqual([]);
    const bad = parseCsvManifest('title,lesson_order\nNo key,1');
    expect(bad.rows).toHaveLength(0);
    expect(bad.errors[0]?.message).toMatch(/storageKey, legacyPath or assetId/);
  });
  it('parses JSON manifests (array or { rows }) with alias keys', () => {
    const r = parseJsonManifest(JSON.stringify({ rows: [{ path: 'A/01 x.mp3', course: 'A', lesson_order: '1', tags: 'a|b', target_variety_id: 'ary', bogus: 1 }, { nope: true }] }));
    expect(r.rows).toEqual([{ legacyPath: 'A/01 x.mp3', collectionTitle: 'A', lessonOrder: 1, tags: ['a', 'b'], targetVarietyId: 'ary' }]);
    expect(r.unknownColumns).toEqual(['bogus', 'nope']);
    expect(r.errors[0]?.row).toBe(2);
    expect(parseJsonManifest('{').errors[0]?.message).toMatch(/Invalid JSON/);
    expect(parseJsonManifest('[{"assetId":"00000000-0000-4000-8000-000000000000"}]').rows).toHaveLength(1);
  });
});

describe('merge rules', () => {
  it('sidecar overrides inherited overrides defaults; legacy path always preserved', () => {
    const parsed = parseImportPath('Pimsleur French I/Unit 2/03 - Lesson 3.mp3');
    const merged = mergeImportMetadata(parsed, { lessonTitle: 'Ordering politely', targetVarietyId: 'fr', legacyPath: 'ignored/should/not/win.mp3' }, { instructionLanguage: 'en', targetVarietyId: 'es-ES', collectionTitle: 'Default course' });
    expect(merged.values).toMatchObject({ legacyPath: 'Pimsleur French I/Unit 2/03 - Lesson 3.mp3', collectionTitle: 'Pimsleur French I', chapterTitle: 'Unit 2', chapterOrder: 2, lessonTitle: 'Ordering politely', lessonOrder: 3, targetVarietyId: 'fr', instructionLanguage: 'en' });
    expect(merged.provenance).toMatchObject({ collectionTitle: 'inherited', lessonTitle: 'sidecar', targetVarietyId: 'sidecar', instructionLanguage: 'default', legacyPath: 'inherited' });
  });
  it('matches sidecar rows by key, path or unique filename', () => {
    const index = indexSidecarRows([{ legacyPath: 'A/Unit 1/01 x.mp3', lessonTitle: 'X' }, { storageKey: 'imports/k.mp3', lessonTitle: 'K' }, { legacyPath: 'B/dup.mp3' }, { legacyPath: 'C/dup.mp3' }]);
    expect(findSidecarRow(index, { storageKey: 'imports/k.mp3', legacyPath: 'zzz', legacyFilename: 'k.mp3' })?.lessonTitle).toBe('K');
    expect(findSidecarRow(index, { legacyPath: 'A/Unit 1/01 x.mp3', legacyFilename: '01 x.mp3' })?.lessonTitle).toBe('X');
    expect(findSidecarRow(index, { legacyPath: 'other/01 x.mp3', legacyFilename: '01 x.mp3' })?.lessonTitle).toBe('X');
    expect(findSidecarRow(index, { legacyPath: 'other/dup.mp3', legacyFilename: 'dup.mp3' })).toBeNull();
  });
});

describe('reconcilePrefix', () => {
  it('classifies objects under a prefix (A19)', () => {
    const r = reconcilePrefix(
      [
        { key: 'imports/fr/Course/Unit 1/01 Hello.mp3', byteLength: 5_000_000 },
        { key: 'imports/fr/Course/Unit 1/02 Bye.mp3', byteLength: 5_000_000 },
        { key: 'imports/fr/Course/manifest.csv', byteLength: 200 },
        { key: 'imports/fr/Course/.DS_Store', byteLength: 6148 },
        { key: 'imports/fr/Course/Unit 1/tiny.mp3', byteLength: 10 },
        { key: 'imports/other/x.mp3', byteLength: 10_000 },
      ],
      { prefix: 'imports/fr', sidecarRows: [{ legacyPath: 'Course/Unit 1/02 Bye.mp3', lessonTitle: 'Goodbye' }], defaults: { instructionLanguage: 'fr', targetVarietyId: 'ary' }, knownKeys: new Set(['imports/fr/Course/Unit 1/01 Hello.mp3']) },
    );
    expect(r.summary).toEqual({ total: 5, new: 1, known: 1, skipped: 3 });
    const bye = r.entries.find((e) => e.key.endsWith('02 Bye.mp3'))!;
    expect(bye.status).toBe('new');
    expect(bye.merged.values).toMatchObject({ lessonTitle: 'Goodbye', lessonOrder: 2, chapterTitle: 'Unit 1', chapterOrder: 1, collectionTitle: 'Course', instructionLanguage: 'fr', targetVarietyId: 'ary' });
    expect(r.entries.find((e) => e.key.endsWith('.csv'))?.skipReason).toBe('sidecar manifest');
    expect(r.entries.find((e) => e.key.endsWith('tiny.mp3'))?.skipReason).toMatch(/smaller/);
  });
});

describe('sorting and renumbering', () => {
  const lessons = [
    { legacyPath: 'c/Lesson 10.mp3', chapterOrder: 1, lessonOrder: 10, lessonTitle: 'Lesson 10' },
    { legacyPath: 'c/Lesson 2.mp3', chapterOrder: 1, lessonOrder: 2, lessonTitle: 'Lesson 2' },
    { legacyPath: 'b/intro.mp3', chapterOrder: null, chapterTitle: 'Bonus', lessonOrder: null, lessonTitle: 'Intro' },
    { legacyPath: 'a/x.mp3', chapterOrder: 2, lessonOrder: null, lessonTitle: 'Track 3' },
    { legacyPath: 'a/y.mp3', chapterOrder: 2, lessonOrder: null, lessonTitle: 'Track 12' },
  ];
  it('natural sorts and renumbers per chapter', () => {
    expect(naturalCompare('Lesson 2', 'Lesson 10')).toBeLessThan(0);
    const sorted = autoSortLessons(lessons);
    expect(sorted.map((l) => l.legacyPath)).toEqual(['c/Lesson 2.mp3', 'c/Lesson 10.mp3', 'a/x.mp3', 'a/y.mp3', 'b/intro.mp3']);
    const renumbered = renumberLessons(sorted);
    expect(renumbered.map((l) => l.lessonOrder)).toEqual([1, 2, 1, 2, 1]);
    expect(renumberLessons(sorted, { perChapter: false, start: 0 }).map((l) => l.lessonOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(renumberChapters(sorted).map((l) => l.chapterOrder)).toEqual([1, 1, 2, 2, 3]);
  });
});
