/**
 * App shell: safe-area padding, the mandatory course header (active track +
 * its source language with an edit affordance, conventions §6) and an
 * optional bottom slot for the tab bar. Insets are passed in by the app
 * (from react-native-safe-area-context or the web) so this package has no
 * native dependency.
 */
import { findCourseTrack } from '@langquest/contracts';
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { SHELL_LABELS, mergeLabels, type LocalizedLabels } from './labels';
import { languageName } from './logic';
import { Chip, IconButton, Row, ThemedText } from './primitives';

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface CourseHeaderInfo {
  courseTrackId: string;
  /** Localized track title; falls back to the catalog English display name. */
  trackTitle?: string;
  sourceLanguageCode: string;
  /** Localized source language name; falls back to the English catalog name. */
  sourceLanguageName?: string;
  /** Regional option label (e.g. "Lebanese"), optional. */
  regionalLabel?: string | null;
}

export interface AppShellProps {
  course?: CourseHeaderInfo | null;
  /** Opens the per-enrollment course / source-language editor. */
  onEditCourse?: () => void;
  /** Screen title shown under the course line (optional). */
  title?: string;
  onBack?: () => void;
  /** Right-side header slot (profile avatar, settings…). */
  headerEnd?: React.ReactNode;
  /** Shown as a chip when the device is offline (honest state). */
  offline?: boolean;
  insets?: Partial<SafeAreaInsets>;
  /** Tab bar or sticky action area. */
  footer?: React.ReactNode;
  /** Remove the horizontal gutter for full-bleed screens. */
  fullBleed?: boolean;
  /** Localized overrides (`t(...)` strings; nested groups may be partial). */
  labels?: LocalizedLabels<typeof SHELL_LABELS>;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function AppShell(props: AppShellProps): React.JSX.Element {
  const {
    course,
    onEditCourse,
    title,
    onBack,
    headerEnd,
    offline = false,
    insets,
    footer,
    fullBleed = false,
    labels,
    children,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const L = mergeLabels(SHELL_LABELS, labels);
  const pad = {
    top: insets?.top ?? 0,
    bottom: insets?.bottom ?? 0,
    left: insets?.left ?? 0,
    right: insets?.right ?? 0,
  };
  const trackName = course
    ? (course.trackTitle ??
      findCourseTrack(course.courseTrackId)?.displayName ??
      course.courseTrackId)
    : null;
  const sourceName = course
    ? (course.sourceLanguageName ??
      languageName(course.sourceLanguageCode as Parameters<typeof languageName>[0]))
    : null;
  const courseLine = trackName && sourceName ? L.learning(trackName, sourceName) : null;

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: theme.colors.background,
          paddingTop: pad.top,
          paddingLeft: pad.left,
          paddingRight: pad.right,
        },
        style,
      ]}
      testID={testID}
    >
      <View
        accessibilityRole="header"
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.xs,
          borderBottomWidth: theme.highContrast ? 1 : 0,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Row gap={theme.spacing.sm} justify="space-between">
          <Row gap={theme.spacing.sm} style={{ flex: 1 }}>
            {onBack ? (
              <IconButton
                icon="chevronLeft"
                accessibilityLabel={L.back}
                onPress={onBack}
                mirrorRtl
              />
            ) : null}
            {courseLine ? (
              <View style={{ flex: 1 }}>
                <Row gap={theme.spacing.xs}>
                  <ThemedText variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {courseLine}
                  </ThemedText>
                  {course?.regionalLabel ? (
                    <Chip label={course.regionalLabel} tone="neutral" />
                  ) : null}
                </Row>
              </View>
            ) : (
              <View style={{ flex: 1 }} />
            )}
          </Row>
          <Row gap={theme.spacing.xs}>
            {offline ? <Chip label={L.offline} tone="warning" icon="offline" /> : null}
            {course && onEditCourse ? (
              <IconButton
                icon="edit"
                accessibilityLabel={L.editCourse}
                onPress={onEditCourse}
                tone="accent"
              />
            ) : null}
            {headerEnd}
          </Row>
        </Row>
        {title ? (
          <ThemedText variant="title" accessibilityRole="header">
            {title}
          </ThemedText>
        ) : null}
      </View>
      <View style={{ flex: 1, paddingHorizontal: fullBleed ? 0 : theme.spacing.lg }}>
        {children}
      </View>
      {footer ? (
        <View style={{ paddingBottom: pad.bottom, backgroundColor: theme.colors.surface }}>
          {footer}
        </View>
      ) : (
        <View style={{ height: pad.bottom }} />
      )}
    </View>
  );
}
