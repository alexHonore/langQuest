'use client';
/**
 * Course × instruction-language capability matrix (CONVENTIONS §8), read-only. Each row is the live
 * `capabilities` snapshot the public coverage endpoint returns for one (track, source) pair — exactly
 * what the enrollment wizard discloses before enrolling ("Missing" column) and what the learner app
 * renders afterwards (the other columns: a hidden tab is shown as "hidden", never as "not available").
 * Values are answered with a 60 s public cache, so an editorial change shows up here within a minute.
 */
import { useEffect, useMemo, useState } from 'react';
import { CAPABILITY_MISSING_I18N_KEYS, type CourseCapabilities } from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { describeApiError } from '@/src/lib/api';
import { useI18n } from '@/src/lib/i18n/client';
import { useWorkingContext } from '@/src/components/shell';
import { Badge, CoverageBadge } from '@/src/components/badges';
import { Button, Select } from '@/src/components/ui';

type Cell = { state: 'loading' } | { state: 'ok'; caps: CourseCapabilities } | { state: 'error'; message: string };

export interface MatrixProps {
  tracks: Array<{ id: string; name: string }>;
  languages: Array<{ code: string; name: string }>;
}

export function CapabilityMatrix({ tracks, languages }: MatrixProps) {
  const { t } = useI18n();
  const [ctx] = useWorkingContext();
  const [trackId, setTrackId] = useState(() => (tracks.some((tr) => tr.id === ctx.courseTrackId) ? ctx.courseTrackId! : (tracks[0]?.id ?? '')));
  const [nonce, setNonce] = useState(0);
  // Results are keyed by (track, nonce): a stale key reads as "loading", so the effect never sets state synchronously.
  const key = `${trackId}#${nonce}`;
  const [results, setResults] = useState<{ key: string; byCode: Record<string, Cell> }>({ key: '', byCode: {} });
  const track = tracks.find((tr) => tr.id === trackId) ?? null;

  useEffect(() => {
    if (!trackId) return;
    let cancelled = false;
    const put = (code: string, cell: Cell) => setResults((prev) => (prev.key === key ? { key, byCode: { ...prev.byCode, [code]: cell } } : { key, byCode: { [code]: cell } }));
    for (const lang of languages) {
      browserApi()
        .call('courseCoverage', { params: { trackId }, query: { source: lang.code } })
        .then((res) => {
          if (cancelled) return;
          const caps = res.capabilities;
          put(lang.code, caps ? { state: 'ok', caps } : { state: 'error', message: 'capabilities absent' });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          put(lang.code, { state: 'error', message: describeApiError(err).message });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [trackId, languages, key]);

  const rows = useMemo(() => languages.map((l) => ({ lang: l, cell: (results.key === key ? results.byCode[l.code] : undefined) ?? ({ state: 'loading' } as Cell) })), [languages, results, key]);
  const hidden = <span className="text-fg-muted">{t('admin.ui.lgMatrixHidden')}</span>;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select aria-label={t('admin.languages.track')} className="w-auto" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
          {tracks.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tr.name}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => setNonce((n) => n + 1)}>
          {t('admin.ui.refresh')}
        </Button>
        <span className="text-xs text-fg-muted">{t('admin.ui.lgMatrixHint')}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">{t('admin.ui.lgMatrix')}</caption>
          <thead className="text-fg-muted">
            <tr>
              <th scope="col" className="py-1 text-start">{t('admin.ui.sourceLanguage')}</th>
              <th scope="col" className="py-1 text-start">{t('enrollment.coverage.label')}</th>
              <th scope="col" className="py-1 text-start">{t('admin.ui.lgMatrixMissions')}</th>
              <th scope="col" className="py-1 text-start">{t('admin.ui.lgMatrixAudio')}</th>
              <th scope="col" className="py-1 text-start">{t('admin.ui.lgMatrixConversation')}</th>
              <th scope="col" className="py-1 text-start">{t('admin.ui.lgMatrixPronunciation')}</th>
              <th scope="col" className="py-1 text-start">{t('admin.ui.lgMatrixDownloads')}</th>
              <th scope="col" className="py-1 text-start">{t('admin.ui.lgMatrixMissing')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ lang, cell }) => (
              <tr key={lang.code} className="border-t border-border align-top">
                <td className="py-1.5 pe-2 whitespace-nowrap">
                  <span className="font-medium">{lang.name}</span> <span className="font-mono text-fg-muted">{lang.code}</span>
                </td>
                {cell.state === 'loading' ? (
                  <td colSpan={7} className="py-1.5 text-fg-muted">
                    {t('admin.ui.lgMatrixLoading')}
                  </td>
                ) : cell.state === 'error' ? (
                  <td colSpan={7} className="py-1.5 text-error">
                    {t('admin.ui.lgMatrixError', { source: lang.code, reason: cell.message })}
                  </td>
                ) : (
                  <>
                    <td className="py-1.5 pe-2">
                      <CoverageBadge status={cell.caps.instructionLanguage.status} nativeReviewed={cell.caps.instructionLanguage.nativeReviewed} />
                    </td>
                    <td className="py-1.5 pe-2 whitespace-nowrap">
                      {cell.caps.missions.available ? (
                        <>
                          {t('admin.ui.lgMatrixPublished', { count: cell.caps.missions.publishedCount })} · {t('admin.ui.lgMatrixLocalized', { count: cell.caps.missions.localizedCount })}
                        </>
                      ) : (
                        hidden
                      )}
                    </td>
                    <td className="py-1.5 pe-2 whitespace-nowrap">{cell.caps.audioLibrary.available ? t('admin.ui.lgMatrixCollections', { count: cell.caps.audioLibrary.publishedCollections }) : hidden}</td>
                    <td className="py-1.5 pe-2 whitespace-nowrap">
                      {cell.caps.liveConversation.available ? (
                        <>
                          {t(`admin.ui.lgMatrixMode.${cell.caps.liveConversation.mode}`)} · {t('admin.ui.lgMatrixCharacters', { count: cell.caps.liveConversation.characterCount })}
                        </>
                      ) : (
                        hidden
                      )}
                    </td>
                    <td className="py-1.5 pe-2 whitespace-nowrap">{cell.caps.pronunciationScoring.mode === 'none' ? hidden : t(`admin.ui.lgMatrixMode.${cell.caps.pronunciationScoring.mode}`)}</td>
                    <td className="py-1.5 pe-2">{cell.caps.offlineDownloads.available ? t('admin.ui.yes') : hidden}</td>
                    <td className="py-1.5">
                      {cell.caps.missing.length === 0 ? (
                        <span className="text-success">{t('enrollment.disclaimer.allAvailable', { source: lang.name })}</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {cell.caps.missing.map((m) => (
                            <li key={m.key} className="flex items-start gap-1">
                              <Badge tone={m.severity === 'blocking' ? 'error' : 'warning'}>{t(`enrollment.disclaimer.severity.${m.severity}`)}</Badge>
                              <span>{t(m.i18nKey || CAPABILITY_MISSING_I18N_KEYS[m.key], { source: lang.name, target: track?.name ?? trackId })}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
