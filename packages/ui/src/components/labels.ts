/**
 * Default (English) label sets for the components. Apps MUST pass localized
 * labels from `@langquest/locales` (`t(key)`) — these defaults exist so the
 * components render meaningful accessibility text out of the box and so the
 * admin studio works before every catalog is complete.
 *
 * Nothing here is learner-facing instruction in the target language; mascot
 * speech and hints come from the enrollment's source language via props.
 */
import type { CoverageStatus, Intelligibility, SpeechState } from '@langquest/contracts';

/* ------------------------------------------------------------------------ */
/* Localized overrides                                                      */
/* ------------------------------------------------------------------------ */

/**
 * The shape a component's `labels` prop accepts: every key of the default
 * label set, optional, with literal strings widened to `string` (so localized
 * text from `@langquest/locales` needs no cast), formatter functions kept, and
 * nested groups (`status`, `focus`, `rights`, …) accepted as partial records.
 *
 * Example: `labels?: LocalizedLabels<typeof MISSION_LABELS>` accepts
 * `{ start: t('missions.start'), focus: { tone: t('missions.focus.tone') } }`.
 */
export type LocalizedLabels<T> = {
  [K in keyof T]?: T[K] extends string
    ? string
    : T[K] extends (...args: infer A) => string
      ? (...args: A) => string
      : T[K] extends object
        ? LocalizedLabels<T[K]>
        : T[K];
};

/** A fully resolved label set (defaults merged with overrides): same keys, widened strings. */
export type ResolvedLabels<T> = {
  readonly [K in keyof T]-?: T[K] extends string
    ? string
    : T[K] extends (...args: infer A) => string
      ? (...args: A) => string
      : T[K] extends object
        ? ResolvedLabels<T[K]>
        : T[K];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge localized overrides onto a default label set. Nested groups are merged
 * key by key, so a partial `status` override keeps the untouched defaults;
 * `undefined` values never shadow a default.
 */
export function mergeLabels<T extends object>(
  defaults: T,
  overrides?: LocalizedLabels<T> | null,
): ResolvedLabels<T> {
  if (!overrides) return defaults as unknown as ResolvedLabels<T>;
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    if (value === undefined) continue;
    const base = out[key];
    out[key] =
      isPlainObject(value) && isPlainObject(base)
        ? mergeLabels(base, value as LocalizedLabels<Record<string, unknown>>)
        : value;
  }
  return out as unknown as ResolvedLabels<T>;
}

/**
 * Mission focus vocabulary. Mirrors the `missions.focus.*` keys of the
 * `@langquest/locales` catalogs so an app can localize with
 * `t(\`missions.focus.${focus}\`)`; `labels.test.ts` enforces the match.
 */
export const MISSION_FOCUS_VALUES = ['pronunciation', 'listening', 'conversation', 'tone'] as const;
export type MissionFocus = (typeof MISSION_FOCUS_VALUES)[number];

export const SPEECH_STATE_LABELS: Readonly<Record<SpeechState, string>> = {
  idle: 'Ready',
  character_speaking: 'Character is speaking',
  waiting: 'Your turn — waiting for you',
  learner_mic_active: 'Microphone is on — listening to you',
  thinking: 'Thinking…',
  reconnecting: 'Reconnecting…',
  error: 'Connection problem',
};

export const INTELLIGIBILITY_LABELS: Readonly<Record<Intelligibility, string>> = {
  understood: 'Understood',
  partially_understood: 'Partly understood',
  not_understood: 'Not understood yet',
  no_speech_detected: 'No speech detected',
};

export const PRONUNCIATION_LABELS = {
  heading: 'Pronunciation',
  meaningMatched: 'Meaning came through',
  meaningMissed: 'Meaning did not come through yet',
  score: 'Score',
  scoreOutOf: 'out of 100',
  detailedUnavailable: 'Detailed phoneme assessment is not yet available for this variety.',
  listenCompare: 'We compared your recording with the reference; the notes below are qualitative.',
  humanCalibrated: 'Feedback calibrated by native reviewers for this variety.',
  semanticOnly: 'Only meaning was checked for this attempt.',
  confidence: 'Confidence',
  confidenceValues: { high: 'high', medium: 'medium', limited: 'limited', none: 'none' },
  wordScores: 'Word by word',
  retrySegment: 'Try this part again',
  tryAgain: 'Record again',
  replayReference: 'Replay reference',
  replaySlow: 'Replay slowly',
  featuresAssessed: 'Assessed',
  features: { word: 'words', phoneme: 'sounds', tone: 'tones', prosody: 'rhythm' },
  errorTypes: {
    none: 'fine',
    mispronunciation: 'sound differs',
    omission: 'missing',
    insertion: 'extra sound',
    unexpected_break: 'unexpected pause',
    missing_break: 'missing pause',
    monotone: 'flat tone',
  },
} as const;

export const COVERAGE_LABELS: Readonly<Record<CoverageStatus, string>> = {
  complete: 'Fully available',
  partial: 'Partly available',
  planned: 'Planned',
  unavailable: 'Not available',
};

export const COVERAGE_DESCRIPTIONS: Readonly<Record<CoverageStatus, string>> = {
  complete: 'All lessons and hints are available in this language.',
  partial:
    'Some explanations are still being translated. You can choose a fallback language for the missing parts.',
  planned: 'This instruction language is planned but not published yet.',
  unavailable: 'This course is not offered from this language.',
};

export const SPEAK_BUTTON_LABELS = {
  holdToSpeak: 'Hold to speak',
  tapToSpeak: 'Tap to speak',
  tapToStop: 'Tap to stop',
  release: 'Release to send',
  recording: 'Recording',
  processing: 'Processing your answer',
  disabled: 'Microphone unavailable',
  switchToTap: 'Use tap instead of hold',
  switchToHold: 'Use hold instead of tap',
} as const;

export const HINT_LABELS = {
  title: 'Need a hand?',
  hint: 'Hint',
  nextHint: 'Another hint',
  translate: 'Translate',
  example: 'Give me an example',
  meaning: 'What does that mean?',
  slower: 'Say it slower',
  repeat: 'Repeat',
  skip: 'Skip for now',
  close: 'Close',
  revealAlternative: 'Show the full model answer',
  hintLevel: (n: number, total: number): string => `Hint ${n} of ${total}`,
} as const;

export const AUDIO_LABELS = {
  play: 'Play',
  pause: 'Pause',
  skipBack: (s: number): string => `Back ${s} seconds`,
  skipForward: (s: number): string => `Forward ${s} seconds`,
  speed: (rate: number): string => `Speed ${rate}×`,
  chapters: 'Chapters',
  sleepTimer: 'Sleep timer',
  sleepOff: 'Off',
  sleepMinutes: (m: number): string => `${m} min`,
  download: 'Download for offline',
  downloaded: 'Available offline',
  downloading: (pct: number): string => `Downloading ${Math.round(pct)}%`,
  removeDownload: 'Remove download',
  transcript: 'Transcript',
  transcriptUnavailable: 'Transcript not available yet',
  bookmark: 'Bookmark this moment',
  practice: 'Practice this with AI',
  repeatSentence: 'Repeat sentence',
  seek: 'Seek',
  position: (cur: string, total: string): string => `${cur} of ${total}`,
  loading: 'Loading audio',
  error: 'Audio could not be loaded',
} as const;

export const SHELL_LABELS = {
  learning: (target: string, source: string): string => `Learning ${target} from ${source}`,
  editCourse: 'Change course or instruction language',
  back: 'Back',
  offline: 'Offline',
} as const;

export const MISSION_LABELS = {
  minutes: (m: number): string => `${m} min`,
  status: {
    locked: 'Locked',
    available: 'Ready',
    in_progress: 'In progress',
    completed: 'Completed',
  },
  /** Keys mirror `missions.focus.*` in `@langquest/locales` (see labels.test.ts). */
  focus: {
    pronunciation: 'Pronunciation',
    listening: 'Listening',
    conversation: 'Conversation',
    tone: 'Tone',
  } satisfies Record<MissionFocus, string>,
  start: 'Start',
  continue: 'Continue',
  replay: 'Replay',
  skillsLabel: 'Skills',
  objective: 'You will be able to',
} as const;

export const PICKER_LABELS = {
  sourceTitle: 'I want explanations in',
  targetTitle: 'I want to learn',
  confirm: (target: string, source: string): string => `Learn ${target} from ${source}`,
  change: 'Change',
  distinctFrom: (names: string): string => `Not ${names}`,
  prominent: 'Popular',
  searchPlaceholder: 'Search languages',
  perCourseNote:
    'You can change the instruction language for this course later without affecting your other courses.',
} as const;

export const STORY_MAP_LABELS = {
  listView: 'List view',
  mapView: 'Map view',
  chapter: (title: string): string => `Chapter: ${title}`,
  status: {
    locked: 'Locked until you complete the previous mission',
    available: 'Available',
    in_progress: 'In progress',
    completed: 'Completed',
  },
  branchesTo: (n: number): string => `Leads to ${n} next ${n === 1 ? 'mission' : 'missions'}`,
} as const;

export const CELEBRATION_LABELS = {
  skip: 'Skip',
  continue: 'Continue',
  xp: (n: number): string => `+${n} XP`,
  engagementNote: 'XP reflects effort, not proficiency.',
} as const;

export const ASSET_PICKER_LABELS = {
  title: 'Choose an asset',
  search: 'Search assets',
  empty: 'No assets match',
  upload: 'Upload',
  select: 'Select',
  selected: 'Selected',
  rights: {
    verified: 'Rights verified',
    unverified: 'Rights unverified',
    blocked: 'Rights blocked',
  },
  review: {
    draft: 'Draft',
    review_needed: 'Review needed',
    in_review: 'In review',
    approved: 'Approved',
    rejected: 'Rejected',
  },
} as const;

export const EMPTY_LABELS = {
  retry: 'Try again',
} as const;
