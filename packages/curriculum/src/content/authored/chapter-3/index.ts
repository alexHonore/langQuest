/**
 * Chapter 3 ("finding your voice": your day, work, hobbies, asking a local for advice, a friendly debate, a story) of every course, written in the compact authored format (`../../authored.ts`) and
 * expanded here. AI-assisted drafts: `review_needed`, never native-reviewed, and labelled as drafts in the app. Each
 * file passes `checkAuthoredChapter` (`pnpm exec tsx packages/curriculum/src/content/authored-check.ts`).
 */
import { authoredChapterFor, expandAuthoredChapter, type AuthoredChapterInput } from '../../authored';
import type { SeedChapter } from '../../types';

/** Chapter 3 as written (Chinese Simplified shares Mandarin's). */
export const AUTHORED_CHAPTER_3_INPUTS: readonly AuthoredChapterInput[] = [
];

/** Chapter 3 of every course written so far, expanded to seed chapters. */
export const AUTHORED_CHAPTER_3: readonly SeedChapter[] = [
  ...AUTHORED_CHAPTER_3_INPUTS,
  ...AUTHORED_CHAPTER_3_INPUTS.filter((c) => c.track === 'chinese-mandarin').map((c) => authoredChapterFor('chinese-simplified', c)),
].map((c) => expandAuthoredChapter(c, 3));
