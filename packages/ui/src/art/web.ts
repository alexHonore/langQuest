/**
 * `@langquest/ui/art/web` — the web/Node-safe slice of the art module.
 *
 * Re-exports ONLY the pure string renderers, the data tables (roster, scenes,
 * mascot states, cover recipes, icon names) and the manifests. Nothing in this
 * file's import graph touches `react`, `react-native` or `react-native-svg`,
 * so the admin (Next.js), the jobs runner and the export script can import it
 * from plain Node. The React Native components stay under `@langquest/ui/art`.
 *
 * `art.test.ts` guards the import graph; `scripts/verify-web-entry.ts` proves
 * it loads under `tsx` without React Native installed in the module graph.
 */
export type { SvgNode, SvgDocument, SvgTag } from './svg-node';
export { toSvgString, nodeToString, countNodes } from './svg-node';
export type {
  ArtTheme,
  MascotPalette,
  SceneBasePalette,
  SkinToneId,
  HairColorId,
  ClothColorId,
} from './palette';
export { MASCOT_PALETTE, SCENE_BASE, SKIN_TONES, HAIR_COLORS, CLOTH_COLORS } from './palette';

export {
  MASCOT_STATES,
  MASCOT_POSES,
  MASCOT_ACCESSIBILITY_LABELS,
  MASCOT_VIEWBOX,
  mascotLabelKey,
  mascotSpeechKey,
  buildMascotNodes,
  buildMascotDocument,
  mascotSvgString,
} from './mascot';
export type {
  MascotPose,
  MascotRenderOptions,
  EyeShape,
  MouthShape,
  ArmPose,
  BrowShape,
  PropKind,
} from './mascot';

export {
  CHARACTER_ROSTER,
  CHARACTER_EXPRESSIONS,
  CHARACTER_EXPRESSION_POSES,
  CHARACTER_STYLE_VERSION,
  PORTRAIT_VIEWBOX,
  findCharacter,
  charactersForVariety,
  stableCharacterUuid,
  buildCharacterPortraitNodes,
  buildCharacterPortraitDocument,
  characterPortraitLabel,
  characterPortraitSvgString,
} from './characters';
export type {
  LangQuestCharacter,
  PortraitParams,
  CharacterVoiceNotes,
  HeadShape,
  HairStyle,
  FacialHair,
  Glasses,
  Earrings,
  Clothing,
  Extra,
  AgeGroup,
} from './characters';

export {
  SCENES,
  SCENE_IDS,
  SCENE_VIEWBOX,
  findScene,
  buildSceneNodes,
  buildSceneDocument,
  sceneArtSvgString,
} from './scenes';
export type { SceneId, SceneVariant, SceneDefinition, SceneRenderOptions } from './scenes';

export {
  COVER_RECIPES,
  COVER_TRACK_IDS,
  COVER_VIEWBOX,
  getCoverRecipe,
  buildCoverNodes,
  buildCoverDocument,
  courseCoverSvgString,
  coverAltTextKey,
  defaultCoverAltText,
} from './covers';
export type { CoverMotif, CoverRecipe, CoverRenderOptions } from './covers';

export {
  ICON_NAMES,
  ICON_LABELS,
  ICON_VIEWBOX,
  buildIconNodes,
  buildIconDocument,
  iconSvgString,
} from './icons';
export type { IconName } from './icons';

export {
  ART_MANIFEST,
  ART_STYLE_VERSION,
  listArtExports,
  mascotAssetPath,
  characterAssetPath,
  sceneAssetPath,
  coverAssetPath,
  iconAssetPath,
} from './manifest';
export type { ArtManifest, ArtExportFile } from './manifest';
