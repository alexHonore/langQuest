import { createReadStream } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContentTypeMismatchError, assertSafeRelativePath, checkRelativePath, extractAudioMetadata, filenameExtension, isCompatibleMime, normalizeFilename, sniffContainer, verifyDeclaredContentType } from './metadata';
import { FIXTURE_DURATION_SEC, FIXTURE_TAGS, fixturePath, fixturesDir, readFixture } from './test/fixtures';

const hasFixtures = Boolean(fixturesDir());

describe('sniffContainer', () => {
  it('recognises magic bytes', () => {
    expect(sniffContainer(new TextEncoder().encode('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000'))?.format).toBe('mp3');
    expect(sniffContainer(new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0]))?.format).toBe('mp3');
    expect(sniffContainer(new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0]))?.format).toBe('aac');
    expect(sniffContainer(new TextEncoder().encode('fLaC\u0000\u0000\u0000\u0022'))?.format).toBe('flac');
    expect(sniffContainer(new TextEncoder().encode('OggS\u0000\u0002\u0000\u0000'))?.format).toBe('ogg');
    expect(sniffContainer(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WAVEfmt '))?.format).toBe('wav');
    expect(sniffContainer(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))?.format).toBe('webp');
    expect(sniffContainer(new TextEncoder().encode('\u0000\u0000\u0000\u0020ftypM4A \u0000\u0000'))?.format).toBe('m4a');
    expect(sniffContainer(new TextEncoder().encode('\u0000\u0000\u0000\u0020ftypavif\u0000\u0000'))?.format).toBe('avif');
    expect(sniffContainer(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.format).toBe('png');
    expect(sniffContainer(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))?.format).toBe('jpeg');
    expect(sniffContainer(new TextEncoder().encode('PK\u0003\u0004zipzipzip'))).toBeNull();
    expect(sniffContainer(new TextEncoder().encode('MZ\u0090\u0000exe'))).toBeNull();
  });

  it('rejects spoofed content types', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    const res = verifyDeclaredContentType('audio/mpeg', png);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('content_type_mismatch');
    expect(verifyDeclaredContentType('audio/mpeg', new TextEncoder().encode('MZ\u0090\u0000exe-exe-exe-exe')).ok).toBe(false);
    expect(verifyDeclaredContentType('image/png', png).ok).toBe(true);
    expect(verifyDeclaredContentType('audio/x-m4a', new TextEncoder().encode('\u0000\u0000\u0000\u0020ftypM4A \u0000\u0000\u0000\u0000')).ok).toBe(true);
    expect(isCompatibleMime('audio/x-wav', 'audio/wav')).toBe(true);
    expect(isCompatibleMime('audio/mpeg', 'audio/wav')).toBe(false);
  });
});

describe.skipIf(!hasFixtures)('extractAudioMetadata (ffmpeg fixtures)', () => {
  it('extracts WAV format info from a buffer', async () => {
    const meta = await extractAudioMetadata(await readFixture('wav'), 'tone.wav', { declaredMimeType: 'audio/wav' });
    expect(meta.sniffed?.format).toBe('wav');
    expect(meta.container).toBe('WAVE');
    expect(meta.channels).toBe(1);
    expect(meta.sampleRateHz).toBe(22050);
    expect(meta.durationMs).toBeGreaterThanOrEqual(FIXTURE_DURATION_SEC * 1000 - 50);
    expect(meta.durationMs).toBeLessThanOrEqual(FIXTURE_DURATION_SEC * 1000 + 50);
    expect(meta.lossless).toBe(true);
    expect(meta.embeddedCover.present).toBe(false);
  });

  it('extracts MP3 ID3 tags, bitrate and embedded cover', async () => {
    const meta = await extractAudioMetadata(await readFixture('mp3'), 'tone.mp3');
    expect(meta.sniffed?.format).toBe('mp3');
    expect(meta.codec).toMatch(/MPEG/i);
    expect(meta.tags.title).toBe(FIXTURE_TAGS.title);
    expect(meta.tags.artist).toBe(FIXTURE_TAGS.artist);
    expect(meta.tags.album).toBe(FIXTURE_TAGS.album);
    expect(meta.tags.track.no).toBe(3);
    expect(meta.bitrateKbps).toBeGreaterThanOrEqual(56);
    expect(meta.bitrateKbps).toBeLessThanOrEqual(72);
    expect(meta.tagTypes.some((t) => t.startsWith('ID3v2'))).toBe(true);
    expect(meta.embeddedCover.present).toBe(true);
    expect(meta.embeddedCover.mimeType).toBe('image/png');
    expect(meta.durationMs).toBeGreaterThan(1800);
    expect(meta.durationMs).toBeLessThan(2300);
    expect(meta.tags.language).toContain('fra');
  });

  it('extracts M4A (AAC) and FLAC metadata', async () => {
    const m4a = await extractAudioMetadata(await readFixture('m4a'));
    expect(m4a.sniffed?.format).toBe('m4a');
    expect(m4a.channels).toBe(2);
    expect(m4a.codec).toMatch(/AAC/i);
    expect(m4a.tags.title).toBe(FIXTURE_TAGS.title);
    const flac = await extractAudioMetadata(await readFixture('flac'));
    expect(flac.sniffed?.format).toBe('flac');
    expect(flac.lossless).toBe(true);
    expect(flac.tags.title).toBe(FIXTURE_TAGS.title);
  });

  it('works from a Node stream and a Web stream', async () => {
    const fromNode = await extractAudioMetadata(createReadStream(fixturePath('mp3')), 'tone.mp3', { exactDuration: true });
    expect(fromNode.tags.title).toBe(FIXTURE_TAGS.title);
    expect(fromNode.durationEstimated).toBe(false);
    const bytes = await readFixture('flac');
    const web = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.subarray(0, 5)); c.enqueue(bytes.subarray(5, 300)); c.enqueue(bytes.subarray(300)); c.close(); } });
    const fromWeb = await extractAudioMetadata(web, undefined, { declaredMimeType: 'audio/flac' });
    expect(fromWeb.sniffed?.format).toBe('flac');
    expect(fromWeb.tags.album).toBe(FIXTURE_TAGS.album);
  });

  it('throws ContentTypeMismatchError when the declared type is spoofed', async () => {
    await expect(extractAudioMetadata(await readFixture('png'), 'cover.png', { declaredMimeType: 'audio/mpeg' })).rejects.toBeInstanceOf(ContentTypeMismatchError);
    await expect(extractAudioMetadata(await readFixture('wav'), undefined, { declaredMimeType: 'audio/mpeg' })).rejects.toThrow(/sniffs as audio\/wav/);
  });
});

describe('filenames and paths', () => {
  it('normalises unsafe filenames without using them as keys', () => {
    expect(normalizeFilename('  ../../etc/passwd ')).toBe('passwd');
    expect(normalizeFilename('..hidden.mp3')).toBe('hidden.mp3');
    expect(normalizeFilename('C:\\Users\\x\\03 - Lesson 3.mp3')).toBe('03 - Lesson 3.mp3');
    expect(normalizeFilename('bad\u0000name\u202e.mp3')).toBe('badname.mp3');
    expect(normalizeFilename('CON')).toBe('_CON');
    expect(normalizeFilename('')).toBe('untitled');
    expect(normalizeFilename('   ')).toBe('untitled');
    expect(normalizeFilename('e\u0301te\u0301.mp3')).toBe('été.mp3');
    const long = `${'a'.repeat(300)}.mp3`;
    expect(normalizeFilename(long).length).toBeLessThanOrEqual(255);
    expect(normalizeFilename(long).endsWith('.mp3')).toBe(true);
    expect(filenameExtension('Track 05.MP3')).toBe('mp3');
    expect(filenameExtension('noext')).toBeNull();
  });

  it('rejects path traversal and absolute paths', () => {
    expect(checkRelativePath('Unit 2/Track 05.mp3')).toMatchObject({ ok: true, normalized: 'Unit 2/Track 05.mp3', segments: ['Unit 2', 'Track 05.mp3'] });
    expect(checkRelativePath('a\\b\\c.mp3')).toMatchObject({ ok: true, normalized: 'a/b/c.mp3' });
    for (const bad of ['../x.mp3', 'a/../../x.mp3', '/etc/passwd', 'C:/x.mp3', 'a/%2e%2e/x.mp3', 'a/\u0000/x.mp3', '', './x.mp3']) {
      expect(checkRelativePath(bad).ok, bad).toBe(false);
    }
    expect(() => assertSafeRelativePath('../x')).toThrow(/Unsafe/);
  });
});
