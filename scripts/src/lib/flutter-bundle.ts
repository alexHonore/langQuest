/**
 * Where the Flutter learner app's offline content bundle lives, and how the scripts read its chapters back.
 *
 * `catalog.json` lists every course with the instruction languages it is taught from; each course's chapters are a
 * file of their own, `chapters/<trackId>.json`, so the app loads only the courses the learner takes
 * (written by `export-flutter-content`).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const BUNDLE_DIR = 'apps/mobile_flutter/assets/content';

/** The per-course chapter files, relative to {@link BUNDLE_DIR}. */
export const CHAPTERS_SUBDIR = 'chapters';

/** A course's chapter file, relative to {@link BUNDLE_DIR} (the app reads `assets/content/chapters/<trackId>.json`). */
export const chaptersFileOf = (trackId: string): string => `${CHAPTERS_SUBDIR}/${trackId}.json`;

/** The chapter files of the checked-in bundle, relative to {@link BUNDLE_DIR}, in file-name order. */
export function bundleChapterFiles(root: string): string[] {
  const dir = resolve(root, BUNDLE_DIR, CHAPTERS_SUBDIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => `${CHAPTERS_SUBDIR}/${f}`);
}

/** Every chapter of the checked-in bundle, course file by course file (file-name order). */
export function readBundleChapters<T = unknown>(root: string): T[] {
  return bundleChapterFiles(root).flatMap((file) => (JSON.parse(readFileSync(resolve(root, BUNDLE_DIR, file), 'utf8')) as { chapters: T[] }).chapters);
}
