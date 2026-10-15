import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RouteKey } from '@langquest/contracts';
import type { ApiClient, CallOptions } from '../api';
import { UploadEngine } from './engine';
import { createMainThreadHasher } from './hasher';
import { MemoryUploadStore } from './store';
import { PartUploadError, type PartTransport, type PutPartOptions } from './transport';

const PART = 1024;
const bytes = (n: number, seed: number) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** In-memory stand-in for the API's multipart lifecycle (initiate/sign/complete/abort). */
class FakeServer {
  sessions = new Map<string, { uploadId: string; checksum: string; byteLength: number; partCount: number; parts: Map<number, string>; status: string }>();
  byKey = new Map<string, string>();
  knownAssets = new Map<string, string>(); // checksum → assetId
  calls: string[] = [];
  nextId = 1;
  api: Pick<ApiClient, 'call'> = {
    call: async <K extends RouteKey>(key: K, opts: CallOptions<K> = {}) => {
      this.calls.push(key);
      const body = opts.body as Record<string, unknown>;
      const params = opts.params as Record<string, string> | undefined;
      if (key === 'adminUploadInitiate') {
        const existingId = this.byKey.get(String(body.idempotencyKey));
        const existing = existingId ? this.sessions.get(existingId) : undefined;
        if (existing) {
          return {
            uploadId: existing.uploadId,
            storageKey: `uploads/${existing.uploadId}/${existing.checksum}.mp3`,
            partSizeBytes: PART,
            partCount: existing.partCount,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            status: 'uploading',
            duplicateOfAssetId: null,
            resumed: true,
            completedPartNumbers: [...existing.parts.keys()],
          } as never;
        }
        const uploadId = uuid(this.nextId++);
        const byteLength = Number(body.byteLength);
        const partCount = Math.max(1, Math.ceil(byteLength / PART));
        const checksum = String(body.clientChecksumSha256);
        this.sessions.set(uploadId, { uploadId, checksum, byteLength, partCount, parts: new Map(), status: 'initiated' });
        this.byKey.set(String(body.idempotencyKey), uploadId);
        return {
          uploadId,
          storageKey: `uploads/${uploadId}/${checksum}.mp3`,
          partSizeBytes: PART,
          partCount,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          status: 'initiated',
          duplicateOfAssetId: this.knownAssets.get(checksum) ?? null,
          resumed: false,
          completedPartNumbers: [],
        } as never;
      }
      if (key === 'adminUploadPartsSign') {
        const s = this.sessions.get(params!.id!)!;
        return { parts: (body.partNumbers as number[]).map((n) => ({ partNumber: n, url: `https://r2.test/${s.uploadId}/${n}`, expiresAt: new Date(Date.now() + 3600_000).toISOString() })) } as never;
      }
      if (key === 'adminUploadComplete') {
        const s = this.sessions.get(params!.id!)!;
        const parts = body.parts as Array<{ partNumber: number; etag: string; byteLength: number }>;
        const ok = parts.length === s.partCount && parts.every((p) => s.parts.get(p.partNumber) === p.etag) && body.clientChecksumSha256 === s.checksum;
        s.status = ok ? 'verified' : 'failed';
        return {
          uploadId: s.uploadId,
          status: s.status,
          assetId: ok ? uuid(900 + this.nextId++) : null,
          verifiedChecksumSha256: ok ? s.checksum : null,
          byteLength: s.byteLength,
          durationMs: null,
          contentState: ok ? 'imported_draft' : null,
          queuedJobIds: [],
          failureCode: ok ? null : 'checksum_mismatch',
        } as never;
      }
      if (key === 'adminUploadAbort') {
        const s = this.sessions.get(params!.id!);
        if (s) s.status = 'aborted';
        return { uploadId: params!.id, status: 'aborted' } as never;
      }
      throw new Error(`unexpected route ${key}`);
    },
  };
  /** Transport that records bytes on the fake server and can fail or block. */
  transport(options: { failTimes?: Map<string, number>; blockPart?: (url: string) => boolean } = {}): PartTransport & { stored: Map<string, Uint8Array> } {
    const stored = new Map<string, Uint8Array>();
    const failTimes = options.failTimes ?? new Map<string, number>();
    const sessions = this.sessions;
    return {
      stored,
      async putPart(url: string, body: Blob, opts: PutPartOptions = {}) {
        if (opts.signal?.aborted) throw new PartUploadError('aborted', null, false);
        if (options.blockPart?.(url)) {
          await new Promise<void>((_, reject) => opts.signal?.addEventListener('abort', () => reject(new PartUploadError('aborted', null, false)), { once: true }));
        }
        const remaining = failTimes.get(url) ?? 0;
        if (remaining > 0) {
          failTimes.set(url, remaining - 1);
          throw new PartUploadError('503 from storage', 503, true);
        }
        const data = new Uint8Array(await body.arrayBuffer());
        opts.onProgress?.(data.byteLength);
        stored.set(url, data);
        const [, uploadId, n] = url.replace('https://r2.test/', '').match(/^(.+)\/(\d+)$/)!;
        const etag = createHash('md5').update(data).digest('hex');
        sessions.get(uploadId!)!.parts.set(Number(n), etag);
        return { etag };
      },
    };
  }
}

function makeEngine(server: FakeServer, transport: PartTransport, store = new MemoryUploadStore(), extra: Partial<ConstructorParameters<typeof UploadEngine>[0]> = {}) {
  let id = 1;
  return new UploadEngine({
    api: server.api,
    store,
    hasher: createMainThreadHasher(),
    transport,
    partSizeBytes: PART,
    partConcurrency: 2,
    fileConcurrency: 2,
    newId: () => uuid(100 + id++),
    sleep: async () => undefined,
    ...extra,
  });
}

describe('UploadEngine', () => {
  it('uploads a multi-part file end to end with verified checksum', async () => {
    const server = new FakeServer();
    const transport = server.transport();
    const engine = makeEngine(server, transport);
    const data = bytes(PART * 3 + 17, 1);
    engine.addFiles([{ file: new File([data], 'lesson 01.mp3', { type: 'audio/mpeg' }), relativePath: 'Course/Unit 1/lesson 01.mp3' }]);
    engine.start();
    await engine.idle();
    const item = engine.getItems()[0]!;
    expect(item.state).toBe('done');
    expect(item.checksumSha256).toBe(createHash('sha256').update(data).digest('hex'));
    expect(item.partCount).toBe(4);
    expect(Object.keys(item.completedParts)).toHaveLength(4);
    expect(item.result?.status).toBe('verified');
    expect(item.suggestion?.lessonOrder).toBe(1);
    const reassembled = Buffer.concat([1, 2, 3, 4].map((n) => Buffer.from(transport.stored.get(`https://r2.test/${item.uploadId}/${n}`)!)));
    expect(createHash('sha256').update(reassembled).digest('hex')).toBe(item.checksumSha256);
  });

  it('resumes after an interruption without re-uploading finished parts (A18)', async () => {
    const server = new FakeServer();
    const store = new MemoryUploadStore();
    let blocked = true;
    const transport = server.transport({ blockPart: (url) => blocked && url.endsWith('/3') });
    const engine = makeEngine(server, transport, store);
    const data = bytes(PART * 5, 2);
    const file = new File([data], 'big.mp3', { type: 'audio/mpeg' });
    engine.addFiles([{ file }]);
    engine.start();
    // wait until parts 1-2 are done and part 3 is blocked
    for (let i = 0; i < 200 && Object.keys(engine.getItems()[0]!.completedParts).length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    engine.pause();
    await engine.idle();
    expect(engine.getItems()[0]!.state).toBe('paused');
    const persisted = await store.list();
    expect(persisted).toHaveLength(1);
    expect(Object.keys(persisted[0]!.completedParts).length).toBeGreaterThanOrEqual(2);
    engine.dispose();

    // "reload": a fresh engine restores the session, the editor re-selects the same file
    blocked = false;
    const putCountBefore = transport.stored.size;
    const engine2 = makeEngine(server, transport, store);
    const restored = await engine2.restore();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.file).toBeNull();
    engine2.addFiles([{ file }]);
    engine2.start();
    await engine2.idle();
    const item = engine2.getItems()[0]!;
    expect(item.state).toBe('done');
    expect(item.resumed).toBe(true);
    expect(server.calls.filter((c) => c === 'adminUploadInitiate')).toHaveLength(2);
    expect(server.sessions.size).toBe(1); // same idempotency key → same session, no duplicate asset
    expect(transport.stored.size - putCountBefore).toBeLessThanOrEqual(3);
    expect(await store.list()).toHaveLength(0);
  });

  it('detects local and remote duplicates by content hash', async () => {
    const server = new FakeServer();
    const engine = makeEngine(server, server.transport());
    const data = bytes(PART + 5, 3);
    const known = bytes(PART, 4);
    server.knownAssets.set(createHash('sha256').update(known).digest('hex'), uuid(777));
    engine.addFiles([
      { file: new File([data], 'a.mp3', { type: 'audio/mpeg' }), relativePath: 'x/a.mp3' },
      { file: new File([data], 'copy of a.mp3', { type: 'audio/mpeg' }), relativePath: 'y/copy of a.mp3' },
      { file: new File([known], 'known.mp3', { type: 'audio/mpeg' }) },
    ]);
    engine.start();
    await engine.idle();
    const [a, copy, knownItem] = engine.getItems();
    expect(a!.state).toBe('done');
    expect(copy!.state).toBe('duplicate');
    expect(copy!.duplicateOfLocalId).toBe(a!.localId);
    expect(knownItem!.state).toBe('duplicate');
    expect(knownItem!.duplicateOfAssetId).toBe(uuid(777));
    expect(server.calls.filter((c) => c === 'adminUploadAbort')).toHaveLength(1);
  });

  it('retries transient part failures, fails hard on permanent ones, and supports retry/cancel', async () => {
    const server = new FakeServer();
    const failTimes = new Map<string, number>();
    const transport = server.transport({ failTimes });
    const engine = makeEngine(server, transport, new MemoryUploadStore(), { maxPartRetries: 2 });
    const data = bytes(PART * 2, 5);
    engine.addFiles([{ file: new File([data], 't.mp3', { type: 'audio/mpeg' }) }]);
    // the first session id is deterministic
    failTimes.set(`https://r2.test/${uuid(1)}/2`, 1);
    engine.start();
    await engine.idle();
    expect(engine.getItems()[0]!.state).toBe('done');

    const server2 = new FakeServer();
    const fail2 = new Map<string, number>([[`https://r2.test/${uuid(1)}/1`, 10]]);
    const engine2 = makeEngine(server2, server2.transport({ failTimes: fail2 }), new MemoryUploadStore(), { maxPartRetries: 1 });
    engine2.addFiles([{ file: new File([data], 't.mp3', { type: 'audio/mpeg' }) }]);
    engine2.start();
    await engine2.idle();
    const failed = engine2.getItems()[0]!;
    expect(failed.state).toBe('failed');
    expect(failed.error).toContain('503');
    fail2.clear();
    engine2.retry(failed.localId);
    await engine2.idle();
    expect(engine2.getItems()[0]!.state).toBe('done');

    const engine3 = makeEngine(server2, server2.transport({ blockPart: () => true }));
    engine3.addFiles([{ file: new File([data], 'c.mp3', { type: 'audio/mpeg' }) }]);
    engine3.start();
    for (let i = 0; i < 200 && engine3.getItems()[0]!.state !== 'uploading'; i++) await new Promise((r) => setTimeout(r, 5));
    const id = engine3.getItems()[0]!.localId;
    await engine3.cancel(id);
    await engine3.idle();
    expect(engine3.getItems()[0]!.state).toBe('cancelled');
    expect(server2.calls).toContain('adminUploadAbort');
  });

  it('rejects unsupported and empty files honestly instead of uploading them', () => {
    const server = new FakeServer();
    const engine = makeEngine(server, server.transport());
    const [exe, empty] = engine.addFiles([
      { file: new File([new Uint8Array(4)], 'setup.exe', { type: 'application/x-msdownload' }) },
      { file: new File([], 'empty.mp3', { type: 'audio/mpeg' }) },
    ]);
    expect(exe!.state).toBe('unsupported');
    expect(exe!.error).toContain('unsupported_type');
    expect(empty!.state).toBe('unsupported');
    expect(empty!.error).toBe('empty_file');
  });
});
