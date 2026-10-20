/**
 * Export every static art asset (SVG) to `<repo>/assets/{mascot,characters,scenes,covers,icons}`
 * and write `assets/art-manifest.json`.
 *
 * Usage (from repo root): `pnpm --filter @langquest/ui export-art`
 *   or `npx tsx packages/ui/scripts/export-art.ts [--out <dir>] [--only mascot,icons]`
 *
 * `--only` restricts writing (and stale-file removal) to the listed managed directories, so
 * one asset family can be regenerated without touching the others.
 *
 * Besides the manifest entries, the mascot family also writes `mascot/icon/<state>.svg`
 * (24 px detail level, light + dark) and `mascot/master-rive.svg` (layered rigging master).
 * The Lottie clips are produced by `scripts/lottie/generate-mascot-lottie.ts`.
 *
 * Pure Node — imports only the string renderers, never react-native-svg.
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ART_MANIFEST,
  ART_STYLE_VERSION,
  type ArtExportFile,
  listArtExports,
} from '../src/art/manifest';
import { MASCOT_STATES, mascotMasterSvgString, mascotSvgString } from '../src/art/mascot';

const here = dirname(fileURLToPath(import.meta.url));
const argOut = process.argv.indexOf('--out');
const outDir =
  argOut >= 0 && process.argv[argOut + 1]
    ? resolve(process.argv[argOut + 1] as string)
    : resolve(here, '../../../assets');

const ALL_MANAGED_DIRS = ['mascot', 'characters', 'scenes', 'covers', 'icons'];
const argOnly = process.argv.indexOf('--only');
const MANAGED_DIRS =
  argOnly >= 0 && process.argv[argOnly + 1]
    ? (process.argv[argOnly + 1] as string).split(',').filter((d) => ALL_MANAGED_DIRS.includes(d))
    : ALL_MANAGED_DIRS;
const topDir = (p: string): string => p.split('/')[0] ?? '';

/** Extra mascot files that are not manifest entries (icon detail level + rigging master). */
function mascotExtras(): ArtExportFile[] {
  const files: ArtExportFile[] = [];
  for (const s of MASCOT_STATES) {
    files.push({
      path: `mascot/icon/${s}.svg`,
      svg: mascotSvgString(s, { size: 24, theme: 'light' }),
    });
    files.push({
      path: `mascot/icon/dark/${s}.svg`,
      svg: mascotSvgString(s, { size: 24, theme: 'dark' }),
    });
  }
  files.push({ path: 'mascot/master-rive.svg', svg: mascotMasterSvgString('light', 512) });
  return files;
}

function listSvgFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.svg')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const files = listArtExports();
const toWrite = [...files, ...mascotExtras()].filter((f) => MANAGED_DIRS.includes(topDir(f.path)));
const written = new Set<string>();
let bytes = 0;
for (const f of toWrite) {
  const target = join(outDir, f.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${f.svg}\n`, 'utf8');
  written.add(resolve(target));
  bytes += Buffer.byteLength(f.svg, 'utf8');
}

// Remove stale SVGs inside the managed directories so the manifest always matches disk.
// `mascot/lottie/` belongs to the Lottie generator (clips + frame renders) and is left alone.
const KEEP_DIRS = [resolve(outDir, 'mascot/lottie')];
let removed = 0;
for (const d of MANAGED_DIRS) {
  for (const existing of listSvgFiles(join(outDir, d))) {
    if (KEEP_DIRS.some((k) => resolve(existing).startsWith(`${k}/`))) continue;
    if (!written.has(resolve(existing))) {
      rmSync(existing);
      removed += 1;
    }
  }
}

const manifestJson = {
  // Only rewritten on a full export so a partial (`--only`) run never desynchronises it.
  styleVersion: ART_STYLE_VERSION,
  baseDir: 'assets',
  counts: {
    mascot: Object.keys(ART_MANIFEST.mascot).length,
    characters: Object.keys(ART_MANIFEST.characters).length,
    characterExpressions: Object.values(ART_MANIFEST.characters).reduce(
      (n, m) => n + Object.keys(m).length,
      0,
    ),
    scenes: Object.keys(ART_MANIFEST.scenes).length,
    covers: Object.keys(ART_MANIFEST.covers).length,
    icons: Object.keys(ART_MANIFEST.icons).length,
    files: files.length,
  },
  variants: {
    mascotDark: 'mascot/dark/<state>.svg',
    sceneEvening: 'scenes/<scene>-evening.svg',
    sceneDark: 'scenes/dark/<scene>.svg',
  },
  ...ART_MANIFEST,
};
if (MANAGED_DIRS.length === ALL_MANAGED_DIRS.length) {
  writeFileSync(
    join(outDir, 'art-manifest.json'),
    `${JSON.stringify(manifestJson, null, 2)}\n`,
    'utf8',
  );
}

console.log(
  `export-art: wrote ${toWrite.length} SVG files (${(bytes / 1024).toFixed(0)} KiB) to ${relative(process.cwd(), outDir) || '.'} [${MANAGED_DIRS.join(',')}]; removed ${removed} stale file(s); ${MANAGED_DIRS.length === ALL_MANAGED_DIRS.length ? 'manifest at art-manifest.json' : 'manifest untouched (--only)'}`,
);
