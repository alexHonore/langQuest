import { Button, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import { useServices } from '@/lib/services';
import { useAuth } from '@/state/auth';
import { usePrefs } from '@/state/prefs';

/**
 * Export + delete account (§1.3, A28). The contracts expose no learner
 * export/deletion route yet, so this screen is honest about it: it performs
 * the local part (wipe caches, outbox, recordings, sign out) and tells the
 * learner that the server-side request must be made through support until the
 * endpoint ships. Nothing pretends to have deleted server data.
 */
export default function DangerZone(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const { resetLocal } = useServices();
  const signOut = useAuth((s) => s.signOut);
  const resetPrefs = usePrefs((s) => s.resetForSignOut);
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  return (
    <Screen title={t('account.deleteAccount.title')} onBack={() => router.back()}>
      <Surface radius="lg" padding={theme.spacing.lg} bordered style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="heading">{t('account.export.title')}</ThemedText>
        <ThemedText tone="secondary">{t('account.export.hint')}</ThemedText>
        <StatusLine icon="info" tone="warning" text="Data export is not available in this build: the API has no learner export endpoint yet. Request it from support and we will send a copy." />
      </Surface>
      <Surface radius="lg" padding={theme.spacing.lg} bordered style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="heading">{t('account.deleteAccount.confirmTitle')}</ThemedText>
        <ThemedText tone="secondary">{t('account.deleteAccount.hint')}</ThemedText>
        <ThemedText variant="caption" tone="muted">{t('account.deleteAccount.confirmHint')}</ThemedText>
        <TextInput value={confirm} onChangeText={setConfirm} placeholder={t('account.deleteAccount.confirmPlaceholder')} placeholderTextColor={theme.colors.textMuted} autoCapitalize="characters" accessibilityLabel={t('account.deleteAccount.confirmPlaceholder')} style={{ borderWidth: 1, borderColor: theme.colors.error, borderRadius: theme.radii.md, padding: theme.spacing.md, color: theme.colors.textPrimary, minHeight: theme.touchTargets.min }} />
        <StatusLine icon="warning" tone="warning" text="Server-side deletion is not exposed by the API in this build. This removes everything stored on this device and signs you out; the account deletion request itself goes through support until the endpoint ships." />
        {done ? <StatusLine icon="check" tone="success" text={t('account.deleteAccount.scheduled')} /> : null}
        <Button
          label={t('account.deleteAccount.button')}
          variant="danger"
          fullWidth
          disabled={confirm.trim() !== 'DELETE'}
          onPress={async () => {
            await resetLocal();
            resetPrefs();
            setDone(true);
            await signOut();
            router.replace('/auth/sign-in');
          }}
          accessibilityLabel={t('account.deleteAccount.button')}
        />
      </Surface>
    </Screen>
  );
}
