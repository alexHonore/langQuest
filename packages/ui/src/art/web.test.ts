/**
 * `@langquest/ui/art/web` must stay loadable from plain Node / Next.js server
 * code: nothing in its import graph may reference react, react-native or
 * react-native-svg. The graph is walked statically from the source files.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as web from './web';

const here = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN = /^(react|react-native|react-native-svg|react-dom)(\/|$)/;

function localImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /(?:import|export)\s+(?:type\s+)?[^'"]*?\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) out.push(m[1] as string);
  return out;
}

function walk(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const spec of localImports(file)) {
      if (spec.startsWith('.')) {
        const base = resolve(dirname(file), spec);
        const candidate = ['.ts', '.tsx', '/index.ts']
          .map((ext) => base + ext)
          .find((p) => {
            try {
              readFileSync(p);
              return true;
            } catch {
              return false;
            }
          });
        if (candidate) visit(candidate);
      } else {
        packages.add(spec);
      }
    }
  };
  visit(entry);
  return { files, packages };
}

describe('@langquest/ui/art/web', () => {
  it('imports no react / react-native module anywhere in its graph', () => {
    const { files, packages } = walk(resolve(here, 'web.ts'));
    expect([...files].some((f) => f.endsWith('native.tsx'))).toBe(false);
    expect([...files].every((f) => f.endsWith('.ts'))).toBe(true);
    for (const p of packages) expect(p).not.toMatch(FORBIDDEN);
    expect([...packages]).toContain('@langquest/contracts');
  });

  it('exposes every string renderer and manifest, and nothing from native', () => {
    for (const name of [
      'mascotSvgString',
      'characterPortraitSvgString',
      'sceneArtSvgString',
      'courseCoverSvgString',
      'iconSvgString',
      'buildIconDocument',
      'ART_MANIFEST',
      'CHARACTER_ROSTER',
      'SCENES',
      'MASCOT_STATES',
      'ICON_NAMES',
      'listArtExports',
      'coverAltTextKey',
      'mascotLabelKey',
      'mascotSpeechKey',
    ] as const) {
      expect(typeof (web as Record<string, unknown>)[name]).not.toBe('undefined');
    }
    // Every value export of the full art module that does not come from
    // ./native is also on the web entry (read statically: importing ./index
    // here would pull react-native-svg into the test).
    const indexSrc = readFileSync(resolve(here, 'index.ts'), 'utf8');
    const blocks = [...indexSrc.matchAll(/export\s+\{([^}]*)\}\s+from\s+'\.\/([a-z-]+)'/g)];
    expect(blocks.length).toBeGreaterThan(5);
    const nativeNames = new Set<string>();
    const otherNames = new Set<string>();
    for (const [, names, mod] of blocks) {
      for (const raw of (names as string).split(',')) {
        const name = raw.trim();
        if (!name) continue;
        (mod === 'native' ? nativeNames : otherNames).add(name);
      }
    }
    expect(nativeNames.has('CourseCoverSvg')).toBe(true);
    for (const name of nativeNames) expect(name in web, name).toBe(false);
    for (const name of otherNames) expect(name in web, name).toBe(true);
  });

  it('is declared as an explicit subpath export next to ./art and ./tokens', () => {
    const pkg = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports['./art/web']).toBe('./src/art/web.ts');
    expect(pkg.exports['./art']).toBe('./src/art/index.ts');
    expect(pkg.exports['./tokens']).toBe('./src/tokens/index.ts');
    expect(pkg.exports['.']).toBe('./src/index.ts');
  });
});
