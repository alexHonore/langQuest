/**
 * Background lanterns (U2 "Night Market"): three large, soft colour blobs
 * behind the canvas whose colours follow the course and the lesson
 * (`theme.lanterns.colors`). They drift slowly (22–31 s, alternate) unless
 * reduced motion / the low-end tier disables it; they are decorative, hidden
 * from assistive tech and never carry meaning. On the solid tier there is no
 * blur, so the blobs are drawn larger and fainter.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Platform, type StyleProp, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface LanternsProps {
  /** Override the theme's lantern colours (lead first). */
  colors?: readonly [string, string, string];
  /** Override the opacity (0..1). */
  opacity?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface BlobSpec {
  size: number;
  position: ViewStyle;
}

const BLOBS: readonly BlobSpec[] = [
  { size: 300, position: { left: -110, top: -80 } },
  { size: 260, position: { right: -120, top: 220 } },
  { size: 280, position: { left: 40, bottom: -120 } },
];

function Blob(props: {
  color: string;
  spec: BlobSpec;
  driftMs: number;
  opacity: number;
  blur: number;
}): React.JSX.Element {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (props.driftMs <= 0) {
      drift.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: props.driftMs, useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: props.driftMs, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift, props.driftMs]);
  // The glow is a real blur filter only where one is reliable (CSS `filter: blur()` on web; iOS has no blur
  // filter and Android needs API 31+). Elsewhere, and on the solid tier, the blob is enlarged and softened by
  // opacity alone so the lantern still reads as a glow rather than a flat disc.
  const blurred = props.blur > 0 && Platform.OS === 'web';
  const scale = blurred ? 1 : 1.35;
  const size = props.spec.size * scale;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        ...props.spec.position,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: props.color,
        opacity: props.opacity * (blurred ? 1 : 0.6),
        ...(blurred ? { filter: `blur(${props.blur}px)` } : null),
        transform: [
          { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) },
          { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) },
        ],
      }}
    />
  );
}

export function Lanterns(props: LanternsProps): React.JSX.Element | null {
  const theme = useTheme();
  const colors = props.colors ?? theme.lanterns.colors;
  const opacity = props.opacity ?? theme.lanterns.opacity;
  const drift = theme.lanterns.driftMs;
  const blobs = useMemo(
    () => BLOBS.map((spec, i) => ({ spec, color: colors[i] ?? colors[0], driftMs: drift[i] ?? 0 })),
    [colors, drift],
  );
  if (opacity <= 0) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
        props.style,
      ]}
      testID={props.testID}
    >
      {blobs.map((b, i) => (
        <Blob
          key={i}
          color={b.color}
          spec={b.spec}
          driftMs={b.driftMs}
          opacity={opacity}
          blur={theme.lanterns.blur}
        />
      ))}
    </View>
  );
}
