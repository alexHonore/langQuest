'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/src/lib/supabase/client';
import { useI18n } from '@/src/lib/i18n/client';
import { Button, Field, Input, Notice } from '@/src/components/ui';

export function LoginForm({ reason, next }: { reason: string | null; next: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(t('admin.ui.signInFailed', { reason: signInError.message }));
      setBusy(false);
      return;
    }
    // The proxy verifies the staff role on the next navigation; learners are bounced back with reason=norole.
    router.replace(next.startsWith('/') ? next : '/');
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3" noValidate>
      {reason === 'norole' ? <Notice tone="warning">{t('admin.ui.noRole')}</Notice> : null}
      {reason === 'signin' ? <Notice tone="info">{t('admin.ui.sessionExpired')}</Notice> : null}
      <Field label={t('admin.ui.email')} required>
        {(id) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label={t('admin.ui.password')} required error={error}>
        {(id, describedBy) => <Input id={id} aria-describedby={describedBy} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Button type="submit" variant="primary" loading={busy} className="justify-center">
        {t('admin.ui.signIn')}
      </Button>
    </form>
  );
}
