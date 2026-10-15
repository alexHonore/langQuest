/**
 * ID3 / container metadata preview for the upload queue via `music-metadata` (`parseBlob`).
 * Reads tags only; duration is reported when the parser can get it without scanning the
 * whole file (never guessed). Errors are swallowed into `null` — a preview must not block
 * an upload.
 */
import type { Id3Preview } from './types';

export async function readId3Preview(file: Blob): Promise<Id3Preview | null> {
  try {
    const { parseBlob } = await import('music-metadata');
    const meta = await parseBlob(file, { duration: false, skipCovers: false });
    const c = meta.common;
    const f = meta.format;
    return {
      title: c.title ?? null,
      artist: c.artist ?? null,
      album: c.album ?? null,
      track: c.track?.no ?? null,
      year: c.year ?? null,
      genre: c.genre ?? [],
      durationMs: typeof f.duration === 'number' ? Math.round(f.duration * 1000) : null,
      codec: f.codec ?? null,
      bitrateKbps: typeof f.bitrate === 'number' ? Math.round(f.bitrate / 1000) : null,
      sampleRateHz: f.sampleRate ?? null,
      hasCover: Boolean(c.picture && c.picture.length > 0),
    };
  } catch {
    return null;
  }
}
