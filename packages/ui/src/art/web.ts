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
