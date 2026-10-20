/**
 * Primary microphone control (§10.2B screens 4–6, §10.3 motor accessibility).
 * Two interaction modes: press-and-hold, and tap-to-toggle. The button only
 * reports intent (`onStart` / `onStop` / `onCancel`); audio capture lives in
 * the app. The `processing` and `disabled` states are driven by the caller so
 * the visual state is always what is actually happening.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, type StyleProp, View, type ViewStyle } from 'react-native';
import { ICONS } from '../art';
import type { Density } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import { SPEAK_BUTTON_LABELS, mergeLabels, type LocalizedLabels } from './labels';
import { type SpeakButtonMode, type SpeakButtonState, nextSpeakState } from './logic';
import { Button, ThemedText } from './primitives';

export type HapticKind = 'start' | 'stop' | 'error';

export interface SpeakButtonProps {
  mode?: SpeakButtonMode;
  /** Externally driven state (e.g. `processing` while the evaluation runs, `disabled` without permission). */
  state?: Exclude<SpeakButtonState, 'recording'> | 'recording';
  onStart: () => void;
  onStop: () => void;
  onCancel?: () => void;
  /** Called when the learner switches between hold and tap modes. */
  onModeChange?: (mode: SpeakButtonMode) => void;
  /** Optional haptic hook; only called when the theme has haptics enabled. */
  onHaptic?: (kind: HapticKind) => void;
  size?: 'default' | 'compact';
  /** Show the mode-switch text button under the mic (default: only in `full` density). */
  showModeSwitch?: boolean;
  density?: Density;
  /** Glow (elevation 3) around the mic — it is THE primary action of speaking screens. */
  glow?: boolean;
  /** Elapsed recording time text (caller owns the clock; no limit is implied). */
  elapsedText?: string | null;
  /** Localized overrides (`t(...)` strings; nested groups may be partial). */
  labels?: LocalizedLabels<typeof SPEAK_BUTTON_LABELS>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SpeakButton(props: SpeakButtonProps): React.JSX.Element {
  const {
    mode: modeProp,
    state: externalState,
    onStart,
    onStop,
    onCancel,
    onModeChange,
    onHaptic,
    size = 'default',
    showModeSwitch: showModeSwitchProp,
    elapsedText,
    density,
    glow = true,
    labels,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const calm = (density ?? theme.density) === 'calm';
  const showModeSwitch = showModeSwitchProp ?? !calm;
  const L = mergeLabels(SPEAK_BUTTON_LABELS, labels);
  const [internalMode, setInternalMode] = useState<SpeakButtonMode>('hold');
  const mode = modeProp ?? internalMode;
  const [internalState, setInternalState] = useState<SpeakButtonState>('idle');
  const state: SpeakButtonState = externalState ?? internalState;
  const lastState = useRef(state);

  // Keep the internal machine in sync when the caller drives the state.
  useEffect(() => {
    if (externalState !== undefined) setInternalState(externalState);
  }, [externalState]);

  const haptic = useCallback(
    (kind: HapticKind) => {
      if (theme.hapticsEnabled) onHaptic?.(kind);
    },
    [onHaptic, theme.hapticsEnabled],
  );

  const transition = useCallback(
    (event: Parameters<typeof nextSpeakState>[1]) => {
      const next = nextSpeakState(state, event, mode);
      if (next === state) return;
      setInternalState(next);
      if (next === 'recording') {
        haptic('start');
        onStart();
      } else if (state === 'recording' && next === 'processing') {
        haptic('stop');
        onStop();
      } else if (state === 'recording' && next === 'idle') {
        onCancel?.();
      }
    },
    [state, mode, haptic, onStart, onStop, onCancel],
  );

  // Breathing glow ring while recording (U2 dur-glow 1600 ms; static under reduced motion).
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'recording' || !theme.motion.glowAnimated) {
      ring.setValue(state === 'recording' ? 1 : 0);
      return;
    }
    const half = theme.motion.glowPulse / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1, duration: half, useNativeDriver: true }),
        Animated.timing(ring, { toValue: 0.4, duration: half, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, theme.motion.glowAnimated, theme.motion.glowPulse, ring]);
  lastState.current = state;

  // Press spring (U2: damping 14 · stiffness 180 · mass 1, scale .94 → 1).
  const pressScale = useRef(new Animated.Value(1)).current;
  const springTo = useCallback(
    (to: number) => {
      if (theme.reducedMotion) {
        pressScale.setValue(to);
        return;
      }
      Animated.spring(pressScale, {
        toValue: to,
        ...theme.motion.springs.press,
        useNativeDriver: true,
      }).start();
    },
    [pressScale, theme.reducedMotion, theme.motion.springs.press],
  );

  const diameter = size === 'compact' ? theme.touchTargets.speakCompact : theme.touchTargets.speak;
  const c = theme.colors;
  // Mic open = cyan (speech.listening); idle = the course's primary accent; processing = thinking.
  const bg =
    state === 'recording'
      ? c.cyan
      : state === 'processing'
        ? c.speech.thinking
        : state === 'disabled'
          ? c.surfaceMuted
          : theme.accents.primary;
  const fg =
    state === 'disabled' ? c.textMuted : state === 'recording' ? c.onCyan : theme.accents.onPrimary;
  const glowColor = state === 'recording' ? c.speech.listening : theme.accents.ring;
  const glowStyleObj = glow && state !== 'disabled' ? theme.glow(glowColor) : null;
  const MicIcon = state === 'disabled' ? ICONS.micOff : ICONS.mic;
  const StopIcon = ICONS.pause;

  const label =
    state === 'disabled'
      ? L.disabled
      : state === 'processing'
        ? L.processing
        : state === 'recording'
          ? mode === 'hold'
            ? L.release
            : L.tapToStop
          : mode === 'hold'
            ? L.holdToSpeak
            : L.tapToSpeak;

  const handlers =
    mode === 'hold'
      ? {
          onPressIn: () => {
            springTo(0.94);
            transition('pressIn');
          },
          onPressOut: () => {
            springTo(1);
            transition('pressOut');
          },
        }
      : {
          onPressIn: () => springTo(0.94),
          onPressOut: () => springTo(1),
          onPress: () => transition('tap'),
        };

  return (
    <View style={[{ alignItems: 'center', gap: theme.spacing.sm }, style]} testID={testID}>
      <View
        style={{
          width: diameter + 24,
          height: diameter + 24,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: diameter + 24,
            height: diameter + 24,
            borderRadius: (diameter + 24) / 2,
            backgroundColor: c.speech.listening,
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] }),
            transform: [
              { scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
            ],
          }}
        />
        <Animated.View
          pointerEvents="box-none"
          style={{
            transform: [{ scale: pressScale }],
            borderRadius: diameter / 2,
            ...(glowStyleObj
              ? {
                  shadowColor: glowStyleObj.shadowColor,
                  shadowOffset: glowStyleObj.shadowOffset,
                  shadowOpacity: glowStyleObj.shadowOpacity,
                  shadowRadius: glowStyleObj.shadowRadius,
                  elevation: glowStyleObj.elevation,
                }
              : null),
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={mode === 'hold' ? L.holdToSpeak : undefined}
            accessibilityState={{
              disabled: state === 'disabled',
              busy: state === 'processing',
              selected: state === 'recording',
            }}
            disabled={state === 'disabled' || state === 'processing'}
            {...handlers}
            style={({ pressed }) => ({
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              backgroundColor: bg,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: theme.highContrast ? 3 : glowStyleObj ? glowStyleObj.ringWidth : 0,
              borderColor: theme.highContrast
                ? c.border
                : glowStyleObj
                  ? glowStyleObj.ringColor
                  : 'transparent',
              opacity: pressed && state !== 'disabled' ? 0.96 : 1,
            })}
          >
            {state === 'recording' && mode === 'toggle' ? (
              <StopIcon size={diameter * 0.42} color={fg} />
            ) : (
              <MicIcon size={diameter * 0.42} color={fg} />
            )}
          </Pressable>
        </Animated.View>
      </View>
      <ThemedText
        variant="label"
        tone={state === 'disabled' ? 'muted' : 'secondary'}
        align="center"
        accessibilityLiveRegion="polite"
      >
        {state === 'recording' && elapsedText ? `${L.recording} · ${elapsedText}` : label}
      </ThemedText>
      {showModeSwitch && state !== 'recording' && state !== 'processing' ? (
        <Button
          variant="ghost"
          size="sm"
          label={mode === 'hold' ? L.switchToTap : L.switchToHold}
          onPress={() => {
            const next: SpeakButtonMode = mode === 'hold' ? 'toggle' : 'hold';
            setInternalMode(next);
            onModeChange?.(next);
          }}
        />
      ) : null}
    </View>
  );
}
