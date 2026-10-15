import { Button, StatusLine, ThemedText, useTheme } from '@langquest/ui';
import { Link, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AuthFrame, Field, OAuthButtons } from '@/components/AuthForm';
import { isBackendConfigured } from '@/config/env';
import { useI18n, useLanguageNames } from '@/lib/i18n';
import { useAuth } from '@/state/auth';
import { usePrefs } from '@/state/prefs';

export default function SignUp(): React.JSX.Element {
  const { t, locale } = useI18n();
  const names = useLanguageNames();
  const theme = useTheme();
  const router = useRouter();
  const { signUp, status, clearError } = useAuth();
  const pendingSource = usePrefs((s) => s.pendingDefaultSourceLanguage);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState(false);
  useEffect(() => {
    if (status === 'signed_in') router.replace('/(tabs)');
  }, [status, router]);
  useEffect(() => clearError, [clearError]);
  return (
    <AuthFrame title={t('onboarding.getStarted')}>
      {pendingSource ? <StatusLine icon="info" tone="info" text={`${t('account.defaultSourceLanguage')}: ${names(pendingSource)}`} /> : null}
      <Field label={t('account.displayName')} value={displayName} onChangeText={setDisplayName} autoComplete="name" />
      <Field label={t('account.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secure autoComplete="new-password" textContentType="newPassword" />
      {verify ? (
        <StatusLine icon="check" tone="success" text="Check your inbox to verify your email, then sign in." />
      ) : (
        <Button
          label={t('common.continue')}
          size="lg"
          fullWidth
          loading={busy}
          disabled={!isBackendConfigured() || !email || password.length < 8}
          onPress={async () => {
            setBusy(true);
            const result = await signUp(email, password, { uiLocale: locale, defaultSourceLanguageCode: pendingSource, displayName: displayName || null });
            setBusy(false);
            if (result === 'verify_email') setVerify(true);
          }}
          accessibilityLabel={t('common.continue')}
        />
      )}
      <ThemedText variant="caption" tone="muted">
        Password: at least 8 characters.
      </ThemedText>
      <OAuthButtons />
      <View style={{ gap: theme.spacing.sm }}>
        <Link href="/auth/sign-in" asChild>
          <Button label={t('onboarding.alreadyHaveAccount')} variant="ghost" fullWidth accessibilityLabel={t('onboarding.alreadyHaveAccount')} />
        </Link>
      </View>
    </AuthFrame>
  );
}
