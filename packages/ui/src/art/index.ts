/**
 * `@langquest/ui` art module — original visual identity assets as code.
 *
 * - Mascot ("orbit-creature") in 17 states, light/dark, RN + string renderers.
 *   `mascotLabelKey(state)` → `mascot.a11yState.<state>` (accessibility label);
 *   `mascotSpeechKey(state)` → `mascot.state.<state>` (speech-bubble copy).
 * - 16 original conversational characters × 9 expressions (parametric portraits).
 * - 12 layered scene environments (day/evening, light/dark).
 * - 30 course covers from a palette + motif system.
 * - 37 stroke icons on a 24 grid.
 * - `ART_MANIFEST` with the relative paths of the exported static SVGs under `/assets`.
 *
 * Web / Node consumers that must not load react-native: import `@langquest/ui/art/web`
 * (string renderers + manifests only).
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
  uuidV5,
  characterKey,
  CHARACTER_UUID_NAMESPACE,
  CHARACTER_UUID_NAME_PREFIX,
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

export {
  MascotSvg,
  CharacterPortraitSvg,
  SceneArtSvg,
  CourseCoverSvg,
  ICONS,
  renderSvgNode,
  renderSvgDocument,
} from './native';
export type {
  MascotSvgProps,
  CharacterPortraitSvgProps,
  SceneArtSvgProps,
  CourseCoverSvgProps,
  IconProps,
} from './native';
