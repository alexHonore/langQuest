/**
 * Offline checks of the admin structure/speakers/rights/visual/suggestion routes: role gates answer before any
 * database call, bodies and params are validated with the contracts schemas, and the image header sniffer used by
 * `adminVisualAssetRegister` reads real dimensions (and refuses what it cannot read).
 */
import { describe, expect, it } from 'vitest';
import { imageMimeMatches, sniffImage } from '../../lib/images';
import { call, offlineApp, signTestToken } from '../harness';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const EDITOR = '33333333-3333-4333-8333-333333333333';
const SUPPORT = '44444444-4444-4444-8444-444444444444';
const ID = '55555555-5555-4555-8555-555555555555';

describe('admin structure routes (offline)', () => {
  const ctx = offlineApp({ [ADMIN]: ['admin'], [EDITOR]: ['content_editor'], [SUPPORT]: ['support_readonly'] });

  it('every new admin route is gated: anonymous 401, learner 403, read-only staff cannot mutate', async () => {
    const learner = await signTestToken(LEARNER);
    const support = await signTestToken(SUPPORT);
    for (const path of ['/v1/admin/speakers', '/v1/admin/library/collections', '/v1/admin/content-rights', '/v1/admin/visual-assets', '/v1/admin/asset-suggestions']) {
      expect((await call(ctx, path)).status, path).toBe(401);
      expect((await call(ctx, path, { token: learner })).status, path).toBe(403);
    }
    const mutations: [string, string, unknown][] = [
      ['POST', '/v1/admin/speakers', { displayName: 'x', idempotencyKey: 'key-12345678' }],
      ['PATCH', `/v1/admin/speakers/${ID}`, { region: 'x' }],
      ['DELETE', `/v1/admin/speakers/${ID}`, {}],
      ['POST', '/v1/admin/library/collections', { titleTranslations: { en: 'x' }, idempotencyKey: 'key-12345678' }],
      ['POST', `/v1/admin/library/collections/${ID}/chapters/reorder`, { orderedIds: [ID], idempotencyKey: 'key-12345678' }],
      ['POST', '/v1/admin/library/lessons', { chapterId: ID, titleTranslations: { en: 'x' }, idempotencyKey: 'key-12345678' }],
      ['POST', '/v1/admin/content-rights', { permissionGrant: 'x', licenseId: 'cc-by', idempotencyKey: 'key-12345678' }],
      ['POST', `/v1/admin/content-rights/${ID}/revoke`, { reason: 'takedown', idempotencyKey: 'key-12345678' }],
      ['POST', '/v1/admin/visual-assets', { uploadId: ID, type: 'mission_scene', styleVersion: 'v1', altTextTranslations: { en: 'x' }, origin: 'original_upload', idempotencyKey: 'key-12345678' }],
      ['POST', `/v1/admin/visual-assets/${ID}/assign`, { entityTable: 'missions', entityId: ID, slot: 'scene', idempotencyKey: 'key-12345678' }],
      ['POST', `/v1/admin/asset-suggestions/${ID}/decide`, { decision: 'approve', idempotencyKey: 'key-12345678' }],
      ['POST', '/v1/admin/asset-suggestions/bulk-decide', { suggestionIds: [ID], decision: 'reject', idempotencyKey: 'key-12345678' }],
    ];
    for (const [method, path, body] of mutations) {
      const res = await call(ctx, path, { method, token: support, body });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.json.error.code).toBe('forbidden');
    }
  });

  it('validates bodies, params and queries with the contracts schemas before any database call', async () => {
    const editor = await signTestToken(EDITOR);
    const admin = await signTestToken(ADMIN);
    expect((await call(ctx, '/v1/admin/speakers', { token: editor, body: { displayName: '' } })).status).toBe(422);
    expect((await call(ctx, '/v1/admin/speakers/not-a-uuid', { token: editor })).status).toBe(422);
    expect((await call(ctx, '/v1/admin/speakers?consentState=maybe', { token: editor })).status).toBe(422);
    // An empty PATCH is refused (at least one field), as is a reorder with a repeated id.
    expect((await call(ctx, `/v1/admin/library/collections/${ID}`, { method: 'PATCH', token: editor, body: { expectedRevision: 1 } })).status).toBe(422);
    const dup = await call(ctx, `/v1/admin/library/chapters/${ID}/lessons/reorder`, { token: editor, body: { orderedIds: [ID, ID], idempotencyKey: 'key-12345678' } });
    expect(dup.status).toBe(422);
    expect(JSON.stringify(dup.json.error.details)).toContain('orderedIds');
    // Visual uploads accept image MIME types only; alt text needs `en`; slots are validated per table.
    expect((await call(ctx, '/v1/admin/visual-assets/upload-initiate', { token: editor, body: { filename: 'a.mp3', contentType: 'audio/mpeg', byteLength: 10, clientChecksumSha256: 'a'.repeat(64), idempotencyKey: 'key-12345678' } })).status).toBe(422);
    const noEn = await call(ctx, '/v1/admin/visual-assets', { token: editor, body: { uploadId: ID, type: 'mission_scene', styleVersion: 'v1', altTextTranslations: { fr: 'x' }, origin: 'original_upload', idempotencyKey: 'key-12345678' } });
    expect(noEn.status).toBe(422);
    expect(JSON.stringify(noEn.json.error.details)).toContain('altTextTranslations');
    expect((await call(ctx, `/v1/admin/visual-assets/${ID}/assign`, { token: admin, body: { entityTable: 'characters', entityId: ID, slot: 'nope', idempotencyKey: 'key-12345678' } })).status).toBe(422);
    expect((await call(ctx, '/v1/admin/asset-suggestions?minConfidence=2', { token: editor })).status).toBe(422);
    expect((await call(ctx, '/v1/admin/content-rights', { token: admin, body: { permissionGrant: 'x', idempotencyKey: 'key-12345678' } })).status).toBe(422);
  });
});

describe('image header sniffing', () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  };
  it('reads PNG, JPEG, GIF, WebP and SVG dimensions', () => {
    expect(sniffImage(png(1024, 768))).toEqual({ mimeType: 'image/png', width: 1024, height: 768 });
    // JPEG: SOI, APP0 (length 16), SOF0 (height 300, width 400).
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x01, 0x2c, 0x01, 0x90, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImage(jpeg)).toEqual({ mimeType: 'image/jpeg', width: 400, height: 300 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x08, 0x00, 0, 0]);
    expect(sniffImage(gif)).toEqual({ mimeType: 'image/gif', width: 16, height: 8 });
    const webp = new Uint8Array(32);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 0x1f, 0x00, 0x00, 0x0f, 0x00, 0x00]);
    expect(sniffImage(webp)).toEqual({ mimeType: 'image/webp', width: 32, height: 16 });
    expect(sniffImage(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect/></svg>'))).toEqual({ mimeType: 'image/svg+xml', width: 640, height: 480 });
    expect(sniffImage(new TextEncoder().encode('<svg width="12px" height="34"></svg>'))).toEqual({ mimeType: 'image/svg+xml', width: 12, height: 34 });
  });
  it('refuses what it cannot read (no invented size) and compares containers to the declared MIME', () => {
    expect(sniffImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
    expect(sniffImage(png(0, 10))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(imageMimeMatches('image/jpg', 'image/jpeg')).toBe(true);
    expect(imageMimeMatches('image/png', 'image/webp')).toBe(false);
  });
});
