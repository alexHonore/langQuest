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

const CASTILIAN = 'Speak in natural Castilian Spanish from Madrid, Spain, as in an everyday conversation: relaxed, warm, native pace and intonation.';
const TOKYO = 'Speak in natural Tokyo Japanese, as in an everyday conversation: polite, warm, native pace and intonation.';
const AMERICAN = 'Speak in natural American English, as in an everyday conversation: relaxed, warm, native pace and intonation.';
const DARIJA = 'Speak in Moroccan Darija as spoken in Casablanca, never Modern Standard Arabic, as in an everyday conversation: warm, native pace and intonation.';

/** Per course: the character voices by casting, and the learner's voice. */
export const BUNDLE_VOICES: Readonly<Record<string, { female: BundleVoice; male: BundleVoice; learner: BundleVoice }>> = {
  'spanish-spain': {
    female: gemini('es-es-aoede', 'Aoede', CASTILIAN, 'Aoede (Gemini TTS, instructed Castilian)'),
    male: gemini('es-es-orus', 'Orus', CASTILIAN, 'Orus (Gemini TTS, instructed Castilian)'),
    learner: gemini('es-es-puck', 'Puck', CASTILIAN, 'Puck (Gemini TTS, instructed Castilian)'),
  },
  japanese: {
    female: gemini('ja-kore', 'Kore', TOKYO, 'Kore (Gemini TTS, instructed Tokyo Japanese)'),
    male: gemini('ja-charon', 'Charon', TOKYO, 'Charon (Gemini TTS, instructed Tokyo Japanese)'),
    learner: gemini('ja-puck', 'Puck', TOKYO, 'Puck (Gemini TTS, instructed Tokyo Japanese)'),
  },
  'arabic-moroccan': {
    female: gemini('ary-kore', 'Kore', DARIJA, 'Kore (Gemini TTS, instructed Darija)'),
    male: gemini('ary-charon', 'Charon', DARIJA, 'Charon (Gemini TTS, instructed Darija)'),
    learner: gemini('ary-puck', 'Puck', DARIJA, 'Puck (Gemini TTS, instructed Darija)'),
  },
  english: {
    female: gemini('en-us-aoede', 'Aoede', AMERICAN, 'Aoede (Gemini TTS, instructed American English)'),
    male: gemini('en-us-orus', 'Orus', AMERICAN, 'Orus (Gemini TTS, instructed American English)'),
    learner: gemini('en-us-puck', 'Puck', AMERICAN, 'Puck (Gemini TTS, instructed American English)'),
  },
};

/** The voice of one line: the learner's role, or the character cast female or male (female when not cast). */
export function voiceForLine(trackId: string, speaker: 'learner' | 'character', characterVoice: 'female' | 'male' | null): BundleVoice | null {
  const course = BUNDLE_VOICES[trackId];
  if (!course) return null;
  if (speaker === 'learner') return course.learner;
  return characterVoice === 'male' ? course.male : course.female;
}
