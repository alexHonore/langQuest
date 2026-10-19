import { Button, StatusLine } from '@langquest/ui';
import { Link, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { AuthFrame, Field } from '@/components/AuthForm';
import { useExtraLabels } from '@/lib/extra-labels';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/state/auth';

/** Password reset: request an email, or (arriving from the email link with a recovery session) set a new password. */
export default function Reset(): React.JSX.Element {
  const t = useT();
  const X = useExtraLabels();
  const params = useLocalSearchParams<{ type?: string }>();
  const { resetPassword, updatePassword, status } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [updated, setUpdated] = useState(false);
  const recovery = params.type === 'recovery' || status === 'signed_in';
  return (
    <AuthFrame title={recovery ? X.chooseNewPassword : X.resetPassword}>
      {recovery ? (
        <>
          <Field label={X.newPassword} value={password} onChangeText={setPassword} secure autoComplete="new-password" />
          {updated ? <StatusLine icon="check" tone="success" text={X.passwordUpdated} /> : <Button label={t('common.save')} fullWidth disabled={password.length < 8} onPress={async () => setUpdated(await updatePassword(password))} accessibilityLabel={t('common.save')} />}
        </>
      ) : (
        <>
          <Field label={t('account.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
          {sent ? <StatusLine icon="check" tone="success" text={X.resetLinkSent} /> : <Button label={t('common.continue')} fullWidth disabled={!email} onPress={async () => setSent(await resetPassword(email))} accessibilityLabel={t('common.continue')} />}
        </>
      )}
      <Link href="/auth/sign-in" asChild>
        <Button label={t('common.back')} variant="ghost" fullWidth accessibilityLabel={t('common.back')} />
      </Link>
    </AuthFrame>
  );
}
