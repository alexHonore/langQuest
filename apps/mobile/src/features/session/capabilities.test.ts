import { CAPABILITY_MISSING_I18N_KEYS, CourseCapabilitiesSchema, type CourseCapabilities } from '@langquest/contracts';
import { createTranslator } from '@langquest/locales';
import { describe, expect, it } from 'vitest';
import { HIDDEN_NAVIGATION, buildDisclaimer, buildIncludes, completeUiLocales, homeCta, orderMissing, resolveNavigation, visibleTabs, withoutNumericScore } from './capabilities';

const base = (): CourseCapabilities =>
  CourseCapabilitiesSchema.parse({
    courseTrackId: 'arabic-moroccan',
    sourceLanguageCode: 'fr',
    targetVarietyId: 'ary',
    missions: { available: true, publishedCount: 6, localizedCount: 6 },
    audioLibrary: { available: true, publishedCollections: 2 },
    liveConversation: { available: true, characterCount: 52, mode: 'text_and_voice' },
    pronunciationScoring: { mode: 'acoustic' },
    offlineDownloads: { available: true },
    instructionLanguage: { status: 'partial', nativeReviewed: false, metrics: { mission_instructions_pct: 100, explanations_pct: 100, ui_pct: 100, subtitles_pct: 0, audio_overlays_pct: 0 } },
    scripts: { modes: ['native', 'latin', 'both'] },
    regionalOptions: [],
    missing: [{ key: 'instruction_language_draft', i18nKey: CAPABILITY_MISSING_I18N_KEYS.instruction_language_draft, severity: 'info' }],
    computedAt: '2026-10-19T21:24:18.566Z',
  });

const withCaps = (patch: (c: CourseCapabilities) => void): CourseCapabilities => {
  const c = base();
  patch(c);
  return c;
};

const t = (locale: 'en' | 'fr') => {
  const tr = createTranslator(locale);
  return (key: string, values?: Record<string, unknown>) => tr.t(key, values as never);
};
const names = { source: 'French', target: 'Arabic (Moroccan)' };

describe('resolveNavigation (CONVENTIONS §8: hidden, never greyed)', () => {
  it('hides everything optional when the snapshot is unknown (offline first run, old cache)', () => {
    expect(resolveNavigation(null)).toBe(HIDDEN_NAVIGATION);
    expect(resolveNavigation(undefined).known).toBe(false);
    expect(visibleTabs(resolveNavigation(undefined))).toEqual(['index', 'progress']);
    expect(homeCta(resolveNavigation(undefined))).toBeNull();
  });

  it('renders every tab for a fully capable pair', () => {
    const nav = resolveNavigation(base());
    expect(nav).toEqual({ known: true, missions: true, audio: true, speak: true, liveConversation: true, conversationVoice: true, pronunciationDrills: true, numericScore: true, downloads: true });
    expect(visibleTabs(nav)).toEqual(['index', 'missions', 'audio', 'speak', 'progress']);
    expect(homeCta(nav)).toBe('missions');
  });

  it('drops the Audio tab (4 tabs) and downloads when there is no audio library', () => {
    const nav = resolveNavigation(withCaps((c) => (c.audioLibrary = { available: false, publishedCollections: 0 })));
    expect(nav.audio).toBe(false);
    expect(nav.downloads).toBe(false);
    expect(visibleTabs(nav)).toEqual(['index', 'missions', 'speak', 'progress']);
  });

  it('never trusts `available: true` with a zero count', () => {
    expect(resolveNavigation(withCaps((c) => (c.missions = { available: true, publishedCount: 0, localizedCount: 0 }))).missions).toBe(false);
    expect(resolveNavigation(withCaps((c) => (c.audioLibrary = { available: true, publishedCollections: 0 }))).audio).toBe(false);
    expect(resolveNavigation(withCaps((c) => (c.liveConversation = { available: true, characterCount: 0, mode: 'text_and_voice' }))).liveConversation).toBe(false);
  });

  it('hides Missions and sends the Home CTA to Speak when the pair has no missions', () => {
    const nav = resolveNavigation(withCaps((c) => (c.missions = { available: false, publishedCount: 3, localizedCount: 0 })));
    expect(nav.missions).toBe(false);
    // Drills need mission expressions, so they go too; the Speak tab stays for the live conversation.
    expect(nav.pronunciationDrills).toBe(false);
    expect(nav.numericScore).toBe(false);
    expect(nav.speak).toBe(true);
    expect(visibleTabs(nav)).toEqual(['index', 'audio', 'speak', 'progress']);
    expect(homeCta(nav)).toBe('speak');
  });

  it('keeps the Speak tab for drills only when live conversation is unavailable', () => {
    const nav = resolveNavigation(withCaps((c) => (c.liveConversation = { available: false, characterCount: 0, mode: 'none' })));
    expect(nav.liveConversation).toBe(false);
    expect(nav.conversationVoice).toBe(false);
    expect(nav.pronunciationDrills).toBe(true);
    expect(nav.speak).toBe(true);
  });

  it('hides the Speak tab entirely when neither conversation nor drills exist', () => {
    const nav = resolveNavigation(
      withCaps((c) => {
        c.liveConversation = { available: false, characterCount: 0, mode: 'none' };
        c.pronunciationScoring = { mode: 'none' };
      }),
    );
    expect(nav.speak).toBe(false);
    expect(visibleTabs(nav)).toEqual(['index', 'missions', 'audio', 'progress']);
  });

  it('text-only conversation keeps the tab but removes voice controls', () => {
    const nav = resolveNavigation(withCaps((c) => (c.liveConversation = { available: true, characterCount: 2, mode: 'text_only' })));
    expect(nav.liveConversation).toBe(true);
    expect(nav.conversationVoice).toBe(false);
  });

  it('shows a numeric score only for an acoustic assessor', () => {
    expect(resolveNavigation(withCaps((c) => (c.pronunciationScoring = { mode: 'reference_comparison' }))).numericScore).toBe(false);
    expect(resolveNavigation(withCaps((c) => (c.pronunciationScoring = { mode: 'reference_comparison' }))).pronunciationDrills).toBe(true);
    expect(resolveNavigation(withCaps((c) => (c.pronunciationScoring = { mode: 'none' }))).pronunciationDrills).toBe(false);
  });

  it('downloads need media storage AND platform support', () => {
    expect(resolveNavigation(withCaps((c) => (c.offlineDownloads = { available: false }))).downloads).toBe(false);
    expect(resolveNavigation(base(), { downloadsSupported: false }).downloads).toBe(false);
    expect(resolveNavigation(base(), { downloadsSupported: true }).downloads).toBe(true);
  });
});

describe('buildDisclaimer (enrollment wizard, before enrolling)', () => {
  it('returns null for an unknown snapshot (nothing is rendered, nothing is guessed)', () => {
    expect(buildDisclaimer(null, t('en'), names)).toBeNull();
  });

  it('renders one localised line per missing item with the source/target values', () => {
    const caps = withCaps((c) => {
      c.audioLibrary = { available: false, publishedCollections: 0 };
      c.missing = [
        { key: 'instruction_language_draft', i18nKey: CAPABILITY_MISSING_I18N_KEYS.instruction_language_draft, severity: 'info' },
        { key: 'no_audio_library', i18nKey: CAPABILITY_MISSING_I18N_KEYS.no_audio_library, severity: 'info' },
      ];
    });
    const en = buildDisclaimer(caps, t('en'), names)!;
    expect(en.title).toBe('What this course does not have yet');
    expect(en.lines.map((l) => l.key)).toEqual(['instruction_language_draft', 'no_audio_library']);
    expect(en.lines[0]!.text).toBe('Explanations from French are drafts, not yet reviewed by native speakers');
    expect(en.lines[1]!.text).toBe('No audio library for this course yet');
    expect(en.blocking).toBe(false);
    expect(en.instructionLanguageStatus).toBe('Partly available from French');
    expect(en.nativeReviewCaption).not.toBeNull();
    expect(en.allAvailable).toBeNull();

    const fr = buildDisclaimer(caps, t('fr'), names)!;
    expect(fr.title).toBe("Ce que ce cours n'a pas encore");
    expect(fr.lines[1]!.text).toContain('audio');
  });

  it('says everything is available when nothing is missing', () => {
    const caps = withCaps((c) => {
      c.missing = [];
      c.instructionLanguage.status = 'complete';
      c.instructionLanguage.nativeReviewed = true;
    });
    const d = buildDisclaimer(caps, t('en'), names)!;
    expect(d.lines).toEqual([]);
    expect(d.allAvailable).toBe('Everything is available for this course from French.');
    expect(d.nativeReviewCaption).toBeNull();
    expect(d.instructionLanguageStatus).toBe('Fully available from French');
  });

  it('puts blocking items first and flags the disclaimer as blocking', () => {
    const items = [
      { key: 'no_audio_library' as const, i18nKey: CAPABILITY_MISSING_I18N_KEYS.no_audio_library, severity: 'info' as const },
      { key: 'instruction_language_planned' as const, i18nKey: CAPABILITY_MISSING_I18N_KEYS.instruction_language_planned, severity: 'blocking' as const },
      { key: 'no_missions' as const, i18nKey: CAPABILITY_MISSING_I18N_KEYS.no_missions, severity: 'info' as const },
    ];
    expect(orderMissing(items).map((m) => m.key)).toEqual(['instruction_language_planned', 'no_audio_library', 'no_missions']);
    const caps = withCaps((c) => {
      c.missing = items;
      c.instructionLanguage.status = 'planned';
    });
    const d = buildDisclaimer(caps, t('en'), names)!;
    expect(d.blocking).toBe(true);
    expect(d.lines[0]!.severity).toBe('blocking');
    expect(d.instructionLanguageStatus).toBe('Planned from French');
  });
});

describe('buildIncludes (account → "What this course includes")', () => {
  it('lists only what the navigation renders, with counts', () => {
    const lines = buildIncludes(base(), t('en'))!;
    expect(lines.map((l) => l.key)).toEqual(['missions', 'audioLibrary', 'liveConversation', 'pronunciationAcoustic', 'offlineDownloads']);
    expect(lines[0]!.text).toBe('Mission pathway (6 missions)');
    expect(lines[1]!.text).toBe('Audio library (2 collections)');
    expect(lines[2]!.text).toBe('Live conversation (52 characters)');
  });

  it('switches to text-only / listen-and-compare wording and drops hidden features', () => {
    const caps = withCaps((c) => {
      c.liveConversation = { available: true, characterCount: 1, mode: 'text_only' };
      c.pronunciationScoring = { mode: 'reference_comparison' };
      c.audioLibrary = { available: false, publishedCollections: 0 };
    });
    const lines = buildIncludes(caps, t('en'))!;
    expect(lines.map((l) => l.key)).toEqual(['missions', 'liveConversationTextOnly', 'pronunciationReference']);
    expect(lines[1]!.text).toBe('Live conversation, text only (1 character)');
  });

  it('is empty (render nothing) when nothing is usable, and null when unknown', () => {
    const caps = withCaps((c) => {
      c.missions = { available: false, publishedCount: 0, localizedCount: 0 };
      c.audioLibrary = { available: false, publishedCollections: 0 };
      c.liveConversation = { available: false, characterCount: 0, mode: 'none' };
      c.pronunciationScoring = { mode: 'none' };
      c.offlineDownloads = { available: false };
    });
    expect(buildIncludes(caps, t('en'))).toEqual([]);
    expect(buildIncludes(undefined, t('en'))).toBeNull();
  });
});

describe('completeUiLocales (partial interface languages are not offered as chrome)', () => {
  it('keeps only 100% catalogs from the checked-in coverage metadata', () => {
    expect(completeUiLocales()).toEqual(['en', 'fr']);
  });
  it('falls back to the base locale if the metadata is unusable', () => {
    expect(completeUiLocales({ locales: {} })).toEqual(['en']);
    expect(completeUiLocales({ locales: { en: { pct: 100, status: 'complete' }, es: { pct: 99.9, status: 'partial' } } })).toEqual(['en']);
  });
});

describe('withoutNumericScore', () => {
  const result = { assessmentId: 'x', pronunciation: { numericScore: 72, wordScores: [{ word: 'hola', score: 80 }] } };
  it('keeps the score for an acoustic pair and strips it otherwise', () => {
    expect(withoutNumericScore(result, { numericScore: true })).toBe(result);
    const stripped = withoutNumericScore(result, { numericScore: false });
    expect(stripped.pronunciation.numericScore).toBeNull();
    expect(stripped.pronunciation.wordScores).toEqual([]);
    expect(stripped.assessmentId).toBe('x');
  });
  it('returns the same object when there is nothing to strip', () => {
    const r = { pronunciation: { numericScore: null, wordScores: [] } };
    expect(withoutNumericScore(r, { numericScore: false })).toBe(r);
  });
});
