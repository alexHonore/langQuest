/**
 * Pronunciation feedback (§3.6, §10.2B screen 6). Renders intelligibility and
 * the qualitative feedback list for every result. A numeric score is shown
 * ONLY when `result.pronunciation.numericScore !== null` AND the assessment
 * mode is acoustic (`pronunciationDisplay` enforces this). Otherwise a clear
 * "detailed phoneme assessment not yet available for this variety" line is
 * shown. All tones are paired with text + icon (colour-blind safe).
 */
import type { ScriptId, SpeechEvaluationResult } from '@langquest/contracts';
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { INTELLIGIBILITY_LABELS, PRONUNCIATION_LABELS } from './labels';
import { pronunciationDisplay } from './logic';
import { Button, Chip, ProgressBar, Row, StatusLine, Surface, ThemedText } from './primitives';

export interface PronunciationFeedbackProps {
  result: SpeechEvaluationResult;
  /** Target phrase in its native script (for the retry segment). */
  targetScript?: ScriptId;
  onRetry?: () => void;
  onReplayReference?: () => void;
  onReplaySlow?: () => void;
  /** Called with the highlighted segment when the learner taps "try this part". */
  onRetrySegment?: (segment: { startMs: number; endMs: number; text: string }) => void;
  labels?: Partial<typeof PRONUNCIATION_LABELS>;
  intelligibilityLabels?: Partial<typeof INTELLIGIBILITY_LABELS>;
  /** Show the transcript the meaning judgement used (learner may hide it). */
  showTranscript?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PronunciationFeedback(props: PronunciationFeedbackProps): React.JSX.Element {
  const {
    result,
    targetScript,
    onRetry,
    onReplayReference,
    onReplaySlow,
    onRetrySegment,
    labels,
    intelligibilityLabels,
    showTranscript = true,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const L = { ...PRONUNCIATION_LABELS, ...labels };
  const IL = { ...INTELLIGIBILITY_LABELS, ...intelligibilityLabels };
  const d = pronunciationDisplay(result);
  const segment = result.pronunciation.highlightedSegment;

  const modeNotice =
    d.assessmentMode === 'human-calibrated-reference-comparison'
      ? L.humanCalibrated
      : d.assessmentMode === 'semantic-only'
        ? L.semanticOnly
        : d.assessmentMode === 'reference-comparison'
          ? L.listenCompare
          : null;

  return (
    <Surface
      variant="elevated"
      level={1}
      radius="lg"
      padding={theme.spacing.lg}
      style={[{ gap: theme.spacing.md }, style]}
      testID={testID}
    >
      <ThemedText variant="heading">{L.heading}</ThemedText>

      <StatusLine icon={d.icon} tone={d.tone} text={IL[d.intelligibility]} variant="subheading" />
      <StatusLine
        icon={d.meaningMatched ? 'check' : 'info'}
        tone={d.meaningMatched ? 'success' : 'warning'}
        text={d.meaningMatched ? L.meaningMatched : L.meaningMissed}
      />

      {d.showNumeric && d.numericScore !== null ? (
        <View
          accessible
          accessibilityLabel={`${L.score} ${d.numericScore} ${L.scoreOutOf}`}
          style={{ gap: theme.spacing.xs }}
        >
          <Row gap={theme.spacing.sm} align="baseline">
            <ThemedText variant="display">{Math.round(d.numericScore)}</ThemedText>
            <ThemedText variant="caption" tone="muted">
              {L.scoreOutOf}
            </ThemedText>
          </Row>
          <ProgressBar
            value={d.numericScore / 100}
            accessibilityLabel={L.score}
            tone={d.numericScore >= 70 ? 'success' : 'accent'}
          />
          <Row gap={theme.spacing.xs} wrap>
            <ThemedText variant="caption" tone="muted">
              {L.featuresAssessed}:
            </ThemedText>
            {d.featuresAssessed.map((f) => (
              <Chip key={f} label={L.features[f as keyof typeof L.features] ?? f} tone="info" />
            ))}
            <ThemedText variant="caption" tone="muted">
              · {L.confidence}: {L.confidenceValues[d.confidence]}
            </ThemedText>
          </Row>
        </View>
      ) : (
        <StatusLine
          icon="info"
          tone="info"
          text={d.detailedUnavailable ? L.detailedUnavailable : L.listenCompare}
          variant="caption"
        />
      )}
      {modeNotice && d.detailedUnavailable ? (
        <ThemedText variant="caption" tone="muted">
          {modeNotice}
        </ThemedText>
      ) : null}

      {d.feedback.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }} accessibilityRole="list">
          {d.feedback.map((line, i) => (
            <Row key={i} gap={theme.spacing.sm} align="flex-start" accessibilityRole="text">
              <ThemedText variant="body" tone="accent">
                •
              </ThemedText>
              <ThemedText variant="body" style={{ flex: 1 }}>
                {line}
              </ThemedText>
            </Row>
          ))}
        </View>
      ) : null}

      {d.scoredWords.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <ThemedText variant="label" tone="secondary">
            {L.wordScores}
          </ThemedText>
          <Row gap={theme.spacing.xs} wrap>
            {d.scoredWords.map((w, i) => {
              const tone = w.accuracy >= 80 ? 'success' : w.accuracy >= 60 ? 'warning' : 'error';
              const err =
                w.errorType && w.errorType !== 'none'
                  ? ` – ${L.errorTypes[w.errorType as keyof typeof L.errorTypes] ?? w.errorType}`
                  : '';
              return (
                <Chip
                  key={`${w.word}-${i}`}
                  label={`${w.word} ${Math.round(w.accuracy)}${err}`}
                  tone={tone}
                />
              );
            })}
          </Row>
        </View>
      ) : null}

      {segment ? (
        <Surface variant="accentSoft" radius="md" padding={theme.spacing.md}>
          <ThemedText variant="caption" tone="accent">
            {L.retrySegment}
          </ThemedText>
          <ThemedText variant="phrase" script={targetScript}>
            {segment.text}
          </ThemedText>
          {onRetrySegment ? (
            <Button
              variant="secondary"
              size="sm"
              icon="mic"
              label={L.retrySegment}
              onPress={() => onRetrySegment(segment)}
            />
          ) : null}
        </Surface>
      ) : null}

      {showTranscript && result.transcript ? (
        <ThemedText variant="caption" tone="muted">
          “{result.transcript}”
        </ThemedText>
      ) : null}

      <Row gap={theme.spacing.sm} wrap>
        {onRetry ? (
          <Button variant="primary" icon="mic" label={L.tryAgain} onPress={onRetry} />
        ) : null}
        {onReplayReference ? (
          <Button
            variant="secondary"
            icon="replay"
            label={L.replayReference}
            onPress={onReplayReference}
          />
        ) : null}
        {onReplaySlow ? (
          <Button variant="secondary" icon="slow" label={L.replaySlow} onPress={onReplaySlow} />
        ) : null}
      </Row>
    </Surface>
  );
}
