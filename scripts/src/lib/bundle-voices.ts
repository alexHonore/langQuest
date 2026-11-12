/**
 * Which synthetic voice reads each line of the Flutter app's bundled course audio (`synthesize-bundle-audio`).
 *
 * A dialogue has two speakers: the mission's character, cast with their own voice (`SeedCharacter.voice`), and the
 * learner's role, read by one voice per course that differs from every character voice (so the two sides of a
 * conversation never sound alike). The learner's voice is male where the course's learner lines are written in the
 * masculine ("Encantado.", "أنا الجار الجديد"). All are Gemini TTS voices instructed with the variety (for Darija,
 * never to drift into Modern Standard Arabic): in a blind listening check (2026-11-11) they were rated 9–10/10 for
 * naturalness in all four languages, where MAI-Voice's English voices were rated 5–6 ("robotic intonation").
 */

export interface BundleVoice {
  /** Stable id recorded in `voices.json` (and part of each clip's file name). */
  id: string;
  model: string;
  /** Provider voice name as OpenRouter expects it. */
  voice: string;
  /** Delivery instructions for models that honour them (Gemini). */
  instructions: string | null;
  /** Gemini TTS answers raw 16-bit PCM (24 kHz mono); MAI answers MP3. */
  format: 'pcm' | 'mp3';
  label: string;
}

const GEMINI = 'google/gemini-3.8-flash-tts';

const gemini = (id: string, voice: string, instructions: string, label: string): BundleVoice => ({ id, model: GEMINI, voice, instructions, format: 'pcm', label });

/** How each course's lines are spoken: the variety (and where the course's characters live), never a neighbouring one. */
export const VOICE_INSTRUCTIONS: Readonly<Record<string, string>> = {
  'arabic-eastern': 'Levantine Arabic as spoken in Damascus, never Modern Standard Arabic',
  'arabic-moroccan': 'Moroccan Darija as spoken in Casablanca, never Modern Standard Arabic',
  'arabic-egyptian': 'Egyptian Arabic as spoken in Cairo, never Modern Standard Arabic',
  'arabic-msa': 'Modern Standard Arabic with a clear, natural standard pronunciation',
  'chinese-cantonese': 'Hong Kong Cantonese, never Mandarin',
  'chinese-mandarin': 'standard Mandarin Chinese (Putonghua) as spoken in Beijing',
  'chinese-simplified': 'standard Mandarin Chinese (Putonghua) as spoken in Beijing',
  english: 'natural American English',
  danish: 'natural standard Danish as spoken in Copenhagen',
  french: 'natural French from France',
  german: 'natural standard German from Germany',
  greek: 'natural standard Modern Greek as spoken in Athens',
  'haitian-creole': 'Haitian Creole (Kreyòl ayisyen) as spoken in Port-au-Prince, never French',
  hebrew: 'natural modern Israeli Hebrew',
  hindi: 'natural standard Hindi as spoken in Delhi',
  italian: 'natural standard Italian',
  japanese: 'natural Tokyo Japanese',
  korean: 'natural standard Seoul Korean',
  'portuguese-brazilian': 'natural Brazilian Portuguese, never European Portuguese',
  'portuguese-european': 'natural European Portuguese from Lisbon, never Brazilian Portuguese',
  romanian: 'natural standard Romanian',
  russian: 'natural standard Russian as spoken in Moscow',
  'spanish-latin-american': 'natural Latin American Spanish as spoken in Mexico City, never Castilian Spanish',
  'spanish-spain': 'natural Castilian Spanish from Madrid, Spain',
  swahili: 'natural Swahili as spoken in Nairobi',
  kinyarwanda: 'natural Kinyarwanda as spoken in Kigali',
  swedish: 'natural standard Swedish as spoken in Stockholm',
  lingala: 'natural Lingala as spoken in Kinshasa',
  ukrainian: 'natural standard Ukrainian as spoken in Kyiv, never Russian',
  vietnamese: 'natural Vietnamese as spoken in Hanoi',
};

const say = (variety: string): string => `Speak in ${variety}, as in an everyday conversation: relaxed, warm, native pace and intonation.`;

/** Instructions of the first four courses, verbatim: they are part of each clip's name, so the shipped clips keep matching. */
const LEGACY_INSTRUCTIONS: Readonly<Record<string, string>> = {
  japanese: 'Speak in natural Tokyo Japanese, as in an everyday conversation: polite, warm, native pace and intonation.',
  'arabic-moroccan': 'Speak in Moroccan Darija as spoken in Casablanca, never Modern Standard Arabic, as in an everyday conversation: warm, native pace and intonation.',
};

/** The course's voice ids (`<track>-<voice>`, lowercase) are stable: they name the bundled clips. */
const ID_PREFIX: Readonly<Record<string, string>> = { 'spanish-spain': 'es-es', japanese: 'ja', 'arabic-moroccan': 'ary', english: 'en-us' };
const LEGACY_VOICES: Readonly<Record<string, { female: string; male: string }>> = { japanese: { female: 'Kore', male: 'Charon' }, 'arabic-moroccan': { female: 'Kore', male: 'Charon' } };

/**
 * Courses whose lines are another course's, word for word (Chinese Simplified is Mandarin's chapters): they are read
 * by that course's voices, so each line is recorded once and its clip shared.
 */
export const SHARED_VOICES: Readonly<Record<string, string>> = { 'chinese-simplified': 'chinese-mandarin' };

/** Per course: the character voices by casting, and the learner's voice. */
export const BUNDLE_VOICES: Readonly<Record<string, { female: BundleVoice; male: BundleVoice; learner: BundleVoice }>> = Object.fromEntries(
  Object.entries(VOICE_INSTRUCTIONS).map(([own, ownVariety]) => {
    const track = SHARED_VOICES[own] ?? own;
    const variety = VOICE_INSTRUCTIONS[track] ?? ownVariety;
    const prefix = ID_PREFIX[track] ?? track;
    const names = LEGACY_VOICES[track] ?? { female: 'Aoede', male: 'Orus' };
    const voice = (name: string): BundleVoice => gemini(`${prefix}-${name.toLowerCase()}`, name, LEGACY_INSTRUCTIONS[track] ?? say(variety), `${name} (Gemini TTS, instructed ${variety.replace(/^natural /, '').replace(/,.*$/, '')})`);
    return [own, { female: voice(names.female), male: voice(names.male), learner: voice('Puck') }];
  }),
);

/** The voice of one line: the learner's role, or the character cast female or male (female when not cast). */
export function voiceForLine(trackId: string, speaker: 'learner' | 'character', characterVoice: 'female' | 'male' | null): BundleVoice | null {
  const course = BUNDLE_VOICES[trackId];
  if (!course) return null;
  if (speaker === 'learner') return course.learner;
  return characterVoice === 'male' ? course.male : course.female;
}
