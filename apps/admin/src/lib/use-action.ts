'use client';
/**
 * Small mutation helper: runs an async action, surfaces errors through the toast (with the
 * contract error code), refreshes server-rendered data on success and tracks a busy flag.
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeApiError, isUnreachable } from './api';
import { publicEnv } from './env';
import { useI18n } from './i18n/client';
import { useToast } from '@/src/components/toast';

export function useAction<Args extends unknown[], R>(action: (...args: Args) => Promise<R>, options: { successMessage?: string | ((result: R) => string); refresh?: boolean } = {}) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (...args: Args): Promise<R | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const result = await action(...args);
        if (options.successMessage) toast.success(typeof options.successMessage === 'function' ? options.successMessage(result) : options.successMessage);
        if (options.refresh !== false) router.refresh();
        return result;
      } catch (err) {
        const message = isUnreachable(err) ? t('admin.ui.apiUnreachable', { url: safeBase() }) : t('admin.ui.apiError', describeApiError(err));
        setError(message);
        toast.error(message);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [action, options, router, toast, t],
  );
  return { run, busy, error, clearError: () => setError(null) };
}

function safeBase(): string {
  try {
    return publicEnv().NEXT_PUBLIC_API_BASE_URL;
  } catch {
    return 'NEXT_PUBLIC_API_BASE_URL';
  }
}
