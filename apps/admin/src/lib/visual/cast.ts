/**
 * Character casting per course track, read from the `@langquest/ui` roster (C2 clay cast).
 * Editors use it to check that every course has a diverse cast (age bands, gender presentation,
 * skin-tone families) whose everyday roles cover the lesson situations (a kid asks for an ice
 * cream, an adult or an elder asks for directions, a shopkeeper bargains…). Pure: no React.
 */
import { COURSE_TRACK_IDS, type CourseTrackId } from '@langquest/contracts';
import { CHARACTER_SITUATIONS, charactersForTrack, type AgeBand, type GenderPresentation, type LangQuestCharacter, type SkinToneFamily } from '@art/characters';

export const AGE_BANDS: readonly AgeBand[] = ['child', 'teen', 'adult', 'elder'];
export const GENDER_PRESENTATIONS: readonly GenderPresentation[] = ['feminine', 'masculine'];
export const SKIN_FAMILIES: readonly SkinToneFamily[] = ['light', 'medium', 'brown', 'deep'];

export interface CastMember {
  id: string;
  name: string;
  role: string;
  city: string;
  region: string;
  ageBand: AgeBand;
  gender: GenderPresentation;
  skinFamily: SkinToneFamily;
  /** Situation tags with their documentation labels (English, roster source). */
  situations: { tag: string; label: string }[];
  intents: string[];
  altText: string;
}

export interface CastSummary {
  trackId: CourseTrackId;
  members: CastMember[];
  ageBands: Record<AgeBand, number>;
  genders: Record<GenderPresentation, number>;
  skinFamilies: Record<SkinToneFamily, number>;
  /** Age bands with nobody cast (an elder or a child missing is the usual diversity gap). */
  missingAgeBands: AgeBand[];
  missingGenders: GenderPresentation[];
  /** Distinct curriculum intents the cast's situations cover. */
  intentCount: number;
}

export const isCourseTrackId = (value: unknown): value is CourseTrackId =>
  typeof value === 'string' && (COURSE_TRACK_IDS as readonly string[]).includes(value);

function toMember(c: LangQuestCharacter): CastMember {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    city: c.city,
    region: c.region,
    ageBand: c.ageBand,
    gender: c.genderPresentation,
    skinFamily: c.skinFamily,
    situations: c.situations.map((tag) => ({ tag, label: CHARACTER_SITUATIONS[tag].label })),
    intents: [...c.intents],
    altText: c.altText,
  };
}

const count = <K extends string>(keys: readonly K[], pick: (m: CastMember) => K, members: CastMember[]): Record<K, number> => {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const m of members) out[pick(m)] += 1;
  return out;
};

/** Cast of one track with the diversity tallies; `null` for an unknown track id. */
export function castForTrack(trackId: string | null | undefined): CastSummary | null {
  if (!isCourseTrackId(trackId)) return null;
  const members = charactersForTrack(trackId).map(toMember);
  const ageBands = count(AGE_BANDS, (m) => m.ageBand, members);
  const genders = count(GENDER_PRESENTATIONS, (m) => m.gender, members);
  const skinFamilies = count(SKIN_FAMILIES, (m) => m.skinFamily, members);
  return {
    trackId,
    members,
    ageBands,
    genders,
    skinFamilies,
    missingAgeBands: AGE_BANDS.filter((b) => ageBands[b] === 0),
    missingGenders: GENDER_PRESENTATIONS.filter((g) => genders[g] === 0),
    intentCount: new Set(members.flatMap((m) => m.intents)).size,
  };
}
