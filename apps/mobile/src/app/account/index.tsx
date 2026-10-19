import { SOURCE_LANGUAGES, getCourseTrack, type SourceLanguageCode } from '@langquest/contracts';
import { Button, Chip, Divider, Row, StatusLine, Surface, ThemedText, orderedSourceLanguages, useTheme } from '@langquest/ui';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Platform, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ErrorView } from '@/components/StateViews';
import { ChoiceRow } from '@/components/SettingRow';
import { usePatchSettings } from '@/features/account/use-settings';
import { completeUiLocales } from '@/features/session/capabilities';
import { useActiveEnrollment } from '@/features/session/queries';
import { useExtraLabels } from '@/lib/extra-labels';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useServices } from '@/lib/services';
import { prepareSignOut } from '@/lib/sign-out';
import { useAuth } from '@/state/auth';
import { usePrefs } from '@/state/prefs';

/** Chrome languages: complete catalogs only (partial es/ru stay instruction languages; docs/UPCOMING_FEATURES.md). */
const UI_LOCALES = completeUiLocales();

/** Account + settings hub (§1.3): profile, UI language, default instruction language, per-course overrides, sections. */
export default function Account(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const names = useLanguageNames();
  const { me, enrollments } = useActiveEnrollment();
  const { resetLocal, pendingEvents, syncNow, local } = useServices();
  const [signingOut, setSigningOut] = useState(false);

  const completeSignOut = async (): Promise<void> => {
    await resetLocal();
    prefs.resetForSignOut();
    await signOut();
    router.replace('/auth/sign-in');
  };

  /** Flush the outbox first; if progress is still unsent, ask before deleting it (§4.5). */
  const requestSignOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      const readiness = await prepareSignOut({ syncNow, pendingCount: async () => (local ? local.outbox.pendingCount() : 0) });
      if (readiness.pending === 0) {
        await completeSignOut();
        return;
      }
      const confirmed = await new Promise<boolean>((resolve) => {
        if (Platform.OS === 'web') {
          resolve(typeof globalThis.confirm === 'function' ? globalThis.confirm(`${X.signOutPendingTitle}\n\n${X.signOutPendingBody(readiness.pending)}`) : false);
          return;
        }
        Alert.alert(X.signOutPendingTitle, X.signOutPendingBody(readiness.pending), [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: X.signOutAnyway, style: 'destructive', onPress: () => resolve(true) },
        ]);
      });
      if (confirmed) await completeSignOut();
    } finally {
      setSigningOut(false);
    }
  };
  const signOut = useAuth((s) => s.signOut);
  const prefs = usePrefs();
  const patch = usePatchSettings();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const uiLocale = prefs.uiLocale ?? me?.uiLocale ?? 'en';

  return (
    <Screen title={t('account.title')} onBack={() => router.back()}>
      <Surface radius="lg" padding={theme.spacing.lg} bordered style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="heading">{t('account.profile')}</ThemedText>
        <ThemedText variant="caption" tone="muted">{t('account.email')}</ThemedText>
        <ThemedText>{me?.email ?? '—'}</ThemedText>
        <ThemedText variant="caption" tone="muted">{t('account.displayName')}</ThemedText>
        <Row gap={theme.spacing.xs}>
          <TextInput value={displayName ?? me?.displayName ?? ''} onChangeText={setDisplayName} accessibilityLabel={t('account.displayName')} style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, padding: theme.spacing.md, color: theme.colors.textPrimary, minHeight: theme.touchTargets.min }} />
          <Button label={t('common.save')} size="sm" disabled={displayName === null || displayName === me?.displayName} loading={patch.isPending} onPress={() => patch.mutate({ displayName: displayName || null })} accessibilityLabel={t('common.save')} />
        </Row>
      </Surface>

      <ChoiceRow label={t('account.uiLanguage')} value={uiLocale} options={UI_LOCALES.map((c) => ({ value: c, label: names(c) }))} onChange={(v) => { prefs.set({ uiLocale: v }); patch.mutate({ uiLocale: v }); }} />
      <ChoiceRow
        label={t('account.defaultSourceLanguage')}
        hint={t('account.defaultSourceLanguageHint')}
        value={(me?.defaultSourceLanguageCode ?? '') as SourceLanguageCode}
        options={orderedSourceLanguages().filter((s) => SOURCE_LANGUAGES.some((x) => x.code === s.code)).map((s) => ({ value: s.code, label: names(s.code) }))}
        onChange={(v) => patch.mutate({ defaultSourceLanguageCode: v })}
      />

      <View style={{ gap: theme.spacing.xs }}>
        <ThemedText variant="label">{t('enrollment.title')}</ThemedText>
        {enrollments.map((e) => (
          <Row key={e.id} gap={theme.spacing.sm} justify="space-between">
            <ThemedText style={{ flex: 1 }}>{t('home.activeCourse', { target: getCourseTrack(e.courseTrackId).displayName, source: names(e.sourceLanguageCode) })}</ThemedText>
            <Button label={t('common.edit')} variant="ghost" size="sm" icon="edit" onPress={() => router.push({ pathname: '/enrollment/[id]', params: { id: e.id } })} accessibilityLabel={`${t('common.edit')} ${getCourseTrack(e.courseTrackId).displayName}`} />
          </Row>
        ))}
        {enrollments.length > 0 ? <Button testID="account-course-includes" label={t('enrollment.disclaimer.includes.title')} variant="secondary" size="sm" icon="info" onPress={() => router.push('/account/includes')} accessibilityLabel={t('enrollment.disclaimer.includes.title')} /> : null}
        <Button label={t('enrollment.add')} variant="secondary" size="sm" icon="globe" onPress={() => router.push('/catalog')} accessibilityLabel={t('enrollment.add')} />
      </View>
      <Divider />
      <Button label={t('account.accessibility.title')} variant="secondary" fullWidth icon="settings" onPress={() => router.push('/account/accessibility')} accessibilityLabel={t('account.accessibility.title')} />
      <Button label={t('account.notifications.title')} variant="secondary" fullWidth icon="info" onPress={() => router.push('/account/notifications')} accessibilityLabel={t('account.notifications.title')} />
      <Button label={t('account.privacy.title')} variant="secondary" fullWidth icon="transcript" onPress={() => router.push('/account/privacy')} accessibilityLabel={t('account.privacy.title')} />
      <Button testID="account-danger" label={`${t('account.export.title')} / ${t('account.deleteAccount.title')}`} variant="secondary" fullWidth icon="warning" onPress={() => router.push('/account/danger')} accessibilityLabel={t('account.deleteAccount.title')} />
      <Divider />
      <Row gap={theme.spacing.xs} wrap>
        <Chip label={t('common.free')} tone="success" icon="check" />
        {pendingEvents > 0 ? <Chip label={X.pendingSync(pendingEvents)} tone="info" /> : null}
      </Row>
      <Button label={X.helpReport} variant="ghost" fullWidth onPress={() => void Linking.openURL('mailto:support@langquest.app?subject=LangQuest%20mobile')} accessibilityLabel={X.helpReport} />
      {patch.error ? <ErrorView error={patch.error} /> : null}
      <Button testID="account-sign-out" label={t('account.signOut')} variant="danger" fullWidth loading={signingOut} onPress={() => void requestSignOut()} accessibilityLabel={t('account.signOut')} />
      <StatusLine icon="info" tone="secondary" text={t('account.accessibility.screenReaderNote')} />
    </Screen>
  );
}
