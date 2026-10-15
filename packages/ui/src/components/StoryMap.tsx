/**
 * Illustrated mission pathway (§10.2B screen 3): a branching route laid out
 * by `layoutStoryMap`, with an accessible linear list alternative that shows
 * exactly the same nodes. The route is fictional/game geography — no factual
 * map claims.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';
import { type IconName, SceneArtSvg, type SceneId, findScene } from '../art';
import { useTheme } from '../theme/ThemeProvider';
import { STORY_MAP_LABELS, mergeLabels, type LocalizedLabels, type ResolvedLabels } from './labels';
import {
  type StoryMapLayoutNode,
  type StoryMapNode,
  type StoryNodeStatus,
  layoutStoryMap,
  linearStoryList,
} from './logic';
import { Button, Chip, InlineIcon, Row, Surface, ThemedText } from './primitives';

export interface StoryMapProps {
  nodes: readonly StoryMapNode[];
  onSelect: (nodeId: string) => void;
  /** Initial view; the learner can toggle. `list` is also the screen-reader default. */
  initialView?: 'map' | 'list';
  /** Force a view (hides the toggle). */
  view?: 'map' | 'list';
  /** Localized overrides (`t(...)` strings; nested groups may be partial). */
  labels?: LocalizedLabels<typeof STORY_MAP_LABELS>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const STATUS_ICON: Record<StoryNodeStatus, IconName> = {
  locked: 'info',
  available: 'play',
  in_progress: 'replay',
  completed: 'check',
};
const STATUS_TONE: Record<StoryNodeStatus, 'neutral' | 'accent' | 'info' | 'success'> = {
  locked: 'neutral',
  available: 'accent',
  in_progress: 'info',
  completed: 'success',
};

function NodeCard(props: {
  node: StoryMapLayoutNode;
  onPress: () => void;
  labels: ResolvedLabels<typeof STORY_MAP_LABELS>;
  compact: boolean;
}): React.JSX.Element {
  const { node, onPress, labels: L, compact } = props;
  const theme = useTheme();
  const locked = node.status === 'locked';
  const scene = node.sceneId ? findScene(node.sceneId) : undefined;
  const a11y = `${node.title}. ${L.chapter(node.chapterTitle)}. ${L.status[node.status]}.${node.next.length > 0 ? ` ${L.branchesTo(node.next.length)}` : ''}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: locked ? 0.6 : pressed ? 0.9 : 1,
        flex: compact ? undefined : 1,
      })}
    >
      <Surface variant="elevated" level={1} radius="lg" style={{ overflow: 'hidden' }}>
        {scene && !compact ? (
          <View style={{ height: 72, overflow: 'hidden' }}>
            <SceneArtSvg
              sceneId={scene.id as SceneId}
              width={220}
              height={124}
              theme={theme.artTheme}
            />
          </View>
        ) : null}
        <View style={{ padding: theme.spacing.md, gap: theme.spacing.xs }}>
          <Row gap={theme.spacing.xs} justify="space-between" align="flex-start">
            <ThemedText variant="label" numberOfLines={2} style={{ flex: 1 }}>
              {node.title}
            </ThemedText>
            <InlineIcon
              name={STATUS_ICON[node.status]}
              tone={
                node.status === 'completed'
                  ? 'success'
                  : node.status === 'locked'
                    ? 'muted'
                    : 'accent'
              }
              size={theme.iconSizes.xs}
            />
          </Row>
          <Row gap={theme.spacing.xs} wrap>
            <Chip
              label={L.status[node.status].split(' ')[0] ?? L.status[node.status]}
              tone={STATUS_TONE[node.status]}
            />
            {node.minutes ? (
              <ThemedText variant="caption" tone="muted">
                {node.minutes} min
              </ThemedText>
            ) : null}
          </Row>
        </View>
      </Surface>
    </Pressable>
  );
}

export function StoryMap(props: StoryMapProps): React.JSX.Element {
  const { nodes, onSelect, initialView = 'map', view: forcedView, labels, style, testID } = props;
  const theme = useTheme();
  const L = mergeLabels(STORY_MAP_LABELS, labels);
  const [view, setView] = useState<'map' | 'list'>(initialView);
  const activeView = forcedView ?? view;
  const laid = useMemo(() => layoutStoryMap(nodes), [nodes]);
  const linear = useMemo(() => linearStoryList(nodes), [nodes]);

  const rows = useMemo(() => {
    const byRow = new Map<number, StoryMapLayoutNode[]>();
    for (const n of laid) byRow.set(n.row, [...(byRow.get(n.row) ?? []), n]);
    return [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, ns]) => ns.sort((a, b) => a.lane - b.lane));
  }, [laid]);

  return (
    <View style={[{ gap: theme.spacing.md }, style]} testID={testID}>
      {!forcedView ? (
        <Row gap={theme.spacing.sm} justify="flex-end">
          <Button
            variant={activeView === 'map' ? 'primary' : 'secondary'}
            size="sm"
            icon="map"
            label={L.mapView}
            onPress={() => setView('map')}
            accessibilityLabel={L.mapView}
          />
          <Button
            variant={activeView === 'list' ? 'primary' : 'secondary'}
            size="sm"
            icon="missions"
            label={L.listView}
            onPress={() => setView('list')}
            accessibilityLabel={L.listView}
          />
        </Row>
      ) : null}

      {activeView === 'map' ? (
        <View style={{ gap: 0 }}>
          {rows.map((rowNodes, i) => {
            const chapterTitle = rowNodes[0]?.chapterTitle;
            const newChapter = i === 0 || rows[i - 1]?.[0]?.chapterId !== rowNodes[0]?.chapterId;
            return (
              <View key={i}>
                {newChapter && chapterTitle ? (
                  <ThemedText
                    variant="caption"
                    tone="accent"
                    accessibilityRole="header"
                    style={{ marginVertical: theme.spacing.xs }}
                  >
                    {L.chapter(chapterTitle)}
                  </ThemedText>
                ) : null}
                {i > 0 ? (
                  <View
                    style={{ alignItems: 'center' }}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <View
                      style={{
                        width: 3,
                        height: theme.spacing.xl,
                        backgroundColor: theme.colors.borderStrong,
                        borderRadius: 2,
                      }}
                    />
                  </View>
                ) : null}
                <Row gap={theme.spacing.md} align="stretch">
                  {rowNodes.map((n) => (
                    <NodeCard
                      key={n.id}
                      node={n}
                      onPress={() => onSelect(n.id)}
                      labels={L}
                      compact={false}
                    />
                  ))}
                </Row>
              </View>
            );
          })}
        </View>
      ) : (
        <View accessibilityRole="list" style={{ gap: theme.spacing.sm }}>
          {linear.map((n, i) => {
            const newChapter = i === 0 || linear[i - 1]?.chapterId !== n.chapterId;
            return (
              <View key={n.id} style={{ gap: theme.spacing.sm }}>
                {newChapter ? (
                  <ThemedText variant="subheading" accessibilityRole="header">
                    {L.chapter(n.chapterTitle)}
                  </ThemedText>
                ) : null}
                <NodeCard node={n} onPress={() => onSelect(n.id)} labels={L} compact />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
