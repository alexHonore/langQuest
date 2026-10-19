import type { SpeechRetention } from '@langquest/contracts';
import { Divider, StatusLine, ThemedText } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Screen } from '@/components/Screen';
import { ChoiceRow, SwitchRow } from '@/components/SettingRow';
import { usePatchSettings } from '@/features/account/use-settings';
import { useActiveEnrollment } from '@/features/session/queries';
import { useExtraLabels } from '@/lib/extra-labels';
import { useT } from '@/lib/i18n';

const RETENTION: readonly SpeechRetention[] = ['none', 'session', 'opt_in_30_days', 'opt_in_until_deleted'];

/** Transcript storage and speech privacy (§3.6, §11): everything defaults to the least retention. */
export default function PrivacySettings(): React.JSX.Element {
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const { me } = useActiveEnrollment();
  const patch = usePatchSettings();
  const p = me?.privacyOptions;
  return (
    <Screen title={t('account.privacy.title')} onBack={() => router.back()}>
      <ThemedText tone="secondary">{t('onboarding.privacyNote')}</ThemedText>
      <ChoiceRow<SpeechRetention> label={t('account.privacy.speechRetention.label')} hint={t('account.privacy.recordingsHint')} value={p?.store_speech_recordings ?? 'none'} options={RETENTION.map((r) => ({ value: r, label: t(`account.privacy.speechRetention.${r}`) }))} onChange={(v) => patch.mutate({ privacyOptions: { store_speech_recordings: v } })} />
      <SwitchRow label={t('lesson.transcript')} hint={t('account.privacy.recordingsHint')} value={p?.store_raw_transcripts ?? false} onChange={(v) => patch.mutate({ privacyOptions: { store_raw_transcripts: v } })} />
      <Divider />
      <SwitchRow label={t('account.privacy.analytics')} hint={t('account.privacy.analyticsHint')} value={!(p?.analytics_opt_out ?? false)} onChange={(v) => patch.mutate({ privacyOptions: { analytics_opt_out: !v } })} />
      <SwitchRow label={t('account.privacy.aiTraining')} hint={t('account.privacy.aiTrainingHint')} value={p?.personalize_from_interests ?? false} onChange={(v) => patch.mutate({ privacyOptions: { personalize_from_interests: v } })} />
      <SwitchRow label={X.leaderboard} hint={t('account.notifications.optInNote')} value={p?.leaderboard_opt_in ?? false} onChange={(v) => patch.mutate({ privacyOptions: { leaderboard_opt_in: v } })} />
      {patch.isPending ? <StatusLine icon="info" tone="info" text={t('common.loading')} /> : null}
      {patch.error ? <StatusLine icon="warning" tone="error" text={t('errors.generic')} /> : null}
    </Screen>
  );
}
