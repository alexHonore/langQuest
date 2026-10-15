import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalFsObjectStore, ObjectKeyError, R2ObjectStore, assertObjectKey, createObjectStore } from './r2';
import { readJobsEnv } from './config';

describe('LocalFsObjectStore (dev-only)', () => {
  let root: string;
  let store: LocalFsObjectStore;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lq-store-'));
    store = new LocalFsObjectStore(root, 'bucket');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('puts, heads, gets, copies, lists and deletes objects', async () => {
    const head = await store.put('media/a/b.txt', 'hello', { contentType: 'text/plain' });
    expect(head.byteLength).toBe(5);
    expect((await store.head('media/a/b.txt'))?.contentType).toBe('text/plain');
    expect(new TextDecoder().decode((await store.getBytes('media/a/b.txt'))!)).toBe('hello');
    await store.copy('media/a/b.txt', 'derived/a/c.txt');
    expect((await store.head('derived/a/c.txt'))?.contentType).toBe('text/plain');
    const listed = await store.listAll('media/');
    expect(listed.map((o) => o.key)).toEqual(['media/a/b.txt']);
    const page = await store.list('', { limit: 1 });
    expect(page.objects.length).toBe(1);
    expect(page.truncated).toBe(true);
    await store.delete('media/a/b.txt');
    expect(await store.head('media/a/b.txt')).toBeNull();
    expect(await store.getBytes('media/a/b.txt')).toBeNull();
  });

  it('streams to and from files', async () => {
    const src = join(root, 'src.bin');
    await (await import('node:fs/promises')).writeFile(src, Buffer.alloc(70_000, 7));
    await store.putFile('uploads/x.bin', src, { contentType: 'application/octet-stream' });
    const dest = join(root, 'out', 'dest.bin');
    const head = await store.getToFile('uploads/x.bin', dest);
    expect(head.byteLength).toBe(70_000);
    expect((await readFile(dest)).length).toBe(70_000);
  });

  it('supports multipart upload', async () => {
    const handle = await store.createMultipart('media/mp.bin', { contentType: 'application/octet-stream' });
    const p2 = await store.uploadPart(handle, 2, new Uint8Array([3, 4]));
    const p1 = await store.uploadPart(handle, 1, new Uint8Array([1, 2]));
    const head = await store.completeMultipart(handle, [p2, p1]);
    expect(head.byteLength).toBe(4);
    expect(Array.from((await store.getBytes('media/mp.bin'))!)).toEqual([1, 2, 3, 4]);
  });

  it('refuses path traversal and malformed keys', async () => {
    await expect(store.put('../escape.txt', 'x')).rejects.toBeInstanceOf(ObjectKeyError);
    await expect(store.put('media/../../escape.txt', 'x')).rejects.toBeInstanceOf(ObjectKeyError);
    expect(() => assertObjectKey('/abs')).toThrow(ObjectKeyError);
    expect(() => assertObjectKey('ok/key.txt')).not.toThrow();
  });

  it('presigned urls are file urls (never for clients)', async () => {
    await store.put('media/a.txt', 'x');
    expect(await store.presignGet('media/a.txt', 60)).toMatch(/^file:\/\//);
  });
});

describe('createObjectStore', () => {
  it('falls back to the local store when R2 is not configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lq-store-'));
    const env = readJobsEnv({ LOCAL_OBJECT_STORE_DIR: root });
    const logs: string[] = [];
    const store = createObjectStore(env, { log: (m) => logs.push(m) });
    expect(store.kind).toBe('local');
    expect(logs[0]).toMatch(/DEV-ONLY/);
    await rm(root, { recursive: true, force: true });
  });

  it('builds an R2 client when the four variables are present', () => {
    const env = readJobsEnv({ R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'langquest-media' });
    const store = createObjectStore(env);
    expect(store).toBeInstanceOf(R2ObjectStore);
    expect(store.bucket).toBe('langquest-media');
  });

  it('refuses OBJECT_STORE=r2 without credentials', () => {
    expect(() => createObjectStore(readJobsEnv({ OBJECT_STORE: 'r2' }))).toThrow(/R2_ENDPOINT/);
  });
});
