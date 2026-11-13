import { describe, expect, it } from 'vitest';
import { IMMUTABLE, contentObjectName, indexDocument, planRelease } from './publish-content';
import { repoRoot } from './lib/io';

describe('publish-content', () => {
  const { objects, index } = planRelease(repoRoot());

  it('names each content file by what it holds, and lists it in the index the app reads', () => {
    expect(contentObjectName('content/catalog.json', Buffer.from('a'))).toMatch(/^content\/catalog\.[0-9a-f]{12}\.json$/);
    expect(contentObjectName('content/catalog.json', Buffer.from('a'))).toBe(contentObjectName('content/catalog.json', Buffer.from('a')));
    expect(contentObjectName('content/catalog.json', Buffer.from('a'))).not.toBe(contentObjectName('content/catalog.json', Buffer.from('b')));
    for (const key of ['content/catalog.json', 'content/skills.json', 'content/cast.json', 'content/examples.json', 'content/chapters/spanish-spain.json', 'content/voices/spanish-spain.json']) {
      expect(index[key], key).toMatch(/\.[0-9a-f]{12}\.json$/);
    }
    // The file every course's voices are split from is not one the app reads.
    expect(Object.keys(index)).not.toContain('content/voices.json');
    expect(Object.keys(index).filter((k) => k.startsWith('content/chapters/'))).toHaveLength(30);
  });

  it('publishes the clips under their own names, and everything for good (the index aside)', () => {
    const clips = objects.filter((o) => o.name.startsWith('audio/'));
    expect(clips.length).toBeGreaterThan(2000);
    expect(clips.every((o) => /^audio\/(lines|tatoeba|narration)\/[^/]+\.mp3$/.test(o.name) && o.contentType === 'audio/mpeg')).toBe(true);
    expect(objects.every((o) => o.cacheControl === IMMUTABLE)).toBe(true);
    expect(new Set(objects.map((o) => o.name)).size).toBe(objects.length);
    const doc = JSON.parse(indexDocument(index, new Date('2026-11-12T00:00:00Z'))) as { schemaVersion: number; files: Record<string, string> };
    expect(doc.schemaVersion).toBe(1);
    expect(doc.files).toEqual(index);
  });
});
