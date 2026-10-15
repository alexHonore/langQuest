import { describe, expect, it } from 'vitest';
import { activeSegmentAt, detectLanguageMix, formatTimestamp, karaokeWindows, labelLanguage, labelSpeaker, loopBounds, mergeSegments, normalizeSegments, parseSubtitles, parseTimestamp, retimeSegment, sentenceAnchors, splitSegment, toSrt, toTranscriptJson, toVtt, transcriptCoveragePct, type Segment } from './transcripts';

const base: Segment[] = normalizeSegments([
  { index: 0, startMs: 0, endMs: 2000, text: 'Salam, labas?', speakerLabel: 'Salma', languageCode: 'ar', varietyId: 'ary' },
  { index: 1, startMs: 2000, endMs: 4500, text: 'Bonjour, ça va bien merci.', speakerLabel: 'Learner', languageCode: 'fr' },
  { index: 2, startMs: 5000, endMs: 8000, text: 'Bghit atay b naanaa afak', speakerLabel: 'Salma', languageCode: 'ar', varietyId: 'ary', words: [
    { word: 'Bghit', startMs: 5000, endMs: 5600 }, { word: 'atay', startMs: 5600, endMs: 6200 }, { word: 'b', startMs: 6200, endMs: 6400 }, { word: 'naanaa', startMs: 6400, endMs: 7200 }, { word: 'afak', startMs: 7200, endMs: 8000 } ] },
]);

describe('normalize / merge / split / retime', () => {
  it('sorts, reindexes and clamps overlaps', () => {
    const s = normalizeSegments([{ index: 5, startMs: 3000, endMs: 4000, text: 'b' }, { index: 9, startMs: 0, endMs: 3500, text: 'a' }]);
    expect(s.map((x) => [x.index, x.startMs, x.endMs])).toEqual([[0, 0, 3500], [1, 3500, 4000]]);
    expect(s[0]!.speakerLabel).toBeNull();
    expect(s[0]!.words).toEqual([]);
  });
  it('merges a range', () => {
    const merged = mergeSegments(base, 0, 1);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ index: 0, startMs: 0, endMs: 4500, text: 'Salam, labas? Bonjour, ça va bien merci.', languageCode: 'mul', speakerLabel: null, reviewed: false });
    expect(merged[1]!.index).toBe(1);
    expect(() => mergeSegments(base, 2, 1)).toThrow();
  });
  it('splits at a word boundary when word timings exist', () => {
    const split = splitSegment(base, 2, { atMs: 6300 });
    expect(split).toHaveLength(4);
    expect(split[2]).toMatchObject({ startMs: 5000, endMs: 6400, text: 'Bghit atay b' });
    expect(split[3]).toMatchObject({ startMs: 6400, endMs: 8000, text: 'naanaa afak', index: 3 });
    expect(split[3]!.words.map((w) => w.word)).toEqual(['naanaa', 'afak']);
  });
  it('splits proportionally by characters otherwise and snaps to whitespace', () => {
    const split = splitSegment(base, 1, { atMs: 3400 });
    expect(split[1]!.text).toBe('Bonjour, ça va');
    expect(split[2]!.text).toBe('bien merci.');
    expect(split[1]!.endMs).toBe(split[2]!.startMs);
    const byChar = splitSegment(base, 0, { atChar: 6 });
    expect(byChar[0]!.text).toBe('Salam,');
    expect(byChar[1]!.text).toBe('labas?');
    expect(() => splitSegment(normalizeSegments([{ index: 0, startMs: 0, endMs: 100, text: 'x' }]), 0, { atChar: 0 })).toThrow(/empty/);
  });
  it('retimes and clamps neighbours', () => {
    const r = retimeSegment(base, 1, { startMs: 1500, endMs: 5500 });
    expect(r[0]!.endMs).toBe(1500);
    expect(r[1]).toMatchObject({ startMs: 1500, endMs: 5500, reviewed: false });
    expect(r[2]!.startMs).toBe(5500);
    expect(() => retimeSegment(base, 1, { startMs: 3000, endMs: 2000 })).toThrow();
  });
  it('labels speakers and languages, detects mixed-language speech', () => {
    const labelled = labelLanguage(labelSpeaker(base, [1], 'Youssef'), [1], 'fr', null);
    expect(labelled[1]).toMatchObject({ speakerLabel: 'Youssef', languageCode: 'fr', varietyId: null });
    const mix = detectLanguageMix(base);
    expect(mix.mixed).toBe(true);
    expect(mix.dominant).toBe('ar');
    expect(mix.languages.map((l) => l.code)).toEqual(['ar', 'fr']);
    expect(detectLanguageMix(base.filter((s) => s.languageCode === 'ar')).mixed).toBe(false);
  });
});

describe('export / import', () => {
  it('formats and parses timestamps', () => {
    expect(formatTimestamp(3_723_004)).toBe('01:02:03,004');
    expect(formatTimestamp(65_500, '.')).toBe('00:01:05.500');
    expect(parseTimestamp('01:02:03,004')).toBe(3_723_004);
    expect(parseTimestamp('01:05.5')).toBe(65_500);
    expect(() => parseTimestamp('nope')).toThrow();
  });
  it('exports SRT and VTT and parses them back', () => {
    const srt = toSrt(base, { includeSpeaker: true });
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,000\nSalma: Salam, labas?\n');
    const vtt = toVtt(base, { includeSpeaker: true });
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:02.000 --> 00:00:04.500\n<v Learner>Bonjour, ça va bien merci.');
    const fromSrt = parseSubtitles(srt);
    expect(fromSrt.map((s) => [s.startMs, s.endMs, s.text, s.speakerLabel])).toEqual(base.map((s) => [s.startMs, s.endMs, s.text, s.speakerLabel]));
    const fromVtt = parseSubtitles(vtt);
    expect(fromVtt.map((s) => s.speakerLabel)).toEqual(['Salma', 'Learner', 'Salma']);
    expect(fromVtt[1]!.text).toBe('Bonjour, ça va bien merci.');
    const manual = parseSubtitles('WEBVTT\n\nNOTE made by hand\n\nintro\n00:01.000 --> 00:02.500\n<i>Hello</i> world\nsecond line\n');
    expect(manual).toEqual([expect.objectContaining({ id: 'intro', startMs: 1000, endMs: 2500, text: 'Hello world second line' })]);
  });
  it('exports JSON with language mode', () => {
    const json = toTranscriptJson(base);
    expect(json.version).toBe(1);
    expect(json.languageMode).toBe('mixed');
    expect(json.segments).toHaveLength(3);
  });
});

describe('playback helpers', () => {
  it('builds karaoke windows from words or proportionally', () => {
    const w = karaokeWindows(base[2]!);
    expect(w).toHaveLength(5);
    expect(w[3]).toEqual({ startMs: 6400, endMs: 7200, charStart: 13, charEnd: 19, text: 'naanaa' });
    const p = karaokeWindows(base[1]!);
    expect(p.map((x) => x.text)).toEqual(['Bonjour,', 'ça', 'va', 'bien', 'merci.']);
    expect(p[0]!.startMs).toBe(2000);
    expect(p[p.length - 1]!.endMs).toBe(4500);
    for (let i = 1; i < p.length; i++) expect(p[i]!.startMs).toBe(p[i - 1]!.endMs);
    expect(karaokeWindows({ ...base[1]!, text: '   ' })).toEqual([]);
  });
  it('finds the active segment and loop bounds', () => {
    expect(activeSegmentAt(base, 2500)?.index).toBe(1);
    expect(activeSegmentAt(base, 4700)).toBeNull();
    expect(activeSegmentAt(base, 9000)).toBeNull();
    expect(activeSegmentAt(base, 0)?.index).toBe(0);
    expect(loopBounds(base, 1, { paddingMs: 300 })).toEqual({ startMs: 2000, endMs: 4800 });
    expect(loopBounds(base, 2, { paddingMs: 300, durationMs: 8100 })).toEqual({ startMs: 4700, endMs: 8100 });
    expect(loopBounds(base, 0, { paddingMs: 300, clampToNeighbours: false })).toEqual({ startMs: 0, endMs: 2300 });
  });
  it('builds anchors and coverage', () => {
    const anchors = sentenceAnchors(base, 10);
    expect(anchors[0]).toEqual({ index: 0, id: null, startMs: 0, endMs: 2000, snippet: 'Salam, la…', speakerLabel: 'Salma' });
    expect(transcriptCoveragePct(base, 10_000)).toBe(75);
    expect(transcriptCoveragePct(base, 0)).toBe(0);
  });
});
