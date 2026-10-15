import {
  COURSE_TRACKS,
  SpeechEvaluationResultSchema,
  type SpeechEvaluationResult,
  referenceComparisonAssessment,
} from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import {
  NATIVE_SAMPLES,
  ORDERED_TRACKS,
  SPEECH_STATE_HAS_AUDIO,
  SPEECH_STATE_TO_MASCOT,
  chapterIndexAt,
  dialectClarification,
  formatDurationMs,
  formatMinutes,
  layoutStoryMap,
  linearStoryList,
  nextPlaybackRate,
  nextSpeakState,
  orderedSourceLanguages,
  pronunciationDisplay,
  stepProgress,
} from './logic';

const baseResult = (): SpeechEvaluationResult =>
  SpeechEvaluationResultSchema.parse({
    assessmentId: '0b4f8c2e-9c1a-4f1e-8b7a-2d3c4e5f6a7b',
    targetVarietyId: 'ary',
    semanticIntentMatched: true,
    meaningConfidence: 0.9,
    intelligibility: 'understood',
    pronunciation: referenceComparisonAssessment(['Nice rhythm on "salam".']),
    shouldAdvanceConversation: true,
    transcript: 'salam',
    matchedIntentIds: ['greet'],
  });

describe('pronunciationDisplay (honest scoring)', () => {
  it('never shows a number for reference-comparison results', () => {
    const d = pronunciationDisplay(baseResult());
    expect(d.showNumeric).toBe(false);
    expect(d.numericScore).toBeNull();
    expect(d.detailedUnavailable).toBe(true);
    expect(d.scoredWords).toEqual([]);
    expect(d.tone).toBe('success');
    expect(d.icon).toBe('check');
  });

  it('shows the number only for acoustic assessments with a score', () => {
    const r = baseResult();
    const acoustic: SpeechEvaluationResult = {
      ...r,
      targetVarietyId: 'es-419',
      intelligibility: 'partially_understood',
      pronunciation: {
        ...r.pronunciation,
        assessmentMode: 'acoustic-assessor',
        numericScore: 72,
        confidence: 'high',
        featuresAssessed: ['word', 'phoneme'],
        wordScores: [
          { word: 'hola', startMs: 0, endMs: 300, accuracy: 90, errorType: 'none' },
          { word: 'buenos', startMs: 300, endMs: 700, accuracy: 55, errorType: 'mispronunciation' },
          { word: 'días', startMs: null, endMs: null, accuracy: null, errorType: null },
        ],
        provider: 'test',
        scorerVersion: '1',
      },
    };
    const d = pronunciationDisplay(SpeechEvaluationResultSchema.parse(acoustic));
    expect(d.showNumeric).toBe(true);
    expect(d.numericScore).toBe(72);
    expect(d.detailedUnavailable).toBe(false);
    expect(d.scoredWords.map((w) => w.word)).toEqual(['hola', 'buenos']);
    expect(d.tone).toBe('warning');
  });

  it('treats an acoustic mode with a null score as qualitative', () => {
    const r = baseResult();
    const d = pronunciationDisplay({
      ...r,
      pronunciation: {
        ...r.pronunciation,
        assessmentMode: 'acoustic-assessor',
        confidence: 'limited',
        numericScore: null,
      },
    });
    expect(d.showNumeric).toBe(false);
    expect(d.detailedUnavailable).toBe(false);
  });

  it('maps every intelligibility to a tone + icon pair (never colour only)', () => {
    for (const i of [
      'understood',
      'partially_understood',
      'not_understood',
      'no_speech_detected',
    ] as const) {
      const d = pronunciationDisplay({ ...baseResult(), intelligibility: i });
      expect(d.tone).toBeTruthy();
      expect(d.icon).toBeTruthy();
    }
  });
});

describe('speak button state machine', () => {
  it('hold mode records while pressed then processes', () => {
    expect(nextSpeakState('idle', 'pressIn', 'hold')).toBe('recording');
    expect(nextSpeakState('recording', 'pressOut', 'hold')).toBe('processing');
    expect(nextSpeakState('processing', 'pressIn', 'hold')).toBe('processing');
    expect(nextSpeakState('processing', 'processingDone', 'hold')).toBe('idle');
    expect(nextSpeakState('idle', 'tap', 'hold')).toBe('idle');
  });

  it('toggle mode starts and stops on taps', () => {
    expect(nextSpeakState('idle', 'tap', 'toggle')).toBe('recording');
    expect(nextSpeakState('recording', 'tap', 'toggle')).toBe('processing');
    expect(nextSpeakState('recording', 'pressOut', 'toggle')).toBe('recording');
    expect(nextSpeakState('idle', 'pressIn', 'toggle')).toBe('idle');
  });

  it('disable/enable/cancel work in both modes', () => {
    expect(nextSpeakState('recording', 'disable', 'toggle')).toBe('disabled');
    expect(nextSpeakState('disabled', 'tap', 'toggle')).toBe('disabled');
    expect(nextSpeakState('disabled', 'enable', 'hold')).toBe('idle');
    expect(nextSpeakState('recording', 'cancel', 'hold')).toBe('idle');
  });
});

describe('speech state maps', () => {
  it('only mic-active and character-speaking states claim audio activity', () => {
    expect(SPEECH_STATE_HAS_AUDIO.learner_mic_active).toBe(true);
    expect(SPEECH_STATE_HAS_AUDIO.character_speaking).toBe(true);
    expect(SPEECH_STATE_HAS_AUDIO.thinking).toBe(false);
    expect(SPEECH_STATE_HAS_AUDIO.reconnecting).toBe(false);
    expect(SPEECH_STATE_TO_MASCOT.learner_mic_active).toBe('listening');
    expect(SPEECH_STATE_TO_MASCOT.reconnecting).toBe('connection_error');
  });
});

describe('time & audio helpers', () => {
  it('formats durations', () => {
    expect(formatDurationMs(0)).toBe('0:00');
    expect(formatDurationMs(65000)).toBe('1:05');
    expect(formatDurationMs(3_725_000)).toBe('1:02:05');
    expect(formatDurationMs(-5)).toBe('0:00');
    expect(formatDurationMs(Number.NaN)).toBe('0:00');
    expect(formatMinutes(0)).toBe(0);
    expect(formatMinutes(10_000)).toBe(1);
    expect(formatMinutes(7.4 * 60000)).toBe(7);
  });

  it('finds chapters and cycles rates', () => {
    const chapters = [
      { id: 'a', title: 'A', startMs: 0 },
      { id: 'b', title: 'B', startMs: 60_000 },
      { id: 'c', title: 'C', startMs: 120_000 },
    ];
    expect(chapterIndexAt(chapters, 0)).toBe(0);
    expect(chapterIndexAt(chapters, 61_000)).toBe(1);
    expect(chapterIndexAt(chapters, 999_999)).toBe(2);
    expect(chapterIndexAt([], 10)).toBe(-1);
    expect(nextPlaybackRate(1)).toBe(1.25);
    expect(nextPlaybackRate(1.5)).toBe(0.75);
    expect(nextPlaybackRate(3)).toBe(0.75);
    expect(stepProgress(2, 5)).toBe(0.4);
    expect(stepProgress(9, 5)).toBe(1);
    expect(stepProgress(1, 0)).toBe(0);
  });
});

describe('language pair helpers', () => {
  it('puts English and French first, then production tiers', () => {
    const ordered = orderedSourceLanguages();
    expect(ordered[0]?.code).toBe('en');
    expect(ordered[1]?.code).toBe('fr');
    expect(ordered.filter((s) => s.prominent)).toHaveLength(2);
    expect(
      ordered
        .map((s) => s.code)
        .slice(2, 4)
        .sort(),
    ).toEqual(['es', 'ru']);
    expect(new Set(ordered.map((s) => s.code)).size).toBe(ordered.length);
  });

  it('has a native-script sample for all 30 tracks in catalog order', () => {
    expect(ORDERED_TRACKS).toHaveLength(30);
    expect(ORDERED_TRACKS.map((t) => t.order)).toEqual([...Array(30).keys()].map((i) => i + 1));
    for (const t of COURSE_TRACKS) expect(NATIVE_SAMPLES[t.id].native.length).toBeGreaterThan(0);
  });

  it('clarifies dialect boundaries without crossing them', () => {
    const darija = dialectClarification(COURSE_TRACKS.find((t) => t.id === 'arabic-moroccan')!);
    expect(darija.needsClarification).toBe(true);
    expect(darija.varietyName).toContain('Darija');
    expect(darija.distinctFrom).toContain('Modern Standard Arabic');
    const yue = dialectClarification(COURSE_TRACKS.find((t) => t.id === 'chinese-cantonese')!);
    expect(yue.distinctFrom).toContain('Mandarin');
    const ht = dialectClarification(COURSE_TRACKS.find((t) => t.id === 'haitian-creole')!);
    expect(ht.distinctFrom).toContain('French');
    const de = dialectClarification(COURSE_TRACKS.find((t) => t.id === 'german')!);
    expect(de.needsClarification).toBe(false);
  });
});

describe('story map layout', () => {
  const nodes = [
    {
      id: 'cafe',
      title: 'Order a coffee',
      chapterId: 'c1',
      chapterTitle: 'Arrival',
      status: 'completed' as const,
      next: ['market', 'park'],
    },
    {
      id: 'market',
      title: 'Buy fruit',
      chapterId: 'c1',
      chapterTitle: 'Arrival',
      status: 'available' as const,
      next: ['station'],
    },
    {
      id: 'park',
      title: 'Meet a neighbour',
      chapterId: 'c1',
      chapterTitle: 'Arrival',
      status: 'locked' as const,
      next: ['station'],
    },
    {
      id: 'station',
      title: 'Take the train',
      chapterId: 'c2',
      chapterTitle: 'Moving around',
      status: 'locked' as const,
      next: [],
    },
    {
      id: 'orphan',
      title: 'Unlinked',
      chapterId: 'c2',
      chapterTitle: 'Moving around',
      status: 'locked' as const,
      next: [],
    },
  ];

  it('assigns rows breadth-first and lanes per row, keeping every node', () => {
    const laid = layoutStoryMap(nodes);
    const byId = Object.fromEntries(laid.map((n) => [n.id, n]));
    expect(laid).toHaveLength(nodes.length);
    expect(byId.cafe?.row).toBe(0);
    expect(byId.market?.row).toBe(1);
    expect(byId.park?.row).toBe(1);
    expect(new Set([byId.market?.lane, byId.park?.lane])).toEqual(new Set([0, 1]));
    expect(byId.station?.row).toBe(2);
    expect(byId.orphan).toBeDefined();
  });

  it('produces a deterministic linear list', () => {
    const list = linearStoryList(nodes).map((n) => n.id);
    expect(list.indexOf('cafe')).toBeLessThan(list.indexOf('market'));
    expect(list.indexOf('market')).toBeLessThan(list.indexOf('station'));
    expect(linearStoryList(nodes).map((n) => n.id)).toEqual(list);
  });

  it('handles an empty map and a cycle', () => {
    expect(layoutStoryMap([])).toEqual([]);
    const cyc = layoutStoryMap([
      { id: 'a', title: 'A', chapterId: 'c', chapterTitle: 'C', status: 'available', next: ['b'] },
      { id: 'b', title: 'B', chapterId: 'c', chapterTitle: 'C', status: 'locked', next: ['a'] },
    ]);
    expect(cyc).toHaveLength(2);
  });
});
