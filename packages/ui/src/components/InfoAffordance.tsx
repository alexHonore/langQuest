/**
 * Info affordance (owner decision 2026-10-19, "less information pollution"):
 * a small ⓘ button that opens a sheet with the explanation that used to sit
 * inline. The sheet is a plain modal (no network, no storage); the host can
 * also control it through `open` / `onOpenChange` for its own sheet stack.
 */
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, type StyleProp, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { INFO_LABELS, mergeLabels, type LocalizedLabels } from './labels';
import { IconButton, Row, Surface, ThemedText } from './primitives';

export interface InfoAffordanceProps {
  /** Accessible name of the ⓘ button (what the sheet explains). */
  label?: string;
  /** Sheet heading; defaults to `label`. */
  title?: string;
  /** Explanation: one paragraph or a list of short lines (rendered as bullets). */
  text?: string | readonly string[] | null;
  /** Custom sheet content (rendered under `text`). */
  children?: React.ReactNode;
  /** Controlled open state (uncontrolled when omitted). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Icon size; the hit target stays ≥ 44 dp. */
  size?: number;
  tone?: 'muted' | 'secondary' | 'accent';
  /** Localized overrides (`t(...)` strings). */
  labels?: LocalizedLabels<typeof INFO_LABELS>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function InfoAffordance(props: InfoAffordanceProps): React.JSX.Element {
  const {
    label,
    title,
    text,
    children,
    open: openProp,
    onOpenChange,
    size,
    tone = 'muted',
    labels,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const L = mergeLabels(INFO_LABELS, labels);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean): void => {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const name = label ?? L.open;
  const lines = text === undefined || text === null ? [] : typeof text === 'string' ? [text] : text;
  const glass = theme.glass(2);

  return (
    <View style={style} testID={testID}>
      <IconButton
        icon="info"
        accessibilityLabel={name}
        accessibilityHint={undefined}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        size={size ?? theme.iconSizes.sm}
        tone={tone}
        testID={testID ? `${testID}-button` : undefined}
      />
      <Modal
        visible={open}
        transparent
        animationType={theme.reducedMotion ? 'none' : 'slide'}
        onRequestClose={() => setOpen(false)}
        testID={testID ? `${testID}-sheet` : undefined}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={L.close}
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: theme.colors.overlay }}
        />
        <Surface
          variant="glassStrong"
          level={4}
          radius="xl"
          accessibilityViewIsModal
          style={{
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            maxHeight: '70%',
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.xxl,
            backgroundColor: glass.backgroundColor,
          }}
        >
          <Row justify="space-between">
            <ThemedText variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
              {title ?? name}
            </ThemedText>
            <IconButton icon="close" accessibilityLabel={L.close} onPress={() => setOpen(false)} />
          </Row>
          <ScrollView
            contentContainerStyle={{ gap: theme.spacing.sm, paddingTop: theme.spacing.sm }}
          >
            {lines.length === 1 ? (
              <ThemedText variant="body" tone="secondary">
                {lines[0]}
              </ThemedText>
            ) : (
              lines.map((line, i) => (
                <Row key={i} gap={theme.spacing.sm} align="flex-start">
                  <ThemedText variant="body" tone="accent">
                    •
                  </ThemedText>
                  <ThemedText variant="body" tone="secondary" style={{ flex: 1 }}>
                    {line}
                  </ThemedText>
                </Row>
              ))
            )}
            {children}
          </ScrollView>
        </Surface>
      </Modal>
    </View>
  );
}
