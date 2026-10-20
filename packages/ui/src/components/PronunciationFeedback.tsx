/**
 * Pronunciation feedback (§3.6, §10.2B screen 6). Renders intelligibility and
 * the qualitative feedback list for every result. A numeric score is shown
 * ONLY when `result.pronunciation.numericScore !== null` AND the assessment
 * mode is acoustic (`pronunciationDisplay` enforces this). Otherwise only the
 * assessment-mode line is shown (what WAS compared), never a "not available"
 * line (CONVENTIONS §8). All tones are paired with text + icon (colour-blind safe).
 *
 * Calm density (default): ONE line (intelligibility) + the primary action;
 * meaning, mode, feedback notes, word scores, the retry segment and the
 * transcript live in an optional detail sheet (ⓘ). Full density: inline.
 */
import type { ScriptId, SpeechEvaluationResult } from '@langquest/contracts';
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import type { Density } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import { InfoAffordance } from './InfoAffordance';
import {
  CALM_LABELS,
  INTELLIGIBILITY_LABELS,
  PRONUNCIATION_LABELS,
  mergeLabels,
  type LocalizedLabels,
} from './labels';
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
  /** Localized overrides (`t(...)` strings; nested groups may be partial). */
  labels?: LocalizedLabels<typeof PRONUNCIATION_LABELS>;
  intelligibilityLabels?: Partial<typeof INTELLIGIBILITY_LABELS>;
  /** Localized "Details" for the calm info button. */
  calmLabels?: LocalizedLabels<typeof CALM_LABELS>;
  /** Show the transcript the meaning judgement used (learner may hide it). */
  showTranscript?: boolean;
  density?: Density;
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
    calmLabels,
    showTranscript = true,
    density,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const L = mergeLabels(PRONUNCIATION_LABELS, labels);
  const C = mergeLabels(CALM_LABELS, calmLabels);
  const IL = { ...INTELLIGIBILITY_LABELS, ...intelligibilityLabels };
  const d = pronunciationDisplay(result);
  const calm = (density ?? theme.density) === 'calm';
  const segment = result.pronunciation.highlightedSegment;

  const modeNotice =
    d.assessmentMode === 'human-calibrated-reference-comparison'
      ? L.humanCalibrated
      : d.assessmentMode === 'semantic-only'
        ? L.semanticOnly
        : d.assessmentMode === 'reference-comparison'
          ? L.listenCompare
          : null;

  const meaningLine = (
    <StatusLine
      icon={d.meaningMatched ? 'check' : 'info'}
      tone={d.meaningMatched ? 'success' : 'warning'}
      text={d.meaningMatched ? L.meaningMatched : L.meaningMissed}
    />
  );

  const score =
    d.showNumeric && d.numericScore !== null ? (
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
      <StatusLine icon="info" tone="info" text={modeNotice ?? L.listenCompare} variant="caption" />
    );

  const notes =
    d.feedback.length > 0 ? (
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
    ) : null;

  const words =
    d.scoredWords.length > 0 ? (
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
    ) : null;

  const retrySegment = segment ? (
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
  ) : null;

  const transcript =
    showTranscript && result.transcript ? (
      <ThemedText variant="caption" tone="muted">
        “{result.transcript}”
      </ThemedText>
    ) : null;

  const actions = (
    <Row gap={theme.spacing.sm} wrap>
      {onRetry ? (
        <Button variant="primary" icon="mic" label={L.tryAgain} onPress={onRetry} glow />
      ) : null}
      {!calm && onReplayReference ? (
        <Button
          variant="secondary"
          icon="replay"
          label={L.replayReference}
          onPress={onReplayReference}
        />
      ) : null}
      {!calm && onReplaySlow ? (
        <Button variant="secondary" icon="slow" label={L.replaySlow} onPress={onReplaySlow} />
      ) : null}
    </Row>
  );

  if (calm) {
    const hasDetail = Boolean(
      notes || words || retrySegment || transcript || modeNotice || d.showNumeric,
    );
    return (
      <Surface
        variant="glass"
        level={1}
        radius="lg"
        padding={theme.spacing.lg}
        style={[{ gap: theme.spacing.md }, style]}
        testID={testID}
      >
        <Row gap={theme.spacing.sm} justify="space-between" align="flex-start">
          <View style={{ flex: 1 }}>
            <StatusLine
              icon={d.icon}
              tone={d.tone}
              text={IL[d.intelligibility]}
              variant="subheading"
            />
          </View>
          {hasDetail ? (
            <InfoAffordance
              label={C.details}
              title={L.heading}
              testID={testID ? `${testID}-details` : undefined}
            >
              <View style={{ gap: theme.spacing.md }}>
                {meaningLine}
                {score}
                {notes}
                {words}
                {retrySegment}
                {transcript}
                <Row gap={theme.spacing.sm} wrap>
                  {onReplayReference ? (
                    <Button
                      variant="secondary"
                      icon="replay"
                      label={L.replayReference}
                      onPress={onReplayReference}
                    />
                  ) : null}
                  {onReplaySlow ? (
                    <Button
                      variant="secondary"
                      icon="slow"
                      label={L.replaySlow}
                      onPress={onReplaySlow}
                    />
                  ) : null}
                </Row>
              </View>
            </InfoAffordance>
          ) : null}
        </Row>
        {d.showNumeric && d.numericScore !== null ? (
          <ThemedText
            variant="display"
            accessibilityLabel={`${L.score} ${d.numericScore} ${L.scoreOutOf}`}
          >
            {Math.round(d.numericScore)}
          </ThemedText>
        ) : null}
        {actions}
      </Surface>
    );
  }

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
      {meaningLine}
      {score}
      {notes}
      {words}
      {retrySegment}
      {transcript}
      {actions}
    </Surface>
  );
}
