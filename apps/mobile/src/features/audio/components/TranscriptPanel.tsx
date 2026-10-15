/**
 * Transcript follow-along (§7.5, Phase 8): sentence list with karaoke
 * highlight (word alignment when the server has it, proportional otherwise),
 * tap-to-seek, A/B loop on a sentence or a range, instruction-language
 * translation (never a silent fallback), speaker labels, save-to-review and
 * honest transcript status.
 */
import type { TranscriptResponse } from '@langquest/contracts';
import { Button, Chip, Row, StatusLine, ThemedText, useTheme } from '@langquest/ui';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { activeWindowIndex, karaokeWindows, loopBoundsFor, loopBoundsForRange, nearestSegmentIndex, type TranscriptSegment } from '@/audio/transcript-sync';
import type { AbLoop } from '@/audio/engine-state';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useAudioLabels } from '../labels';

export interface TranscriptPanelProps {
  transcript: TranscriptResponse;
  positionMs: number;
  durationMs: number | null;
  loop: AbLoop | null;
  /** Instruction language the learner asked translations in. */
  translationLanguage: string | null;
  savedSegmentIds: ReadonlySet<string>;
  onSeek: (ms: number) => void;
  onSetLoop: (loop: AbLoop | null) => void;
  onSaveExpression: (segment: TranscriptSegment) => void;
  reducedMotion: boolean;
}

function Sentence(props: { segment: TranscriptSegment; active: boolean; positionMs: number; showTranslation: boolean; saved: boolean; looped: boolean; onPress: () => void; onLoop: () => void; onSave: () => void; labels: ReturnType<typeof useAudioLabels>; t: ReturnType<typeof useT> }): React.JSX.Element {
  const theme = useTheme();
  const { segment, active } = props;
  const windows = useMemo(() => karaokeWindows(segment), [segment]);
  const wordIdx = active ? activeWindowIndex(windows, props.positionMs) : -1;
  const parts = useMemo(() => {
    if (!active || wordIdx < 0 || windows.length === 0) return null;
    const w = windows[wordIdx]!;
    return { before: segment.text.slice(0, w.charStart), word: segment.text.slice(w.charStart, w.charEnd), after: segment.text.slice(w.charEnd) };
  }, [active, wordIdx, windows, segment.text]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.labels.jumpTo}: ${segment.text}`}
      accessibilityState={{ selected: active }}
      onPress={props.onPress}
      style={({ pressed }) => ({
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: active ? theme.colors.accentSoft : pressed ? theme.colors.surfaceMuted : 'transparent',
        borderWidth: props.looped ? 1 : 0,
        borderColor: theme.colors.accent,
        gap: 2,
      })}
    >
      {segment.speakerLabel ? (
        <ThemedText variant="caption" tone="muted">
          {segment.speakerLabel}
        </ThemedText>
      ) : null}
      <ThemedText variant={active ? 'bodyLarge' : 'body'} tone={active ? 'primary' : 'secondary'}>
        {parts ? (
          <>
            {parts.before}
            <ThemedText variant={active ? 'bodyLarge' : 'body'} tone="accent" style={{ fontWeight: '700' }}>
              {parts.word}
            </ThemedText>
            {parts.after}
          </>
        ) : (
          segment.text
        )}
      </ThemedText>
      {segment.transliteration ? (
        <ThemedText variant="transliteration" tone="muted">
          {segment.transliteration}
        </ThemedText>
      ) : null}
      {props.showTranslation && segment.translation ? (
        <ThemedText variant="label" tone="secondary">
          {segment.translation.text}
          {segment.translation.qaState !== 'reviewed' && segment.translation.qaState !== 'approved' ? ' ·' : ''}
        </ThemedText>
      ) : null}
      {active ? (
        <Row gap={theme.spacing.xs} wrap style={{ marginTop: theme.spacing.xs }}>
          <Button label={props.looped ? props.labels.loopOff : props.labels.loopSentence} variant={props.looped ? 'primary' : 'ghost'} size="sm" icon="replay" onPress={props.onLoop} />
          <Button label={props.saved ? props.labels.savedExpression : props.labels.saveExpression} variant="ghost" size="sm" icon={props.saved ? 'check' : 'bookmark'} disabled={props.saved} onPress={props.onSave} />
        </Row>
      ) : null}
    </Pressable>
  );
}

export function TranscriptPanel(props: TranscriptPanelProps): React.JSX.Element {
  const theme = useTheme();
  const t = useT();
  const L = useAudioLabels();
  const names = useLanguageNames();
  const segments = props.transcript.segments;
  const [showTranslation, setShowTranslation] = useState(true);
  const [loopA, setLoopA] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<number[]>([]);
  const activeIdx = nearestSegmentIndex(segments, props.positionMs);
  const lastScrolled = useRef(-1);

  useEffect(() => {
    if (activeIdx < 0 || activeIdx === lastScrolled.current) return;
    lastScrolled.current = activeIdx;
    const y = offsets.current[activeIdx];
    if (typeof y === 'number') scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: !props.reducedMotion });
  }, [activeIdx, props.reducedMotion]);

  const hasTranslations = segments.some((s) => s.translation !== null);
  const loopedIndex = props.loop ? segments.findIndex((s) => props.loop && s.startMs >= props.loop.startMs - 200 && s.endMs <= props.loop.endMs + 200) : -1;

  const toggleLoop = (index: number): void => {
    if (loopedIndex === index && props.loop) {
      props.onSetLoop(null);
      return;
    }
    props.onSetLoop(loopBoundsFor(segments, index, { durationMs: props.durationMs }));
  };

  const statusText = props.transcript.status === 'reviewed' || props.transcript.reviewed ? L.transcriptReviewed : L.transcriptMachine;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Row gap={theme.spacing.sm} wrap justify="space-between" align="center">
        <Chip label={statusText} tone={props.transcript.reviewed ? 'success' : 'neutral'} icon="transcript" />
        {hasTranslations ? <Button label={showTranslation ? L.hideTranslation : L.showTranslation} variant="ghost" size="sm" icon="translate" onPress={() => setShowTranslation((v) => !v)} /> : null}
      </Row>
      {props.transcript.translationUnavailableFor ? <StatusLine icon="info" tone="warning" text={L.translationUnavailable(names(props.transcript.translationUnavailableFor))} /> : null}
      {props.transcript.coveragePct < 95 ? (
        <ThemedText variant="caption" tone="muted">
          {Math.round(props.transcript.coveragePct)}% · {statusText}
        </ThemedText>
      ) : null}
      <Row gap={theme.spacing.xs} wrap>
        <Button label={loopA === null ? L.setLoopA : `${L.setLoopA} ✓`} variant={loopA === null ? 'ghost' : 'secondary'} size="sm" onPress={() => setLoopA(activeIdx >= 0 ? activeIdx : null)} accessibilityLabel={L.setLoopA} />
        <Button
          label={L.setLoopB}
          variant="ghost"
          size="sm"
          disabled={loopA === null || activeIdx < 0}
          onPress={() => {
            if (loopA === null || activeIdx < 0) return;
            props.onSetLoop(loopBoundsForRange(segments, loopA, activeIdx, { durationMs: props.durationMs }));
            setLoopA(null);
          }}
          accessibilityLabel={L.loopRange}
        />
        {props.loop ? <Button label={L.loopOff} variant="primary" size="sm" icon="close" onPress={() => props.onSetLoop(null)} /> : null}
      </Row>
      <ScrollView ref={scrollRef} style={{ maxHeight: 360 }} nestedScrollEnabled accessibilityRole="list" accessibilityLabel={t('audio.player.transcript')}>
        {segments.map((segment, i) => (
          <View
            key={segment.id}
            onLayout={(e) => {
              offsets.current[i] = e.nativeEvent.layout.y;
            }}
          >
            <Sentence
              segment={segment}
              active={i === activeIdx}
              positionMs={props.positionMs}
              showTranslation={showTranslation}
              saved={props.savedSegmentIds.has(segment.id)}
              looped={i === loopedIndex}
              onPress={() => props.onSeek(segment.startMs)}
              onLoop={() => toggleLoop(i)}
              onSave={() => props.onSaveExpression(segment)}
              labels={L}
              t={t}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
