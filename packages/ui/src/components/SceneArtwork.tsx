/**
 * Responsive scene artwork (16:9 by default) with an overlay slot kept inside
 * the art module's uncluttered centre band. Renders the in-code vector scene
 * when `sceneId` is given, or a remote image when a reviewed `imageUri` exists
 * (the image wins; the vector is the honest fallback, never a blank panel).
 */
import React, { useState } from 'react';
import { Image, type LayoutChangeEvent, type StyleProp, View, type ViewStyle } from 'react-native';
import { SceneArtSvg, type SceneId, findScene } from '../art';
import { useTheme } from '../theme/ThemeProvider';
import { ThemedText } from './primitives';

export interface SceneArtworkProps {
  sceneId?: SceneId;
  /** Reviewed remote/offline image (R2 / cache). Falls back to the vector scene on error. */
  imageUri?: string | null;
  /** Localized alt text; required when `imageUri` is used. */
  altText?: string;
  aspectRatio?: number;
  variant?: 'day' | 'evening';
  /** Content laid over the centre band (title, speech bubble…). */
  overlay?: React.ReactNode;
  overlayPosition?: 'center' | 'bottom' | 'top';
  /** Darken the art slightly so overlay text stays readable. */
  scrim?: boolean;
  /**
   * Back the `overlay` content with a full-strength `overlay` scrim band so text drawn
   * with `tone="onScrim"` stays AA over any art. Opt-in: overlays that carry their own
   * surface or scheme-dependent ink (a `CharacterPortrait`) must not use it.
   */
  overlayScrim?: boolean;
  radius?: 'none' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SceneArtwork(props: SceneArtworkProps): React.JSX.Element {
  const {
    sceneId,
    imageUri,
    altText,
    aspectRatio,
    variant = 'day',
    overlay,
    overlayPosition = 'center',
    scrim = false,
    overlayScrim = false,
    radius = 'lg',
    style,
    testID,
  } = props;
  const theme = useTheme();
  const ratio = aspectRatio ?? theme.illustration.sceneAspect;
  const [width, setWidth] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const scene = sceneId ? findScene(sceneId) : undefined;
  const label = altText ?? scene?.altText ?? '';
  const height =
    width > 0
      ? Math.max(theme.illustration.sceneMinHeight, width / ratio)
      : theme.illustration.sceneMinHeight;
  const useImage = Boolean(imageUri) && !imageFailed;

  const onLayout = (e: LayoutChangeEvent): void => setWidth(Math.round(e.nativeEvent.layout.width));

  return (
    <View
      onLayout={onLayout}
      accessible={!overlay}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[
        {
          width: '100%',
          height,
          overflow: 'hidden',
          borderRadius: theme.radii[radius],
          backgroundColor: theme.colors.surfaceMuted,
        },
        style,
      ]}
      testID={testID}
    >
      {width > 0 ? (
        useImage ? (
          <Image
            source={{ uri: imageUri ?? undefined }}
            accessibilityIgnoresInvertColors
            onError={() => setImageFailed(true)}
            style={{ width, height }}
            resizeMode="cover"
          />
        ) : sceneId ? (
          <SceneArtSvg
            sceneId={sceneId}
            width={width}
            height={height}
            theme={theme.artTheme}
            variant={variant}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ThemedText variant="caption" tone="muted">
              {label}
            </ThemedText>
          </View>
        )
      ) : null}
      {scrim ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            backgroundColor: theme.colors.overlay,
            opacity: 0.35,
          }}
        />
      ) : null}
      {overlay ? (
        <View
          style={{
            position: 'absolute',
            left: '12%',
            right: '12%',
            top: overlayPosition === 'top' ? theme.spacing.md : undefined,
            bottom: overlayPosition === 'bottom' ? theme.spacing.md : undefined,
            ...(overlayPosition === 'center'
              ? { top: 0, bottom: 0, justifyContent: 'center' as const }
              : {}),
            alignItems: 'center',
          }}
        >
          {overlayScrim ? (
            <View
              style={{
                backgroundColor: theme.colors.overlay,
                borderRadius: theme.radii.md,
                paddingVertical: theme.spacing.sm,
                paddingHorizontal: theme.spacing.md,
                maxWidth: '100%',
              }}
              testID={testID ? `${testID}-scrim-band` : undefined}
            >
              {overlay}
            </View>
          ) : (
            overlay
          )}
        </View>
      ) : null}
    </View>
  );
}
