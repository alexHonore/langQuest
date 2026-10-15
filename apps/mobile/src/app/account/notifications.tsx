import { StatusLine, ThemedText } from '@langquest/ui';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Platform } from 'react-native';
import { Screen } from '@/components/Screen';
import { SwitchRow } from '@/components/SettingRow';
import { usePatchSettings } from '@/features/account/use-settings';
import { useActiveEnrollment } from '@/features/session/queries';
import { useT } from '@/lib/i18n';

/**
 * Notifications are opt-in (§10.4): the OS permission is requested only when
 * the learner enables a reminder. No streak punishment, no guilt copy.
 */
export default function NotificationSettings(): React.JSX.Element {
  const router = useRouter();
  const t = useT();
  const { me } = useActiveEnrollment();
  const patch = usePatchSettings();
  const [denied, setDenied] = useState(false);
  // Server-side preferences are not part of /v1/me; keep a local mirror that is pushed through PATCH.
  const [local, setLocal] = useState({ daily_reminder: false, review_due: true, story_updates: true, streak_gentle: false });

  const ensurePermission = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return true;
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const res = await Notifications.requestPermissionsAsync();
    setDenied(!res.granted);
    return res.granted;
  };
  const toggle = async (key: keyof typeof local, value: boolean): Promise<void> => {
    if (value && !(await ensurePermission())) return;
    setLocal({ ...local, [key]: value });
    patch.mutate({ notificationPreferences: { [key]: value } });
  };

  return (
    <Screen title={t('account.notifications.title')} onBack={() => router.back()}>
      <ThemedText tone="secondary">{t('account.notifications.optInNote')}</ThemedText>
      <SwitchRow label={t('account.notifications.dailyGoal')} value={local.daily_reminder} onChange={(v) => void toggle('daily_reminder', v)} />
      <SwitchRow label={t('account.notifications.dueReviews')} value={local.review_due} onChange={(v) => void toggle('review_due', v)} />
      <SwitchRow label={t('account.notifications.newMission')} value={local.story_updates} onChange={(v) => void toggle('story_updates', v)} />
      <SwitchRow label={t('account.notifications.pauseStreak')} hint={t('account.notifications.pauseStreakHint')} value={!local.streak_gentle} onChange={(v) => void toggle('streak_gentle', !v)} />
      <ThemedText variant="caption" tone="muted">
        {t('account.notifications.timezone')}: {me?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
      </ThemedText>
      {denied ? <StatusLine icon="warning" tone="warning" text={t('errors.permission.notificationsDenied')} /> : null}
    </Screen>
  );
}
