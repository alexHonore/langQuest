/**
 * Mission card (§10.2B screens 2 & 3): objective, skills, duration, focus and
 * status. Status is shown with text + icon, never colour alone, and no
 * geography is claimed — the scene is an illustration, not a map pin.
 */
import type { MissionType } from '@langquest/contracts';
import React from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';
import type { IconName, SceneId } from '../art';
import { useTheme } from '../theme/ThemeProvider';
import { MISSION_LABELS, type MissionFocus, mergeLabels, type LocalizedLabels } from './labels';
import type { StoryNodeStatus } from './logic';
import { Chip, InlineIcon, Row, Surface, ThemedText } from './primitives';
import { SceneArtwork } from './SceneArtwork';

export type { MissionFocus } from './labels';

export interface MissionCardSkill {
  key: string;
  /** Localized label. */
  label: string;
  completed: boolean;
}

export interface MissionCardProps {
  title: string;
  /** "You will be able to …" line in the enrollment's source language. */
  objective: string;
  minutes: number;
  focus: MissionFocus;
  status: StoryNodeStatus;
  type?: MissionType;
  skills?: readonly MissionCardSkill[];
  sceneId?: SceneId;
  sceneImageUri?: string | null;
  sceneAltText?: string;
  /** Unlocked narrative consequence (optional, localized). */
  consequence?: string | null;
  /** Large hero layout (home screen CTA) vs compact list row. */
  layout?: 'hero' | 'compact';
  onPress?: () => void;
  /** Localized overrides (`t(...)` strings; nested groups may be partial). */
  labels?: LocalizedLabels<typeof MISSION_LABELS>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const STATUS_ICON: Record<StoryNodeStatus, IconName> = {
  locked: 'info',
  available: 'play',
  in_progress: 'replay',
  completed: 'check',
};

const FOCUS_ICON: Record<MissionFocus, IconName> = {
  pronunciation: 'mic',
  listening: 'headphones',
  conversation: 'characters',
  tone: 'audio',
};

export function MissionCard(props: MissionCardProps): React.JSX.Element {
  const {
    title,
    objective,
    minutes,
    focus,
    status,
    skills = [],
    sceneId,
    sceneImageUri,
    sceneAltText,
    consequence,
    layout = 'hero',
    onPress,
    labels,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const L = mergeLabels(MISSION_LABELS, labels);
  const statusLabel = L.status[status];
  const cta = status === 'completed' ? L.replay : status === 'in_progress' ? L.continue : L.start;
  const statusTone =
    status === 'completed'
      ? 'success'
      : status === 'in_progress'
        ? 'info'
        : status === 'locked'
          ? 'neutral'
          : 'accent';
  const disabled = status === 'locked';
  const a11y = `${title}. ${objective}. ${L.minutes(minutes)}. ${L.focus[focus]}. ${statusLabel}`;

  const body = (
    <Surface
      variant="elevated"
      level={layout === 'hero' ? 2 : 1}
      radius="lg"
      style={{ overflow: 'hidden', opacity: disabled ? 0.7 : 1 }}
    >
      {layout === 'hero' && (sceneId || sceneImageUri) ? (
        <SceneArtwork
          sceneId={sceneId}
          imageUri={sceneImageUri}
          altText={sceneAltText}
          radius="none"
          variant="day"
        />
      ) : null}
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
        <Row gap={theme.spacing.sm} justify="space-between" align="flex-start">
          <ThemedText
            variant={layout === 'hero' ? 'heading' : 'subheading'}
            style={{ flex: 1 }}
            numberOfLines={2}
          >
            {title}
          </ThemedText>
          <Chip label={statusLabel} tone={statusTone} icon={STATUS_ICON[status]} />
        </Row>
        <ThemedText variant="body" tone="secondary" numberOfLines={layout === 'hero' ? 3 : 2}>
          {L.objective} {objective}
        </ThemedText>
        <Row gap={theme.spacing.md} wrap>
          <Row gap={theme.spacing.xs}>
            <InlineIcon name="progress" tone="muted" size={theme.iconSizes.xs} />
            <ThemedText variant="caption" tone="muted">
              {L.minutes(minutes)}
            </ThemedText>
          </Row>
          <Row gap={theme.spacing.xs}>
            <InlineIcon name={FOCUS_ICON[focus]} tone="muted" size={theme.iconSizes.xs} />
            <ThemedText variant="caption" tone="muted">
              {L.focus[focus]}
            </ThemedText>
          </Row>
        </Row>
        {skills.length > 0 ? (
          <Row
            gap={theme.spacing.xs}
            wrap
            accessibilityLabel={`${L.skillsLabel}: ${skills.map((s) => s.label).join(', ')}`}
          >
            {skills.map((s) => (
              <Chip
                key={s.key}
                label={s.label}
                tone={s.completed ? 'success' : 'neutral'}
                icon={s.completed ? 'check' : undefined}
              />
            ))}
          </Row>
        ) : null}
        {consequence ? (
          <ThemedText variant="caption" tone="info">
            {consequence}
          </ThemedText>
        ) : null}
        {onPress && !disabled ? (
          <Row gap={theme.spacing.xs} justify="flex-end">
            <ThemedText variant="label" tone="accent">
              {cta}
            </ThemedText>
            <InlineIcon name="chevronRight" tone="accent" />
          </Row>
        ) : null}
      </View>
    </Surface>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={a11y} style={style} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={disabled ? undefined : cta}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }, style]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}
