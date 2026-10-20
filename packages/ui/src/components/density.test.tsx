/**
 * Text-budget checks for the calm density (owner decision 2026-10-19): with
 * `density: 'calm'` (the default) components render no helper text unless it
 * is explicitly requested, and the same props in `full` density render it.
 * React Native is stood in by tag-named host components so the markup can be
 * rendered with react-dom's static renderer in Node (no pixels, no native).
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
  const R = await import('react');
  const host = (tag: string) => {
    const C = (props: Record<string, unknown>) => {
      const { children, style, ...rest } = props;
      const attrs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
          attrs[`data-${k.toLowerCase()}`] = String(v);
      }
      void style;
      const kids =
        typeof children === 'function'
          ? (children as (s: { pressed: boolean }) => unknown)({ pressed: false })
          : children;
      return R.createElement(tag, attrs, kids as React.ReactNode);
    };
    C.displayName = tag;
    return C;
  };
  class Value {
    v: number;
    constructor(v: number) {
      this.v = v;
    }
    setValue(v: number): void {
      this.v = v;
    }
    interpolate(): Value {
      return this;
    }
  }
  const anim = { start: () => undefined, stop: () => undefined };
  return {
    View: host('view'),
    Text: host('text'),
    Pressable: host('pressable'),
    ScrollView: host('scrollview'),
    Modal: (props: Record<string, unknown>) =>
      props.visible ? R.createElement('modal', null, props.children as React.ReactNode) : null,
    Image: host('image'),
    Animated: {
      View: host('animatedview'),
      Value,
      timing: () => anim,
      spring: () => anim,
      loop: () => anim,
      sequence: () => anim,
    },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => undefined }),
    },
    I18nManager: { isRTL: false },
    useColorScheme: () => 'dark',
  };
});

vi.mock('react-native-svg', async () => {
  const R = await import('react');
  const make = (tag: string) => {
    const C = (props: Record<string, unknown>) =>
      R.createElement(
        tag,
        // Keep paint attributes observable (the mascot tint test reads the body fill).
        typeof props.fill === 'string' ? { 'data-fill': props.fill } : null,
        props.children as React.ReactNode,
      );
    C.displayName = tag;
    return C;
  };
  return {
    default: make('svg'),
    Svg: make('svg'),
    G: make('g'),
    Circle: make('circle'),
    Ellipse: make('ellipse'),
    Path: make('path'),
    Rect: make('rect'),
    Line: make('line'),
    Polyline: make('polyline'),
    Polygon: make('polygon'),
    Defs: make('defs'),
    LinearGradient: make('linearGradient'),
    RadialGradient: make('radialGradient'),
    Stop: make('stop'),
    ClipPath: make('clipPath'),
  };
});

import { SpeechEvaluationResultSchema, referenceComparisonAssessment } from '@langquest/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveTheme } from '../theme/resolve';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AudioPlayer } from './AudioPlayer';
import { CapabilityDisclaimer } from './CapabilityDisclaimer';
import { CoverageBadge } from './CoverageBadge';
import { EmptyState } from './EmptyState';
import { CAPABILITY_LABELS, COVERAGE_SHORT_LABELS, SPEECH_STATE_SHORT_LABELS } from './labels';
import { Mascot } from './Mascot';
import { MissionCard } from './MissionCard';
import { PronunciationFeedback } from './PronunciationFeedback';
import { SpeechStateIndicator } from './SpeechStateIndicator';

type Density = 'calm' | 'full';

function render(node: React.ReactElement, density: Density): string {
  return renderToStaticMarkup(
    <ThemeProvider density={density} scheme="dark" reducedMotion courseTrackId="arabic-moroccan">
      {node}
    </ThemeProvider>,
  );
}

/** Render under a dark theme for a given course (or none). */
function renderForCourse(node: React.ReactElement, courseTrackId: string | null): string {
  return renderToStaticMarkup(
    <ThemeProvider scheme="dark" reducedMotion courseTrackId={courseTrackId}>
      {node}
    </ThemeProvider>,
  );
}

/** Every `fill` hex the mocked svg kept, in document order. */
const fills = (html: string): string[] =>
  Array.from(html.matchAll(/data-fill="(#[0-9a-f]{6})"/gi), (m) => m[1]!.toLowerCase());

/** Visible text nodes (what a sighted learner reads), ignoring attributes. */
const visibleText = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const both = (node: React.ReactElement): { calm: string; full: string } => ({
  calm: render(node, 'calm'),
  full: render(node, 'full'),
});

const result = () =>
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

describe('calm density renders no helper text unless requested', () => {
  it('MissionCard: title + duration only; objective, focus and skills behind the details toggle', () => {
    const { calm, full } = both(
      <MissionCard
        title="Order a coffee"
        objective="ask for a coffee politely"
        minutes={6}
        focus="conversation"
        status="available"
        skills={[{ key: 'greet', label: 'Greeting', completed: true }]}
        consequence="Nadia remembers you"
        onPress={() => undefined}
        testID="mc"
      />,
    );
    const calmText = visibleText(calm);
    expect(calmText).toContain('Order a coffee');
    expect(calmText).toContain('6 min');
    expect(calmText).not.toContain('ask for a coffee politely');
    expect(calmText).not.toContain('Greeting');
    expect(calmText).not.toContain('Nadia remembers you');
    expect(calmText).not.toContain('Ready');
    expect(calm).toContain('data-testid="mc-toggle"');
    expect(calm).not.toContain('data-testid="mc-details"');
    const fullText = visibleText(full);
    expect(fullText).toContain('ask for a coffee politely');
    expect(fullText).toContain('Greeting');
    expect(fullText).toContain('Conversation');
    expect(full).not.toContain('mc-toggle');
    // The objective is still spoken to assistive tech in both densities.
    expect(calm).toContain('ask for a coffee politely');
  });

  it('MissionCard: defaultExpanded shows the details in calm density', () => {
    const html = render(
      <MissionCard
        title="T"
        objective="the objective"
        minutes={3}
        focus="tone"
        status="completed"
        defaultExpanded
        testID="mc"
      />,
      'calm',
    );
    expect(visibleText(html)).toContain('the objective');
    expect(html).toContain('data-testid="mc-details"');
  });

  it('EmptyState: title + one action; description and secondary action only in full', () => {
    const { calm, full } = both(
      <EmptyState
        title="Nothing to review"
        description="Come back after your next mission."
        actionLabel="Start a mission"
        onAction={() => undefined}
        secondaryActionLabel="Browse courses"
        onSecondaryAction={() => undefined}
      />,
    );
    expect(visibleText(calm)).toContain('Nothing to review');
    expect(visibleText(calm)).toContain('Start a mission');
    expect(visibleText(calm)).not.toContain('Come back after');
    expect(visibleText(calm)).not.toContain('Browse courses');
    expect(visibleText(full)).toContain('Come back after');
    expect(visibleText(full)).toContain('Browse courses');
  });

  it('CoverageBadge: icon + two words in calm, no description line', () => {
    const { calm, full } = both(
      <CoverageBadge status="partial" sourceLanguageCode="fr" nativeReviewed={false} verbose />,
    );
    const calmText = visibleText(calm);
    expect(calmText).toBe(COVERAGE_SHORT_LABELS.partial);
    expect(COVERAGE_SHORT_LABELS.partial.split(' ').length).toBeLessThanOrEqual(2);
    expect(visibleText(full)).toContain('Some explanations are still being translated');
    expect(visibleText(full)).toContain('Not yet reviewed');
    for (const label of Object.values(COVERAGE_SHORT_LABELS)) {
      expect(label.split(' ').length).toBeLessThanOrEqual(2);
    }
  });

  it('SpeechStateIndicator: one word in calm, detail only in full', () => {
    const { calm, full } = both(
      <SpeechStateIndicator state="reconnecting" detail="Retrying in 3 s" />,
    );
    expect(visibleText(calm)).toBe(SPEECH_STATE_SHORT_LABELS.reconnecting);
    expect(visibleText(full)).toContain('Retrying in 3 s');
    expect(calm).toContain('Retrying in 3 s'); // still announced
    for (const label of Object.values(SPEECH_STATE_SHORT_LABELS)) {
      expect(label.split(' ').length).toBe(1);
    }
  });

  it('PronunciationFeedback: one line + primary action in calm; notes and transcript only in full', () => {
    const { calm, full } = both(
      <PronunciationFeedback
        result={result()}
        onRetry={() => undefined}
        onReplaySlow={() => undefined}
      />,
    );
    const calmText = visibleText(calm);
    expect(calmText).toContain('Understood');
    expect(calmText).toContain('Record again');
    expect(calmText).not.toContain('Nice rhythm');
    expect(calmText).not.toContain('salam');
    expect(calmText).not.toContain('Replay slowly');
    expect(calmText).not.toContain('Pronunciation');
    const fullText = visibleText(full);
    expect(fullText).toContain('Nice rhythm');
    expect(fullText).toContain('salam');
    expect(fullText).toContain('Replay slowly');
    // Honesty by omission in both densities: never a score for reference comparison.
    expect(fullText).not.toMatch(/\b\d{2,3}\b/);
  });

  it('AudioPlayer: no captions in calm (subtitle, chapter, attribution behind the info button)', () => {
    const controller = {
      status: 'paused' as const,
      positionMs: 65_000,
      durationMs: 600_000,
      rate: 1,
      play: () => undefined,
      pause: () => undefined,
      seekTo: () => undefined,
      setRate: () => undefined,
      setSleepTimer: () => undefined,
    };
    const node = (
      <AudioPlayer
        controller={controller}
        title="Chapter one"
        subtitle="Darija from French"
        chapters={[{ id: 'c1', title: 'At the café', startMs: 0 }]}
        attributionText="Narrated by a reviewed native speaker"
        transcript={{ available: true, visible: false, onToggle: () => undefined }}
        onDownload={() => undefined}
        onPracticeWithAi={() => undefined}
      />
    );
    const { calm, full } = both(node);
    const calmText = visibleText(calm);
    expect(calmText).toContain('Chapter one');
    expect(calmText).toContain('1:05');
    expect(calmText).not.toContain('Darija from French');
    expect(calmText).not.toContain('At the café');
    expect(calmText).not.toContain('Narrated by');
    expect(calmText).not.toContain('Practice this with AI');
    // Icons keep their accessible names.
    expect(calm).toContain('Practice this with AI');
    expect(calm).toContain('Download for offline');
    expect(calm).toContain('Transcript');
    const fullText = visibleText(full);
    expect(fullText).toContain('Darija from French');
    expect(fullText).toContain('Narrated by');
    expect(fullText).toContain('Practice this with AI');
  });

  it('CapabilityDisclaimer: bullets of at most 6 words in calm, long lines in full', () => {
    const items = [
      {
        key: 'no_live_conversation' as const,
        severity: 'blocking' as const,
        text: 'No live conversation with AI characters yet',
      },
      {
        key: 'no_offline_downloads' as const,
        severity: 'info' as const,
        text: 'No offline downloads yet',
      },
    ];
    const { calm, full } = both(
      <CapabilityDisclaimer
        items={items}
        statusText="Explanations from French: reviewed"
        severityLabels={{ blocking: 'Not ready yet', info: 'Missing for now' }}
      />,
    );
    const calmText = visibleText(calm);
    expect(calmText).toContain(CAPABILITY_LABELS.title);
    expect(calmText).toContain(CAPABILITY_LABELS.short.no_live_conversation);
    expect(calmText).not.toContain('with AI characters');
    expect(calmText).not.toContain('Explanations from French');
    expect(calmText).not.toContain('Not ready yet');
    const fullText = visibleText(full);
    expect(fullText).toContain('No live conversation with AI characters yet');
    expect(fullText).toContain('Explanations from French');
    expect(fullText).toContain('Not ready yet');
    for (const line of Object.values(CAPABILITY_LABELS.short)) {
      expect(line.split(' ').length, line).toBeLessThanOrEqual(6);
    }
    expect(render(<CapabilityDisclaimer items={null} />, 'calm')).toBe('');
    expect(visibleText(render(<CapabilityDisclaimer items={[]} />, 'calm'))).toBe(
      CAPABILITY_LABELS.allAvailable,
    );
  });

  it('Mascot: the shared component wears the course-family tint, not only the state tint', () => {
    const noCourse = renderForCourse(<Mascot state="curious" />, null);
    const japanese = renderForCourse(<Mascot state="curious" />, 'japanese');
    // `animate` takes the other branch of Mascot (AnimatedMascot); reducedMotion is off here.
    const animatedJapanese = renderToStaticMarkup(
      <ThemeProvider scheme="dark" reducedMotion={false} courseTrackId="japanese">
        <Mascot state="curious" animate />
      </ThemeProvider>,
    );
    const bodyFor = (courseTrackId: string | null): string =>
      resolveTheme({ scheme: 'dark', courseTrackId }).mascotTint('curious').body.toLowerCase();
    expect(fills(noCourse).length).toBeGreaterThan(0);
    // The exact hex the theme computes for this situation × course is what the art paints.
    expect(fills(noCourse)).toContain(bodyFor(null));
    expect(fills(japanese)).toContain(bodyFor('japanese'));
    expect(fills(animatedJapanese)).toContain(bodyFor('japanese'));
    // And the two courses therefore differ in body colour.
    expect(bodyFor('japanese')).not.toBe(bodyFor(null));
    expect(fills(japanese)).not.toContain(bodyFor(null));
  });

  it('an explicit density prop wins over the theme', () => {
    const html = render(
      <SpeechStateIndicator state="thinking" detail="Scoring" density="full" />,
      'calm',
    );
    expect(visibleText(html)).toContain('Scoring');
  });
});
