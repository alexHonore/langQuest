/**
 * Generate the mascot's Lottie clips (bodymovin v5.x, shape layers only) from the shared
 * SvgNode geometry and write them to `<repo>/assets/mascot/lottie/<clip>.json`, plus a
 * `<clip>.frame0.svg` sanity render next to each (rebuilt from the Lottie data itself).
 *
 * Usage (from repo root): `pnpm --filter @langquest/ui lottie`
 *   or `npx tsx packages/ui/scripts/lottie/generate-mascot-lottie.ts [--out <dir>] [--theme dark]`
 *
 * Pure Node — imports only the string renderers, never react-native-svg.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MASCOT_LOTTIE_CLIPS,
  buildMascotLottie,
  renderLottieFrameSvg,
  walkLottieShapes,
} from '../../src/art/mascot/lottie';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const outDir = arg('--out')
  ? resolve(arg('--out') as string)
  : resolve(here, '../../../../assets/mascot/lottie');
const theme = arg('--theme') === 'dark' ? 'dark' : 'light';
mkdirSync(outDir, { recursive: true });

const ALLOWED = new Set(['gr', 'sh', 'el', 'rc', 'fl', 'st', 'tr']);
let bytes = 0;
for (const clip of MASCOT_LOTTIE_CLIPS) {
  const anim = buildMascotLottie(clip, { theme });
  // Structural self-check before writing: only shape layers / nulls, only generated shape kinds.
  for (const layer of anim.layers) {
    if (layer.ty !== 3 && layer.ty !== 4)
      throw new Error(`${clip}: unexpected layer type ${layer.ty}`);
  }
  walkLottieShapes(anim, (s) => {
    if (!ALLOWED.has(s.ty)) throw new Error(`${clip}: unexpected shape ${s.ty}`);
  });
  // Tiny render sanity check: the clip must rebuild into a non-trivial SVG at frame 0 and mid-clip.
  const f0 = renderLottieFrameSvg(anim, 0);
  const fm = renderLottieFrameSvg(anim, Math.floor(anim.op / 2));
  if (!f0.startsWith('<svg') || f0.length < 2000)
    throw new Error(`${clip}: frame 0 render looks empty`);
  if (f0 === fm)
    throw new Error(`${clip}: frame 0 and mid-clip frame are identical (nothing animates)`);
  const json = `${JSON.stringify(anim)}\n`;
  writeFileSync(join(outDir, `${clip}.json`), json, 'utf8');
  writeFileSync(join(outDir, `${clip}.frame0.svg`), `${f0}\n`, 'utf8');
  bytes += Buffer.byteLength(json, 'utf8');
  console.log(
    `lottie: ${clip}.json — ${anim.layers.length} layers, ${anim.op} frames @ ${anim.fr} fps, ${(json.length / 1024).toFixed(1)} KiB`,
  );
}
console.log(
  `lottie: wrote ${MASCOT_LOTTIE_CLIPS.length} clips (${(bytes / 1024).toFixed(0)} KiB) to ${relative(process.cwd(), outDir) || '.'}`,
);
