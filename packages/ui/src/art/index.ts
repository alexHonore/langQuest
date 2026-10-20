/**
 * `@langquest/ui` art module — original visual identity assets as code.
 *
 * - Mascot ("Melo", the chameleon) in 17 states, light/dark, chameleon tint per
 *   state × course family (`mascotTint`), RN + string renderers.
 *   `mascotLabelKey(state)` → `mascot.a11yState.<state>` (accessibility label);
 *   `mascotSpeechKey(state)` → `mascot.state.<state>` (speech-bubble copy).
 * - 97 original conversational characters × 9 expressions (C2 clay parametric portraits,
 *   ≥ 3 per track, roles ↔ lesson situations via `charactersForIntent`; flat LOD ≤ 48 px).
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
export {
  MASCOT_PALETTE,
  MASCOT_BASE_HUE,
  MASCOT_BASE_SATURATION,
  MASCOT_BODY_LIGHTNESS,
  mascotBodyTokens,
  SCENE_BASE,
  SKIN_TONES,
  HAIR_COLORS,
  CLOTH_COLORS,
} from './palette';

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
  MASCOT_NAME,
  MASCOT_PART_IDS,
  MASCOT_PIVOT,
  MASCOT_STATE_TINTS,
  COURSE_FAMILY_IDS,
  COURSE_FAMILY_HUE_OFFSETS,
  COURSE_TRACK_FAMILIES,
  courseFamilyTint,
  mascotTint,
  mascotBaseTint,
  mascotTintTable,
  buildMascotParts,
  figureTransform,
  mascotMasterSvgString,
} from './mascot';
export type {
  MascotPose,
  MascotRenderOptions,
  EyeShape,
  MouthShape,
  ArmPose,
  BrowShape,
  PropKind,
  TailSpec,
  MascotDetail,
  MascotPartId,
  MascotParts,
  CourseFamilyId,
  CourseFamilyTint,
  MascotTint,
  MascotTintInput,
  MascotStateTint,
} from './mascot';

export {
  CHARACTER_ROSTER,
  CHARACTER_EXPRESSIONS,
  CHARACTER_EXPRESSION_POSES,
  CHARACTER_STYLE_VERSION,
  PORTRAIT_VIEWBOX,
  findCharacter,
  charactersForVariety,
  charactersForTrack,
  charactersForIntent,
  charactersForSituation,
  charactersForMission,
  castMatchesMission,
  missionIntentsCovered,
  missionIntentKeys,
  LEGACY_ROSTER_IDS,
  CHARACTER_SITUATIONS,
  SITUATION_TAGS,
  intentsForSituations,
  isSituationTag,
  situationFitsAge,
  EXPRESSION_LABELS,
  PORTRAIT_FLAT_MAX_SIZE,
  portraitDetailForSize,
  DISC_TINTS,
  cast,
  skinToneFamily,
  ClayContext,
  KEY_LIGHT,
  RIM_COLOR,
  RIM_OPACITY,
  SHADOW_INK,
  mix,
  specular,
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
  AgeBand,
  GenderPresentation,
  SkinToneFamily,
  Stature,
  PortraitDetail,
  PortraitRenderOptions,
  ExpressionPose,
  CharacterSituation,
  CurriculumIntentKey,
  SituationTag,
  CastSheet,
  CharacterRef,
  ClayMaterial,
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
