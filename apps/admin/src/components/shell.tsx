'use client';
/**
 * Studio shell: sidebar navigation (sections filtered by role), interface-language switch,
 * the editorial working context (course track × instruction language, editable everywhere)
 * and the signed-in identity.
 *
 * Night Market adoption (U2, light by default for a work tool): the shell root carries the
 * course × lesson accent variables (`courseAccentVars`), so primary actions, links, selected
 * rows and the sidebar lanterns follow the active course; Melo (the chameleon) sits in the
 * brand spot and takes the same tint.
 */
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { COURSE_TRACKS, LANGUAGES, type Role } from '@langquest/contracts';
import { Pencil } from 'lucide-react';
import { SECTION_PATHS, sectionForPath, visibleSections, type AdminSection } from '@/src/lib/auth/roles';
import { ADMIN_LOCALES, sectionKey, type AdminLocale } from '@/src/lib/i18n';
import { useI18n } from '@/src/lib/i18n/client';
import { useWorkingContext } from '@/src/lib/working-context';
import { useApplyScheme, useScheme, useSchemePreference } from '@/src/lib/visual/scheme';
import { courseAccentVars, SCHEME_PREFERENCES } from '@/src/lib/visual/theme';
import { RoleBadge } from './badges';
import { Lanterns, Melo } from './brand';
import { Button, Select } from './ui';

export type { WorkingContext } from '@/src/lib/working-context';
export { useWorkingContext } from '@/src/lib/working-context';

export function ContextBar() {
  const { t } = useI18n();
  const [ctx, setCtx] = useWorkingContext();
  const [editing, setEditing] = useState(false);
  const track = COURSE_TRACKS.find((tr) => tr.id === ctx.courseTrackId);
  const source = LANGUAGES.find((l) => l.code === ctx.sourceLanguageCode);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
      {editing ? (
        <>
          <Select aria-label={t('admin.ui.activeCourse')} className="w-auto py-0.5 text-xs" value={ctx.courseTrackId ?? ''} onChange={(e) => setCtx({ ...ctx, courseTrackId: e.target.value || null })}>
            <option value="">{t('admin.ui.any')}</option>
            {COURSE_TRACKS.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.displayName}
              </option>
            ))}
          </Select>
          <Select aria-label={t('admin.ui.sourceLanguage')} className="w-auto py-0.5 text-xs" value={ctx.sourceLanguageCode ?? ''} onChange={(e) => setCtx({ ...ctx, sourceLanguageCode: e.target.value || null })}>
            <option value="">{t('admin.ui.any')}</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.englishName} ({l.code})
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => setEditing(false)}>
            {t('admin.ui.close')}
          </Button>
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent-soft px-2 py-0.5 text-accent-text" title={t('admin.ui.activeCourse')}>
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
            <span className="sr-only">{t('admin.ui.activeCourse')}: </span>
            {track ? track.displayName : t('admin.ui.any')}
          </span>
          <span className="rounded-full border border-border px-2 py-0.5" title={t('admin.ui.sourceLanguage')}>
            <span className="sr-only">{t('admin.ui.sourceLanguage')}: </span>
            {source ? source.englishName : t('admin.ui.any')}
          </span>
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded px-1 text-accent-text hover:underline" aria-label={t('admin.ui.edit')}>
            <Pencil size={12} /> {t('admin.ui.edit')}
          </button>
        </>
      )}
    </div>
  );
}

function LocaleSwitch() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const change = async (next: AdminLocale) => {
    setBusy(true);
    await fetch('/api/locale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: next }) });
    setBusy(false);
    router.refresh();
  };
  return (
    <Select aria-label={t('admin.ui.language')} value={locale} disabled={busy} onChange={(e) => void change(e.target.value as AdminLocale)} className="w-auto py-1 text-xs">
      {ADMIN_LOCALES.map((l) => (
        <option key={l} value={l}>
          {l === 'en' ? 'English' : 'Français'}
        </option>
      ))}
    </Select>
  );
}

/** Light (default) / dark / system — the same tokens, swapped by `data-theme`. */
export function ThemeSwitch() {
  const { t } = useI18n();
  const [pref, setPref] = useSchemePreference();
  return (
    <Select aria-label={t('admin.ui.theme')} value={pref} onChange={(e) => setPref(e.target.value as (typeof SCHEME_PREFERENCES)[number])} className="w-auto py-1 text-xs">
      {SCHEME_PREFERENCES.map((p) => (
        <option key={p} value={p}>
          {t(`admin.ui.themeOption.${p}`)}
        </option>
      ))}
    </Select>
  );
}

/** The brand spot: Melo tinted by the active course, under the course lanterns. */
function BrandMark({ title }: { title: string }) {
  return (
    <Link href="/" className="relative flex items-center gap-2 overflow-hidden px-4 py-3">
      <Lanterns />
      <Melo state="neutral" size={36} className="relative" />
      <span className="relative text-base font-semibold">{title}</span>
    </Link>
  );
}

export function StudioShell({ roles, email, setupIncomplete = false, children }: { roles: Role[]; email: string | null; setupIncomplete?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const active = sectionForPath(pathname);
  const sections: AdminSection[] = visibleSections(roles, { setupIncomplete });
  const [ctx] = useWorkingContext();
  const scheme = useScheme();
  useApplyScheme();
  const accentStyle = courseAccentVars(ctx.courseTrackId, null, scheme) as unknown as CSSProperties;
  return (
    <div className="flex min-h-screen" style={accentStyle}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-elevated focus:px-2 focus:py-1">
        Skip to content
      </a>
      <aside className="hidden w-60 shrink-0 flex-col border-e border-border bg-surface md:flex" aria-label={t('admin.title')}>
        <div className="border-b border-border">
          <BrandMark title={t('admin.title')} />
        </div>
        <nav className="flex-1 overflow-y-auto py-2" aria-label={t('admin.title')}>
          <ul>
            {sections.map((s) => (
              <li key={s}>
                <Link
                  href={SECTION_PATHS[s]}
                  aria-current={active === s ? 'page' : undefined}
                  className={clsx('block px-4 py-1.5 text-sm hover:bg-surface-muted', active === s ? 'bg-accent-soft font-medium text-accent-text' : 'text-fg-secondary')}
                >
                  {t(sectionKey(s))}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-border px-4 py-3 text-xs">
          <div className="truncate text-fg-muted" title={email ?? ''}>
            {email ? t('admin.ui.signedInAs', { email }) : ''}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {roles.map((r) => (
              <RoleBadge key={r} role={r} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <LocaleSwitch />
            <ThemeSwitch />
            <form action="/api/auth/signout" method="post">
              <Button size="sm" variant="ghost" type="submit">
                {t('admin.ui.signOut')}
              </Button>
            </form>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2 md:hidden">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Melo state="neutral" size={28} />
            {t('admin.title')}
          </Link>
          <Select aria-label={t('admin.sections.dashboard')} value={active ?? 'dashboard'} onChange={(e) => (window.location.href = SECTION_PATHS[e.target.value as AdminSection])} className="w-auto py-1 text-xs">
            {sections.map((s) => (
              <option key={s} value={s}>
                {t(sectionKey(s))}
              </option>
            ))}
          </Select>
        </header>
        <div className="border-b border-border bg-surface px-4 py-1.5">
          <ContextBar />
        </div>
        <main id="main" className="flex-1 px-4 py-4 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
