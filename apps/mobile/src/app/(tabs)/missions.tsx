import { Button, EmptyState, MissionCard, StatusLine, StoryMap, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { usePathway } from '@/features/missions/use-pathway';
import { useActiveEnrollment } from '@/features/session/queries';
import { useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { track } from '@/lib/telemetry';

/** Screen 3: illustrated mission pathway with an accessible linear list alternative. */
export default function Missions(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const labels = useUiLabels();
  const { enrollment } = useActiveEnrollment();
  const { pathway, manifest } = usePathway(enrollment);
  const [view, setView] = useState<'map' | 'cards'>('map');
  useEffect(() => track.screenView('missions', theme.direction.rtl, enrollment?.scriptMode ?? null), [theme.direction.rtl, enrollment?.scriptMode]);

  const open = (id: string): void => router.push({ pathname: '/mission/[id]', params: { id } });

  return (
    <Screen insideTabs title={t('missions.pathway')}>
      {!enrollment ? <EmptyState title={t('home.noCourse')} actionLabel={t('home.addCourse')} onAction={() => router.push('/catalog')} mascotState="curious" /> : null}
      {manifest.isLoading ? <LoadingView rows={3} /> : null}
      {manifest.error && !manifest.data ? <ErrorView error={manifest.error} onRetry={() => void manifest.refetch()} /> : null}
      {manifest.data?.fromCache ? <CacheNotice fetchedAt={manifest.data.fetchedAt} /> : null}
      {pathway ? (
        <View style={{ gap: theme.spacing.lg }}>
          <StatusLine icon="info" tone="secondary" text={t('missions.noGeographyClaim')} />
          <Button label={view === 'map' ? t('missions.listView') : t('missions.mapView')} variant="ghost" size="sm" icon={view === 'map' ? 'missions' : 'map'} onPress={() => setView(view === 'map' ? 'cards' : 'map')} accessibilityLabel={view === 'map' ? t('missions.listView') : t('missions.mapView')} />
          {pathway.missions.length === 0 ? <EmptyState title={t('common.notAvailable')} description={t('enrollment.coverage.detail.planned', { source: enrollment?.sourceLanguageCode ?? '', fallback: enrollment?.coverage.fallbackSourceLanguageCode ?? 'en' })} mascotState="quiet_audio" /> : null}
          {view === 'map' ? (
            <StoryMap nodes={pathway.nodes} onSelect={open} view="map" labels={labels.storyMap} />
          ) : (
            <View style={{ gap: theme.spacing.md }}>
              {pathway.missions.map((m, i) => (
                <View key={m.mission.id} style={{ gap: theme.spacing.xs }}>
                  {i === 0 || pathway.missions[i - 1]?.chapterId !== m.chapterId ? (
                    <ThemedText variant="caption" tone="accent" accessibilityRole="header">
                      {t('missions.chapter', { number: m.chapterOrder, title: m.chapterTitle })}
                    </ThemedText>
                  ) : null}
                  <MissionCard
                    layout="compact"
                    title={m.mission.title}
                    objective={m.mission.skillKeys.map((k) => k.replace(/_/g, ' ')).join(', ')}
                    minutes={m.minutes}
                    focus={m.focus}
                    status={m.status}
                    type={m.mission.type}
                    sceneId={m.sceneId}
                    consequence={m.mission.localizationComplete ? null : t('enrollment.coverage.draftAvailable', { source: enrollment?.sourceLanguageCode ?? '' })}
                    labels={labels.mission}
                    onPress={() => open(m.mission.id)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </Screen>
  );
}
