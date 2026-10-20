/**
 * Melo, the chameleon mascot (M3), everywhere the learner app shows the guide.
 *
 * - Colour follows the situation: `useMascotTint(state)` blends the state hue (listening =
 *   sea teal, thinking = lavender, try_again = coral…) with the active course family from the
 *   theme (`CourseAccentScope`), so the same friend wears the local light of the course.
 * - Idle life: a reanimated breath (scale about the feet, 4 s) on the UI thread plus timed
 *   blinks (3 cheap re-renders every ~4 s). Both are off under reduced motion and when the
 *   learner hid the mascot (`theme.mascotEnabled` → only the speech line stays).
 * - Celebrations: Lottie clips from `assets/mascot/lottie` (native; static pose on web).
 * - Rive: when `ENV.mascotRive` is on and a rig is bundled (`mascot/rive-source.ts`) the Rive
 *   runtime renders the figure; otherwise the SVG, always.
 * - Honesty: nothing here reacts to audio activity; `listening` / `speaking` states are set by
 *   screens from the real speech state, never guessed.
 */
import type { MascotState } from '@langquest/contracts';
import { COURSE_FAMILY_IDS, MASCOT_ACCESSIBILITY_LABELS, MASCOT_PIVOT, MASCOT_VIEWBOX, Row, Surface, ThemedText, buildMascotDocument, courseFamilyTint, mascotSize, renderSvgDocument, useMascotTint, useTheme, type MascotVariant } from '@langquest/ui';
import React, { useEffect, useMemo, useState } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { ENV } from '@/config/env';
import { useT } from '@/lib/i18n';
import type { MeloClip } from './mascot/lottie-types';
import { MeloLottie } from './mascot/MeloLottie';
import { MeloRive } from './mascot/MeloRive';

export interface MeloProps {
  state: MascotState;
  /** Size preset (`icon` 32 · `companion` 80 · `welcome` 160 · `celebration` 280) or dp. */
  size?: MascotVariant | number;
  /** One line in the enrollment's instruction language (the screen's single helper line). */
  speech?: string;
  bubblePlacement?: 'end' | 'below';
  /** Idle breath + blink (default on; gated by reduced motion and the mascot toggle). */
  animate?: boolean;
  /** Play a Lottie clip once (celebrations) — static pose under reduced motion / on web. */
  clip?: MeloClip | null;
  onClipEnd?: () => void;
  /** Keep the speech line when the learner hid the mascot (default true). */
  bubbleWhenDisabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const BREATH_MS = 4000;
const BLINK_EVERY_MS = 4200;

/** Blink schedule: close 70 ms, hold 40 ms, open 110 ms (M3 animation notes). */
function useBlink(enabled: boolean): number {
  const [lid, setLid] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const interval = setInterval(() => {
      timers.forEach(clearTimeout);
      timers = [setTimeout(() => setLid(0.6), 0), setTimeout(() => setLid(1), 70), setTimeout(() => setLid(0.5), 110), setTimeout(() => setLid(0), 220)];
    }, BLINK_EVERY_MS);
    return () => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, [enabled]);
  return enabled ? lid : 0;
}

/** Breathing scale about the ground pivot, on the UI thread (no re-render). */
function Breathing(props: { enabled: boolean; size: number; children: React.ReactNode }): React.JSX.Element {
  const phase = useSharedValue(0);
  useEffect(() => {
    if (!props.enabled) {
      phase.value = withTiming(0, { duration: 120 });
      return;
    }
    phase.value = withRepeat(withTiming(1, { duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [props.enabled, phase]);
  // Pivot (50, 88) in viewBox units → translate to the feet, scale, translate back.
  const [px, py] = MASCOT_PIVOT.breath;
  const unit = props.size / MASCOT_VIEWBOX.width;
  const ox = (px - MASCOT_VIEWBOX.width / 2) * unit;
  const oy = (py - MASCOT_VIEWBOX.height / 2) * unit;
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: ox }, { translateY: oy }, { scaleX: 1 + phase.value * 0.02 }, { scaleY: 1 - phase.value * 0.015 }, { translateX: -ox }, { translateY: -oy }],
  }));
  return <Animated.View style={[{ width: props.size, height: props.size }, animated]}>{props.children}</Animated.View>;
}

export function Melo(props: MeloProps): React.JSX.Element | null {
  const { state, size = 'companion', speech, bubblePlacement = 'end', animate = true, clip = null, onClipEnd, bubbleWhenDisabled = true, accessibilityLabel, style, testID } = props;
  const theme = useTheme();
  const t = useT();
  const tint = useMascotTint(state);
  const px = mascotSize(theme, size);
  const label = accessibilityLabel ?? t('common.a11y.mascotImage', { state: t(`mascot.a11yState.${state}`) }) ?? MASCOT_ACCESSIBILITY_LABELS[state];
  const motion = animate && !theme.reducedMotion && theme.mascotEnabled && px >= theme.illustration.mascotCompanion;
  const lid = useBlink(motion);
  const [riveFailed, setRiveFailed] = useState(false);
  const familyIndex = useMemo(() => {
    const family = courseFamilyTint(theme.courseTrackId).family;
    return family ? COURSE_FAMILY_IDS.indexOf(family) : -1;
  }, [theme.courseTrackId]);

  const bubble = speech ? (
    <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.md} style={{ maxWidth: 280, flexShrink: 1 }} accessibilityRole="text">
      <ThemedText variant="body">{speech}</ThemedText>
    </Surface>
  ) : null;

  if (!theme.mascotEnabled) {
    if (!bubble || !bubbleWhenDisabled) return null;
    return (
      <View style={style} testID={testID}>
        {bubble}
      </View>
    );
  }

  const svg = renderSvgDocument(buildMascotDocument(state, { size: px, theme: theme.artTheme, tint, blink: lid }), label);
  let figure: React.ReactNode;
  const rive = ENV.mascotRive && !riveFailed ? <MeloRive state={state} size={px} courseFamilyIndex={familyIndex} reducedMotion={theme.reducedMotion} accessibilityLabel={label} onError={() => setRiveFailed(true)} testID={testID ? `${testID}-rive` : undefined} /> : null;
  if (clip && motion) {
    figure = <MeloLottie clip={clip} size={px} tint={tint} accessibilityLabel={label} onFinish={onClipEnd} testID={testID ? `${testID}-clip` : undefined} />;
    // Web has no Lottie renderer: `MeloLottie` renders nothing and finishes at once, so keep the pose visible.
    figure = (
      <View style={{ width: px, height: px }}>
        <View style={{ position: 'absolute' }}>{svg}</View>
        <View style={{ position: 'absolute' }}>{figure}</View>
      </View>
    );
  } else if (rive) {
    figure = rive;
  } else {
    figure = (
      <Breathing enabled={motion} size={px}>
        {svg}
      </Breathing>
    );
  }

  if (!bubble) {
    return (
      <View style={style} testID={testID}>
        {figure}
      </View>
    );
  }
  if (bubblePlacement === 'below') {
    return (
      <View style={[{ alignItems: 'center', gap: theme.spacing.sm }, style]} testID={testID}>
        {figure}
        {bubble}
      </View>
    );
  }
  return (
    <Row gap={theme.spacing.md} align="flex-end" style={style} testID={testID}>
      {figure}
      {bubble}
    </Row>
  );
}
