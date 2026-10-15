/**
 * Pure, platform-free helpers behind the components. Kept out of the TSX so
 * the product rules (honest pronunciation display, speak-button state machine,
 * story-map linearisation, source-language ordering) are unit-tested in Node.
 */
import {
  COURSE_TRACKS,
  type CourseTrack,
  type CourseTrackId,
  type CoverageStatus,
  type Intelligibility,
  LANGUAGES,
  type LanguageCode,
  type MascotState,
  SOURCE_LANGUAGES,
  type SourceLanguageCode,
  type SpeechEvaluationResult,
  type SpeechState,
  getLanguage,
  getVariety,
  isAcousticAssessmentMode,
  tracksForLanguage,
} from '@langquest/contracts';

/* ---------------------------------------------------------------- time --- */

/** `m:ss` under an hour, `h:mm:ss` above. Negative / NaN input renders as `0:00`. */
export function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(ms) ? ms / 1000 : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Rounded whole minutes, never below 1 for a positive duration. */
export function formatMinutes(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(1, Math.round(ms / 60000));
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/* ------------------------------------------------------- pronunciation --- */

export type PronunciationTone = 'success' | 'warning' | 'error' | 'info';

export interface PronunciationDisplay {
  /** Numeric score may be shown ONLY when an acoustic assessor produced it. */
  showNumeric: boolean;
  numericScore: number | null;
  /** True when the variety has no capable acoustic assessor → show the honest notice. */
  detailedUnavailable: boolean;
  intelligibility: Intelligibility;
  /** Colour-blind-safe: every tone is paired with a text label and an icon name. */
  tone: PronunciationTone;
  icon: 'check' | 'info' | 'warning' | 'micOff';
  feedback: readonly string[];
  /** Word scores with real accuracy numbers (acoustic only); empty otherwise. */
  scoredWords: readonly { word: string; accuracy: number; errorType: string | null }[];
  hasSegmentToRetry: boolean;
  confidence: SpeechEvaluationResult['pronunciation']['confidence'];
  assessmentMode: SpeechEvaluationResult['pronunciation']['assessmentMode'];
  featuresAssessed: readonly string[];
  meaningMatched: boolean;
}

/**
 * Decide what the pronunciation UI may claim (§3.6, §10.2B screen 6). The
 * numeric score is only surfaced when `numericScore !== null` AND the mode is
 * acoustic; everything else is qualitative, with an explicit "not yet available" line.
 */
export function pronunciationDisplay(result: SpeechEvaluationResult): PronunciationDisplay {
  const p = result.pronunciation;
  const acoustic = isAcousticAssessmentMode(p.assessmentMode);
  const showNumeric = acoustic && p.numericScore !== null;
  const toneByIntelligibility: Record<Intelligibility, PronunciationTone> = {
    understood: 'success',
    partially_understood: 'warning',
    not_understood: 'error',
    no_speech_detected: 'info',
  };
  const iconByIntelligibility: Record<Intelligibility, PronunciationDisplay['icon']> = {
    understood: 'check',
    partially_understood: 'info',
    not_understood: 'warning',
    no_speech_detected: 'micOff',
  };
  return {
    showNumeric,
    numericScore: showNumeric ? p.numericScore : null,
    detailedUnavailable: !acoustic,
    intelligibility: result.intelligibility,
    tone: toneByIntelligibility[result.intelligibility],
    icon: iconByIntelligibility[result.intelligibility],
    feedback: p.feedback,
    scoredWords: acoustic
      ? p.wordScores
          .filter((w): w is typeof w & { accuracy: number } => w.accuracy !== null)
          .map((w) => ({ word: w.word, accuracy: w.accuracy, errorType: w.errorType }))
      : [],
    hasSegmentToRetry: p.highlightedSegment !== null,
    confidence: p.confidence,
    assessmentMode: p.assessmentMode,
    featuresAssessed: p.featuresAssessed,
    meaningMatched: result.semanticIntentMatched,
  };
}

/* ------------------------------------------------------- speech states --- */

/** Mascot reaction for a transparent speech state (never shows "speaking" when nothing plays). */
export const SPEECH_STATE_TO_MASCOT: Readonly<Record<SpeechState, MascotState>> = {
  idle: 'neutral',
  character_speaking: 'quiet_audio',
  waiting: 'curious',
  learner_mic_active: 'listening',
  thinking: 'thinking',
  reconnecting: 'connection_error',
  error: 'connection_error',
};

/** Whether a state corresponds to real audio activity (mic capturing or audio playing). */
export const SPEECH_STATE_HAS_AUDIO: Readonly<Record<SpeechState, boolean>> = {
  idle: false,
  character_speaking: true,
  waiting: false,
  learner_mic_active: true,
  thinking: false,
  reconnecting: false,
  error: false,
};

/* -------------------------------------------------------- speak button --- */

export type SpeakButtonMode = 'hold' | 'toggle';
export type SpeakButtonState = 'idle' | 'recording' | 'processing' | 'disabled';
export type SpeakButtonEvent =
  'pressIn' | 'pressOut' | 'tap' | 'submitted' | 'processingDone' | 'cancel' | 'disable' | 'enable';

/**
 * Speak-button state machine. `hold` records while pressed; `toggle` starts on
 * one tap and stops on the next (motor-accessibility alternative, §10.3).
 * Returns the same state object when the event is a no-op.
 */
export function nextSpeakState(
  state: SpeakButtonState,
  event: SpeakButtonEvent,
  mode: SpeakButtonMode,
): SpeakButtonState {
  if (event === 'disable') return 'disabled';
  if (state === 'disabled') return event === 'enable' ? 'idle' : 'disabled';
  if (event === 'enable') return state;
  if (event === 'cancel') return 'idle';
  if (event === 'processingDone') return state === 'processing' ? 'idle' : state;
  if (state === 'processing') return 'processing';
  if (mode === 'hold') {
    if (state === 'idle' && event === 'pressIn') return 'recording';
    if (state === 'recording' && (event === 'pressOut' || event === 'submitted'))
      return 'processing';
    return state;
  }
  // toggle
  if (state === 'idle' && event === 'tap') return 'recording';
  if (state === 'recording' && (event === 'tap' || event === 'submitted')) return 'processing';
  return state;
}

/* ---------------------------------------------------------------- audio --- */

export interface ChapterMarker {
  id: string;
  title: string;
  startMs: number;
}

/** Index of the chapter containing `positionMs` (markers sorted by start). -1 when none. */
export function chapterIndexAt(chapters: readonly ChapterMarker[], positionMs: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i += 1) {
    const c = chapters[i];
    if (c && c.startMs <= positionMs) idx = i;
    else break;
  }
  return idx;
}

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export function nextPlaybackRate(current: number): PlaybackRate {
  const i = PLAYBACK_RATES.indexOf(current as PlaybackRate);
  const next = PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
  return next ?? 1;
}

/* ------------------------------------------------------------- coverage --- */

export type CoverageTone = 'success' | 'warning' | 'info' | 'muted';

export const COVERAGE_TONE: Readonly<Record<CoverageStatus, CoverageTone>> = {
  complete: 'success',
  partial: 'warning',
  planned: 'info',
  unavailable: 'muted',
};

/* -------------------------------------------------------- language pair --- */

/** Native-script greeting shown on each course tile (§10.2B screen 1). */
export const NATIVE_SAMPLES: Readonly<
  Record<CourseTrackId, { native: string; latin: string | null }>
> = {
  'arabic-eastern': { native: 'مرحبا', latin: 'marhaba' },
  'arabic-moroccan': { native: 'سلام', latin: 'salam' },
  'arabic-egyptian': { native: 'أهلاً', latin: 'ahlan' },
  'arabic-msa': { native: 'مرحباً', latin: 'marḥaban' },
  'chinese-cantonese': { native: '你好', latin: 'nei5 hou2' },
  'chinese-mandarin': { native: '你好', latin: 'nǐ hǎo' },
  'chinese-simplified': { native: '你好', latin: 'nǐ hǎo' },
  english: { native: 'Hello', latin: null },
  danish: { native: 'Hej', latin: null },
  french: { native: 'Bonjour', latin: null },
  german: { native: 'Hallo', latin: null },
  greek: { native: 'Γεια σου', latin: 'geia sou' },
  'haitian-creole': { native: 'Bonjou', latin: null },
  hebrew: { native: 'שלום', latin: 'shalom' },
  hindi: { native: 'नमस्ते', latin: 'namaste' },
  italian: { native: 'Ciao', latin: null },
  japanese: { native: 'こんにちは', latin: 'konnichiwa' },
  korean: { native: '안녕하세요', latin: 'annyeonghaseyo' },
  'portuguese-brazilian': { native: 'Olá', latin: null },
  'portuguese-european': { native: 'Olá', latin: null },
  romanian: { native: 'Bună', latin: null },
  russian: { native: 'Привет', latin: 'privet' },
  'spanish-latin-american': { native: 'Hola', latin: null },
  'spanish-spain': { native: 'Hola', latin: null },
  swahili: { native: 'Habari', latin: null },
  kinyarwanda: { native: 'Muraho', latin: null },
  swedish: { native: 'Hej', latin: null },
  lingala: { native: 'Mbote', latin: null },
  ukrainian: { native: 'Привіт', latin: 'pryvit' },
  vietnamese: { native: 'Xin chào', latin: null },
};

/**
 * Source languages for the picker: English and French first (spec §10.2B),
 * then by production priority tier, then by English name.
 */
export function orderedSourceLanguages(): readonly {
  code: SourceLanguageCode;
  englishName: string;
  nativeName: string;
  prominent: boolean;
}[] {
  const prominent: SourceLanguageCode[] = ['en', 'fr'];
  const rest = SOURCE_LANGUAGES.filter((s) => !prominent.includes(s.code))
    .map((s) => ({ ...s, lang: getLanguage(s.code) }))
    .sort(
      (a, b) =>
        a.priorityTier - b.priorityTier || a.lang.englishName.localeCompare(b.lang.englishName),
    );
  return [
    ...prominent.map((code) => {
      const l = getLanguage(code);
      return { code, englishName: l.englishName, nativeName: l.nativeName, prominent: true };
    }),
    ...rest.map((s) => ({
      code: s.code,
      englishName: s.lang.englishName,
      nativeName: s.lang.nativeName,
      prominent: false,
    })),
  ];
}

export interface DialectClarification {
  /** Variety name, e.g. "Moroccan Arabic (Darija)". */
  varietyName: string;
  /** Names of varieties this course must never be confused with (e.g. MSA for Darija). */
  distinctFrom: readonly string[];
  /** Short teaching focus line from the catalog. */
  focus: string;
  /** True when several tracks share the language → clarification must be shown. */
  needsClarification: boolean;
}

/** Dialect / script clarification for a course tile (Arabic, Mandarin, Cantonese, Portuguese, Spanish…). */
export function dialectClarification(track: CourseTrack): DialectClarification {
  const variety = getVariety(track.targetVarietyId);
  const siblings = tracksForLanguage(track.languageCode);
  const distinctFrom = variety.mustNotSubstitute.map((id) => getVariety(id).name);
  return {
    varietyName: variety.name,
    distinctFrom,
    focus: track.teachingFocus,
    needsClarification: siblings.length > 1 || distinctFrom.length > 0,
  };
}

/** All 30 tracks in catalog order. */
export const ORDERED_TRACKS: readonly CourseTrack[] = [...COURSE_TRACKS].sort(
  (a, b) => a.order - b.order,
);

export const languageName = (code: LanguageCode): string =>
  LANGUAGES.find((l) => l.code === code)?.englishName ?? code;

/* ------------------------------------------------------------ story map --- */

export type StoryNodeStatus = 'locked' | 'available' | 'in_progress' | 'completed';

export interface StoryMapNode {
  id: string;
  title: string;
  chapterId: string;
  chapterTitle: string;
  status: StoryNodeStatus;
  /** Ids of nodes reachable from this one. */
  next: readonly string[];
  /** Optional scene art id from the art module. */
  sceneId?: string;
  /** Approximate minutes. */
  minutes?: number;
}

export interface StoryMapLayoutNode extends StoryMapNode {
  /** 0-based row (vertical order) and column (branch lane). */
  row: number;
  lane: number;
}

/**
 * Lay out a branching route deterministically: breadth-first rows from the
 * roots, lanes assigned left-to-right per row. Cycles are ignored. The same
 * function feeds the accessible linear list (ordered by row then lane).
 */
export function layoutStoryMap(nodes: readonly StoryMapNode[]): StoryMapLayoutNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const incoming = new Map<string, number>();
  for (const n of nodes) {
    for (const t of n.next) incoming.set(t, (incoming.get(t) ?? 0) + 1);
  }
  const roots = nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
  const rowOf = new Map<string, number>();
  let frontier = roots.length > 0 ? roots : nodes.slice(0, 1).map((n) => n.id);
  let row = 0;
  const visited = new Set<string>();
  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      rowOf.set(id, row);
      const n = byId.get(id);
      if (n) for (const t of n.next) if (!visited.has(t) && byId.has(t)) nextFrontier.push(t);
    }
    frontier = [...new Set(nextFrontier)];
    row += 1;
  }
  // Unreachable nodes (data errors) still get a row so nothing disappears.
  for (const n of nodes) if (!rowOf.has(n.id)) rowOf.set(n.id, row++);

  const laneCounters = new Map<number, number>();
  return nodes
    .map((n) => ({ n, row: rowOf.get(n.id) ?? 0 }))
    .sort((a, b) => a.row - b.row)
    .map(({ n, row: r }) => {
      const lane = laneCounters.get(r) ?? 0;
      laneCounters.set(r, lane + 1);
      return { ...n, row: r, lane };
    });
}

/** Linear, screen-reader friendly order: chapter by chapter, then route order. */
export function linearStoryList(nodes: readonly StoryMapNode[]): StoryMapLayoutNode[] {
  return layoutStoryMap(nodes).sort((a, b) => a.row - b.row || a.lane - b.lane);
}

/* -------------------------------------------------------- lesson phases --- */

export type LessonPhase = 'listen' | 'anticipate' | 'speak' | 'compare' | 'review' | 'summary';

export const LESSON_PHASES: readonly LessonPhase[] = [
  'listen',
  'anticipate',
  'speak',
  'compare',
  'review',
  'summary',
];

/** 0..1 completion for a step index inside `total` steps. */
export function stepProgress(step: number, total: number): number {
  if (!Number.isFinite(step) || !Number.isFinite(total) || total <= 0) return 0;
  return clamp(step / total, 0, 1);
}
