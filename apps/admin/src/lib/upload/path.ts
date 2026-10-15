/**
 * UI helpers around `parseImportPath` (@langquest/media): suggestions for collection /
 * chapter / lesson from a dropped folder path, asset kind detection and queue grouping.
 */
import { parseImportPath } from '@langquest/media';
import { ALLOWED_UPLOAD_MIME_TYPES, type AssetKind } from '@langquest/contracts';
import type { PathSuggestion } from './types';

const EXT_MIME: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  json: 'application/json',
  csv: 'text/csv',
};

/** Normalise a browser-reported MIME (often empty or `audio/x-m4a`) to a contract-allowed one. */
export function resolveMimeType(name: string, reported: string | null | undefined): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const byExt = EXT_MIME[ext] ?? null;
  const allowed = ALLOWED_UPLOAD_MIME_TYPES as readonly string[];
  if (reported && allowed.includes(reported)) return reported;
  if (byExt && allowed.includes(byExt)) return byExt;
  return null;
}

export function kindForMime(mime: string): AssetKind {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'text/csv' || mime === 'application/json') return 'document';
  return 'document';
}

/** Suggest hierarchy metadata from a relative path; null when the path is unsafe or flat. */
export function suggestFromPath(relativePath: string): PathSuggestion | null {
  try {
    const parsed = parseImportPath(relativePath);
    const i = parsed.inherited;
    return {
      collectionTitle: i.collectionTitle,
      chapterTitle: i.chapterTitle,
      chapterOrder: i.chapterOrder,
      lessonTitle: i.lessonTitle,
      lessonOrder: i.lessonOrder,
      episodeNumber: i.episodeNumber,
      folders: parsed.folders,
    };
  } catch {
    return null;
  }
}

/** Relative path for a File coming from `<input webkitdirectory>` or drag-and-drop traversal. */
export function relativePathOf(file: File, explicit?: string): string {
  const candidate = explicit || (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return candidate.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Top-level folder of a relative path (or '' for root files). */
export function topFolder(relativePath: string): string {
  const idx = relativePath.indexOf('/');
  return idx === -1 ? '' : relativePath.slice(0, idx);
}

/** Group paths by their first folder, preserving insertion order. */
export function groupByTopFolder<T extends { relativePath: string }>(items: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = topFolder(item.relativePath);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}
