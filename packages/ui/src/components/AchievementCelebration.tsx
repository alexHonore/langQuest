/**
 * Celebration overlay (§3.8, §10.2A): a static card by default with an
 * optional short reveal animation (skippable; 0 ms under reduced motion).
 * Copy is caller-provided and must describe the can-do skill or effort —
 * the component never implies fluency and separates XP (engagement) from mastery.
 */
import type { MascotState } from '@langquest/contracts';
import React, { useEffect, useRef } from 'react';
import { Animated, Modal, type StyleProp, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { CELEBRATION_LABELS, mergeLabels, type LocalizedLabels } from './labels';
import { Mascot } from './Mascot';
import { Button, Row, Surface, ThemedText } from './primitives';

export interface AchievementCelebrationProps {
  visible: boolean;
  /** e.g. "You can order a coffee" (can-do skill) or "Chapter complete". */
  title: string;
  description?: string;
  /** Engagement XP earned; shown with the "XP reflects effort" note. */
  xp?: number | null;
  /** Optional badge artwork node. */
  badge?: React.ReactNode;
  mascotState?: MascotState;
  onContinue: () => void;
  /** Skip the animation / dismiss immediately. Defaults to `onContinue`. */
  onSkip?: () => void;
  /** Optional haptic hook (only called when haptics are enabled). */
  onHaptic?: () => void;
  /** Localized overrides (`t(...)` strings; nested groups may be partial). */
  labels?: LocalizedLabels<typeof CELEBRATION_LABELS>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function AchievementCelebration(props: AchievementCelebrationProps): React.JSX.Element {
  const {
    visible,
    title,
    description,
    xp,
    badge,
    mascotState = 'celebrate',
    onContinue,
    onSkip,
    onHaptic,
    labels,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const L = mergeLabels(CELEBRATION_LABELS, labels);
  const progress = useRef(new Animated.Value(theme.reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(theme.reducedMotion ? 1 : 0);
      return;
    }
    if (theme.hapticsEnabled) onHaptic?.();
    if (theme.reducedMotion || theme.motion.celebrate === 0) {
      progress.setValue(1);
      return;
    }
    const anim = Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: true,
      friction: 6,
      tension: 60,
    });
    anim.start();
    return () => anim.stop();
  }, [visible, theme.reducedMotion, theme.motion.celebrate]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });

  return (
    <Modal
      visible={visible}
      transparent
      animationType={theme.reducedMotion ? 'none' : 'fade'}
      onRequestClose={onSkip ?? onContinue}
      testID={testID}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.overlay,
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.xxl,
        }}
      >
        <Animated.View
          style={{ transform: [{ scale }], opacity: progress, width: '100%', maxWidth: 420 }}
        >
          <Surface
            variant="elevated"
            level={4}
            radius="xl"
            padding={theme.spacing.xxl}
            style={[{ alignItems: 'center', gap: theme.spacing.md }, style]}
            accessibilityViewIsModal
          >
            {badge ?? <Mascot state={mascotState} size="welcome" animate />}
            <ThemedText
              variant="title"
              align="center"
              accessibilityRole="header"
              accessibilityLiveRegion="assertive"
            >
              {title}
            </ThemedText>
            {description ? (
              <ThemedText variant="body" tone="secondary" align="center">
                {description}
              </ThemedText>
            ) : null}
            {typeof xp === 'number' && xp > 0 ? (
              <View style={{ alignItems: 'center', gap: 2 }}>
                <ThemedText variant="heading" tone="accent">
                  {L.xp(xp)}
                </ThemedText>
                <ThemedText variant="caption" tone="muted" align="center">
                  {L.engagementNote}
                </ThemedText>
              </View>
            ) : null}
            <Row gap={theme.spacing.sm} justify="center" wrap>
              {onSkip ? <Button variant="ghost" label={L.skip} onPress={onSkip} /> : null}
              <Button label={L.continue} onPress={onContinue} size="lg" />
            </Row>
          </Surface>
        </Animated.View>
      </View>
    </Modal>
  );
}
