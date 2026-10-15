/**
 * Recurring conversational characters (§10.2A) — an original roster of
 * native-speaking interlocutors, plus a parametric portrait generator that
 * renders every character in the 9 required expressions.
 *
 * Characters are fictional; names/looks are not based on real people or
 * existing franchises. Clothing is contemporary (no stereotyped costumes).
 * Each character is bound to ONE language variety and never substituted
 * across variety boundaries (a Darija character speaks Darija, etc.).
 *
 * Coordinate space: 120 × 120 viewBox, clean circular background for avatars.
 */
import {
  CHARACTER_EXPRESSION_VALUES,
  type CharacterExpression,
  type CharacterVisualProfile,
  type CourseTrackId,
  type VarietyId,
} from '@langquest/contracts';
import {
  type ArtTheme,
  CLOTH_COLORS,
  type ClothColorId,
  HAIR_COLORS,
  type HairColorId,
  SKIN_TONES,
  type SkinToneId,
  shade,
} from './palette';
import {
  type SvgDocument,
  type SvgNode,
  circle,
  el,
  ellipse,
  fmt,
  g,
  line,
  path,
  roundedRect,
  stroke,
  toSvgString,
} from './svg-node';

/** The 9 required lead-character expressions, in contract order. */
export const CHARACTER_EXPRESSIONS: readonly CharacterExpression[] = CHARACTER_EXPRESSION_VALUES;

export type HeadShape = 'round' | 'oval' | 'square' | 'heart' | 'long';
export type HairStyle =
  | 'short'
  | 'buzz'
  | 'curlyShort'
  | 'curlyVolume'
  | 'afro'
  | 'longStraight'
  | 'bob'
  | 'bun'
  | 'braids'
  | 'locs'
  | 'wavyMedium'
  | 'sidePart'
  | 'ponytail'
  | 'headscarf'
  | 'bald';
export type FacialHair = 'none' | 'stubble' | 'beard' | 'moustache' | 'goatee';
export type Glasses = 'none' | 'round' | 'rect';
export type Earrings = 'none' | 'studs' | 'hoops';
export type Clothing =
  | 'crew'
  | 'collar'
  | 'vneck'
  | 'apron'
  | 'coat'
  | 'hoodie'
  | 'blazer'
  | 'hiVis'
  | 'scarf'
  | 'cardigan';
export type Extra = 'cap' | 'earbud' | 'lanyard' | 'pen' | 'headband';
export type AgeGroup = 'young' | 'adult' | 'senior';

/** Parametric look of one character (the "model sheet" in data form). */
export interface PortraitParams {
  skin: SkinToneId;
  head: HeadShape;
  hair: HairStyle;
  hairColor: HairColorId;
  facialHair: FacialHair;
  glasses: Glasses;
  earrings: Earrings;
  clothing: Clothing;
  clothColor: ClothColorId;
  clothAccent: ClothColorId;
  /** Background tint for the avatar disc. */
  backdrop: string;
  eyeColor: string;
  age: AgeGroup;
  extras: Extra[];
}

/** Voice identity notes — no provider voice ids are claimed until a reviewed `CharacterVoiceProfile` exists. */
export interface CharacterVoiceNotes {
  pitch: 'low' | 'mid' | 'high';
  pace: 'relaxed' | 'natural' | 'brisk';
  warmth: 'reserved' | 'warm' | 'bubbly';
  /** Regional option id within the variety (matches `COURSE_TRACKS[].regionalOptions[].id`). */
  regionalOption: string | null;
  notes: string;
}

/** A LangQuest character: contract visual profile + roster metadata. */
export interface LangQuestCharacter extends CharacterVisualProfile {
  /** Stable slug id (`<variety>-<role>-<name>`), used by components and the asset manifest. */
  id: string;
  name: string;
  /** Pronunciation / native-script hint for the name (never used as a label on art). */
  nameNative: string | null;
  role: string;
  city: string;
  region: string;
  varietyId: VarietyId;
  trackIds: CourseTrackId[];
  personality: string;
  lifeContext: string;
  voice: CharacterVoiceNotes;
  look: PortraitParams;
  altText: string;
}

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

/** Deterministic UUID derived from a slug (FNV-1a over the slug, formatted as a v8-style UUID). */
export function stableCharacterUuid(slug: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < slug.length; i += 1) {
    const c = slug.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c * 31 + i), 0x85ebca6b) >>> 0;
  }
  const h3 = Math.imul(h1 ^ h2, 0xc2b2ae35) >>> 0;
  const h4 = Math.imul(h2 ^ (h1 >>> 7), 0x27d4eb2f) >>> 0;
  const hex = (n: number): string => n.toString(16).padStart(8, '0');
  const all = hex(h1) + hex(h2) + hex(h3) + hex(h4); // 32 hex chars
  return `${all.slice(0, 8)}-${all.slice(8, 12)}-8${all.slice(13, 16)}-${((parseInt(all.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${all.slice(17, 20)}-${all.slice(20, 32)}`;
}

interface RosterInput {
  id: string;
  name: string;
  nameNative: string | null;
  role: string;
  city: string;
  region: string;
  varietyId: VarietyId;
  trackIds: CourseTrackId[];
  personality: string;
  lifeContext: string;
  voice: CharacterVoiceNotes;
  look: PortraitParams;
  silhouetteNotes: string;
  altText: string;
}

function character(input: RosterInput): LangQuestCharacter {
  const palette = [
    SKIN_TONES[input.look.skin],
    HAIR_COLORS[input.look.hairColor],
    CLOTH_COLORS[input.look.clothColor],
    CLOTH_COLORS[input.look.clothAccent],
    input.look.backdrop,
  ];
  return {
    ...input,
    characterId: stableCharacterUuid(input.id),
    styleVersion: CHARACTER_STYLE_VERSION,
    palette,
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

/** Style version of the portrait generator — bump when geometry changes materially. */
export const CHARACTER_STYLE_VERSION = 'portrait-v1';

/** The original character roster (16 characters across 15 varieties). */
export const CHARACTER_ROSTER: readonly LangQuestCharacter[] = [
  character({
    id: 'ary-cafe-staff-nadia',
    name: 'Nadia',
    nameNative: 'نادية',
    role: 'Café staff',
    city: 'Casablanca',
    region: 'Morocco',
    varietyId: 'ary',
    trackIds: ['arabic-moroccan'],
    personality: 'Quick, warm, teases gently, remembers your usual order.',
    lifeContext:
      'Runs the morning shift at a neighbourhood café in Maârif; studying marketing at night.',
    voice: {
      pitch: 'mid',
      pace: 'brisk',
      warmth: 'warm',
      regionalOption: 'casablanca',
      notes: 'Casablanca Darija, natural French code-switching for café vocabulary.',
    },
    look: {
      skin: 's3',
      head: 'oval',
      hair: 'wavyMedium',
      hairColor: 'darkBrown',
      facialHair: 'none',
      glasses: 'none',
      earrings: 'studs',
      clothing: 'apron',
      clothColor: 'teal',
      clothAccent: 'sand',
      backdrop: '#FFE8D6',
      eyeColor: '#4A2E1C',
      age: 'young',
      extras: ['pen'],
    },
    silhouetteNotes:
      'Oval face, shoulder-length wavy hair tucked behind one ear, apron over a t-shirt.',
    altText:
      'Nadia, a young café worker from Casablanca with wavy dark hair, wearing a teal apron.',
  }),
  character({
    id: 'ary-neighbour-youssef',
    name: 'Youssef',
    nameNative: 'يوسف',
    role: 'Neighbour',
    city: 'Rabat',
    region: 'Morocco',
    varietyId: 'ary',
    trackIds: ['arabic-moroccan'],
    personality: 'Calm, dry humour, patient explainer, football talk always welcome.',
    lifeContext:
      'Retired teacher in Agdal who waters the stairwell plants and knows everyone in the building.',
    voice: {
      pitch: 'low',
      pace: 'relaxed',
      warmth: 'warm',
      regionalOption: 'casablanca',
      notes: 'Rabat Darija, slower delivery, clear consonants.',
    },
    look: {
      skin: 's4',
      head: 'square',
      hair: 'short',
      hairColor: 'grey',
      facialHair: 'moustache',
      glasses: 'rect',
      earrings: 'none',
      clothing: 'cardigan',
      clothColor: 'olive',
      clothAccent: 'white',
      backdrop: '#E3EFE6',
      eyeColor: '#3B2A1E',
      age: 'senior',
      extras: [],
    },
    silhouetteNotes: 'Square jaw, short grey hair, rectangular glasses, cardigan over a shirt.',
    altText: 'Youssef, an older neighbour from Rabat with short grey hair, glasses and a cardigan.',
  }),
  character({
    id: 'es-es-coworker-marta',
    name: 'Marta',
    nameNative: null,
    role: 'Coworker',
    city: 'Madrid',
    region: 'Spain',
    varietyId: 'es-ES',
    trackIds: ['spanish-spain'],
    personality: 'Direct, organised, generous with coffee breaks and feedback.',
    lifeContext: 'Product designer at a small studio in Lavapiés; cycles to work.',
    voice: {
      pitch: 'mid',
      pace: 'brisk',
      warmth: 'warm',
      regionalOption: null,
      notes: 'Castilian Spanish with distinción; office register.',
    },
    look: {
      skin: 's2',
      head: 'heart',
      hair: 'bob',
      hairColor: 'auburn',
      facialHair: 'none',
      glasses: 'round',
      earrings: 'hoops',
      clothing: 'blazer',
      clothColor: 'navy',
      clothAccent: 'white',
      backdrop: '#E6E9F7',
      eyeColor: '#556B2F',
      age: 'adult',
      extras: ['lanyard'],
    },
    silhouetteNotes: 'Heart-shaped face, chin-length auburn bob, round glasses, blazer.',
    altText: 'Marta, a coworker from Madrid with an auburn bob, round glasses and a navy blazer.',
  }),
  character({
    id: 'es-419-market-vendor-rafael',
    name: 'Rafael',
    nameNative: null,
    role: 'Market vendor',
    city: 'Mexico City',
    region: 'Mexico',
    varietyId: 'es-419',
    trackIds: ['spanish-latin-american'],
    personality: 'Loud laugh, proud of his produce, bargains with a smile.',
    lifeContext:
      'Third-generation fruit stall at Mercado de Medellín; sends voice notes to his grandkids.',
    voice: {
      pitch: 'low',
      pace: 'natural',
      warmth: 'bubbly',
      regionalOption: 'MX',
      notes: 'Mexico City Spanish, friendly diminutives, market calls.',
    },
    look: {
      skin: 's5',
      head: 'round',
      hair: 'short',
      hairColor: 'black',
      facialHair: 'goatee',
      glasses: 'none',
      earrings: 'none',
      clothing: 'apron',
      clothColor: 'coral',
      clothAccent: 'mustard',
      backdrop: '#FFF0D6',
      eyeColor: '#2E1A10',
      age: 'adult',
      extras: ['cap'],
    },
    silhouetteNotes: 'Round face, cap, goatee, apron over a bright t-shirt.',
    altText: 'Rafael, a market vendor from Mexico City wearing a cap and a coral apron.',
  }),
  character({
    id: 'ja-neighbour-haruka',
    name: 'Haruka',
    nameNative: '春香',
    role: 'Neighbour',
    city: 'Tokyo',
    region: 'Japan',
    varietyId: 'ja',
    trackIds: ['japanese'],
    personality: 'Considerate, observant, quietly funny; loves recycling-day logistics.',
    lifeContext:
      'Illustrator working from a small apartment in Koenji; grows herbs on the balcony.',
    voice: {
      pitch: 'high',
      pace: 'natural',
      warmth: 'warm',
      regionalOption: null,
      notes: 'Standard Tokyo Japanese, polite-casual neighbour register.',
    },
    look: {
      skin: 's1',
      head: 'oval',
      hair: 'longStraight',
      hairColor: 'black',
      facialHair: 'none',
      glasses: 'none',
      earrings: 'none',
      clothing: 'crew',
      clothColor: 'sand',
      clothAccent: 'mint',
      backdrop: '#E8F3EE',
      eyeColor: '#2B1D16',
      age: 'young',
      extras: [],
    },
    silhouetteNotes:
      'Oval face, long straight black hair with a straight fringe, soft crew-neck top.',
    altText:
      'Haruka, a neighbour from Tokyo with long straight black hair and a sand-coloured top.',
  }),
  character({
    id: 'ko-classmate-minjun',
    name: 'Min-jun',
    nameNative: '민준',
    role: 'Classmate',
    city: 'Seoul',
    region: 'South Korea',
    varietyId: 'ko',
    trackIds: ['korean'],
    personality: 'Energetic, competitive at board games, shares study playlists.',
    lifeContext: 'Second-year university student in Sinchon; part-time at a study café.',
    voice: {
      pitch: 'mid',
      pace: 'brisk',
      warmth: 'bubbly',
      regionalOption: null,
      notes: 'Seoul standard Korean, campus banmal/jondaetmal switching explained in hints.',
    },
    look: {
      skin: 's2',
      head: 'long',
      hair: 'sidePart',
      hairColor: 'black',
      facialHair: 'none',
      glasses: 'none',
      earrings: 'none',
      clothing: 'hoodie',
      clothColor: 'denim',
      clothAccent: 'white',
      backdrop: '#E4ECF8',
      eyeColor: '#2B1D16',
      age: 'young',
      extras: ['earbud'],
    },
    silhouetteNotes: 'Long face, side-parted black hair with volume on top, hoodie.',
    altText: 'Min-jun, a university student from Seoul with side-parted hair and a blue hoodie.',
  }),
  character({
    id: 'uk-friend-oksana',
    name: 'Oksana',
    nameNative: 'Оксана',
    role: 'Friend',
    city: 'Kyiv',
    region: 'Ukraine',
    varietyId: 'uk',
    trackIds: ['ukrainian'],
    personality: 'Warm, frank, fiercely loyal, bakes when stressed.',
    lifeContext: 'Software tester in Podil; organises weekend hikes outside the city.',
    voice: {
      pitch: 'mid',
      pace: 'natural',
      warmth: 'warm',
      regionalOption: null,
      notes: 'Standard Ukrainian, Kyiv pronunciation, friendly informal register.',
    },
    look: {
      skin: 's1',
      head: 'round',
      hair: 'braids',
      hairColor: 'blonde',
      facialHair: 'none',
      glasses: 'none',
      earrings: 'studs',
      clothing: 'scarf',
      clothColor: 'plum',
      clothAccent: 'mustard',
      backdrop: '#F3E8F2',
      eyeColor: '#4F7CAC',
      age: 'adult',
      extras: [],
    },
    silhouetteNotes: 'Round face, blonde braid over one shoulder, light scarf over a sweater.',
    altText: 'Oksana, a friend from Kyiv with a blonde braid and a plum sweater with a scarf.',
  }),
  character({
    id: 'pt-br-host-thiago',
    name: 'Thiago',
    nameNative: null,
    role: 'Host',
    city: 'Rio de Janeiro',
    region: 'Brazil',
    varietyId: 'pt-BR',
    trackIds: ['portuguese-brazilian'],
    personality: 'Laid-back, hospitable, talks with his hands, beach-volleyball evangelist.',
    lifeContext: 'Rents a spare room in Botafogo; works as a sound engineer.',
    voice: {
      pitch: 'low',
      pace: 'relaxed',
      warmth: 'bubbly',
      regionalOption: null,
      notes: 'Carioca Portuguese, open vowels, informal host register.',
    },
    look: {
      skin: 's5',
      head: 'oval',
      hair: 'curlyShort',
      hairColor: 'darkBrown',
      facialHair: 'stubble',
      glasses: 'none',
      earrings: 'none',
      clothing: 'vneck',
      clothColor: 'mint',
      clothAccent: 'sand',
      backdrop: '#E2F4EA',
      eyeColor: '#3B2A1E',
      age: 'adult',
      extras: [],
    },
    silhouetteNotes: 'Oval face, short curly hair, stubble, relaxed v-neck tee.',
    altText: 'Thiago, a host from Rio with short curly hair, stubble and a mint v-neck t-shirt.',
  }),
  character({
    id: 'pt-pt-pharmacist-ines',
    name: 'Inês',
    nameNative: null,
    role: 'Pharmacist',
    city: 'Lisbon',
    region: 'Portugal',
    varietyId: 'pt-PT',
    trackIds: ['portuguese-european'],
    personality: 'Precise, reassuring, dry wit, never rushes a question.',
    lifeContext: 'Runs a family pharmacy in Alvalade; fado on the radio after closing.',
    voice: {
      pitch: 'mid',
      pace: 'natural',
      warmth: 'reserved',
      regionalOption: null,
      notes: 'Lisbon European Portuguese, clear professional register, reduced vowels.',
    },
    look: {
      skin: 's2',
      head: 'oval',
      hair: 'bun',
      hairColor: 'brown',
      facialHair: 'none',
      glasses: 'rect',
      earrings: 'studs',
      clothing: 'coat',
      clothColor: 'white',
      clothAccent: 'teal',
      backdrop: '#E6F1F4',
      eyeColor: '#5C4033',
      age: 'adult',
      extras: ['pen'],
    },
    silhouetteNotes: 'Oval face, hair in a neat bun, rectangular glasses, white professional coat.',
    altText: 'Inês, a pharmacist from Lisbon with her hair in a bun, glasses and a white coat.',
  }),
  character({
    id: 'arz-taxi-driver-samir',
    name: 'Samir',
    nameNative: 'سمير',
    role: 'Taxi driver',
    city: 'Cairo',
    region: 'Egypt',
    varietyId: 'arz',
    trackIds: ['arabic-egyptian'],
    personality: 'Storyteller, philosophical in traffic, knows every shortcut and every song.',
    lifeContext: 'Drives nights across Zamalek and Dokki; studying for a tourism licence.',
    voice: {
      pitch: 'low',
      pace: 'natural',
      warmth: 'warm',
      regionalOption: 'cairo',
      notes: 'Cairene Egyptian Arabic, expressive intonation, street-direction vocabulary.',
    },
    look: {
      skin: 's4',
      head: 'square',
      hair: 'buzz',
      hairColor: 'black',
      facialHair: 'beard',
      glasses: 'none',
      earrings: 'none',
      clothing: 'collar',
      clothColor: 'sky',
      clothAccent: 'charcoal',
      backdrop: '#E6ECF3',
      eyeColor: '#2E1A10',
      age: 'adult',
      extras: [],
    },
    silhouetteNotes: 'Square face, buzz cut, full short beard, collared short-sleeve shirt.',
    altText: 'Samir, a taxi driver from Cairo with a buzz cut, short beard and a light blue shirt.',
  }),
  character({
    id: 'ar-levant-shopkeeper-rima',
    name: 'Rima',
    nameNative: 'ريما',
    role: 'Shopkeeper',
    city: 'Beirut',
    region: 'Lebanon',
    varietyId: 'ar-levant',
    trackIds: ['arabic-eastern'],
    personality: 'Elegant, sharp, generous with samples and opinions.',
    lifeContext: 'Owns a small grocery-and-deli in Mar Mikhael; trilingual by necessity.',
    voice: {
      pitch: 'mid',
      pace: 'natural',
      warmth: 'warm',
      regionalOption: 'LB',
      notes:
        'Lebanese Levantine Arabic with light French/English borrowings typical of Beirut retail.',
    },
    look: {
      skin: 's2',
      head: 'heart',
      hair: 'wavyMedium',
      hairColor: 'darkBrown',
      facialHair: 'none',
      glasses: 'none',
      earrings: 'hoops',
      clothing: 'blazer',
      clothColor: 'rose',
      clothAccent: 'white',
      backdrop: '#FBE8EA',
      eyeColor: '#3B2A1E',
      age: 'adult',
      extras: [],
    },
    silhouetteNotes: 'Heart-shaped face, wavy shoulder-length hair, hoop earrings, light blazer.',
    altText: 'Rima, a shopkeeper from Beirut with wavy dark hair, hoop earrings and a rose blazer.',
  }),
  character({
    id: 'yue-teahouse-staff-ka-yan',
    name: 'Ka-yan',
    nameNative: '嘉欣',
    role: 'Tea-house staff',
    city: 'Hong Kong',
    region: 'Hong Kong SAR',
    varietyId: 'yue',
    trackIds: ['chinese-cantonese'],
    personality: 'Fast, witty, unflappable during the lunch rush, secretly loves karaoke.',
    lifeContext:
      'Works the floor at a cha chaan teng in Sham Shui Po; evening Cantonese opera classes.',
    voice: {
      pitch: 'high',
      pace: 'brisk',
      warmth: 'bubbly',
      regionalOption: 'HK',
      notes: 'Hong Kong Cantonese with sentence-final particles; never Mandarin substitution.',
    },
    look: {
      skin: 's1',
      head: 'round',
      hair: 'ponytail',
      hairColor: 'black',
      facialHair: 'none',
      glasses: 'none',
      earrings: 'studs',
      clothing: 'apron',
      clothColor: 'charcoal',
      clothAccent: 'mustard',
      backdrop: '#FFF3D9',
      eyeColor: '#2B1D16',
      age: 'young',
      extras: ['pen'],
    },
    silhouetteNotes: 'Round face, high ponytail, dark apron over a tee.',
    altText: 'Ka-yan, a tea-house worker from Hong Kong with a high ponytail and a charcoal apron.',
  }),
  character({
    id: 'ht-teacher-manouchka',
    name: 'Manouchka',
    nameNative: null,
    role: 'Teacher',
    city: 'Port-au-Prince',
    region: 'Haiti',
    varietyId: 'ht',
    trackIds: ['haitian-creole'],
    personality: 'Encouraging, structured, proverbs for every situation.',
    lifeContext: 'Primary-school teacher in Pétion-Ville; runs a Saturday reading club.',
    voice: {
      pitch: 'mid',
      pace: 'natural',
      warmth: 'warm',
      regionalOption: null,
      notes: 'Haitian Creole throughout; French is never used as a stand-in for Kreyòl.',
    },
    look: {
      skin: 's7',
      head: 'oval',
      hair: 'locs',
      hairColor: 'black',
      facialHair: 'none',
      glasses: 'round',
      earrings: 'hoops',
      clothing: 'cardigan',
      clothColor: 'mustard',
      clothAccent: 'white',
      backdrop: '#FFF0DA',
      eyeColor: '#1F140E',
      age: 'adult',
      extras: ['headband'],
    },
    silhouetteNotes: 'Oval face, shoulder-length locs with a headband, round glasses, cardigan.',
    altText:
      'Manouchka, a teacher from Port-au-Prince with shoulder-length locs, round glasses and a mustard cardigan.',
  }),
  character({
    id: 'sw-matatu-conductor-brian',
    name: 'Brian',
    nameNative: null,
    role: 'Matatu conductor',
    city: 'Nairobi',
    region: 'Kenya',
    varietyId: 'sw',
    trackIds: ['swahili'],
    personality: 'Fast-talking, funny, keeps exact change and exact timing.',
    lifeContext: 'Works the Ngong Road route; saving for a bodaboda of his own.',
    voice: {
      pitch: 'mid',
      pace: 'brisk',
      warmth: 'bubbly',
      regionalOption: 'KE',
      notes: 'Nairobi Swahili with Sheng flavour flagged in hints; Kenyan pronunciation.',
    },
    look: {
      skin: 's8',
      head: 'long',
      hair: 'buzz',
      hairColor: 'black',
      facialHair: 'stubble',
      glasses: 'none',
      earrings: 'none',
      clothing: 'hiVis',
      clothColor: 'charcoal',
      clothAccent: 'mustard',
      backdrop: '#E9EEE4',
      eyeColor: '#1F140E',
      age: 'young',
      extras: [],
    },
    silhouetteNotes: 'Long face, buzz cut, high-visibility vest over a dark t-shirt.',
    altText:
      'Brian, a matatu conductor from Nairobi with a buzz cut wearing a yellow high-visibility vest.',
  }),
  character({
    id: 'rw-guide-aline',
    name: 'Aline',
    nameNative: null,
    role: 'Guide',
    city: 'Kigali',
    region: 'Rwanda',
    varietyId: 'rw',
    trackIds: ['kinyarwanda'],
    personality: 'Gracious, precise, proud of the city, gently corrects.',
    lifeContext: 'City walking-tour guide based in Nyamirambo; trained as a geographer.',
    voice: {
      pitch: 'mid',
      pace: 'relaxed',
      warmth: 'warm',
      regionalOption: null,
      notes: 'Kinyarwanda with careful tone; native-validated recordings preferred over synthesis.',
    },
    look: {
      skin: 's7',
      head: 'heart',
      hair: 'curlyVolume',
      hairColor: 'black',
      facialHair: 'none',
      glasses: 'none',
      earrings: 'studs',
      clothing: 'collar',
      clothColor: 'white',
      clothAccent: 'teal',
      backdrop: '#E2F0F3',
      eyeColor: '#1F140E',
      age: 'adult',
      extras: ['lanyard'],
    },
    silhouetteNotes: 'Heart-shaped face, voluminous natural curls, collared shirt with a lanyard.',
    altText:
      'Aline, a city guide from Kigali with voluminous curly hair and a white collared shirt.',
  }),
  character({
    id: 'ln-musician-didier',
    name: 'Didier',
    nameNative: null,
    role: 'Musician',
    city: 'Kinshasa',
    region: 'DR Congo',
    varietyId: 'ln',
    trackIds: ['lingala'],
    personality: 'Charismatic, rhythmic speech, improvises nicknames for everyone.',
    lifeContext: 'Guitarist in a rumba band rehearsing in Matonge; teaches kids on Sundays.',
    voice: {
      pitch: 'low',
      pace: 'natural',
      warmth: 'bubbly',
      regionalOption: 'CD',
      notes: 'Kinshasa Lingala with typical French borrowings; musical intonation.',
    },
    look: {
      skin: 's8',
      head: 'square',
      hair: 'afro',
      hairColor: 'black',
      facialHair: 'goatee',
      glasses: 'none',
      earrings: 'none',
      clothing: 'collar',
      clothColor: 'rust',
      clothAccent: 'sand',
      backdrop: '#F7E9DC',
      eyeColor: '#1F140E',
      age: 'adult',
      extras: [],
    },
    silhouetteNotes:
      'Square face, rounded afro, goatee, patterned-free rust shirt with open collar.',
    altText: 'Didier, a musician from Kinshasa with an afro, goatee and a rust-coloured shirt.',
  }),
];

const rosterById = new Map<string, LangQuestCharacter>();
for (const c of CHARACTER_ROSTER) {
  rosterById.set(c.id, c);
  rosterById.set(c.characterId, c);
}

/** Look up a character by slug id or by its stable UUID. */
export function findCharacter(characterId: string): LangQuestCharacter | undefined {
  return rosterById.get(characterId);
}

/** Characters whose variety matches (never crosses variety boundaries). */
export function charactersForVariety(varietyId: VarietyId): LangQuestCharacter[] {
  return CHARACTER_ROSTER.filter((c) => c.varietyId === varietyId);
}

/* ------------------------------------------------------------ expressions */

type PEyes = 'open' | 'happy' | 'wide' | 'side' | 'half';
type PBrows = 'neutral' | 'raised' | 'raisedOne' | 'furrowed' | 'soft';
type PMouth = 'closedSmile' | 'smile' | 'open' | 'wideOpen' | 'o' | 'wavy' | 'grin' | 'flat' | 'ee';
type PHand = 'none' | 'wave' | 'chin';

interface ExpressionPose {
  eyes: PEyes;
  brows: PBrows;
  mouth: PMouth;
  tilt: number;
  hand: PHand;
  blush: boolean;
  gaze: readonly [number, number];
}

/** Expression vocabulary for lead characters. */
export const CHARACTER_EXPRESSION_POSES: Record<CharacterExpression, ExpressionPose> = {
  neutral: {
    eyes: 'open',
    brows: 'neutral',
    mouth: 'closedSmile',
    tilt: 0,
    hand: 'none',
    blush: false,
    gaze: [0, 0],
  },
  greeting: {
    eyes: 'open',
    brows: 'raised',
    mouth: 'smile',
    tilt: -3,
    hand: 'wave',
    blush: true,
    gaze: [0, 0],
  },
  listening: {
    eyes: 'side',
    brows: 'soft',
    mouth: 'closedSmile',
    tilt: 6,
    hand: 'none',
    blush: false,
    gaze: [-1, 0],
  },
  talking: {
    eyes: 'open',
    brows: 'neutral',
    mouth: 'open',
    tilt: 0,
    hand: 'none',
    blush: false,
    gaze: [0, 0],
  },
  surprise: {
    eyes: 'wide',
    brows: 'raised',
    mouth: 'o',
    tilt: 0,
    hand: 'none',
    blush: false,
    gaze: [0, -0.3],
  },
  confusion: {
    eyes: 'open',
    brows: 'raisedOne',
    mouth: 'wavy',
    tilt: 4,
    hand: 'chin',
    blush: false,
    gaze: [0.8, -0.4],
  },
  friendly_success: {
    eyes: 'happy',
    brows: 'soft',
    mouth: 'grin',
    tilt: -2,
    hand: 'none',
    blush: true,
    gaze: [0, 0],
  },
  follow_up_question: {
    eyes: 'open',
    brows: 'raisedOne',
    mouth: 'smile',
    tilt: -5,
    hand: 'none',
    blush: false,
    gaze: [0.6, 0],
  },
  lip_sync: {
    eyes: 'open',
    brows: 'neutral',
    mouth: 'ee',
    tilt: 0,
    hand: 'none',
    blush: false,
    gaze: [0, 0],
  },
};

/* --------------------------------------------------------------- drawing */

export const PORTRAIT_VIEWBOX = { x: 0, y: 0, width: 120, height: 120 } as const;
const HX = 60;
const HY = 52;
const OUT = '#2B2522';
const LINE = 1.6;

interface HeadGeom {
  rx: number;
  ry: number;
  d: string;
  top: number;
  bottom: number;
}

function headGeom(shape: HeadShape): HeadGeom {
  switch (shape) {
    case 'round':
      return { rx: 21, ry: 22, d: ellipsePath(HX, HY, 21, 22), top: HY - 22, bottom: HY + 22 };
    case 'oval':
      return { rx: 19.5, ry: 24, d: ellipsePath(HX, HY, 19.5, 24), top: HY - 24, bottom: HY + 24 };
    case 'long':
      return { rx: 18, ry: 26, d: ellipsePath(HX, HY + 1, 18, 26), top: HY - 25, bottom: HY + 27 };
    case 'square':
      return {
        rx: 20.5,
        ry: 23,
        d: roundedRect(HX - 20.5, HY - 23, 41, 46, [16, 16, 13, 13]),
        top: HY - 23,
        bottom: HY + 23,
      };
    case 'heart':
      return {
        rx: 21,
        ry: 23,
        d: `M${HX - 21},${HY - 8} C${HX - 21},${HY - 24} ${HX - 10},${HY - 25} ${HX},${HY - 25} C${HX + 10},${HY - 25} ${HX + 21},${HY - 24} ${HX + 21},${HY - 8} C${HX + 21},${HY + 8} ${HX + 10},${HY + 23} ${HX},${HY + 23} C${HX - 10},${HY + 23} ${HX - 21},${HY + 8} ${HX - 21},${HY - 8}Z`,
        top: HY - 25,
        bottom: HY + 23,
      };
    default:
      return { rx: 20, ry: 23, d: ellipsePath(HX, HY, 20, 23), top: HY - 23, bottom: HY + 23 };
  }
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${fmt(cx - rx)},${cy} a${rx},${ry} 0 1 0 ${fmt(rx * 2)},0 a${rx},${ry} 0 1 0 ${fmt(-rx * 2)},0Z`;
}

function hairBack(style: HairStyle, color: string, h: HeadGeom): SvgNode[] {
  const dark = shade(color, -0.25);
  const base = { fill: color, stroke: OUT, strokeWidth: LINE, strokeLinejoin: 'round' as const };
  switch (style) {
    case 'longStraight':
      return [
        path(
          `M${HX - h.rx - 3},${h.top + 14} C${HX - h.rx - 6},${HY + 30} ${HX - h.rx - 2},${HY + 46} ${HX - h.rx + 2},${HY + 48} H${HX + h.rx - 2} C${HX + h.rx + 2},${HY + 46} ${HX + h.rx + 6},${HY + 30} ${HX + h.rx + 3},${h.top + 14} Q${HX},${h.top - 6} ${HX - h.rx - 3},${h.top + 14}Z`,
          base,
        ),
      ];
    case 'wavyMedium':
      return [
        path(
          `M${HX - h.rx - 4},${h.top + 12} C${HX - h.rx - 9},${HY + 16} ${HX - h.rx - 3},${HY + 28} ${HX - h.rx - 6},${HY + 36} C${HX - h.rx + 4},${HY + 38} ${HX - h.rx + 8},${HY + 30} ${HX - h.rx + 6},${HY + 24} L${HX + h.rx - 6},${HY + 24} C${HX + h.rx - 8},${HY + 30} ${HX + h.rx - 4},${HY + 38} ${HX + h.rx + 6},${HY + 36} C${HX + h.rx + 3},${HY + 28} ${HX + h.rx + 9},${HY + 16} ${HX + h.rx + 4},${h.top + 12} Q${HX},${h.top - 6} ${HX - h.rx - 4},${h.top + 12}Z`,
          base,
        ),
      ];
    case 'bob':
      return [
        path(
          `M${HX - h.rx - 4},${h.top + 10} C${HX - h.rx - 7},${HY + 10} ${HX - h.rx - 5},${HY + 20} ${HX - h.rx - 1},${HY + 22} H${HX + h.rx + 1} C${HX + h.rx + 5},${HY + 20} ${HX + h.rx + 7},${HY + 10} ${HX + h.rx + 4},${h.top + 10} Q${HX},${h.top - 6} ${HX - h.rx - 4},${h.top + 10}Z`,
          base,
        ),
      ];
    case 'braids':
      return [
        path(
          `M${HX + h.rx - 6},${HY + 2} C${HX + h.rx + 2},${HY + 16} ${HX + h.rx + 4},${HY + 30} ${HX + h.rx - 2},${HY + 44}`,
          stroke(OUT, 10),
        ),
        path(
          `M${HX + h.rx - 6},${HY + 2} C${HX + h.rx + 2},${HY + 16} ${HX + h.rx + 4},${HY + 30} ${HX + h.rx - 2},${HY + 44}`,
          stroke(color, 7),
        ),
        path(
          `M${HX + h.rx - 4},${HY + 10} l3,3 M${HX + h.rx - 1},${HY + 20} l3,3 M${HX + h.rx},${HY + 30} l3,3`,
          stroke(dark, 1.4),
        ),
      ];
    case 'locs':
      return [
        g(
          {},
          [-14, -7, 0, 7, 14].map((dx) =>
            path(
              `M${HX + dx},${h.top + 10} Q${HX + dx * 1.6},${HY + 20} ${HX + dx * 1.7},${HY + 34}`,
              stroke(color, 4.4, { stroke: color }),
            ),
          ),
        ),
        g(
          {},
          [-14, -7, 0, 7, 14].map((dx) =>
            path(
              `M${HX + dx},${h.top + 10} Q${HX + dx * 1.6},${HY + 20} ${HX + dx * 1.7},${HY + 34}`,
              stroke(OUT, 1, { strokeOpacity: 0.5 }),
            ),
          ),
        ),
      ];
    case 'ponytail':
      return [
        path(
          `M${HX + 6},${h.top + 4} C${HX + 26},${h.top - 2} ${HX + 30},${HY + 14} ${HX + 22},${HY + 30}`,
          stroke(OUT, 9.5),
        ),
        path(
          `M${HX + 6},${h.top + 4} C${HX + 26},${h.top - 2} ${HX + 30},${HY + 14} ${HX + 22},${HY + 30}`,
          stroke(color, 7),
        ),
      ];
    case 'afro':
      return [circle(HX, HY - 4, h.rx + 12, base)];
    case 'curlyVolume':
      return [
        circle(HX - h.rx + 2, HY - 4, 12, base),
        circle(HX + h.rx - 2, HY - 4, 12, base),
        circle(HX - h.rx + 10, HY - 16, 12, base),
        circle(HX + h.rx - 10, HY - 16, 12, base),
        circle(HX, HY - 20, 13, base),
        circle(HX - h.rx + 4, HY + 8, 10, base),
        circle(HX + h.rx - 4, HY + 8, 10, base),
      ];
    case 'headscarf':
      return [
        path(
          `M${HX - h.rx - 6},${h.top + 12} C${HX - h.rx - 10},${HY + 20} ${HX - h.rx - 4},${HY + 44} ${HX - 6},${HY + 48} H${HX + 8} C${HX + h.rx + 6},${HY + 44} ${HX + h.rx + 10},${HY + 20} ${HX + h.rx + 6},${h.top + 12} Q${HX},${h.top - 8} ${HX - h.rx - 6},${h.top + 12}Z`,
          base,
        ),
      ];
    default:
      return [];
  }
}

function hairFront(style: HairStyle, color: string, h: HeadGeom, extras: Extra[]): SvgNode[] {
  const base = { fill: color, stroke: OUT, strokeWidth: LINE, strokeLinejoin: 'round' as const };
  const t = h.top;
  const r = h.rx;
  const nodes: SvgNode[] = [];
  switch (style) {
    case 'short':
      nodes.push(
        path(
          `M${HX - r + 1},${t + 16} C${HX - r - 1},${t + 2} ${HX - 8},${t - 4} ${HX + 2},${t - 3} C${HX + 14},${t - 3} ${HX + r + 1},${t + 4} ${HX + r - 1},${t + 15} C${HX + r - 6},${t + 8} ${HX + 4},${t + 4} ${HX - 6},${t + 8} C${HX - 12},${t + 10} ${HX - r + 4},${t + 12} ${HX - r + 1},${t + 16}Z`,
          base,
        ),
      );
      break;
    case 'buzz':
      nodes.push(
        path(
          `M${HX - r + 1},${t + 13} C${HX - r},${t + 2} ${HX - 10},${t - 2} ${HX},${t - 2} C${HX + 10},${t - 2} ${HX + r},${t + 2} ${HX + r - 1},${t + 13} C${HX + 8},${t + 7} ${HX - 8},${t + 7} ${HX - r + 1},${t + 13}Z`,
          { ...base, fillOpacity: 0.92 },
        ),
      );
      break;
    case 'curlyShort':
      nodes.push(
        path(
          `M${HX - r},${t + 15} C${HX - r - 3},${t + 2} ${HX - 10},${t - 6} ${HX},${t - 5} C${HX + 10},${t - 6} ${HX + r + 3},${t + 2} ${HX + r},${t + 15} C${HX + r - 4},${t + 10} ${HX + 6},${t + 6} ${HX},${t + 9} C${HX - 6},${t + 6} ${HX - r + 4},${t + 10} ${HX - r},${t + 15}Z`,
          base,
        ),
        circle(HX - r + 2, t + 8, 5, base),
        circle(HX + r - 2, t + 8, 5, base),
        circle(HX - 8, t - 1, 5, base),
        circle(HX + 8, t - 1, 5, base),
      );
      break;
    case 'curlyVolume':
    case 'afro':
      nodes.push(
        path(
          `M${HX - r + 1},${t + 12} C${HX - r},${t + 4} ${HX - 10},${t} ${HX},${t} C${HX + 10},${t} ${HX + r},${t + 4} ${HX + r - 1},${t + 12} C${HX + 8},${t + 8} ${HX - 8},${t + 8} ${HX - r + 1},${t + 12}Z`,
          base,
        ),
      );
      break;
    case 'longStraight':
      nodes.push(
        path(
          `M${HX - r - 1},${t + 18} C${HX - r - 2},${t + 2} ${HX - 8},${t - 4} ${HX},${t - 4} C${HX + 8},${t - 4} ${HX + r + 2},${t + 2} ${HX + r + 1},${t + 18} L${HX + r - 3},${t + 14} L${HX - r + 3},${t + 14}Z`,
          base,
        ),
      );
      break;
    case 'bob':
      nodes.push(
        path(
          `M${HX - r - 1},${t + 16} C${HX - r - 2},${t + 2} ${HX - 6},${t - 4} ${HX + 2},${t - 4} C${HX + 10},${t - 4} ${HX + r + 2},${t + 2} ${HX + r + 1},${t + 16} C${HX + r - 2},${t + 6} ${HX + 2},${t + 4} ${HX - 4},${t + 10} C${HX - 8},${t + 14} ${HX - r + 3},${t + 12} ${HX - r - 1},${t + 16}Z`,
          base,
        ),
      );
      break;
    case 'bun':
      nodes.push(
        circle(HX, t - 2, 8, base),
        path(
          `M${HX - r + 1},${t + 14} C${HX - r},${t + 3} ${HX - 10},${t - 1} ${HX},${t - 1} C${HX + 10},${t - 1} ${HX + r},${t + 3} ${HX + r - 1},${t + 14} C${HX + 8},${t + 8} ${HX - 8},${t + 8} ${HX - r + 1},${t + 14}Z`,
          base,
        ),
      );
      break;
    case 'braids':
      nodes.push(
        path(
          `M${HX - r + 1},${t + 14} C${HX - r},${t + 3} ${HX - 10},${t - 1} ${HX},${t - 1} C${HX + 10},${t - 1} ${HX + r},${t + 3} ${HX + r - 1},${t + 14} C${HX + 8},${t + 8} ${HX - 8},${t + 8} ${HX - r + 1},${t + 14}Z`,
          base,
        ),
        path(
          `M${HX - 6},${t + 1} Q${HX + 4},${t + 4} ${HX + 10},${t + 10}`,
          stroke(shade(color, -0.25), 1.2),
        ),
      );
      break;
    case 'locs':
      nodes.push(
        path(
          `M${HX - r + 1},${t + 12} C${HX - r},${t + 2} ${HX - 10},${t - 3} ${HX},${t - 3} C${HX + 10},${t - 3} ${HX + r},${t + 2} ${HX + r - 1},${t + 12} C${HX + 8},${t + 8} ${HX - 8},${t + 8} ${HX - r + 1},${t + 12}Z`,
          base,
        ),
      );
      break;
    case 'wavyMedium':
      nodes.push(
        path(
          `M${HX - r - 1},${t + 18} C${HX - r - 2},${t + 2} ${HX - 8},${t - 5} ${HX + 2},${t - 4} C${HX + 12},${t - 4} ${HX + r + 2},${t + 2} ${HX + r + 1},${t + 18} C${HX + r - 3},${t + 10} ${HX + 10},${t + 4} ${HX},${t + 10} C${HX - 8},${t + 12} ${HX - r + 3},${t + 12} ${HX - r - 1},${t + 18}Z`,
          base,
        ),
      );
      break;
    case 'sidePart':
      nodes.push(
        path(
          `M${HX - r + 1},${t + 15} C${HX - r - 2},${t + 2} ${HX - 10},${t - 6} ${HX + 4},${t - 5} C${HX + 16},${t - 5} ${HX + r + 2},${t + 3} ${HX + r - 1},${t + 15} C${HX + r - 6},${t + 6} ${HX + 10},${t + 2} ${HX - 8},${t + 12} C${HX - 12},${t + 13} ${HX - r + 3},${t + 12} ${HX - r + 1},${t + 15}Z`,
          base,
        ),
      );
      break;
    case 'ponytail':
      nodes.push(
        path(
          `M${HX - r + 1},${t + 14} C${HX - r},${t + 2} ${HX - 10},${t - 2} ${HX},${t - 2} C${HX + 10},${t - 2} ${HX + r},${t + 2} ${HX + r - 1},${t + 14} C${HX + 8},${t + 8} ${HX - 8},${t + 8} ${HX - r + 1},${t + 14}Z`,
          base,
        ),
      );
      break;
    case 'headscarf':
      nodes.push(
        path(
          `M${HX - r - 2},${t + 20} C${HX - r - 4},${t + 2} ${HX - 8},${t - 6} ${HX},${t - 6} C${HX + 8},${t - 6} ${HX + r + 4},${t + 2} ${HX + r + 2},${t + 20} C${HX + r - 2},${t + 10} ${HX + 10},${t + 5} ${HX},${t + 5} C${HX - 10},${t + 5} ${HX - r + 2},${t + 10} ${HX - r - 2},${t + 20}Z`,
          base,
        ),
      );
      break;
    case 'bald':
      nodes.push(ellipse(HX - 6, t + 6, 5, 2.4, { fill: '#FFFFFF', fillOpacity: 0.25 }));
      break;
    default:
      break;
  }
  if (extras.includes('headband')) {
    nodes.push(
      path(
        `M${HX - r + 2},${t + 11} Q${HX},${t + 4} ${HX + r - 2},${t + 11}`,
        stroke(CLOTH_COLORS.coral, 3.2),
      ),
    );
  }
  if (extras.includes('cap')) {
    nodes.push(
      path(
        `M${HX - r - 1},${t + 12} C${HX - r},${t} ${HX - 10},${t - 6} ${HX},${t - 6} C${HX + 10},${t - 6} ${HX + r},${t} ${HX + r + 1},${t + 12}Z`,
        { fill: CLOTH_COLORS.navy, stroke: OUT, strokeWidth: LINE, strokeLinejoin: 'round' },
      ),
      path(
        `M${HX - r - 1},${t + 12} H${HX + r + 12} q3,0 2,3 Q${HX + 10},${t + 13} ${HX - r - 1},${t + 12}Z`,
        {
          fill: shade(CLOTH_COLORS.navy, -0.2),
          stroke: OUT,
          strokeWidth: LINE,
          strokeLinejoin: 'round',
        },
      ),
    );
  }
  return nodes;
}

function torso(params: PortraitParams, skin: string): SvgNode[] {
  const cloth = CLOTH_COLORS[params.clothColor];
  const accent = CLOTH_COLORS[params.clothAccent];
  const base = { fill: cloth, stroke: OUT, strokeWidth: LINE, strokeLinejoin: 'round' as const };
  const shoulders = `M14,124 C14,98 36,90 60,90 C84,90 106,98 106,124Z`;
  const nodes: SvgNode[] = [
    // neck
    path(roundedRect(53, 66, 14, 28, 5), { fill: skin, stroke: OUT, strokeWidth: LINE }),
    path(`M55,76 Q60,82 65,76`, { fill: shade(skin, -0.18), stroke: 'none' }),
    path(shoulders, base),
  ];
  switch (params.clothing) {
    case 'crew':
      nodes.push(path('M48,92 Q60,102 72,92', stroke(OUT, LINE)));
      break;
    case 'vneck':
      nodes.push(
        path('M50,91 L60,106 L70,91', {
          fill: skin,
          stroke: OUT,
          strokeWidth: LINE,
          strokeLinejoin: 'round',
        }),
      );
      break;
    case 'collar':
      nodes.push(
        path('M50,90 L60,102 L70,90 L74,96 L64,110 L60,104 L56,110 L46,96Z', {
          fill: accent,
          stroke: OUT,
          strokeWidth: LINE,
          strokeLinejoin: 'round',
        }),
        path('M60,104 V124', stroke(OUT, 1.2)),
      );
      break;
    case 'apron':
      nodes.push(
        path('M40,124 V104 Q40,98 46,98 H74 Q80,98 80,104 V124Z', {
          fill: accent,
          stroke: OUT,
          strokeWidth: LINE,
          strokeLinejoin: 'round',
        }),
        path('M46,98 C46,92 50,90 54,90 M74,98 C74,92 70,90 66,90', stroke(OUT, 1.6)),
        path('M48,92 Q60,102 72,92', stroke(OUT, LINE)),
      );
      break;
    case 'coat':
      nodes.push(
        path('M46,91 L60,112 L74,91 L82,96 L82,124 H38 V96Z', {
          fill: accent === cloth ? shade(cloth, -0.15) : cloth,
          stroke: OUT,
          strokeWidth: LINE,
          strokeLinejoin: 'round',
        }),
        path('M46,91 L60,112 L74,91', {
          fill: accent,
          stroke: OUT,
          strokeWidth: LINE,
          strokeLinejoin: 'round',
        }),
        path('M60,112 V124', stroke(OUT, 1.2)),
      );
      break;
    case 'hoodie':
      nodes.push(
        path('M38,100 C40,90 50,86 60,86 C70,86 80,90 82,100 Q70,96 60,104 Q50,96 38,100Z', {
          fill: shade(cloth, -0.18),
          stroke: OUT,
          strokeWidth: LINE,
          strokeLinejoin: 'round',
        }),
        path('M54,104 V116 M66,104 V116', stroke(accent, 2.2)),
      );
      break;
    case 'blazer':
      nodes.push(
        path('M44,94 L60,124 L76,94 L76,124 H44Z', { fill: accent, stroke: 'none' }),
        path('M44,94 L52,96 L60,118 L68,96 L76,94 L82,100 L82,124 H38 V100Z', {
          fill: cloth,
          stroke: OUT,
          strokeWidth: LINE,
          strokeLinejoin: 'round',
        }),
      );
      break;
    case 'hiVis':
      nodes.push(
        path('M36,124 V100 Q40,92 50,92 L60,100 L70,92 Q80,92 84,100 V124Z', {
          fill: accent,
          stroke: OUT,
          strokeWidth: LINE,
          strokeLinejoin: 'round',
        }),
        path('M36,112 H84 M36,118 H84', stroke('#E8EAEC', 2.2)),
        path('M48,92 Q60,102 72,92', stroke(OUT, LINE)),
      );
      break;
    case 'scarf':
      nodes.push(
        path('M40,97 Q60,110 80,97 L83,106 Q60,120 37,106Z', {
          fill: accent,
          stroke: OUT,
          strokeWidth: LINE,
          strokeLinejoin: 'round',
        }),
        path('M70,108 L80,124 H90 L78,104Z', {
          fill: shade(accent, -0.12),
          stroke: OUT,
          strokeWidth: LINE,
          strokeLinejoin: 'round',
        }),
        path('M46,104 Q50,110 56,112', stroke(shade(accent, -0.25), 1.2)),
      );
      break;
    case 'cardigan':
      nodes.push(
        path('M48,91 L60,108 L72,91 L72,124 H48Z', { fill: accent, stroke: 'none' }),
        path('M46,92 L55,96 L55,124 M74,92 L65,96 L65,124', stroke(OUT, LINE)),
        circle(60, 114, 1.4, { fill: OUT }),
        circle(60, 120, 1.4, { fill: OUT }),
      );
      break;
    default:
      break;
  }
  if (params.extras.includes('lanyard')) {
    nodes.push(
      path('M52,94 L58,118 M68,94 L62,118', stroke(CLOTH_COLORS.coral, 1.8)),
      path(roundedRect(56, 116, 8, 6, 1.5), { fill: '#FFFFFF', stroke: OUT, strokeWidth: 1.2 }),
    );
  }
  if (params.extras.includes('pen')) {
    nodes.push(
      path(roundedRect(72, 100, 3, 12, 1.5), {
        fill: CLOTH_COLORS.navy,
        stroke: OUT,
        strokeWidth: 1,
        transform: 'rotate(8 73 106)',
      }),
    );
  }
  return nodes;
}

function faceFeatures(
  params: PortraitParams,
  pose: ExpressionPose,
  skin: string,
  h: HeadGeom,
): SvgNode[] {
  const nodes: SvgNode[] = [];
  const ex = 9;
  const ey = HY + 1;
  const browY = ey - 7;
  const iris = params.eyeColor;
  const eyeAt = (cx: number): SvgNode[] => {
    const gx = cx + pose.gaze[0];
    const gy = ey + pose.gaze[1];
    switch (pose.eyes) {
      case 'happy':
        return [
          path(`M${cx - 3.6},${ey + 1} Q${cx},${ey - 4} ${cx + 3.6},${ey + 1}`, stroke(OUT, 1.8)),
        ];
      case 'wide':
        return [
          ellipse(cx, ey, 4.2, 4, { fill: '#FFFFFF', stroke: OUT, strokeWidth: 1.4 }),
          circle(gx, gy, 2.1, { fill: iris }),
          circle(gx, gy, 1, { fill: OUT }),
          circle(gx - 0.8, gy - 0.9, 0.7, { fill: '#FFFFFF' }),
        ];
      case 'half':
        return [
          ellipse(cx, ey, 3.8, 2.8, { fill: '#FFFFFF', stroke: OUT, strokeWidth: 1.4 }),
          circle(gx, gy + 0.4, 1.9, { fill: iris }),
          circle(gx, gy + 0.4, 0.9, { fill: OUT }),
          path(`M${cx - 4},${ey - 2.8} H${cx + 4} V${ey - 0.6} H${cx - 4}Z`, { fill: skin }),
          line(cx - 3.8, ey - 0.6, cx + 3.8, ey - 0.6, stroke(OUT, 1.4)),
        ];
      default:
        return [
          ellipse(cx, ey, 3.8, 2.9, { fill: '#FFFFFF', stroke: OUT, strokeWidth: 1.4 }),
          circle(gx, gy, 1.9, { fill: iris }),
          circle(gx, gy, 0.9, { fill: OUT }),
          circle(gx - 0.7, gy - 0.8, 0.6, { fill: '#FFFFFF' }),
        ];
    }
  };
  nodes.push(...eyeAt(HX - ex), ...eyeAt(HX + ex));
  // brows
  const b = stroke(shade(HAIR_COLORS[params.hairColor], -0.1), 1.8);
  const browL = (lift: number, inner: number): SvgNode =>
    path(
      `M${HX - ex - 4},${browY - lift} Q${HX - ex},${browY - lift - 2 - inner} ${HX - ex + 4},${browY - lift - inner}`,
      b,
    );
  const browR = (lift: number, inner: number): SvgNode =>
    path(
      `M${HX + ex - 4},${browY - lift - inner} Q${HX + ex},${browY - lift - 2 - inner} ${HX + ex + 4},${browY - lift}`,
      b,
    );
  switch (pose.brows) {
    case 'raised':
      nodes.push(browL(2.5, 0.5), browR(2.5, 0.5));
      break;
    case 'raisedOne':
      nodes.push(browL(0, 0), browR(3.5, 1));
      break;
    case 'furrowed':
      nodes.push(browL(-1, -1.5), browR(-1, -1.5));
      break;
    case 'soft':
      nodes.push(browL(1, 0.3), browR(1, 0.3));
      break;
    default:
      nodes.push(browL(0, 0), browR(0, 0));
  }
  // nose
  nodes.push(path(`M${HX - 1},${HY + 4} q-2,5 1.5,6`, stroke(shade(skin, -0.35), 1.4)));
  // mouth
  const my = HY + 16;
  const m = stroke(OUT, 1.7);
  switch (pose.mouth) {
    case 'closedSmile':
      nodes.push(path(`M${HX - 4},${my} Q${HX},${my + 3} ${HX + 4},${my}`, m));
      break;
    case 'smile':
      nodes.push(path(`M${HX - 5.5},${my - 1} Q${HX},${my + 5} ${HX + 5.5},${my - 1}`, m));
      break;
    case 'grin':
      nodes.push(
        path(
          `M${HX - 6.5},${my - 1.5} Q${HX},${my + 8} ${HX + 6.5},${my - 1.5} Q${HX},${my + 0.5} ${HX - 6.5},${my - 1.5}Z`,
          { fill: '#3A2126', stroke: OUT, strokeWidth: 1.2 },
        ),
        path(`M${HX - 4.5},${my - 0.5} Q${HX},${my + 1.8} ${HX + 4.5},${my - 0.5}Z`, {
          fill: '#FFFFFF',
        }),
      );
      break;
    case 'open':
      nodes.push(
        path(roundedRect(HX - 3.6, my - 1.5, 7.2, 6, [3, 3, 3.6, 3.6]), {
          fill: '#3A2126',
          stroke: OUT,
          strokeWidth: 1.2,
        }),
        ellipse(HX, my + 3.4, 2.2, 1.2, { fill: '#D9646E' }),
      );
      break;
    case 'wideOpen':
      nodes.push(ellipse(HX, my + 1.5, 4.5, 5, { fill: '#3A2126', stroke: OUT, strokeWidth: 1.2 }));
      break;
    case 'o':
      nodes.push(ellipse(HX, my + 1, 2.4, 3, { fill: '#3A2126', stroke: OUT, strokeWidth: 1.2 }));
      break;
    case 'wavy':
      nodes.push(path(`M${HX - 5},${my + 0.5} q2.5,-2.5 5,0 t5,0`, m));
      break;
    case 'flat':
      nodes.push(line(HX - 4, my + 0.5, HX + 4, my + 0.5, m));
      break;
    case 'ee':
      nodes.push(
        path(roundedRect(HX - 6, my - 1, 12, 4.2, 2), {
          fill: '#3A2126',
          stroke: OUT,
          strokeWidth: 1.2,
        }),
        path(roundedRect(HX - 4.5, my - 0.4, 9, 1.6, 0.6), { fill: '#FFFFFF' }),
      );
      break;
    default:
      break;
  }
  // facial hair
  const hairCol = HAIR_COLORS[params.hairColor];
  switch (params.facialHair) {
    case 'stubble':
      nodes.push(
        path(
          `M${HX - 14},${HY + 8} Q${HX},${h.bottom + 2} ${HX + 14},${HY + 8} Q${HX},${HY + 20} ${HX - 14},${HY + 8}Z`,
          { fill: hairCol, fillOpacity: 0.18 },
        ),
      );
      break;
    case 'beard':
      nodes.push(
        path(
          `M${HX - h.rx + 1},${HY + 2} C${HX - h.rx},${HY + 20} ${HX - 10},${h.bottom + 4} ${HX},${h.bottom + 4} C${HX + 10},${h.bottom + 4} ${HX + h.rx},${HY + 20} ${HX + h.rx - 1},${HY + 2} C${HX + h.rx - 4},${HY + 12} ${HX + 8},${HY + 10} ${HX},${HY + 20} C${HX - 8},${HY + 10} ${HX - h.rx + 4},${HY + 12} ${HX - h.rx + 1},${HY + 2}Z`,
          { fill: hairCol, stroke: OUT, strokeWidth: 1.2, strokeLinejoin: 'round' },
        ),
      );
      break;
    case 'moustache':
      nodes.push(
        path(
          `M${HX - 7},${my - 2.5} Q${HX - 3},${my - 6} ${HX},${my - 3} Q${HX + 3},${my - 6} ${HX + 7},${my - 2.5} Q${HX},${my - 1} ${HX - 7},${my - 2.5}Z`,
          { fill: hairCol, stroke: OUT, strokeWidth: 1 },
        ),
      );
      break;
    case 'goatee':
      nodes.push(
        path(
          `M${HX - 5},${my + 4} Q${HX},${h.bottom + 3} ${HX + 5},${my + 4} Q${HX},${my + 6} ${HX - 5},${my + 4}Z`,
          { fill: hairCol, stroke: OUT, strokeWidth: 1 },
        ),
        path(`M${HX - 6},${my - 2.5} Q${HX},${my - 5} ${HX + 6},${my - 2.5}`, stroke(hairCol, 1.8)),
      );
      break;
    default:
      break;
  }
  if (pose.blush)
    nodes.push(
      ellipse(HX - 13, HY + 8, 3.6, 2, { fill: '#F08A80', fillOpacity: 0.45 }),
      ellipse(HX + 13, HY + 8, 3.6, 2, { fill: '#F08A80', fillOpacity: 0.45 }),
    );
  if (params.age === 'senior') {
    nodes.push(
      path(
        `M${HX - 15},${HY + 5} q1,3 3,4 M${HX + 15},${HY + 5} q-1,3 -3,4`,
        stroke(shade(skin, -0.3), 1),
      ),
    );
  }
  // glasses
  if (params.glasses === 'round') {
    nodes.push(
      circle(HX - ex, ey, 6, stroke(OUT, 1.6)),
      circle(HX + ex, ey, 6, stroke(OUT, 1.6)),
      line(HX - 3, ey - 0.5, HX + 3, ey - 0.5, stroke(OUT, 1.4)),
    );
  } else if (params.glasses === 'rect') {
    nodes.push(
      path(roundedRect(HX - ex - 6, ey - 4.5, 12, 9, 2.5), stroke(OUT, 1.6)),
      path(roundedRect(HX + ex - 6, ey - 4.5, 12, 9, 2.5), stroke(OUT, 1.6)),
      line(HX - 3, ey - 1, HX + 3, ey - 1, stroke(OUT, 1.4)),
    );
  }
  return nodes;
}

function ears(params: PortraitParams, skin: string, h: HeadGeom): SvgNode[] {
  if (params.hair === 'headscarf') return [];
  const nodes: SvgNode[] = [
    ellipse(HX - h.rx - 1, HY + 2, 3.4, 4.6, { fill: skin, stroke: OUT, strokeWidth: LINE }),
    ellipse(HX + h.rx + 1, HY + 2, 3.4, 4.6, { fill: skin, stroke: OUT, strokeWidth: LINE }),
  ];
  if (params.earrings === 'studs') {
    nodes.push(
      circle(HX - h.rx - 1, HY + 5.5, 1.2, {
        fill: CLOTH_COLORS.mustard,
        stroke: OUT,
        strokeWidth: 0.8,
      }),
      circle(HX + h.rx + 1, HY + 5.5, 1.2, {
        fill: CLOTH_COLORS.mustard,
        stroke: OUT,
        strokeWidth: 0.8,
      }),
    );
  } else if (params.earrings === 'hoops') {
    nodes.push(
      circle(HX - h.rx - 1, HY + 9, 2.6, stroke(CLOTH_COLORS.mustard, 1.4)),
      circle(HX + h.rx + 1, HY + 9, 2.6, stroke(CLOTH_COLORS.mustard, 1.4)),
    );
  }
  if (params.extras.includes('earbud')) {
    nodes.push(
      circle(HX + h.rx + 1, HY + 2, 1.8, { fill: '#FFFFFF', stroke: OUT, strokeWidth: 0.9 }),
    );
  }
  return nodes;
}

function hand(kind: PHand, skin: string): SvgNode[] {
  if (kind === 'none') return [];
  const base = { fill: skin, stroke: OUT, strokeWidth: LINE, strokeLinejoin: 'round' as const };
  if (kind === 'wave') {
    const px = 97;
    const py = 68;
    return [
      path(`M${px - 4},${py + 24} Q${px - 6},${py + 10} ${px - 2},${py + 2}`, stroke(OUT, 8)),
      path(`M${px - 4},${py + 24} Q${px - 6},${py + 10} ${px - 2},${py + 2}`, stroke(skin, 5.6)),
      path(roundedRect(px - 7, py - 8, 13, 14, 5), base),
      path(roundedRect(px - 7, py - 16, 3, 10, 1.5), base),
      path(roundedRect(px - 3.5, py - 18, 3, 12, 1.5), base),
      path(roundedRect(px, py - 17, 3, 11, 1.5), base),
      path(roundedRect(px + 3.5, py - 14, 3, 8, 1.5), base),
      path(roundedRect(px - 11, py - 4, 5, 3, 1.5), {
        ...base,
        transform: `rotate(-30 ${px - 9} ${py - 3})`,
      }),
    ];
  }
  // chin
  const px = 72;
  const py = 80;
  return [
    path(`M${px + 14},${py + 30} Q${px + 16},${py + 12} ${px + 4},${py}`, stroke(OUT, 8)),
    path(`M${px + 14},${py + 30} Q${px + 16},${py + 12} ${px + 4},${py}`, stroke(skin, 5.6)),
    path(roundedRect(px - 4, py - 9, 11, 12, 4.5), base),
    path(`M${px - 2},${py - 8} q0,-3 3,-3 q3,0 3,3`, stroke(OUT, 1.2)),
  ];
}

/** Build the portrait node tree for a character × expression. */
export function buildCharacterPortraitNodes(
  characterId: string,
  expression: CharacterExpression,
  opts: { theme?: ArtTheme } = {},
): SvgNode[] {
  const c = findCharacter(characterId);
  if (!c) throw new Error(`Unknown character: ${characterId}`);
  const params = c.look;
  const pose = CHARACTER_EXPRESSION_POSES[expression];
  const skin = SKIN_TONES[params.skin];
  const hairCol = HAIR_COLORS[params.hairColor];
  const h = headGeom(params.head);
  const theme = opts.theme ?? 'light';
  const backdrop = theme === 'dark' ? shade(params.backdrop, -0.55) : params.backdrop;
  const clipId = `clip-${c.id}`;

  const headGroup = g(
    {
      transform: `translate(${HX},${HY + 20}) rotate(${fmt(pose.tilt)}) translate(${-HX},${-(HY + 20)})`,
    },
    [
      ...hairBack(params.hair, hairCol, h),
      ...ears(params, skin, h),
      path(h.d, { fill: skin, stroke: OUT, strokeWidth: LINE }),
      ...faceFeatures(params, pose, skin, h),
      ...hairFront(params.hair, hairCol, h, params.extras),
    ],
  );

  return [
    el('defs', {}, [el('clipPath', { id: clipId }, [circle(60, 60, 56)])]),
    circle(60, 60, 56, { fill: backdrop }),
    g({ clipPath: `url(#${clipId})` }, [
      ...torso(params, skin),
      headGroup,
      ...hand(pose.hand, skin),
    ]),
    circle(60, 60, 56, {
      fill: 'none',
      stroke: theme === 'dark' ? '#0F1A20' : OUT,
      strokeWidth: 1.4,
      strokeOpacity: 0.35,
    }),
  ];
}

/** Accessible label for a portrait (expression appended for assistive tech). */
export function characterPortraitLabel(
  characterId: string,
  expression: CharacterExpression,
): string {
  const c = findCharacter(characterId);
  const name = c ? c.name : characterId;
  const map: Record<CharacterExpression, string> = {
    neutral: 'neutral',
    greeting: 'waving hello',
    listening: 'listening',
    talking: 'talking',
    surprise: 'surprised',
    confusion: 'puzzled',
    friendly_success: 'smiling, pleased',
    follow_up_question: 'asking a follow-up question',
    lip_sync: 'mid-word',
  };
  return `${name}, ${map[expression]}`;
}

/** Full document description for a portrait. */
export function buildCharacterPortraitDocument(
  characterId: string,
  expression: CharacterExpression,
  opts: { size?: number; theme?: ArtTheme } = {},
): SvgDocument {
  const size = opts.size ?? 120;
  return {
    viewBox: PORTRAIT_VIEWBOX,
    width: size,
    height: size,
    label: characterPortraitLabel(characterId, expression),
    children: buildCharacterPortraitNodes(characterId, expression, { theme: opts.theme }),
  };
}

/** Standalone `<svg>` markup for a character portrait. */
export function characterPortraitSvgString(
  characterId: string,
  expression: CharacterExpression,
  opts: { size?: number; theme?: ArtTheme } = {},
): string {
  return toSvgString(buildCharacterPortraitDocument(characterId, expression, opts));
}
