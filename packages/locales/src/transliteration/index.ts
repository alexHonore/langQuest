/**
 * Transliteration utilities: pure functions, no I/O. Every module documents its limits at
 * the top of the file. None of these replaces reviewed, content-provided transliterations;
 * they exist for editor hints, search normalisation and best-effort fallbacks that are
 * labelled as such in the UI.
 */
export * from './arabizi';
export * from './cyrillic';
export * from './greek';
export * from './hebrew';
export * from './devanagari';
export * from './korean';
export * from './japanese';
export * from './pinyin';
export * from './jyutping';

import type { CourseTrackId, TransliterationSchemeId } from '@langquest/contracts';
import { getCourseTrack } from '@langquest/contracts';
import { romanizeArabicDarija } from './arabizi';
import { romanizeCyrillic } from './cyrillic';
import { devanagariToIast } from './devanagari';
import { romanizeGreek } from './greek';
import { romanizeHebrew } from './hebrew';
import { kanaToRomaji } from './japanese';
import { hangulToRevisedRomanization } from './korean';

export interface TransliterationResult {
  text: string;
  scheme: TransliterationSchemeId;
  /** Always `best-effort`: generated transliterations must be labelled as such in the UI. */
  quality: 'best-effort';
  /** Human-readable caveat for the UI / reviewer (e.g. vowels omitted, kanji unread). */
  caveat: string | null;
}

/**
 * Best-effort transliteration of native-script text for a track, or `null` when the
 * track's scheme cannot be generated algorithmically (Pinyin, Jyutping, furigana, niqqud
 * need readings from content). Never used as a substitute for reviewed content.
 */
export function transliterateForTrack(trackId: CourseTrackId, nativeText: string): TransliterationResult | null {
  const track = getCourseTrack(trackId);
  const scheme = track.scripts.transliterations[0];
  if (!scheme) return null;
  switch (trackId) {
    case 'arabic-moroccan':
      return { text: romanizeArabicDarija(nativeText), scheme: 'arabizi', quality: 'best-effort', caveat: 'Short vowels are not written in Arabic script; reviewed Arabizi should come from content.' };
    case 'arabic-eastern':
    case 'arabic-egyptian':
    case 'arabic-msa':
      return { text: romanizeArabicDarija(nativeText), scheme: 'translit-latn', quality: 'best-effort', caveat: 'Consonant skeleton with Moroccan-style digits; variety-specific tables pending native review.' };
    case 'russian':
      return { text: romanizeCyrillic(nativeText, 'ru'), scheme: 'translit-latn', quality: 'best-effort', caveat: 'Stress is not marked.' };
    case 'ukrainian':
      return { text: romanizeCyrillic(nativeText, 'uk'), scheme: 'translit-latn', quality: 'best-effort', caveat: null };
    case 'greek':
      return { text: romanizeGreek(nativeText), scheme: 'translit-latn', quality: 'best-effort', caveat: null };
    case 'hebrew':
      return { text: romanizeHebrew(nativeText), scheme: 'translit-latn', quality: 'best-effort', caveat: 'Unpointed Hebrew omits vowels; output is approximate without niqqud.' };
    case 'hindi':
      return { text: devanagariToIast(nativeText, { hindiSchwaDeletion: true }), scheme: 'translit-latn', quality: 'best-effort', caveat: 'Medial schwa deletion is not modelled.' };
    case 'korean':
      return { text: hangulToRevisedRomanization(nativeText), scheme: 'revised-romanization', quality: 'best-effort', caveat: 'Palatalisation and tensification are not modelled.' };
    case 'japanese':
      return { text: kanaToRomaji(nativeText), scheme: 'romaji', quality: 'best-effort', caveat: 'Kanji are left unread; supply kana from furigana data first.' };
    default:
      return null;
  }
}
