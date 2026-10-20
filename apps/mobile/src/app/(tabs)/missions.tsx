import { Button, EmptyState, IconButton, InfoAffordance, MissionCard, Row, StatusLine, StoryMap, ThemedText, useTheme } from '@langquest/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { MissionCast } from '@/features/characters/MissionCast';
import { useCast } from '@/features/characters/use-cast';
import { resumePendingEvaluations } from '@/features/lesson/pending-evaluation';
import { usePathway } from '@/features/missions/use-pathway';
import { useActiveEnrollment, useInvalidateLearner } from '@/features/session/queries';
import { useEnrollmentNavigation } from '@/features/session/use-capabilities';
import { ApiClientError } from '@/lib/api/client';
import { useExtraLabels } from '@/lib/extra-labels';
import { haptic } from '@/lib/haptics';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { getLocalStore } from '@/store';

/**
 * Screen 3: illustrated mission pathway with an accessible linear list alternative (calm density: one
 * heading, the map, a list toggle; the "scenes are illustrative" note sits behind ⓘ). Rendered only
 * when the enrollment's capability snapshot has a mission pathway; otherwise the tab is hidden and a
 * stale link lands Home. Each list card shows the mission's cast as small clay portraits.
 */
export default function Missions(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const names = useLanguageNames();
  const labels = useUiLabels();
  const { api, online } = useServices();
  const qc = useQueryClient();
  const invalidate = useInvalidateLearner();
  const { enrollment } = useActiveEnrollment();
  const nav = useEnrollmentNavigation(enrollment);
  const { pathway, manifest, local } = usePathway(nav.missions ? enrollment : null);
  const { cast } = useCast(nav.missions ? enrollment : null);
  const [view, setView] = useState<'map' | 'cards'>('map');
  const [resuming, setResuming] = useState(false);
  const resumingRef = useRef(false);
  useEffect(() => track.screenView('missions', theme.direction.rtl, enrollment?.scriptMode ?? null), [theme.direction.rtl, enrollment?.scriptMode]);

  const pendingCount = (local.data ?? []).filter((p) => p.status === 'completed' && p.pendingEvaluation).length;

  // Finished missions whose evaluation never reached the server are re-sent here (byte-identical replay).
  const resume = useCallback(async () => {
    if (!online || resumingRef.current) return;
    resumingRef.current = true;
    setResuming(true);
    try {
      const store = await getLocalStore();
      const res = await resumePendingEvaluations(api, store.cache, (e) => e instanceof ApiClientError && e.isConnectivity);
      if (res.sent.length > 0) {
        await invalidate();
        await qc.invalidateQueries({ queryKey: ['local-progress'] });
      } else if (res.dropped.length > 0) {
        await qc.invalidateQueries({ queryKey: ['local-progress'] });
      }
    } finally {
      resumingRef.current = false;
      setResuming(false);
    }
  }, [api, online, invalidate, qc]);

  // Auto-resume once the tab is visible and online (deferred: the kick-off is not a render-time state change).
  useEffect(() => {
    if (pendingCount === 0 || !online) return;
    const handle = setTimeout(() => void resume(), 0);
    return () => clearTimeout(handle);
  }, [pendingCount, online, resume]);

  const open = (id: string): void => {
    void haptic('select');
    router.push({ pathname: '/mission/[id]', params: { id } });
  };
  const sourceName = enrollment ? names(enrollment.sourceLanguageCode) : '';
  if (enrollment && !nav.missions) return <Redirect href="/(tabs)" />;
  const hasPathway = Boolean(pathway && pathway.missions.length > 0);

  return (
    <Screen
      insideTabs
      title={t('missions.pathway')}
      headerEnd={
        hasPathway ? (
          <Row gap={theme.spacing.xs}>
            <IconButton icon={view === 'map' ? 'missions' : 'map'} accessibilityLabel={view === 'map' ? t('missions.listView') : t('missions.mapView')} onPress={() => setView(view === 'map' ? 'cards' : 'map')} />
            <InfoAffordance label={t('missions.aboutPathway')} title={t('missions.pathway')} text={[t('missions.noGeographyClaim'), t('missions.chapterLocked')]} />
          </Row>
        ) : undefined
      }
    >
      {!enrollment ? <EmptyState title={t('home.noCourse')} actionLabel={t('home.addCourse')} onAction={() => router.push('/catalog')} mascotState="curious" /> : null}
      {manifest.isLoading ? <LoadingView rows={3} /> : null}
      {manifest.error && !manifest.data ? <ErrorView error={manifest.error} onRetry={() => void manifest.refetch()} /> : null}
      {manifest.data?.fromCache ? <CacheNotice fetchedAt={manifest.data.fetchedAt} /> : null}
      {pendingCount > 0 ? (
        <Row gap={theme.spacing.sm} justify="space-between">
          <StatusLine icon="info" tone="info" text={X.pendingEvaluation(pendingCount)} />
          {online ? <Button label={X.sendPendingEvaluations} variant="secondary" size="sm" loading={resuming} onPress={() => void resume()} accessibilityLabel={X.sendPendingEvaluations} /> : null}
        </Row>
      ) : null}
      {pathway && hasPathway ? (
        view === 'map' ? (
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
                  consequence={m.mission.localizationComplete ? null : t('enrollment.coverage.draftAvailable', { source: sourceName })}
                  labels={labels.mission}
                  calmLabels={{ details: t('common.details'), hideDetails: t('common.hideDetails') }}
                  onPress={() => open(m.mission.id)}
                />
                <MissionCast characterIds={m.mission.characterIds} cast={cast} size={28} />
              </View>
            ))}
          </View>
        )
      ) : null}
    </Screen>
  );
}
