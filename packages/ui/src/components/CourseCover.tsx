/**
 * Course cover: the in-code 3:2 cover art for a track with the track name
 * overlaid in accessible UI text (never baked into the image, §10.2A).
 */
import { findCourseTrack } from '@langquest/contracts';
import React, { useState } from 'react';
import { Image, type LayoutChangeEvent, type StyleProp, View, type ViewStyle } from 'react-native';
import { CourseCoverSvg } from '../art';
import { useTheme } from '../theme/ThemeProvider';
import { ThemedText } from './primitives';

export interface CourseCoverProps {
  trackId: string;
  /** Localized display name; falls back to the catalog's English display name. */
  title?: string;
  /** Reviewed cover image (admin upload). Vector cover is the fallback. */
  imageUri?: string | null;
  width?: number;
  /** Hide the overlaid title (e.g. when the parent renders it). */
  hideTitle?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function CourseCover(props: CourseCoverProps): React.JSX.Element {
  const { trackId, title, imageUri, width: fixedWidth, hideTitle = false, style, testID } = props;
  const theme = useTheme();
  const [measured, setMeasured] = useState(0);
  const [failed, setFailed] = useState(false);
  const width = fixedWidth ?? measured;
  const height = width > 0 ? Math.round(width / theme.illustration.coverAspect) : 0;
  const track = findCourseTrack(trackId);
  const name = title ?? track?.displayName ?? trackId;
  const onLayout = (e: LayoutChangeEvent): void => {
    if (fixedWidth === undefined) setMeasured(Math.round(e.nativeEvent.layout.width));
  };
  return (
    <View
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[
        {
          width: fixedWidth ?? '100%',
          height: height || undefined,
          borderRadius: theme.radii.md,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceMuted,
        },
        style,
      ]}
      testID={testID}
    >
      {width > 0 ? (
        imageUri && !failed ? (
          <Image
            source={{ uri: imageUri }}
            onError={() => setFailed(true)}
            style={{ width, height }}
            resizeMode="cover"
          />
        ) : (
          <CourseCoverSvg trackId={trackId} width={width} height={height} />
        )
      ) : null}
      {!hideTitle && width > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            backgroundColor: theme.colors.overlay,
          }}
        >
          <ThemedText variant="label" style={{ color: '#FFFFFF' }} numberOfLines={2}>
            {name}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}
