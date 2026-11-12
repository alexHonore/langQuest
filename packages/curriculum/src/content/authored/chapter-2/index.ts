/**
 * Chapter 2 ("settling in") of every course: six missions each (a meal, clothes, a train ticket, asking for help,
 * family, weekend plans), written in the compact authored format (`../../authored.ts`) and expanded here. AI-assisted
 * drafts like chapter 1: `review_needed`, never native-reviewed, and labelled as drafts in the app. Each file passes
 * `checkAuthoredChapter` (`pnpm exec tsx packages/curriculum/src/content/authored-check.ts`).
 */
import { authoredChapterFor, expandAuthoredChapter, type AuthoredChapterInput } from '../../authored';
import type { SeedChapter } from '../../types';
import arabicEastern from './arabic-eastern.json';
import arabicEgyptian from './arabic-egyptian.json';
import arabicMoroccan from './arabic-moroccan.json';
import arabicMsa from './arabic-msa.json';
import chineseCantonese from './chinese-cantonese.json';
import chineseMandarin from './chinese-mandarin.json';
import danish from './danish.json';
import english from './english.json';
import french from './french.json';
import german from './german.json';
import greek from './greek.json';
import haitianCreole from './haitian-creole.json';
import hebrew from './hebrew.json';
import hindi from './hindi.json';
import italian from './italian.json';
import japanese from './japanese.json';
import kinyarwanda from './kinyarwanda.json';
import korean from './korean.json';
import lingala from './lingala.json';
import portugueseBrazilian from './portuguese-brazilian.json';
import portugueseEuropean from './portuguese-european.json';
import romanian from './romanian.json';
import russian from './russian.json';
import spanishLatinAmerican from './spanish-latin-american.json';
import spanishSpain from './spanish-spain.json';
import swahili from './swahili.json';
import ukrainian from './ukrainian.json';
import vietnamese from './vietnamese.json';

/** The authored chapters as written, in course order of their files (Chinese Simplified shares Mandarin's). */
export const AUTHORED_CHAPTER_2_INPUTS: readonly AuthoredChapterInput[] = [
  arabicEastern,
  arabicEgyptian,
  arabicMoroccan,
  arabicMsa,
  chineseCantonese,
  chineseMandarin,
  danish,
  english,
  french,
  german,
  greek,
  haitianCreole,
  hebrew,
  hindi,
  italian,
  japanese,
  kinyarwanda,
  korean,
  lingala,
  portugueseBrazilian,
  portugueseEuropean,
  romanian,
  russian,
  spanishLatinAmerican,
  spanishSpain,
  swahili,
  ukrainian,
  vietnamese,
] as unknown as AuthoredChapterInput[];

/** Chapter 2 of every course, expanded to seed chapters. */
export const AUTHORED_CHAPTERS: readonly SeedChapter[] = [
  ...AUTHORED_CHAPTER_2_INPUTS,
  ...AUTHORED_CHAPTER_2_INPUTS.filter((c) => c.track === 'chinese-mandarin').map((c) => authoredChapterFor('chinese-simplified', c)),
].map((c) => expandAuthoredChapter(c));
