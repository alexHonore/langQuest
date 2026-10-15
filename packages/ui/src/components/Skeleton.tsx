/**
 * Loading skeletons (§10.2 responsive loading). A gentle opacity pulse that is
 * disabled under reduced motion; hidden from screen readers (the parent
 * announces loading via `accessibilityState.busy`).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface SkeletonProps {
  shape?: 'line' | 'box' | 'circle';
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Skeleton(props: SkeletonProps): React.JSX.Element {
  const { shape = 'line', width = '100%', height, radius, style, testID } = props;
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (theme.reducedMotion) {
      opacity.setValue(0.8);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: theme.motion.slow * 2,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: theme.motion.slow * 2,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, theme.reducedMotion, theme.motion.slow]);

  const h = height ?? (shape === 'line' ? 14 : shape === 'circle' ? 48 : 96);
  const w = shape === 'circle' ? h : width;
  const r = radius ?? (shape === 'circle' ? h / 2 : shape === 'line' ? h / 2 : theme.radii.md);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: w,
          height: h,
          borderRadius: r,
          backgroundColor: theme.colors.surfaceMuted,
          opacity,
        },
        style,
      ]}
      testID={testID}
    />
  );
}

/** Common composition: a card skeleton (cover + two lines). */
export function CardSkeleton(props: { style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={[{ gap: theme.spacing.sm }, props.style]}>
      <Skeleton shape="box" height={140} />
      <Skeleton width="70%" />
      <Skeleton width="45%" />
    </View>
  );
}
