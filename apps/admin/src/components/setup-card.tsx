'use client';
/**
 * Setup checklist rendering (CONVENTIONS §8). `SetupChecklist` lists every item (the Setup page);
 * `SetupCard` shows only the items a page depends on, in place of a page that lost its purpose (e.g. Uploads
 * without media storage) — never next to a greyed-out control. Copy is the exact next step, nothing else.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, CircleDashed, HelpCircle, Wrench } from 'lucide-react';
import { SECTION_PATHS } from '@/src/lib/auth/roles';
import { useI18n } from '@/src/lib/i18n/client';
import { useSetupStatus } from '@/src/lib/setup/context';
import type { SetupItem, SetupItemKey, SetupItemState, SetupStatus } from '@/src/lib/setup/derive';
import { formatDateTime } from '@/src/lib/format';
import { Badge, type Tone } from './badges';
import { Button, Card } from './ui';

const STATE_TONE: Record<SetupItemState, Tone> = { ok: 'success', missing: 'error', unknown: 'warning', manual: 'info' };

function StateIcon({ state }: { state: SetupItemState }) {
  const cls = 'shrink-0';
  if (state === 'ok') return <CheckCircle2 size={16} className={`${cls} text-success`} aria-hidden="true" />;
  if (state === 'missing') return <Wrench size={16} className={`${cls} text-error`} aria-hidden="true" />;
  if (state === 'manual') return <HelpCircle size={16} className={`${cls} text-info`} aria-hidden="true" />;
  return <CircleDashed size={16} className={`${cls} text-warning`} aria-hidden="true" />;
}

export function SetupItemRow({ item, showUnlocks }: { item: SetupItem; showUnlocks?: boolean }) {
  const { t } = useI18n();
  return (
    <li className="flex gap-3 py-2">
      <StateIcon state={item.state} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t(`admin.ui.setup.${item.key}.title`)}</span>
          <Badge tone={STATE_TONE[item.state]}>{t(`admin.ui.setup.state.${item.state}`)}</Badge>
          {item.detail ? <code className="font-mono text-[11px] text-fg-muted">{item.detail}</code> : null}
        </div>
        <p className="mt-0.5 text-xs text-fg-secondary">
          <span className="font-medium">{t('admin.ui.setup.nextStep')}: </span>
          {t(item.nextStepKey, { detail: item.detail })}
        </p>
        {showUnlocks && item.unlocks.length > 0 ? (
          <p className="mt-0.5 text-[11px] text-fg-muted">
            {t('admin.ui.setup.unlocks')}: {item.unlocks.map((k) => t(`admin.ui.setup.${k}.title`)).join(' · ')}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** Full checklist for the Setup page; `status` (a fresh server observation) overrides the layout's cached one. */
export function SetupChecklist({ status: fresh }: { status?: SetupStatus }) {
  const { t, locale } = useI18n();
  const cached = useSetupStatus();
  const status = fresh ?? cached;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    setBusy(true);
    router.refresh();
    setTimeout(() => setBusy(false), 800);
  };
  const hidden = (['media', 'ai', 'speech'] as const).filter((k) => status.items.find((i) => i.key === k)?.state !== 'ok');
  return (
    <div className="space-y-4">
      <Card
        title={t('admin.ui.setup.checklist')}
        actions={
          <>
            {status.checkedAt ? <span className="text-xs text-fg-muted">{t('admin.ui.setup.checkedAt', { date: formatDateTime(status.checkedAt, locale) })}</span> : null}
            <Button size="sm" loading={busy} onClick={refresh}>
              {t('admin.ui.setup.refresh')}
            </Button>
          </>
        }
      >
        {!status.incomplete ? <p className="mb-2 text-sm text-success">{t('admin.ui.setup.allConfigured')}</p> : null}
        <ul className="divide-y divide-border">
          {status.items.map((item) => (
            <SetupItemRow key={item.key} item={item} showUnlocks />
          ))}
        </ul>
      </Card>
      {hidden.length > 0 ? (
        <Card title={t('admin.ui.setup.hiddenTitle')}>
          <p className="mb-2 text-xs text-fg-muted">{t('admin.ui.setup.hiddenIntro')}</p>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {hidden.map((k) => (
              <li key={k}>
                <span className="font-medium">{t(`admin.ui.setup.${k}.title`)}</span>: {t(`admin.ui.setup.hidden.${k}`)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-fg-muted">{t('admin.ui.setup.docs')}</p>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The items a page depends on, as a card that replaces the page's controls. Only renders items that are
 * not `ok`, so a page that passes several keys shows just what blocks it.
 */
export function SetupCard({ keys, title }: { keys: readonly SetupItemKey[]; title?: string }) {
  const { t } = useI18n();
  const status = useSetupStatus();
  const items = status.items.filter((i) => keys.includes(i.key) && i.state !== 'ok');
  if (items.length === 0) return null;
  return (
    <Card title={title ?? t('admin.ui.setup.title')} actions={status.canOpenSetup ? <Link href={SECTION_PATHS.setup} className="text-xs text-accent-text hover:underline">{t('admin.ui.setup.openSetup')} →</Link> : null}>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <SetupItemRow key={item.key} item={item} />
        ))}
      </ul>
    </Card>
  );
}
