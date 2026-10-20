/**
 * Static export manifest: relative paths (under `/assets`) of every exported SVG,
 * plus the list of (path → markup) pairs the export script writes. Both the
 * script and the tests derive from this file, so the manifest can never drift
 * from what is on disk.
 */
import { type CharacterExpression, type MascotState } from '@langquest/contracts';
import { CHARACTER_EXPRESSIONS, CHARACTER_ROSTER, characterPortraitSvgString } from './characters';
import { COVER_RECIPES, courseCoverSvgString, coverAltTextKey } from './covers';
import { ICON_NAMES, type IconName, iconSvgString } from './icons';
import { MASCOT_STATES, mascotSvgString } from './mascot';
import { SCENES, type SceneId, sceneArtSvgString } from './scenes';
import { COLOR_PALETTES } from '../tokens/color';

/** Bump when any exported geometry changes in a way consumers should re-cache. */
export const ART_STYLE_VERSION = 'langquest-art-v1';

export interface ArtManifest {
  mascot: Record<MascotState, string>;
  characters: Record<string, Record<CharacterExpression, string>>;
  scenes: Record<SceneId, string>;
  covers: Record<string, string>;
  /**
   * Locale catalog key of each cover's alt text (`catalog.cover.<trackId>`),
   * keyed by track id. Apps pass `t(key)` as the cover's `altText`.
   */
  coverAltTextKeys: Record<string, string>;
  /** Extra: icon files (consumers that only read the four required keys are unaffected). */
  icons: Record<IconName, string>;
}

export const mascotAssetPath = (state: MascotState, theme: 'light' | 'dark' = 'light'): string =>
  theme === 'light' ? `mascot/${state}.svg` : `mascot/dark/${state}.svg`;
export const characterAssetPath = (characterId: string, expression: CharacterExpression): string =>
  `characters/${characterId}/${expression}.svg`;
export const sceneAssetPath = (
  sceneId: SceneId,
  variant: 'day' | 'evening' = 'day',
  theme: 'light' | 'dark' = 'light',
): string =>
  theme === 'dark'
    ? `scenes/dark/${sceneId}${variant === 'evening' ? '-evening' : ''}.svg`
    : `scenes/${sceneId}${variant === 'evening' ? '-evening' : ''}.svg`;
export const coverAssetPath = (trackId: string): string => `covers/${trackId}.svg`;
export const iconAssetPath = (name: IconName): string => `icons/${name}.svg`;

function buildManifest(): ArtManifest {
  const mascot = Object.fromEntries(MASCOT_STATES.map((s) => [s, mascotAssetPath(s)])) as Record<
    MascotState,
    string
  >;
  const characters: Record<string, Record<CharacterExpression, string>> = {};
  for (const c of CHARACTER_ROSTER) {
    characters[c.id] = Object.fromEntries(
      CHARACTER_EXPRESSIONS.map((e) => [e, characterAssetPath(c.id, e)]),
    ) as Record<CharacterExpression, string>;
  }
  const scenes = Object.fromEntries(SCENES.map((s) => [s.id, sceneAssetPath(s.id)])) as Record<
    SceneId,
    string
  >;
  const covers: Record<string, string> = Object.fromEntries(
    COVER_RECIPES.map((r) => [r.trackId, coverAssetPath(r.trackId)]),
  );
  const coverAltTextKeys: Record<string, string> = Object.fromEntries(
    COVER_RECIPES.map((r) => [r.trackId, coverAltTextKey(r.trackId)]),
  );
  const icons = Object.fromEntries(ICON_NAMES.map((n) => [n, iconAssetPath(n)])) as Record<
    IconName,
    string
  >;
  return { mascot, characters, scenes, covers, coverAltTextKeys, icons };
}

/** Relative paths of the exported static SVG files under `/assets`. */
export const ART_MANIFEST: ArtManifest = buildManifest();

export interface ArtExportFile {
  /** Path relative to the `assets/` directory. */
  path: string;
  svg: string;
}

/**
 * Every file the export script writes (manifest entries + dark/evening variants).
 * Pure string rendering: safe to call from Node without React Native.
 */
export function listArtExports(): ArtExportFile[] {
  const files: ArtExportFile[] = [];
  for (const s of MASCOT_STATES) {
    files.push({
      path: mascotAssetPath(s, 'light'),
      svg: mascotSvgString(s, { size: 256, theme: 'light' }),
    });
    files.push({
      path: mascotAssetPath(s, 'dark'),
      svg: mascotSvgString(s, { size: 256, theme: 'dark' }),
    });
  }
  for (const c of CHARACTER_ROSTER) {
    for (const e of CHARACTER_EXPRESSIONS)
      files.push({
        path: characterAssetPath(c.id, e),
        svg: characterPortraitSvgString(c.id, e, { size: 240 }),
      });
  }
  for (const s of SCENES) {
    files.push({
      path: sceneAssetPath(s.id, 'day', 'light'),
      svg: sceneArtSvgString(s.id, { width: 640, variant: 'day' }),
    });
    files.push({
      path: sceneAssetPath(s.id, 'evening', 'light'),
      svg: sceneArtSvgString(s.id, { width: 640, variant: 'evening' }),
    });
    files.push({
      path: sceneAssetPath(s.id, 'day', 'dark'),
      svg: sceneArtSvgString(s.id, { width: 640, variant: 'day', theme: 'dark' }),
    });
  }
  for (const r of COVER_RECIPES)
    files.push({
      path: coverAssetPath(r.trackId),
      svg: courseCoverSvgString(r.trackId, { width: 600 }),
    });
  for (const n of ICON_NAMES)
    files.push({
      path: iconAssetPath(n),
      // Static export paints icons with the light palette's primary text token; in the apps the
      // icon components take the active theme's `textPrimary` instead.
      svg: iconSvgString(n, { size: 24, color: COLOR_PALETTES.light.textPrimary }),
    });
  return files;
}
