import { Button, StatusLine, ThemedText } from '@langquest/ui';
import { Link } from 'expo-router';
import React, { useState } from 'react';
import { AuthFrame, Field } from '@/components/AuthForm';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/state/auth';

/** Landing screen for the verification link + "resend" for learners who did not get the email. */
export default function Verify(): React.JSX.Element {
  const t = useT();
  const { status, resendVerification } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <AuthFrame title="Verify your email">
      {status === 'signed_in' ? <StatusLine icon="check" tone="success" text="Your email is verified. You are signed in." /> : <ThemedText tone="secondary">Open the link we emailed you. Did not get it? Enter your address to resend.</ThemedText>}
      {status !== 'signed_in' ? (
        <>
          <Field label={t('account.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
          {sent ? <StatusLine icon="check" tone="success" text="Verification email sent." /> : <Button label="Resend" fullWidth disabled={!email} onPress={async () => setSent(await resendVerification(email))} accessibilityLabel="Resend verification email" />}
        </>
      ) : null}
      <Link href={status === 'signed_in' ? '/(tabs)' : '/auth/sign-in'} asChild>
        <Button label={t('common.continue')} fullWidth accessibilityLabel={t('common.continue')} />
      </Link>
    </AuthFrame>
  );
}
