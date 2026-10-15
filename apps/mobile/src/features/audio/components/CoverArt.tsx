/**
 * Cover artwork for collections, chapters and lessons: a reviewed image when
 * the catalog provides one, else the course's vector cover, else a neutral
 * headphones tile. Never a generated image presented as licensed art.
 */
import { CourseCover, InlineIcon, useTheme } from '@langquest/ui';
import React, { useState } from 'react';
import { Image, View } from 'react-native';

export interface CoverArtProps {
  imageUri: string | null | undefined;
  courseTrackId: string | null | undefined;
  title: string;
  size: number;
  /** Square tile (lessons / mini player) instead of the 3:2 course cover. */
  square?: boolean;
}

export function CoverArt(props: CoverArtProps): React.JSX.Element {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const height = props.square ? props.size : Math.round(props.size / theme.illustration.coverAspect);
  if (props.imageUri && !failed) {
    return <Image source={{ uri: props.imageUri }} onError={() => setFailed(true)} accessibilityRole="image" accessibilityLabel={props.title} style={{ width: props.size, height, borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceMuted }} />;
  }
  if (props.courseTrackId && !props.square) return <CourseCover trackId={props.courseTrackId} title={props.title} width={props.size} hideTitle />;
  return (
    <View accessibilityRole="image" accessibilityLabel={props.title} style={{ width: props.size, height, borderRadius: theme.radii.md, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <InlineIcon name="headphones" tone="accent" size={Math.max(16, Math.round(props.size * 0.4))} />
    </View>
  );
}
