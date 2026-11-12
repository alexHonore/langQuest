/**
 * Reads the Flutter app's offline content bundle (`apps/mobile_flutter/assets/content/`) for the scripts that work on
 * every course's phrases at once (bundle voices, Tatoeba examples). The bundle keeps one chapters file per course
 * (`chapters/<track>.json`); this joins them, in file-name order, into the `{ chapters: [...] }` shape those scripts read.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const BUNDLE_CHAPTERS_DIR = 'apps/mobile_flutter/assets/content/chapters';

/** Every course's chapters as one `{ "chapters": [...] }` JSON document. */
export function readBundleChaptersJson(root: string): string {
  const dir = resolve(root, BUNDLE_CHAPTERS_DIR);
  const chapters = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { chapters: unknown[] }).chapters);
  return JSON.stringify({ chapters });
}
