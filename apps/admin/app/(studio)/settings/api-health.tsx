'use client';
import { useEffect, useState } from 'react';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { Badge } from '@/src/components/badges';

export function ApiHealth() {
  const { t } = useI18n();
  const [state, setState] = useState<{ reachable: boolean; latencyMs: number; status: number | null } | null>(null);
  useEffect(() => {
    browserApi()
      .health()
      .then(setState)
      .catch(() => setState({ reachable: false, latencyMs: 0, status: null }));
  }, []);
  if (!state) return <Badge>{t('admin.ui.stChecking')}</Badge>;
  return (
    <Badge tone={state.reachable ? 'success' : 'error'}>
      {state.reachable ? `${t('admin.ui.stReachable')} · ${state.latencyMs} ms` : `${t('admin.ui.stUnreachable')}${state.status ? ` (HTTP ${state.status})` : ''}`}
    </Badge>
  );
}
