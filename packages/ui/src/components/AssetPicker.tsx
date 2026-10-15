/**
 * Asset picker UI shell shared by the admin studio and the mobile app (e.g.
 * choosing a cover or scene). Data loading, upload and rights checks live in
 * the host; the picker renders search, kind filters, thumbnails with honest
 * rights/review status, and selection. Blocked-rights assets are visible but
 * not selectable (§7.6).
 */
import type { AssetKind, ReviewStatus } from '@langquest/contracts';
import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  type StyleProp,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import type { IconName } from '../art';
import { useTheme } from '../theme/ThemeProvider';
import { ASSET_PICKER_LABELS } from './labels';
import { formatDurationMs } from './logic';
import { Button, Chip, InlineIcon, Row, Surface, ThemedText } from './primitives';
import { Skeleton } from './Skeleton';

export type RightsState = 'verified' | 'unverified' | 'blocked';

export interface AssetPickerItem {
  id: string;
  title: string;
  kind: AssetKind;
  thumbnailUri?: string | null;
  /** In-code preview (e.g. a vector cover) when no thumbnail exists. */
  preview?: React.ReactNode;
  rightsState: RightsState;
  reviewStatus: ReviewStatus;
  byteLength?: number | null;
  durationMs?: number | null;
  /** Localized provenance line ("Original upload · Jane D."). */
  provenance?: string | null;
}

export interface AssetPickerProps {
  items: readonly AssetPickerItem[];
  selectedId?: string | null;
  onSelect: (item: AssetPickerItem) => void;
  query?: string;
  onQueryChange?: (query: string) => void;
  kinds?: readonly AssetKind[];
  activeKind?: AssetKind | null;
  onKindChange?: (kind: AssetKind | null) => void;
  onUpload?: () => void;
  loading?: boolean;
  /** Localized empty text. */
  emptyText?: string;
  columns?: 2 | 3;
  labels?: Partial<typeof ASSET_PICKER_LABELS>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const KIND_ICON: Record<AssetKind, IconName> = {
  audio: 'audio',
  image: 'map',
  video: 'play',
  animation: 'star',
  document: 'transcript',
  subtitle: 'transcript',
  archive: 'download',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function AssetPicker(props: AssetPickerProps): React.JSX.Element {
  const {
    items,
    selectedId,
    onSelect,
    query,
    onQueryChange,
    kinds,
    activeKind,
    onKindChange,
    onUpload,
    loading = false,
    emptyText,
    columns = 2,
    labels,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const L = { ...ASSET_PICKER_LABELS, ...labels };
  const width = columns === 3 ? '31%' : '48%';
  return (
    <View
      style={[{ gap: theme.spacing.md }, style]}
      testID={testID}
      accessibilityState={{ busy: loading }}
    >
      <Row gap={theme.spacing.sm} justify="space-between">
        <ThemedText variant="heading" accessibilityRole="header">
          {L.title}
        </ThemedText>
        {onUpload ? (
          <Button
            variant="secondary"
            size="sm"
            icon="download"
            label={L.upload}
            onPress={onUpload}
          />
        ) : null}
      </Row>
      {onQueryChange ? (
        <TextInput
          accessibilityLabel={L.search}
          placeholder={L.search}
          placeholderTextColor={theme.colors.textMuted}
          value={query ?? ''}
          onChangeText={onQueryChange}
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
      ) : null}
      {kinds && kinds.length > 0 && onKindChange ? (
        <Row gap={theme.spacing.xs} wrap>
          <Chip label="All" selected={!activeKind} onPress={() => onKindChange(null)} />
          {kinds.map((k) => (
            <Chip
              key={k}
              label={k}
              icon={KIND_ICON[k]}
              selected={activeKind === k}
              onPress={() => onKindChange(k)}
            />
          ))}
        </Row>
      ) : null}

      {loading ? (
        <Row gap={theme.spacing.sm} wrap>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} shape="box" width={width} height={120} />
          ))}
        </Row>
      ) : items.length === 0 ? (
        <ThemedText
          variant="body"
          tone="muted"
          align="center"
          style={{ padding: theme.spacing.xl }}
        >
          {emptyText ?? L.empty}
        </ThemedText>
      ) : (
        <ScrollView>
          <Row gap={theme.spacing.sm} wrap align="stretch" accessibilityRole="list">
            {items.map((item) => {
              const selected = item.id === selectedId;
              const blocked = item.rightsState === 'blocked';
              const rightsTone =
                item.rightsState === 'verified'
                  ? 'success'
                  : item.rightsState === 'unverified'
                    ? 'warning'
                    : 'error';
              const meta = [
                item.byteLength ? formatBytes(item.byteLength) : null,
                item.durationMs ? formatDurationMs(item.durationMs) : null,
              ]
                .filter(Boolean)
                .join(' · ');
              const a11y = `${item.title}, ${item.kind}, ${L.rights[item.rightsState]}, ${L.review[item.reviewStatus]}${meta ? `, ${meta}` : ''}${selected ? `, ${L.selected}` : ''}`;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={a11y}
                  accessibilityState={{ selected, disabled: blocked }}
                  disabled={blocked}
                  onPress={() => onSelect(item)}
                  style={{ width, flexGrow: 1, maxWidth: 320, opacity: blocked ? 0.6 : 1 }}
                >
                  <Surface
                    variant={selected ? 'accentSoft' : 'elevated'}
                    level={1}
                    radius="md"
                    bordered
                    style={{
                      overflow: 'hidden',
                      borderColor: selected ? theme.colors.accent : theme.colors.border,
                      borderWidth: selected ? 2 : 1,
                      flex: 1,
                    }}
                  >
                    <View
                      style={{
                        height: 96,
                        backgroundColor: theme.colors.surfaceMuted,
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      {item.thumbnailUri ? (
                        <Image
                          source={{ uri: item.thumbnailUri }}
                          style={{ width: '100%', height: '100%' }}
                          resizeMode="cover"
                          accessibilityIgnoresInvertColors
                        />
                      ) : (
                        (item.preview ?? (
                          <InlineIcon
                            name={KIND_ICON[item.kind]}
                            tone="muted"
                            size={theme.iconSizes.xl}
                          />
                        ))
                      )}
                    </View>
                    <View style={{ padding: theme.spacing.sm, gap: theme.spacing.xs }}>
                      <ThemedText variant="label" numberOfLines={2}>
                        {item.title}
                      </ThemedText>
                      {meta ? (
                        <ThemedText variant="caption" tone="muted">
                          {meta}
                        </ThemedText>
                      ) : null}
                      <Row gap={theme.spacing.xs} wrap>
                        <Chip label={L.rights[item.rightsState]} tone={rightsTone} />
                        <Chip
                          label={L.review[item.reviewStatus]}
                          tone={
                            item.reviewStatus === 'approved'
                              ? 'success'
                              : item.reviewStatus === 'rejected'
                                ? 'error'
                                : 'neutral'
                          }
                        />
                      </Row>
                      {item.provenance ? (
                        <ThemedText variant="caption" tone="muted" numberOfLines={1}>
                          {item.provenance}
                        </ThemedText>
                      ) : null}
                    </View>
                  </Surface>
                </Pressable>
              );
            })}
          </Row>
        </ScrollView>
      )}
    </View>
  );
}
