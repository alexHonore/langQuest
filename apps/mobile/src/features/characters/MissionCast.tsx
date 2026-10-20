/**
 * The cast of one mission as a row of small clay portraits (C2 flat level of detail ≤ 48 px):
 * the manifest's `characterIds` resolved against the course cast, checked and ranked against the
 * mission (`mission` = its skill keys + scene; a child is never shown on a taxi / office mission,
 * the character whose everyday life carries the mission comes first). Characters the manifest
 * does not carry for the mission are simply absent (never a placeholder, CONVENTIONS §8).
 */
import { Row, ThemedText, buildCharacterPortraitDocument, renderSvgDocument, useTheme } from '@langquest/ui';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useT } from '@/lib/i18n';
import { missionCast, type CastCharacter, type MissionFit } from './cast';

export interface MissionCastProps {
  characterIds: readonly string[];
  cast: readonly CastCharacter[];
  /** The mission's skill keys + scene: enables the role ↔ mission check and ranking. */
  mission?: MissionFit | null;
  size?: number;
  max?: number;
  /** Show the first name next to the portraits (one word, calm density). */
  withName?: boolean;
  testID?: string;
}

export function MissionCast(props: MissionCastProps): React.JSX.Element | null {
  const theme = useTheme();
  const t = useT();
  const size = props.size ?? 32;
  const { characterIds, cast, mission, max } = props;
  const skillKeys = mission?.skillKeys ?? null;
  const sceneId = mission?.sceneId ?? null;
  const members = useMemo(() => missionCast(characterIds, cast, mission ? { skillKeys, sceneId } : null).slice(0, max ?? 3), [characterIds, cast, mission, skillKeys, sceneId, max]);
  if (members.length === 0) return null;
  const label = members.map((m) => t('common.a11y.characterPortrait', { name: m.name })).join(', ');
  return (
    <Row gap={theme.spacing.xs} align="center" accessible accessibilityLabel={label} testID={props.testID}>
      <Row gap={-Math.round(size / 4)} align="center">
        {members.map((m, i) => (
          <View key={m.id} style={{ zIndex: members.length - i, borderRadius: size / 2, borderWidth: 1, borderColor: theme.colors.background, overflow: 'hidden' }}>
            {renderSvgDocument(buildCharacterPortraitDocument(m.portraitKey, 'neutral', { size, theme: theme.artTheme, detail: 'flat' }), m.name)}
          </View>
        ))}
      </Row>
      {props.withName ? (
        <ThemedText variant="caption" tone="secondary" numberOfLines={1}>
          {members.map((m) => m.name.split(' ')[0]).join(', ')}
        </ThemedText>
      ) : null}
    </Row>
  );
}
