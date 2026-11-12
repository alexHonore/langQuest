/**
 * Chapter 4 ("getting things done": a flat to rent, a parcel, a return, the doctor, a sports club, lost luggage) of every course, written in the compact authored format (`../../authored.ts`) and
 * expanded here. AI-assisted drafts: `review_needed`, never native-reviewed, and labelled as drafts in the app. Each
 * file passes `checkAuthoredChapter` (`pnpm exec tsx packages/curriculum/src/content/authored-check.ts`).
 */
import { authoredChapterFor, expandAuthoredChapter, type AuthoredChapterInput } from '../../authored';
import type { SeedChapter } from '../../types';

/** Chapter 4 as written (Chinese Simplified shares Mandarin's). */
export const AUTHORED_CHAPTER_4_INPUTS: readonly AuthoredChapterInput[] = [
];

/** Chapter 4 of every course written so far, expanded to seed chapters. */
export const AUTHORED_CHAPTER_4: readonly SeedChapter[] = [
  ...AUTHORED_CHAPTER_4_INPUTS,
  ...AUTHORED_CHAPTER_4_INPUTS.filter((c) => c.track === 'chinese-mandarin').map((c) => authoredChapterFor('chinese-simplified', c)),
].map((c) => expandAuthoredChapter(c, 4));
