import type { DownloadPackManifest } from '@langquest/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryDocumentStore } from '@/store/document-store';
import { DownloadIndex, bytesDownloaded, downloadFraction, isPlayableOffline, localAudioFile, recordFromManifest, summarizeStorage } from './download-index';
import { DownloadAbortedError, DownloadHttpError, DownloadManager, type DownloadFs } from './download-manager';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const now = (): string => new Date(1_700_000_000_000).toISOString();

const pack = (lessonId: string, opts: { expiresInMs?: number; distributionAllowed?: boolean; v?: number } = {}): DownloadPackManifest => ({
  formatVersion: 1,
  packId: uuid(900),
  lessonId,
  collectionId: uuid(1),
  version: opts.v ?? 1,
  checksum: 'c'.repeat(64),
  generatedAt: now(),
  totalBytes: 1_500,
  files: [
    { assetId: uuid(10), kind: 'audio', path: 'audio/10.mp3', contentHash: HASH_A, byteLength: 1_000, mimeType: 'audio/mpeg', url: `https://media/10?v=${opts.v ?? 1}`, urlExpiresAt: new Date(Date.now() + (opts.expiresInMs ?? 3_600_000)).toISOString() },
    { assetId: uuid(11), kind: 'subtitle', path: 'transcript.json', contentHash: HASH_B, byteLength: 500, mimeType: 'application/json', url: `https://media/11?v=${opts.v ?? 1}`, urlExpiresAt: new Date(Date.now() + (opts.expiresInMs ?? 3_600_000)).toISOString() },
  ],
  includesTranscript: true,
  distributionAllowed: opts.distributionAllowed ?? true,
  attributionText: 'CC BY — Yasmine',
});

const meta = { title: 'Les légumes', subtitle: 'Darija au café · Au marché', durationMs: 180_000, artworkUri: null, courseTrackId: 'arabic-moroccan' };

/** In-memory file system with scripted download behaviour. */
function fakeFs(script: { fail?: (url: string, attempt: number) => Error | null; hashes?: Record<string, string | null>; free?: number | null } = {}) {
  const files = new Map<string, { size: number; hash: string | null }>();
  const attempts = new Map<string, number>();
  const fs: DownloadFs = {
    packRoot: () => 'file:///packs',
    ensureDirectory: async () => undefined,
    download: async (url, dest, options) => {
      const n = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, n);
      if (options.signal.aborted) throw new DownloadAbortedError();
      const err = script.fail?.(url, n) ?? null;
      if (err) throw err;
      options.onProgress(Math.floor(options.expectedBytes / 2), options.expectedBytes);
      const assetHash = url.includes('/10') ? HASH_A : HASH_B;
      const hash = script.hashes && url.includes('/10') ? (script.hashes['10'] ?? assetHash) : assetHash;
      files.set(dest, { size: options.expectedBytes, hash });
    },
    exists: async (uri) => files.has(uri),
    size: async (uri) => files.get(uri)?.size ?? null,
    sha256: async (uri) => files.get(uri)?.hash ?? null,
    delete: async (uri) => void files.delete(uri),
    deleteDirectory: async (uri) => {
      for (const k of [...files.keys()]) if (k.startsWith(uri)) files.delete(k);
    },
    freeBytes: async () => (script.free === undefined ? 10_000_000_000 : script.free),
  };
  return { fs, files, attempts };
}

function setup(fsScript: Parameters<typeof fakeFs>[0] = {}, fetchPack?: (lessonId: string) => Promise<DownloadPackManifest>) {
  const store = new MemoryDocumentStore();
  const index = new DownloadIndex(store);
  const f = fakeFs(fsScript);
  const events: string[] = [];
  const fetch = vi.fn(fetchPack ?? (async (lessonId: string) => pack(lessonId)));
  const manager = new DownloadManager({ index, fs: f.fs, fetchPack: fetch, network: async () => ({ online: true, wifi: true }), wifiOnly: () => false, now, onEvent: (e) => events.push(e.type), minFreeBytes: 1_000 });
  return { index, manager, events, fetch, ...f };
}

const settle = async (manager: DownloadManager, lessonId: string, index: DownloadIndex): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((r) => setTimeout(r, 2));
    const r = await index.get(lessonId);
    if (r && !manager.isActive(lessonId) && (r.status === 'complete' || r.status === 'error' || r.status === 'waiting_wifi' || r.status === 'paused' || r.status === 'cancelled')) return;
  }
};

describe('download index helpers', () => {
  it('builds records from a manifest and reports progress / playability honestly', () => {
    const r = recordFromManifest(pack(uuid(5)), meta, now());
    expect(r.files).toHaveLength(2);
    expect(bytesDownloaded(r)).toBe(0);
    expect(isPlayableOffline(r)).toBe(false);
    r.files[0] = { ...r.files[0]!, state: 'done', localUri: 'file:///packs/x/audio/10.mp3', verifiedBy: 'sha256' };
    r.files[1] = { ...r.files[1]!, bytesWritten: 200 };
    expect(bytesDownloaded(r)).toBe(1_200);
    expect(downloadFraction(r)).toBeCloseTo(0.8);
    expect(isPlayableOffline(r)).toBe(false); // status still queued
    r.status = 'complete';
    expect(isPlayableOffline(r)).toBe(true);
    expect(localAudioFile(r, uuid(10))?.localUri).toBe('file:///packs/x/audio/10.mp3');
    // Partial bytes are not reusable (no resume), so only verified files count as "on disk".
    expect(summarizeStorage([r])).toEqual({ lessons: 1, completeLessons: 1, bytesOnDisk: 1_000, bytesPending: 0 });
  });
});

describe('DownloadManager', () => {
  it('downloads every file of the pack, verifies checksums and marks the lesson complete', async () => {
    const { manager, index, events, files } = setup();
    await manager.start(uuid(5), meta);
    await settle(manager, uuid(5), index);
    const r = await index.get(uuid(5));
    expect(r?.status).toBe('complete');
    expect(r?.files.map((f) => f.verifiedBy)).toEqual(['sha256', 'sha256']);
    expect(r?.bytesDownloaded).toBe(1_500);
    expect(r?.attributionText).toBe('CC BY — Yasmine');
    expect(files.has('file:///packs/' + uuid(5) + '/audio/10.mp3')).toBe(true);
    expect(events).toEqual(['started', 'completed']);
    expect(isPlayableOffline(r)).toBe(true);
  });

  it('discards files whose checksum does not match and fails after retries', async () => {
    const { manager, index, events } = setup({ hashes: { '10': 'f'.repeat(64) } });
    await manager.start(uuid(6), meta);
    await settle(manager, uuid(6), index);
    const r = await index.get(uuid(6));
    expect(r?.status).toBe('error');
    expect(r?.error).toBe('checksum_mismatch');
    expect(r?.files[0]?.localUri).toBeNull();
    expect(events.at(-1)).toBe('failed');
  });

  it('refreshes the pack (new signed URLs) after a 403 and resumes', async () => {
    let v = 0;
    const fetchPack = async (lessonId: string): Promise<DownloadPackManifest> => pack(lessonId, { v: ++v });
    const { manager, index, fetch } = setup({ fail: (url, attempt) => (url.endsWith('v=1') && attempt === 1 ? new DownloadHttpError(403) : null) }, fetchPack);
    await manager.start(uuid(7), meta);
    await settle(manager, uuid(7), index);
    expect((await index.get(uuid(7)))?.status).toBe('complete');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('waits for Wi-Fi when the learner asked for it and resumes on network change', async () => {
    const store = new MemoryDocumentStore();
    const index = new DownloadIndex(store);
    const f = fakeFs();
    let wifi = false;
    const manager = new DownloadManager({ index, fs: f.fs, fetchPack: async (id) => pack(id), network: async () => ({ online: true, wifi }), wifiOnly: () => true, now });
    await manager.start(uuid(8), meta);
    await settle(manager, uuid(8), index);
    expect((await index.get(uuid(8)))?.status).toBe('waiting_wifi');
    wifi = true;
    await manager.onNetworkChange();
    await settle(manager, uuid(8), index);
    expect((await index.get(uuid(8)))?.status).toBe('complete');
  });

  it('cancel removes the record and partial files; remove deletes a finished download', async () => {
    const { manager, index, files } = setup();
    await manager.start(uuid(9), meta);
    await settle(manager, uuid(9), index);
    expect(files.size).toBe(2);
    await manager.remove(uuid(9));
    expect(await index.get(uuid(9))).toBeNull();
    expect(files.size).toBe(0);
    await manager.start(uuid(9), meta);
    await manager.cancel(uuid(9));
    expect(await index.get(uuid(9))).toBeNull();
  });

  it('refuses when the device would drop below the free-space floor and reports rights blocks', async () => {
    const low = setup({ free: 2_000 });
    await low.manager.start(uuid(12), meta);
    await settle(low.manager, uuid(12), low.index);
    expect((await low.index.get(uuid(12)))?.error).toBe('disk_full');
    const blocked = setup({}, async (id) => pack(id, { distributionAllowed: false }));
    await blocked.manager.start(uuid(13), meta);
    await settle(blocked.manager, uuid(13), blocked.index);
    expect((await blocked.index.get(uuid(13)))?.error).toBe('rights_blocked');
  });
});

describe('DownloadManager: learner intent and connectivity', () => {
  /** A fetchPack the test resolves by hand, to race cancel()/pause() against run(). */
  function deferredPack() {
    let resolve: ((m: DownloadPackManifest) => void) | null = null;
    let released = false; // after the first manual release, later fetches resolve immediately
    const fetchPack = vi.fn((lessonId: string) => (released ? Promise.resolve(pack(lessonId)) : new Promise<DownloadPackManifest>((r) => { resolve = r; })));
    return {
      fetchPack,
      resolve: (lessonId: string) => {
        released = true;
        resolve?.(pack(lessonId));
      },
    };
  }

  it('cancel() during the pack fetch wins: the record does not resurrect as "downloading"', async () => {
    const store = new MemoryDocumentStore();
    const index = new DownloadIndex(store);
    const f = fakeFs();
    const d = deferredPack();
    const manager = new DownloadManager({ index, fs: f.fs, fetchPack: d.fetchPack, network: async () => ({ online: true, wifi: true }), wifiOnly: () => false, now, sleep: async () => undefined });
    await manager.start(uuid(20), meta);
    await new Promise((r) => setTimeout(r, 2));
    expect(d.fetchPack).toHaveBeenCalledTimes(1);
    await manager.cancel(uuid(20));
    expect(await index.get(uuid(20))).toBeNull();
    d.resolve(uuid(20));
    await new Promise((r) => setTimeout(r, 10));
    expect(await index.get(uuid(20))).toBeNull();
    expect(f.files.size).toBe(0);
    expect(manager.isActive(uuid(20))).toBe(false);
  });

  it('pause() during the pack fetch leaves the record paused (not restarted) and resumable later', async () => {
    const store = new MemoryDocumentStore();
    const index = new DownloadIndex(store);
    const f = fakeFs();
    const d = deferredPack();
    const manager = new DownloadManager({ index, fs: f.fs, fetchPack: d.fetchPack, network: async () => ({ online: true, wifi: true }), wifiOnly: () => false, now, sleep: async () => undefined });
    await manager.start(uuid(21), meta);
    await new Promise((r) => setTimeout(r, 2));
    await manager.pause(uuid(21));
    d.resolve(uuid(21));
    await new Promise((r) => setTimeout(r, 10));
    const r = await index.get(uuid(21));
    expect(r?.status).toBe('paused');
    expect(r?.bytesDownloaded).toBe(0);
    expect(f.files.size).toBe(0);
    await manager.retry(uuid(21));
    await settle(manager, uuid(21), index);
    expect((await index.get(uuid(21)))?.status).toBe('complete');
  });

  it('a transfer that dies with the network parks as paused/offline and resumes on reconnect', async () => {
    const store = new MemoryDocumentStore();
    const index = new DownloadIndex(store);
    let online = true;
    const f = fakeFs({ fail: (url, attempt) => (url.includes('/10') && attempt === 1 ? new Error('socket closed') : null) });
    const sleeps: number[] = [];
    const events: string[] = [];
    const manager = new DownloadManager({
      index,
      fs: f.fs,
      fetchPack: async (id) => pack(id),
      network: async () => ({ online, wifi: true }),
      wifiOnly: () => false,
      now,
      sleep: async (ms) => void sleeps.push(ms),
      onEvent: (e) => events.push(e.type),
    });
    online = false; // goes offline right as the first file fails
    // network() is consulted at start too, so start online then flip after the pack arrived.
    online = true;
    const original = f.fs.download;
    f.fs.download = async (url, dest, options) => {
      online = false;
      return original(url, dest, options);
    };
    await manager.start(uuid(22), meta);
    await settle(manager, uuid(22), index);
    const parked = await index.get(uuid(22));
    expect(parked?.status).toBe('paused');
    expect(parked?.error).toBe('offline');
    expect(DownloadManager.isWaitingForNetwork(parked!)).toBe(true);
    expect(sleeps).toEqual([]); // no retry storm while offline
    expect(events).toContain('paused');
    online = true;
    f.fs.download = original;
    await manager.onNetworkChange();
    await settle(manager, uuid(22), index);
    expect((await index.get(uuid(22)))?.status).toBe('complete');
  });

  it('backs off between attempts when the network is up but a transfer keeps failing', async () => {
    const sleeps: number[] = [];
    const store = new MemoryDocumentStore();
    const index = new DownloadIndex(store);
    const f = fakeFs({ fail: (url, attempt) => (url.includes('/10') && attempt <= 2 ? new Error('reset') : null) });
    const manager = new DownloadManager({ index, fs: f.fs, fetchPack: async (id) => pack(id), network: async () => ({ online: true, wifi: true }), wifiOnly: () => false, now, sleep: async (ms) => void sleeps.push(ms), retryBaseMs: 100 });
    await manager.start(uuid(23), meta);
    await settle(manager, uuid(23), index);
    expect((await index.get(uuid(23)))?.status).toBe('complete');
    expect(sleeps).toEqual([100, 200]);
  });

  it('markFileMissing reconciles a verified record whose file vanished and retry downloads it again', async () => {
    const { manager, index, files } = setup();
    await manager.start(uuid(24), meta);
    await settle(manager, uuid(24), index);
    const audioId = uuid(10);
    files.delete('file:///packs/' + uuid(24) + '/audio/10.mp3');
    await manager.markFileMissing(uuid(24), audioId);
    const r = await index.get(uuid(24));
    expect(r?.status).toBe('error');
    expect(r?.error).toBe('file_missing');
    expect(isPlayableOffline(r)).toBe(false);
    expect(summarizeStorage([r!]).bytesOnDisk).toBe(500); // only the file still verified on disk
    await manager.retry(uuid(24));
    await settle(manager, uuid(24), index);
    expect((await index.get(uuid(24)))?.status).toBe('complete');
  });
});
