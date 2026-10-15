/**
 * Contextual help sheet (§3.7 controls, §10.2B screen 4): graded hints that
 * never give the whole answer away first, plus translate / example /
 * "what does that mean?" / slower / repeat / skip. The full model answer is
 * only revealed through an explicit, separate action (accessibility alternative).
 */
import type { ConversationCommand } from '@langquest/contracts';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, type StyleProp, View, type ViewStyle } from 'react-native';
import type { IconName } from '../art';
import { useTheme } from '../theme/ThemeProvider';
import { HINT_LABELS } from './labels';
import { Button, IconButton, Row, Surface, ThemedText } from './primitives';

export interface HintLevel {
  /** Localized hint text (source language), from least to most revealing. */
  text: string;
  /** Optional target-language fragment shown in the target script. */
  targetFragment?: string | null;
}

export interface HintSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Graded hints; level 1 is shown first. */
  hints: readonly HintLevel[];
  /** Translation of the character's last line (source language), when the learner asks. */
  translation?: string | null;
  /** Example answer (target language) — optional; shown only on request. */
  example?: string | null;
  /** Explanation for "what does that mean?" */
  meaning?: string | null;
  /** Commands the current step supports; unsupported ones are hidden, not disabled. */
  availableCommands?: readonly ConversationCommand[];
  onCommand: (command: ConversationCommand) => void;
  /** Explicit model-answer reveal (choice/accessibility alternative to speaking first). */
  onRevealModelAnswer?: () => void;
  /** Reported so the evaluator can count hints used (§3.4). */
  onHintShown?: (level: number) => void;
  labels?: Partial<typeof HINT_LABELS>;
  /** Script of target-language text. */
  targetScript?: Parameters<typeof ThemedText>[0]['script'];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const COMMAND_ICON: Record<ConversationCommand, IconName> = {
  slower: 'slow',
  repeat: 'replay',
  translate: 'translate',
  example: 'transcript',
  meaning: 'info',
  hint: 'hint',
  skip: 'skip10forward',
};

const DEFAULT_COMMANDS: readonly ConversationCommand[] = [
  'hint',
  'translate',
  'example',
  'meaning',
  'slower',
  'repeat',
  'skip',
];

export function HintSheet(props: HintSheetProps): React.JSX.Element {
  const {
    visible,
    onClose,
    hints,
    translation,
    example,
    meaning,
    availableCommands = DEFAULT_COMMANDS,
    onCommand,
    onRevealModelAnswer,
    onHintShown,
    labels,
    targetScript,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const L = { ...HINT_LABELS, ...labels };
  const [level, setLevel] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);

  const commandLabel: Record<ConversationCommand, string> = {
    slower: L.slower,
    repeat: L.repeat,
    translate: L.translate,
    example: L.example,
    meaning: L.meaning,
    hint: level === 0 ? L.hint : L.nextHint,
    skip: L.skip,
  };

  const run = (command: ConversationCommand): void => {
    if (command === 'hint') {
      if (level < hints.length) {
        const next = level + 1;
        setLevel(next);
        onHintShown?.(next);
      }
    } else if (command === 'translate') setShowTranslation(true);
    else if (command === 'example') setShowExample(true);
    else if (command === 'meaning') setShowMeaning(true);
    onCommand(command);
  };

  const canHint = level < hints.length;
  const visibleHints = hints.slice(0, level);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={theme.reducedMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={L.close}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: theme.colors.overlay }}
      />
      <Surface
        variant="elevated"
        level={4}
        radius="xl"
        style={[
          {
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            maxHeight: '75%',
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.xxl,
          },
          style,
        ]}
        accessibilityViewIsModal
      >
        <Row justify="space-between">
          <ThemedText variant="heading">{L.title}</ThemedText>
          <IconButton icon="close" accessibilityLabel={L.close} onPress={onClose} />
        </Row>
        <ScrollView contentContainerStyle={{ gap: theme.spacing.md, paddingTop: theme.spacing.sm }}>
          {visibleHints.map((h, i) => (
            <Surface
              key={i}
              variant="accentSoft"
              radius="md"
              padding={theme.spacing.md}
              accessibilityLabel={L.hintLevel(i + 1, hints.length)}
            >
              <ThemedText variant="caption" tone="accent">
                {L.hintLevel(i + 1, hints.length)}
              </ThemedText>
              <ThemedText variant="body">{h.text}</ThemedText>
              {h.targetFragment ? (
                <ThemedText
                  variant="bodyLarge"
                  script={targetScript}
                  style={{ marginTop: theme.spacing.xs }}
                >
                  {h.targetFragment}
                </ThemedText>
              ) : null}
            </Surface>
          ))}
          {showTranslation && translation ? (
            <Surface variant="muted" radius="md" padding={theme.spacing.md}>
              <ThemedText variant="caption" tone="muted">
                {L.translate}
              </ThemedText>
              <ThemedText variant="body">{translation}</ThemedText>
            </Surface>
          ) : null}
          {showMeaning && meaning ? (
            <Surface variant="muted" radius="md" padding={theme.spacing.md}>
              <ThemedText variant="caption" tone="muted">
                {L.meaning}
              </ThemedText>
              <ThemedText variant="body">{meaning}</ThemedText>
            </Surface>
          ) : null}
          {showExample && example ? (
            <Surface variant="muted" radius="md" padding={theme.spacing.md}>
              <ThemedText variant="caption" tone="muted">
                {L.example}
              </ThemedText>
              <ThemedText variant="bodyLarge" script={targetScript}>
                {example}
              </ThemedText>
            </Surface>
          ) : null}
          <Row gap={theme.spacing.sm} wrap>
            {availableCommands.map((cmd) => {
              if (cmd === 'hint' && !canHint) return null;
              if (cmd === 'translate' && (!translation || showTranslation)) return null;
              if (cmd === 'example' && (!example || showExample)) return null;
              if (cmd === 'meaning' && (!meaning || showMeaning)) return null;
              return (
                <Button
                  key={cmd}
                  variant={cmd === 'hint' ? 'primary' : cmd === 'skip' ? 'ghost' : 'secondary'}
                  size="sm"
                  icon={COMMAND_ICON[cmd]}
                  label={commandLabel[cmd]}
                  onPress={() => run(cmd)}
                />
              );
            })}
          </Row>
          {onRevealModelAnswer ? (
            <View style={{ alignItems: 'center', marginTop: theme.spacing.sm }}>
              <Button
                variant="ghost"
                size="sm"
                label={L.revealAlternative}
                onPress={onRevealModelAnswer}
              />
            </View>
          ) : null}
        </ScrollView>
      </Surface>
    </Modal>
  );
}
