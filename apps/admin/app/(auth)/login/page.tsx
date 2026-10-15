import { hasPublicEnv } from '@/src/lib/env';
import { serverTranslator } from '@/src/lib/i18n/server';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string; next?: string }> }) {
  const { reason, next } = await searchParams;
  const { t } = await serverTranslator();
  const configured = hasPublicEnv();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{t('admin.title')}</h1>
        <p className="mt-1 text-xs text-fg-muted">{t('admin.ui.signInHint')}</p>
        {configured ? (
          <LoginForm reason={reason ?? null} next={next ?? '/'} />
        ) : (
          <div role="alert" className="mt-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
            <p className="font-medium">{t('admin.ui.setupTitle')}</p>
            <p className="mt-1 text-xs">{t('admin.ui.setupBody')}</p>
          </div>
        )}
      </div>
    </main>
  );
}
