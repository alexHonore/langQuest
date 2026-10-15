'use client';
import { useEffect } from 'react';
import { useI18n } from '@/src/lib/i18n/client';
import { ErrorState } from '@/src/components/ui';

/** Route-level error boundary: shows the message and a retry instead of a blank screen. */
export default function StudioError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorState title={t('admin.ui.errorTitle')} message={`${error.message}${error.digest ? ` (${error.digest})` : ''}`} onRetry={reset} retryLabel={t('admin.ui.errorRetry')} />;
}
