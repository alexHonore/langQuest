/**
 * Generate the learner app's icon, splash and Android adaptive icons from Melo (M3), rendered with
 * headless Chrome from the same code that draws the mascot in the app (`@langquest/ui/art/web`).
 * Colours come from the Night Market tokens (`@langquest/ui/tokens`): nothing is hard-coded here.
 *
 * Usage (from repo root): `npx tsx apps/mobile/scripts/generate-app-icons.ts [--chrome <path>]`
 * Writes to `apps/mobile/assets/images/`: icon.png (1024), splash-icon.png (512, transparent),
 * android-icon-foreground.png (512, transparent), android-icon-background.png (512),
 * android-icon-monochrome.png (432, white silhouette) and favicon.png (48).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mascotSvgString, mascotTint } from '@langquest/ui/art/web';
import { DARK_COLORS } from '@langquest/ui/tokens';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../assets/images');
const argChrome = process.argv.indexOf('--chrome');
const chrome = argChrome >= 0 && process.argv[argChrome + 1] ? (process.argv[argChrome + 1] as string) : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!chrome) throw new Error('Chrome / Chromium not found; pass --chrome <path>');

const canvas = DARK_COLORS.background;
const [magenta, cyan, amber] = DARK_COLORS.lantern;
const lanterns = `radial-gradient(circle at 22% 20%, ${magenta}66 0, transparent 42%), radial-gradient(circle at 80% 30%, ${cyan}55 0, transparent 40%), radial-gradient(circle at 50% 90%, ${amber}55 0, transparent 45%)`;

interface Target {
  file: string;
  size: number;
  /** CSS background of the page (transparent when omitted). */
  background?: string;
  /** Mascot size in px and state. */
  mascot: { size: number; state: Parameters<typeof mascotSvgString>[0]; filter?: string };
}

const TARGETS: readonly Target[] = [
  { file: 'icon.png', size: 1024, background: `${lanterns}, ${canvas}`, mascot: { size: 820, state: 'welcome' } },
  { file: 'splash-icon.png', size: 512, mascot: { size: 480, state: 'neutral' } },
  { file: 'android-icon-foreground.png', size: 512, mascot: { size: 330, state: 'welcome' } },
  { file: 'android-icon-background.png', size: 512, background: `${lanterns}, ${canvas}`, mascot: { size: 0, state: 'neutral' } },
  { file: 'android-icon-monochrome.png', size: 432, mascot: { size: 300, state: 'welcome', filter: 'brightness(0) invert(1)' } },
  { file: 'favicon.png', size: 48, background: canvas, mascot: { size: 44, state: 'neutral' } },
];

const tmp = mkdtempSync(join(tmpdir(), 'langquest-icons-'));
mkdirSync(outDir, { recursive: true });
for (const target of TARGETS) {
  const svg =
    target.mascot.size > 0
      ? mascotSvgString(target.mascot.state, { size: target.mascot.size, theme: 'dark', tint: mascotTint({ state: target.mascot.state, theme: 'dark' }) })
      : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${target.size}px;height:${target.size}px;overflow:hidden;background:${target.background ?? 'transparent'};}
    body{display:flex;align-items:center;justify-content:center;}
    svg{display:block;${target.mascot.filter ? `filter:${target.mascot.filter};` : ''}}
  </style></head><body>${svg}</body></html>`;
  const page = join(tmp, `${target.file}.html`);
  writeFileSync(page, html, 'utf8');
  const png = join(outDir, target.file);
  execFileSync(chrome, [
    '--headless=new',
    '--hide-scrollbars',
    '--disable-gpu',
    '--no-sandbox',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${target.size},${target.size}`,
    `--screenshot=${png}`,
    `file://${page}`,
  ], { stdio: 'ignore' });
  console.log(`icons: wrote ${target.file} (${target.size}px, ${target.mascot.state})`);
}
console.log(`icons: splash / adaptive background colour = ${canvas}`);
