import { type CourseTrackId, type SourceLanguageCode } from '@langquest/contracts';
import { Chip, CourseCover, NATIVE_SAMPLES, ORDERED_TRACKS, Row, Surface, ThemedText, dialectClarification, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CoverageStatus } from '@/components/CoverageStatus';
import { CacheNotice } from '@/components/StateViews';
import { useActiveEnrollment, useCourses } from '@/features/session/queries';
import { useExtraLabels } from '@/lib/extra-labels';
import { useLanguageNames, useT } from '@/lib/i18n';

/**
 * Catalog: all 30 tracks with search, script/region filters and honest
 * per-source coverage. The catalog itself comes from the contracts constants,
 * so it renders offline; live coverage/capabilities overlay when available.
 */
export default function Catalog(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const names = useLanguageNames();
  const X = useExtraLabels();
  const { me, enrollments } = useActiveEnrollment();
  const source = (me?.defaultSourceLanguageCode ?? null) as SourceLanguageCode | null;
  const courses = useCourses(source);
  const [query, setQuery] = useState('');
  const [script, setScript] = useState<string | null>(null);

  const scripts = useMemo(() => [...new Set(ORDERED_TRACKS.map((tr) => tr.scripts.primary))], []);
  const tracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ORDERED_TRACKS.filter((tr) => (!script || tr.scripts.primary === script) && (!q || tr.displayName.toLowerCase().includes(q) || names(tr.languageCode).toLowerCase().includes(q) || tr.defaultLocale.toLowerCase().includes(q)));
  }, [query, script, names]);
  const live = useMemo(() => new Map((courses.data?.data.courses ?? []).map((c) => [c.track.id, c] as const)), [courses.data]);
  const enrolledTracks = new Set(enrollments.map((e) => e.courseTrackId));

  return (
    <Screen title={t('catalog.title')} onBack={() => router.back()}>
      <ThemedText tone="secondary">{t('catalog.subtitle')}</ThemedText>
      {courses.data?.fromCache ? <CacheNotice fetchedAt={courses.data.fetchedAt} /> : null}
      <TextInput testID="catalog-search" value={query} onChangeText={setQuery} placeholder={t('catalog.searchPlaceholder')} placeholderTextColor={theme.colors.textMuted} accessibilityLabel={t('common.search')} style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, padding: theme.spacing.md, color: theme.colors.textPrimary, minHeight: theme.touchTargets.min }} />
      <Row gap={theme.spacing.xs} wrap>
        <Chip label={t('common.clearFilters')} selected={script === null} onPress={() => setScript(null)} />
        {scripts.map((s) => (
          <Chip key={s} label={s} selected={script === s} onPress={() => setScript(s)} accessibilityLabel={`${t('catalog.filterByScript')} ${s}`} />
        ))}
      </Row>
      <View style={{ gap: theme.spacing.md }}>
        {tracks.map((tr) => {
          const c = live.get(tr.id);
          const cov = c?.coverage.find((x) => x.sourceLanguageCode === source) ?? null;
          const clar = dialectClarification(tr);
          const sample = NATIVE_SAMPLES[tr.id];
          return (
            <Pressable key={tr.id} testID={`catalog-track-${tr.id}`} onPress={() => router.push({ pathname: '/catalog/[trackId]', params: { trackId: tr.id } })} accessibilityRole="button" accessibilityLabel={tr.displayName}>
              <Surface bordered radius="lg" padding={theme.spacing.md} style={{ gap: theme.spacing.sm }}>
                <Row gap={theme.spacing.md} align="flex-start">
                  <View style={{ width: 84 }}>
                    <CourseCover trackId={tr.id} width={84} hideTitle />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Row gap={theme.spacing.xs} justify="space-between">
                      <ThemedText variant="subheading" style={{ flex: 1 }}>
                        {tr.displayName}
                      </ThemedText>
                      {enrolledTracks.has(tr.id as CourseTrackId) ? <Chip label={t('catalog.enrolled')} tone="success" icon="check" /> : null}
                    </Row>
                    <ThemedText variant="scriptSample" script={tr.scripts.primary}>
                      {sample.native}
                    </ThemedText>
                    <ThemedText variant="caption" tone="secondary">
                      {clar.varietyName} · {tr.defaultLocale}
                    </ThemedText>
                    {source ? <CoverageStatus status={cov?.status ?? 'planned'} sourceLanguageCode={source} nativeReviewed={cov?.nativeReviewed} fallbackSourceLanguageCode={cov?.fallbackSourceLanguageCode ?? null} /> : null}
                    {c ? (
                      <Row gap={theme.spacing.xs} wrap>
                        {c.publicationState !== 'published' ? <Chip label={X.publicationState[c.publicationState] ?? c.publicationState} tone="warning" icon="info" /> : null}
                        <Chip label={X.missionsPublished(c.publishedMissionCount)} tone={c.publishedMissionCount === 0 ? 'warning' : 'neutral'} />
                      </Row>
                    ) : null}
                    {c ? <ThemedText variant="caption" tone="muted">{t(`catalog.scoringSupport.${c.capabilities.pronunciationScoring === 'none' ? 'limited' : c.capabilities.pronunciationScoring}`)}</ThemedText> : null}
                  </View>
                </Row>
              </Surface>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
