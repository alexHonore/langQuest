/**
 * `expo-file-system` implementation of {@link DownloadFs}: resumable
 * `DownloadTask`s (pause state is kept per task), SHA-256 via `expo-crypto`
 * for files that fit in memory, and device free-space checks. Web has no
 * persistent file store for large media → the manager reports downloads as
 * unsupported there instead of pretending.
 */
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { DownloadAbortedError, DownloadHttpError, type DownloadFs } from './download-manager';

/** Hash files up to this size in memory; larger files are verified by byte length only (honest `verifiedBy`). */
const MAX_HASH_BYTES = 96 * 1024 * 1024;

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const downloadsSupported = (): boolean => Platform.OS !== 'web';

export function createExpoDownloadFs(): DownloadFs {
  const root = new Directory(Paths.document, 'audio-packs');
  return {
    packRoot: () => root.uri,
    ensureDirectory: async (uri) => {
      const dir = new Directory(uri);
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    },
    download: async (url, destinationUri, options) => {
      const file = new File(destinationUri);
      // Partial files from a cancelled attempt cannot be resumed without the task's resume data: start clean.
      if (file.exists) file.delete();
      const task = File.createDownloadTask(url, file, {
        sessionType: 'background',
        signal: options.signal,
        onProgress: (p) => options.onProgress(p.bytesWritten, p.totalBytes),
      });
      try {
        const result = await task.downloadAsync();
        if (!result) throw new DownloadAbortedError();
      } catch (error) {
        if (options.signal.aborted) throw new DownloadAbortedError();
        const status = extractHttpStatus(error);
        if (status !== null) throw new DownloadHttpError(status);
        throw error;
      } finally {
        task.release();
      }
      if (!file.exists) throw new Error('Download produced no file');
    },
    exists: async (uri) => new File(uri).exists,
    size: async (uri) => {
      const f = new File(uri);
      if (!f.exists) return null;
      const size = f.size;
      return typeof size === 'number' ? size : null;
    },
    sha256: async (uri) => {
      const f = new File(uri);
      if (!f.exists || f.size > MAX_HASH_BYTES) return null;
      const bytes = await f.bytes();
      const buf = await digest(CryptoDigestAlgorithm.SHA256, bytes);
      return bytesToHex(new Uint8Array(buf));
    },
    delete: async (uri) => {
      const f = new File(uri);
      if (f.exists) f.delete();
    },
    deleteDirectory: async (uri) => {
      const d = new Directory(uri);
      if (d.exists) d.delete();
    },
    freeBytes: async () => {
      try {
        const free = Paths.availableDiskSpace;
        return Number.isFinite(free) ? free : null;
      } catch {
        return null;
      }
    },
  };
}

function extractHttpStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const m = /\b(40[0-9]|41[0-9]|5[0-9]{2})\b/.exec(message);
  return m ? Number(m[1]) : null;
}
