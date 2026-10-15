import { Button, ThemedText, useTheme } from '@langquest/ui';
import { Link, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AuthFrame, Field, OAuthButtons } from '@/components/AuthForm';
import { isBackendConfigured } from '@/config/env';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/state/auth';

export default function SignIn(): React.JSX.Element {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { signIn, status, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (status === 'signed_in') router.replace('/(tabs)');
  }, [status, router]);
  useEffect(() => clearError, [clearError]);
  return (
    <AuthFrame title={t('onboarding.alreadyHaveAccount')}>
      <Field label={t('account.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secure autoComplete="password" textContentType="password" />
      <Button
        label={t('common.continue')}
        size="lg"
        fullWidth
        loading={busy}
        disabled={!isBackendConfigured() || !email || !password}
        onPress={async () => {
          setBusy(true);
          await signIn(email, password);
          setBusy(false);
        }}
        accessibilityLabel={t('common.continue')}
      />
      <OAuthButtons />
      <View style={{ gap: theme.spacing.sm }}>
        <Link href="/auth/reset" asChild>
          <Button label="Forgot password?" variant="ghost" accessibilityLabel="Forgot password" />
        </Link>
        <ThemedText tone="secondary" align="center">
          {t('onboarding.getStarted')}
        </ThemedText>
        <Link href="/auth/sign-up" asChild>
          <Button label={t('onboarding.getStarted')} variant="secondary" fullWidth accessibilityLabel={t('onboarding.getStarted')} />
        </Link>
      </View>
    </AuthFrame>
  );
}
