/**
 * Proves `@langquest/ui/art/web` loads from a plain Node context (via tsx)
 * without react / react-native / react-native-svg in the module graph.
 *
 * Usage (from repo root): `pnpm --filter @langquest/ui verify-web-entry`
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const resolved = require.resolve('@langquest/ui/art/web');
if (!resolved.endsWith('/src/art/web.ts')) {
  throw new Error(`Unexpected resolution for @langquest/ui/art/web: ${resolved}`);
}
for (const sub of ['@langquest/ui/art', '@langquest/ui/tokens']) {
  const r = require.resolve(sub);
  if (!r.endsWith('/index.ts')) throw new Error(`Unexpected resolution for ${sub}: ${r}`);
}

const web = await import('@langquest/ui/art/web');
const loaded = Object.keys(require.cache).filter((k) =>
  /[\\/]node_modules[\\/](react|react-native|react-native-svg|react-dom)[\\/]/.test(k),
);
if (loaded.length > 0) throw new Error(`react-native modules loaded: ${loaded.join(', ')}`);

const svg = web.courseCoverSvgString('arabic-moroccan', { width: 300, altText: 'test' });
if (!svg.startsWith('<svg') || !svg.includes('<title>test</title>'))
  throw new Error('cover render failed');
if (web.ART_MANIFEST.coverAltTextKeys['arabic-moroccan'] !== 'catalog.cover.arabic-moroccan')
  throw new Error('manifest altTextKey missing');
if (!web.mascotSvgString('neutral', { size: 64 }).startsWith('<svg'))
  throw new Error('mascot render failed');
if (!web.characterPortraitSvgString(web.CHARACTER_ROSTER[0]!.id, 'greeting').startsWith('<svg'))
  throw new Error('portrait render failed');
if (!web.sceneArtSvgString(web.SCENES[0]!.id).startsWith('<svg'))
  throw new Error('scene render failed');
if (!web.iconSvgString(web.ICON_NAMES[0]!).startsWith('<svg'))
  throw new Error('icon render failed');
if ('MascotSvg' in web) throw new Error('native component leaked into web entry');
console.log(
  `ok: @langquest/ui/art/web -> ${resolved}; ${web.MASCOT_STATES.length} mascot states, ${web.CHARACTER_ROSTER.length} characters, ${web.SCENES.length} scenes, ${Object.keys(web.ART_MANIFEST.covers).length} covers, no react-native in graph`,
);
