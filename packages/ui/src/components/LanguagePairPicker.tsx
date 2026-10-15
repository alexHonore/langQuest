/**
 * Language pair picker (§10.2B screen 1): source / instruction language first
 * (English and French prominent), then the 30-track grid with a native-script
 * sample and dialect clarification, and a "Learn X from Y" confirmation.
 * The selection is per enrollment; the profile default is only a prefill.
 */
import {
  type CourseTrackId,
  type CoverageStatus,
  type SourceLanguageCode,
  getCourseTrack,
  isCourseTrackId,
} from '@langquest/contracts';
import React, { useMemo, useState } from 'react';
import { Pressable, type StyleProp, TextInput, View, type ViewStyle } from 'react-native';
import { CourseCoverSvg } from '../art';
import { useTheme } from '../theme/ThemeProvider';
import { CoverageBadge } from './CoverageBadge';
import { PICKER_LABELS, mergeLabels, type LocalizedLabels } from './labels';
import {
  NATIVE_SAMPLES,
  ORDERED_TRACKS,
  dialectClarification,
  orderedSourceLanguages,
} from './logic';
import { Button, Chip, Row, Surface, ThemedText } from './primitives';

export interface LanguagePairSelection {
  courseTrackId: CourseTrackId;
  sourceLanguageCode: SourceLanguageCode;
}

export interface LanguagePairPickerProps {
  /** Prefill from the profile default; never written back to other enrollments. */
  initialSourceLanguageCode?: SourceLanguageCode;
  initialCourseTrackId?: CourseTrackId;
  /** Editorial coverage per track → per source, to show honest availability. */
  coverage?: Partial<Record<CourseTrackId, Partial<Record<SourceLanguageCode, CoverageStatus>>>>;
  /** Localized names; defaults to catalog English names. */
  languageNames?: Partial<Record<SourceLanguageCode, string>>;
  trackTitles?: Partial<Record<CourseTrackId, string>>;
  /** Tracks to hide (e.g. a track identical to the source language). */
  excludeTrackIds?: readonly CourseTrackId[];
  onConfirm: (selection: LanguagePairSelection) => void;
  onSelectionChange?: (selection: Partial<LanguagePairSelection>) => void;
  /** Localized overrides (`t(...)` strings; nested groups may be partial). */
  labels?: LocalizedLabels<typeof PICKER_LABELS>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function LanguagePairPicker(props: LanguagePairPickerProps): React.JSX.Element {
  const {
    initialSourceLanguageCode,
    initialCourseTrackId,
    coverage,
    languageNames,
    trackTitles,
    excludeTrackIds = [],
    onConfirm,
    onSelectionChange,
    labels,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const L = mergeLabels(PICKER_LABELS, labels);
  const [source, setSource] = useState<SourceLanguageCode | undefined>(initialSourceLanguageCode);
  const [track, setTrack] = useState<CourseTrackId | undefined>(initialCourseTrackId);
  const [query, setQuery] = useState('');
  const sources = useMemo(() => orderedSourceLanguages(), []);
  const langName = (code: SourceLanguageCode): string =>
    languageNames?.[code] ?? sources.find((s) => s.code === code)?.englishName ?? code;
  const trackName = (id: CourseTrackId): string =>
    trackTitles?.[id] ?? getCourseTrack(id).displayName;

  const tracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ORDERED_TRACKS.filter((t) => !excludeTrackIds.includes(t.id)).filter((t) => {
      if (!q) return true;
      const sample = NATIVE_SAMPLES[t.id];
      return [
        trackName(t.id),
        t.displayName,
        t.targetVarietyId,
        sample.native,
        sample.latin ?? '',
      ].some((s) => s.toLowerCase().includes(q));
    });
  }, [query, excludeTrackIds, trackTitles]);

  const pickSource = (code: SourceLanguageCode): void => {
    setSource(code);
    onSelectionChange?.({ sourceLanguageCode: code, courseTrackId: track });
  };
  const pickTrack = (id: CourseTrackId): void => {
    setTrack(id);
    onSelectionChange?.({ sourceLanguageCode: source, courseTrackId: id });
  };

  const canConfirm = Boolean(source && track && isCourseTrackId(track));

  return (
    <View style={[{ gap: theme.spacing.lg }, style]} testID={testID}>
      <View style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="heading" accessibilityRole="header">
          {L.sourceTitle}
        </ThemedText>
        <Row gap={theme.spacing.sm} wrap accessibilityRole="radiogroup">
          {sources.map((s) => {
            const selected = s.code === source;
            const label = `${langName(s.code)}${s.nativeName && s.nativeName !== langName(s.code) ? ` · ${s.nativeName}` : ''}`;
            return (
              <Pressable
                key={s.code}
                accessibilityRole="radio"
                accessibilityState={{ selected, checked: selected }}
                accessibilityLabel={label}
                onPress={() => pickSource(s.code)}
                style={({ pressed }) => ({
                  minHeight: s.prominent ? theme.touchTargets.comfortable : theme.touchTargets.min,
                  paddingHorizontal: s.prominent ? theme.spacing.xl : theme.spacing.md,
                  justifyContent: 'center',
                  borderRadius: theme.radii.pill,
                  borderWidth: 1.5,
                  borderColor: selected ? theme.colors.accent : theme.colors.borderStrong,
                  backgroundColor: selected
                    ? theme.colors.accent
                    : pressed
                      ? theme.colors.surfaceMuted
                      : theme.colors.surface,
                })}
              >
                <ThemedText
                  variant={s.prominent ? 'subheading' : 'label'}
                  style={{ color: selected ? theme.colors.onAccent : theme.colors.textPrimary }}
                >
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </Row>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="heading" accessibilityRole="header">
          {L.targetTitle}
        </ThemedText>
        <TextInput
          accessibilityLabel={L.searchPlaceholder}
          placeholder={L.searchPlaceholder}
          placeholderTextColor={theme.colors.textMuted}
          value={query}
          onChangeText={setQuery}
          style={{
            minHeight: theme.touchTargets.min,
            borderWidth: 1,
            borderColor: theme.colors.borderStrong,
            borderRadius: theme.radii.md,
            paddingHorizontal: theme.spacing.md,
            color: theme.colors.textPrimary,
            backgroundColor: theme.colors.surface,
            fontSize: theme.text('body').fontSize,
            textAlign: theme.direction.textAlign,
          }}
        />
        <Row gap={theme.spacing.sm} wrap align="stretch" accessibilityRole="radiogroup">
          {tracks.map((t) => {
            const selected = t.id === track;
            const sample = NATIVE_SAMPLES[t.id];
            const clar = dialectClarification(t);
            const status = source ? coverage?.[t.id]?.[source] : undefined;
            const a11y = [
              trackName(t.id),
              clar.needsClarification ? clar.varietyName : null,
              sample.native,
              status,
            ]
              .filter(Boolean)
              .join(', ');
            return (
              <Pressable
                key={t.id}
                accessibilityRole="radio"
                accessibilityState={{ selected, checked: selected }}
                accessibilityLabel={a11y}
                onPress={() => pickTrack(t.id)}
                style={{ width: '48%', flexGrow: 1, maxWidth: 260 }}
              >
                {({ pressed }) => (
                  <Surface
                    variant={selected ? 'accentSoft' : 'elevated'}
                    level={selected ? 2 : 1}
                    radius="lg"
                    bordered={selected || theme.highContrast}
                    style={{
                      overflow: 'hidden',
                      borderColor: selected ? theme.colors.accent : theme.colors.border,
                      borderWidth: selected ? 2 : theme.highContrast ? 1 : 0,
                      opacity: pressed ? 0.9 : 1,
                      flex: 1,
                    }}
                  >
                    <View style={{ height: 44, overflow: 'hidden' }}>
                      <CourseCoverSvg trackId={t.id} width={260} height={44 * 1.6} />
                    </View>
                    <View style={{ padding: theme.spacing.md, gap: 2 }}>
                      <ThemedText variant="label" numberOfLines={2}>
                        {trackName(t.id)}
                      </ThemedText>
                      <Row gap={theme.spacing.xs} align="baseline">
                        <ThemedText
                          variant="scriptSample"
                          script={t.scripts.primary}
                          direction={
                            t.scripts.primary === 'Arab' || t.scripts.primary === 'Hebr'
                              ? 'rtl'
                              : 'ltr'
                          }
                        >
                          {sample.native}
                        </ThemedText>
                        {sample.latin ? (
                          <ThemedText variant="caption" tone="muted">
                            {sample.latin}
                          </ThemedText>
                        ) : null}
                      </Row>
                      {clar.needsClarification ? (
                        <ThemedText variant="caption" tone="secondary" numberOfLines={2}>
                          {clar.varietyName}
                          {clar.distinctFrom.length > 0
                            ? ` — ${L.distinctFrom(clar.distinctFrom.join(', '))}`
                            : ''}
                        </ThemedText>
                      ) : null}
                      {status ? <CoverageBadge status={status} /> : null}
                    </View>
                  </Surface>
                )}
              </Pressable>
            );
          })}
        </Row>
      </View>

      <Surface
        variant="elevated"
        level={3}
        radius="lg"
        padding={theme.spacing.lg}
        style={{ gap: theme.spacing.sm }}
      >
        {source && track ? (
          <ThemedText variant="subheading" accessibilityLiveRegion="polite">
            {L.confirm(trackName(track), langName(source))}
          </ThemedText>
        ) : (
          <Row gap={theme.spacing.xs} wrap>
            <Chip
              label={source ? langName(source) : L.sourceTitle}
              tone={source ? 'accent' : 'neutral'}
            />
            <Chip
              label={track ? trackName(track) : L.targetTitle}
              tone={track ? 'accent' : 'neutral'}
            />
          </Row>
        )}
        <ThemedText variant="caption" tone="muted">
          {L.perCourseNote}
        </ThemedText>
        <Button
          size="lg"
          fullWidth
          disabled={!canConfirm}
          label={
            source && track ? L.confirm(trackName(track), langName(source)) : L.confirm('…', '…')
          }
          onPress={() => {
            if (source && track) onConfirm({ courseTrackId: track, sourceLanguageCode: source });
          }}
        />
      </Surface>
    </View>
  );
}
