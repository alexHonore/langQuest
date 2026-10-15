import { describe, expect, it } from 'vitest';
import { buildDerivedKey, buildMasterKey, buildPublicKey, buildUploadStagingKey, extensionForMime, isPublicKey, isValidObjectKey, parseObjectKey } from './keys';

const ASSET = '0f1e2d3c-4b5a-4968-8777-665544332211';
const HASH = 'a'.repeat(64);

describe('object keys', () => {
  it('builds master/derived/staging keys from ids and hashes only', () => {
    expect(buildMasterKey({ assetId: ASSET, contentHash: HASH, mimeType: 'audio/mpeg' })).toBe(`media/${ASSET}/${HASH}.mp3`);
    expect(buildMasterKey({ assetId: ASSET, contentHash: HASH.toUpperCase(), mimeType: 'audio/x-m4a' })).toBe(`media/${ASSET}/${HASH}.m4a`);
    expect(buildDerivedKey({ assetId: ASSET, variant: 'opus', hash: HASH, mimeType: 'audio/ogg' })).toBe(`derived/${ASSET}/opus/${HASH}.ogg`);
    expect(buildUploadStagingKey({ uploadId: ASSET, clientChecksumSha256: HASH, ext: 'wav' })).toBe(`uploads/${ASSET}/${HASH}.wav`);
  });

  it('never accepts filenames, unknown types or malformed ids', () => {
    expect(() => buildMasterKey({ assetId: 'my-file.mp3', contentHash: HASH, mimeType: 'audio/mpeg' })).toThrow(/UUID/);
    expect(() => buildMasterKey({ assetId: ASSET, contentHash: '../etc', mimeType: 'audio/mpeg' })).toThrow(/SHA-256/);
    expect(() => buildMasterKey({ assetId: ASSET, contentHash: HASH, mimeType: 'application/x-msdownload' })).toThrow(/Unsupported MIME/);
    expect(() => buildMasterKey({ assetId: ASSET, contentHash: HASH, ext: '../mp3' })).toThrow(/extension/);
    expect(() => buildDerivedKey({ assetId: ASSET, variant: 'evil' as never, hash: HASH, ext: 'mp3' })).toThrow(/variant/);
    expect(extensionForMime('audio/mpeg; charset=binary')).toBe('mp3');
    expect(extensionForMime('text/html')).toBeNull();
  });

  it('only allows explicitly approved kinds under the public prefix', () => {
    expect(buildPublicKey({ assetId: ASSET, contentHash: HASH, mimeType: 'image/png', kind: 'image', visibility: 'public' })).toBe(`public/image/${ASSET}/${HASH}.png`);
    expect(() => buildPublicKey({ assetId: ASSET, contentHash: HASH, mimeType: 'audio/mpeg', kind: 'audio', visibility: 'public' })).toThrow(/never public/);
    expect(() => buildPublicKey({ assetId: ASSET, contentHash: HASH, mimeType: 'image/png', kind: 'image', visibility: 'private' })).toThrow(/visibility/);
  });

  it('parses and validates keys', () => {
    expect(parseObjectKey(`media/${ASSET}/${HASH}.mp3`)).toEqual({ scope: 'master', assetId: ASSET, contentHash: HASH, ext: 'mp3' });
    expect(parseObjectKey(`derived/${ASSET}/slow_075/${HASH}.m4a`)).toMatchObject({ scope: 'derived', variant: 'slow_075' });
    expect(parseObjectKey(`public/image/${ASSET}/${HASH}.png`)).toMatchObject({ scope: 'public', kind: 'image' });
    expect(parseObjectKey(`public/audio/${ASSET}/${HASH}.mp3`)).toBeNull();
    expect(parseObjectKey('media/lesson 3.mp3')).toBeNull();
    expect(parseObjectKey(`derived/${ASSET}/bogus/${HASH}.m4a`)).toBeNull();
    expect(isValidObjectKey(`uploads/${ASSET}/${HASH}.flac`)).toBe(true);
    expect(isPublicKey(`media/${ASSET}/${HASH}.mp3`)).toBe(false);
  });
});
