/**
 * `cast()` — builds a {@link LangQuestCharacter} from a compact casting sheet.
 *
 * Fills the contract profile (deterministic uuid, honest review status), derives the
 * track ids from the variety, the skin-tone family from the look, the curriculum
 * intents from the situation tags, and generates alt text / silhouette notes from the
 * look when the sheet does not provide them. Every character is fictional; names and
 * looks are not based on real people.
 */
import {
  COURSE_TRACKS,
  type CharacterExpression,
  type CourseTrackId,
  type VarietyId,
} from '@langquest/contracts';
import { CLOTH_COLORS, HAIR_COLORS, SKIN_TONES, type SkinToneId } from '../palette';
import { type SituationTag, intentsForSituations } from './situations';
import type {
  AgeBand,
  AgeGroup,
  CharacterVoiceNotes,
  Clothing,
  GenderPresentation,
  HairStyle,
  LangQuestCharacter,
  PortraitParams,
  SkinToneFamily,
  Stature,
} from './types';
import { stableCharacterUuid } from './uuid';

/** Style version of the portrait generator — bump when geometry changes materially. */
export const CHARACTER_STYLE_VERSION = 'portrait-v2-clay';

const NO_EXPRESSION_ASSETS: Record<CharacterExpression, null> = {
  neutral: null,
  greeting: null,
  listening: null,
  talking: null,
  surprise: null,
  confusion: null,
  friendly_success: null,
  follow_up_question: null,
  lip_sync: null,
};

/** Coarse skin-tone family of a palette tone (two tones per family). */
export function skinToneFamily(skin: SkinToneId): SkinToneFamily {
  switch (skin) {
    case 's1':
    case 's2':
      return 'light';
    case 's3':
    case 's4':
      return 'medium';
    case 's5':
    case 's6':
      return 'brown';
    default:
      return 'deep';
  }
}

const AGE_GROUP: Record<AgeBand, AgeGroup> = {
  child: 'young',
  teen: 'young',
  adult: 'adult',
  elder: 'senior',
};
const STATURE: Record<AgeBand, Stature> = {
  child: 'child',
  teen: 'teen',
  adult: 'adult',
  elder: 'adult',
};

/** Soft disc tints (light theme); the dark disc is derived at render time. */
export const DISC_TINTS: readonly string[] = [
  '#FFE8D6',
  '#E3EFE6',
  '#E6E9F7',
  '#FFF0D6',
  '#E8F3EE',
  '#F3E8F2',
  '#E6F1F4',
  '#FBE8EA',
  '#FFF3D9',
  '#E9EEE4',
  '#F7E9DC',
  '#E4ECF8',
];

const DEFAULT_EYE: Record<keyof typeof HAIR_COLORS, string> = {
  black: '#2B1D16',
  darkBrown: '#3B2A1E',
  brown: '#4A2E1C',
  auburn: '#5C4033',
  blonde: '#4F7CAC',
  grey: '#3B2A1E',
  silver: '#556B7A',
};

const HAIR_WORDS: Record<HairStyle, string> = {
  short: 'short hair',
  buzz: 'close-cropped hair',
  curlyShort: 'short curly hair',
  curlyVolume: 'voluminous curls',
  afro: 'an afro',
  longStraight: 'long straight hair',
  bob: 'a bob',
  bun: 'hair in a bun',
  braids: 'a long braid',
  locs: 'locs',
  wavyMedium: 'shoulder-length wavy hair',
  sidePart: 'side-parted hair',
  ponytail: 'a ponytail',
  headscarf: 'a headscarf',
  bald: 'a shaved head',
  pigtails: 'pigtails',
  twists: 'twists',
  cornrows: 'cornrows',
  topknot: 'a topknot',
};

const CLOTH_WORDS: Record<Clothing, string> = {
  crew: 't-shirt',
  collar: 'shirt',
  vneck: 'v-neck top',
  apron: 'apron',
  coat: 'coat',
  hoodie: 'hoodie',
  blazer: 'blazer',
  hiVis: 'hi-vis vest',
  scarf: 'scarf',
  cardigan: 'cardigan',
  scrubs: 'scrubs',
  polo: 'polo shirt',
  turtleneck: 'turtleneck',
  kurta: 'kurta',
  jersey: 'sports jersey',
  overalls: 'overalls',
};

const COLOR_WORDS: Record<keyof typeof CLOTH_COLORS, string> = {
  teal: 'teal',
  coral: 'coral',
  mustard: 'mustard',
  navy: 'navy',
  plum: 'plum',
  olive: 'olive',
  sky: 'sky-blue',
  sand: 'sand',
  white: 'white',
  charcoal: 'charcoal',
  rose: 'rose',
  mint: 'mint',
  rust: 'rust',
  denim: 'denim-blue',
};

const HAIR_COLOR_WORDS: Record<keyof typeof HAIR_COLORS, string> = {
  black: 'black',
  darkBrown: 'dark brown',
  brown: 'brown',
  auburn: 'auburn',
  blonde: 'blonde',
  grey: 'grey',
  silver: 'silver',
};

const AGE_WORDS: Record<AgeBand, string> = {
  child: 'a child',
  teen: 'a teenager',
  adult: 'an adult',
  elder: 'an older adult',
};

/** Compact casting sheet of one character. */
export interface CastSheet {
  id: string;
  name: string;
  nameNative?: string | null;
  role: string;
  city: string;
  region: string;
  varietyId: VarietyId;
  /** Defaults to every track whose target variety is `varietyId`. */
  trackIds?: CourseTrackId[];
  ageBand: AgeBand;
  gender: GenderPresentation;
  personality: string;
  lifeContext: string;
  voice: Omit<CharacterVoiceNotes, 'regionalOption'> & { regionalOption?: string | null };
  look: Omit<
    PortraitParams,
    'head' | 'facialHair' | 'glasses' | 'earrings' | 'backdrop' | 'eyeColor' | 'age' | 'extras'
  > &
    Partial<
      Pick<
        PortraitParams,
        'head' | 'facialHair' | 'glasses' | 'earrings' | 'backdrop' | 'eyeColor' | 'extras'
      >
    >;
  situations: SituationTag[];
  silhouetteNotes?: string;
  altText?: string;
}

function hashIndex(id: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % mod;
}

/** Build a roster character from its casting sheet. */
export function cast(sheet: CastSheet): LangQuestCharacter {
  const look: PortraitParams = {
    head: 'oval',
    facialHair: 'none',
    glasses: 'none',
    earrings: 'none',
    backdrop: DISC_TINTS[hashIndex(sheet.id, DISC_TINTS.length)] as string,
    eyeColor: DEFAULT_EYE[sheet.look.hairColor],
    extras: [],
    age: AGE_GROUP[sheet.ageBand],
    stature: STATURE[sheet.ageBand],
    ...sheet.look,
  };
  const trackIds =
    sheet.trackIds ??
    COURSE_TRACKS.filter((t) => t.targetVarietyId === sheet.varietyId).map((t) => t.id);
  const regionalOption = sheet.voice.regionalOption ?? null;
  const extrasWords = look.extras.length ? `, ${look.extras.join(', ')}` : '';
  const silhouetteNotes =
    sheet.silhouetteNotes ??
    `${look.head} face, ${HAIR_WORDS[look.hair]}, ${CLOTH_WORDS[look.clothing]}${look.glasses !== 'none' ? `, ${look.glasses} glasses` : ''}${extrasWords}.`;
  const garment = `${COLOR_WORDS[look.clothColor]} ${CLOTH_WORDS[look.clothing]}`;
  const article = /^[aeiou]/.test(garment) ? 'an' : 'a';
  const altText =
    sheet.altText ??
    `${sheet.name}, ${AGE_WORDS[sheet.ageBand]} from ${sheet.city} (${sheet.role.toLowerCase()}) with ${HAIR_COLOR_WORDS[look.hairColor]} ${HAIR_WORDS[look.hair]}, wearing ${article} ${garment}.`;
  return {
    id: sheet.id,
    name: sheet.name,
    nameNative: sheet.nameNative ?? null,
    role: sheet.role,
    city: sheet.city,
    region: sheet.region,
    varietyId: sheet.varietyId,
    trackIds,
    personality: sheet.personality,
    lifeContext: sheet.lifeContext,
    voice: { ...sheet.voice, regionalOption },
    look,
    altText,
    ageBand: sheet.ageBand,
    genderPresentation: sheet.gender,
    regionalOption,
    skinFamily: skinToneFamily(look.skin),
    situations: [...sheet.situations],
    intents: intentsForSituations(sheet.situations),
    characterId: stableCharacterUuid(sheet.id),
    styleVersion: CHARACTER_STYLE_VERSION,
    silhouetteNotes,
    palette: [
      SKIN_TONES[look.skin],
      HAIR_COLORS[look.hairColor],
      CLOTH_COLORS[look.clothColor],
      CLOTH_COLORS[look.clothAccent],
      look.backdrop,
    ],
    expressions: { ...NO_EXPRESSION_ASSETS },
    halfBodyAssetId: null,
    fullBodyAssetId: null,
    clothingVariants: [{ id: 'default', label: 'Everyday', assetId: null }],
    // In-code vector art exists for every expression, but no reviewed `visual_assets` rows yet.
    complete: false,
    reviewStatus: 'review_needed',
    culturalReviewNote: 'Awaiting native cultural and dialect review before publication.',
  };
}
