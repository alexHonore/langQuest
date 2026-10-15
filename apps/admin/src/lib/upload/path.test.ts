import { describe, expect, it } from 'vitest';
import { groupByTopFolder, kindForMime, relativePathOf, resolveMimeType, suggestFromPath, topFolder } from './path';

describe('upload path helpers', () => {
  it('resolves MIME types from the browser or the extension', () => {
    expect(resolveMimeType('a.mp3', '')).toBe('audio/mpeg');
    expect(resolveMimeType('a.m4a', 'audio/x-m4a')).toBe('audio/x-m4a');
    expect(resolveMimeType('a.M4B', '')).toBe('audio/mp4');
    expect(resolveMimeType('cover.PNG', '')).toBe('image/png');
    expect(resolveMimeType('a.exe', 'application/x-msdownload')).toBeNull();
    expect(kindForMime('audio/flac')).toBe('audio');
    expect(kindForMime('image/webp')).toBe('image');
    expect(kindForMime('text/csv')).toBe('document');
  });

  it('suggests hierarchy from folder paths', () => {
    const s = suggestFromPath('Pimsleur Arabic/02 - Unit Two/07 - Lesson 7.mp3');
    expect(s?.collectionTitle).toContain('Pimsleur');
    expect(s?.chapterOrder).toBe(2);
    expect(s?.lessonOrder).toBe(7);
    expect(s?.folders).toEqual(['Pimsleur Arabic', '02 - Unit Two']);
    expect(suggestFromPath('../escape.mp3')).toBeNull();
  });

  it('normalises relative paths and groups by top folder', () => {
    const f = new File([new Uint8Array(3)], 'x.mp3');
    expect(relativePathOf(f, 'A\\B\\x.mp3')).toBe('A/B/x.mp3');
    expect(relativePathOf(f)).toBe('x.mp3');
    expect(topFolder('A/B/x.mp3')).toBe('A');
    expect(topFolder('x.mp3')).toBe('');
    const groups = groupByTopFolder([{ relativePath: 'A/1.mp3' }, { relativePath: 'B/2.mp3' }, { relativePath: 'A/3.mp3' }, { relativePath: 'root.mp3' }]);
    expect([...groups.keys()]).toEqual(['A', 'B', '']);
    expect(groups.get('A')).toHaveLength(2);
  });
});
