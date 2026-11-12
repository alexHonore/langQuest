/** Every authored chapter (2, 3, 4), in story order. */
import type { SeedChapter } from '../types';
import { AUTHORED_CHAPTER_2 } from './chapter-2';
import { AUTHORED_CHAPTER_3 } from './chapter-3';
import { AUTHORED_CHAPTER_4 } from './chapter-4';

export * from './chapter-2';
export * from './chapter-3';
export * from './chapter-4';

export const AUTHORED_CHAPTERS: readonly SeedChapter[] = [...AUTHORED_CHAPTER_2, ...AUTHORED_CHAPTER_3, ...AUTHORED_CHAPTER_4];
