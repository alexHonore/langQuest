import { COURSE_TRACKS, LANGUAGES, LANGUAGE_VARIETIES, getVariety } from '@langquest/contracts';
import { computeCatalogCoverage } from '@langquest/locales';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listCoverage } from '@/src/lib/queries/structure';
import { Card, ErrorState, PageHeader } from '@/src/components/ui';
import { Badge } from '@/src/components/badges';
import { CoverageEditor, type CoverageRow } from './coverage-editor';
import { CapabilityMatrix } from './capability-matrix';
import { CastTable } from './cast-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Languages' };

export default async function LanguagesPage() {
  const session = await requireSection('languages');
  const { t } = await serverTranslator();
  const coverage = await listCoverage();
  const ui = computeCatalogCoverage();
  const canEdit = session.roles.some((r) => ['super_admin', 'admin', 'content_editor', 'language_reviewer'].includes(r));
  return (
    <div className="space-y-4">
      <PageHeader title={t('admin.languages.title')} info={t('admin.ui.lgStatusHint')} />
      <Card title={t('admin.languages.uiCatalog')}>
        <ul className="flex flex-wrap gap-3 text-sm">
          {Object.entries(ui).map(([loc, c]) => (
            <li key={loc} className="flex items-center gap-2">
              <span className="font-mono">{loc}</span>
              <Badge tone={c.status === 'complete' ? 'success' : c.status === 'partial' ? 'warning' : 'error'}>{c.status}</Badge>
              <span className="tabular-nums text-fg-muted">{Math.round(c.pct)}%</span>
              <span className="text-xs text-fg-muted">{t('admin.languages.missingKeys', { count: c.totalExpected - c.totalPresent })}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('admin.ui.lgTracks')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-fg-muted">
              <tr>
                <th className="py-1 text-start">#</th>
                <th className="py-1 text-start">{t('admin.languages.track')}</th>
                <th className="py-1 text-start">{t('admin.languages.variety')}</th>
                <th className="py-1 text-start">{t('admin.ui.lgDefaultLocale')}</th>
                <th className="py-1 text-start">{t('admin.languages.scripts')}</th>
                <th className="py-1 text-start">{t('admin.ui.lgScriptModes')}</th>
                <th className="py-1 text-start">{t('admin.ui.lgRegional')}</th>
                <th className="py-1 text-start">{t('admin.languages.mustNotSubstitute')}</th>
              </tr>
            </thead>
            <tbody>
              {COURSE_TRACKS.map((tr) => {
                const v = getVariety(tr.targetVarietyId);
                return (
                  <tr key={tr.id} className="border-t border-border">
                    <td className="py-1 tabular-nums text-fg-muted">{tr.order}</td>
                    <td className="py-1 font-medium">
                      {tr.displayName}
                      <div className="font-mono text-[11px] text-fg-muted">{tr.id}</div>
                    </td>
                    <td className="py-1">
                      {v.name} <span className="font-mono text-xs text-fg-muted">{v.id}</span>
                      {v.tonal ? <Badge tone="info">{t('admin.ui.lgTonal')}</Badge> : null}
                    </td>
                    <td className="py-1 font-mono text-xs">{tr.defaultLocale}</td>
                    <td className="py-1 text-xs">
                      {tr.scripts.primary}
                      {tr.scripts.alternatives.length ? ` (+${tr.scripts.alternatives.join(', ')})` : ''}
                      {tr.scripts.transliterations.length ? ` · ${tr.scripts.transliterations.join(', ')}` : ''}
                    </td>
                    <td className="py-1 text-xs">{tr.scriptModeOptions.join(', ')} (default {tr.defaultScriptMode})</td>
                    <td className="py-1 text-xs">{tr.regionalOptions.map((r) => r.label).join(', ') || '—'}</td>
                    <td className="py-1 text-xs text-error">{v.mustNotSubstitute.join(', ') || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={t('admin.ui.castTitle')} info={t('admin.ui.castHint')}>
        <CastTable tracks={COURSE_TRACKS.map((tr) => ({ id: tr.id, name: tr.displayName }))} />
      </Card>
      <Card title={t('admin.ui.lgMatrix')}>
        <CapabilityMatrix tracks={COURSE_TRACKS.map((tr) => ({ id: tr.id, name: tr.displayName }))} languages={LANGUAGES.map((l) => ({ code: l.code, name: l.englishName }))} />
      </Card>
      <Card title={t('admin.languages.coverage')}>
        {!coverage.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={coverage.error} /> : null}
        <CoverageEditor rows={(coverage.ok ? coverage.data : []) as CoverageRow[]} tracks={COURSE_TRACKS.map((tr) => ({ id: tr.id, name: tr.displayName }))} languages={LANGUAGES.map((l) => ({ code: l.code, name: l.englishName }))} varieties={LANGUAGE_VARIETIES.length} canEdit={canEdit} />
      </Card>
    </div>
  );
}
