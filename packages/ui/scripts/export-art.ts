/**
 * Export every static art asset (SVG) to `<repo>/assets/{mascot,characters,scenes,covers,icons}`
 * and write `assets/art-manifest.json`.
 *
 * Usage (from repo root): `pnpm --filter @langquest/ui export-art`
 *   or `npx tsx packages/ui/scripts/export-art.ts [--out <dir>]`
 *
 * Pure Node — imports only the string renderers, never react-native-svg.
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ART_MANIFEST, ART_STYLE_VERSION, listArtExports } from '../src/art/manifest';

const here = dirname(fileURLToPath(import.meta.url));
const argOut = process.argv.indexOf('--out');
const outDir =
  argOut >= 0 && process.argv[argOut + 1]
    ? resolve(process.argv[argOut + 1] as string)
    : resolve(here, '../../../assets');

const MANAGED_DIRS = ['mascot', 'characters', 'scenes', 'covers', 'icons'];

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
const written = new Set<string>();
let bytes = 0;
for (const f of files) {
  const target = join(outDir, f.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${f.svg}\n`, 'utf8');
  written.add(resolve(target));
  bytes += Buffer.byteLength(f.svg, 'utf8');
}

// Remove stale SVGs inside the managed directories so the manifest always matches disk.
let removed = 0;
for (const d of MANAGED_DIRS) {
  for (const existing of listSvgFiles(join(outDir, d))) {
    if (!written.has(resolve(existing))) {
      rmSync(existing);
      removed += 1;
    }
  }
}

const manifestJson = {
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
writeFileSync(
  join(outDir, 'art-manifest.json'),
  `${JSON.stringify(manifestJson, null, 2)}\n`,
  'utf8',
);

console.log(
  `export-art: wrote ${files.length} SVG files (${(bytes / 1024).toFixed(0)} KiB) to ${relative(process.cwd(), outDir) || '.'}; removed ${removed} stale file(s); manifest at art-manifest.json`,
);
