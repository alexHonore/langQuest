'use client';
import { useMemo, useState } from 'react';
import { COVERAGE_STATUS_VALUES, type CoverageMetrics, type CoverageUpdateRequest } from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { Button, Checkbox, Field, Input, Notice, Select } from '@/src/components/ui';
import { Dialog } from '@/src/components/dialog';
import { CoverageBadge } from '@/src/components/badges';
import { LanguageSelect } from '@/src/components/forms';

export interface CoverageRow {
  id: string;
  course_track_id: string;
  source_language_code: string;
  status: string;
  metrics: Partial<CoverageMetrics> | null;
  native_reviewed: boolean;
  reviewer_id: string | null;
  reviewed_at: string | null;
  editorial_note_key: string | null;
  fallback_source_language_code: string | null;
  updated_at: string;
}

const METRIC_KEYS: Array<keyof CoverageMetrics> = ['mission_instructions_pct', 'explanations_pct', 'ui_pct', 'subtitles_pct', 'audio_overlays_pct'];

export function CoverageEditor({ rows, tracks, languages, canEdit }: { rows: CoverageRow[]; tracks: Array<{ id: string; name: string }>; languages: Array<{ code: string; name: string }>; varieties: number; canEdit: boolean }) {
  const { t } = useI18n();
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? '');
  const [editing, setEditing] = useState<CoverageRow | null>(null);
  const [form, setForm] = useState<CoverageUpdateRequest | null>(null);
  const byTrack = useMemo(() => rows.filter((r) => r.course_track_id === trackId).sort((a, b) => a.source_language_code.localeCompare(b.source_language_code)), [rows, trackId]);
  const save = useAction(async () => (form ? browserApi().call('adminCoveragePut', { body: form }) : null), { successMessage: t('admin.ui.saved') });
  const open = (row: CoverageRow) => {
    setEditing(row);
    const m = row.metrics ?? {};
    setForm({
      courseTrackId: row.course_track_id as CoverageUpdateRequest['courseTrackId'],
      sourceLanguageCode: row.source_language_code as CoverageUpdateRequest['sourceLanguageCode'],
      status: row.status as CoverageUpdateRequest['status'],
      metrics: Object.fromEntries(METRIC_KEYS.map((k) => [k, Number(m[k] ?? 0)])) as CoverageMetrics,
      nativeReviewed: row.native_reviewed,
      editorialNoteKey: row.editorial_note_key,
      fallbackSourceLanguageCode: row.fallback_source_language_code as CoverageUpdateRequest['fallbackSourceLanguageCode'],
    });
  };
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Select aria-label={t('admin.languages.track')} className="w-auto" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
          {tracks.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tr.name}
            </option>
          ))}
        </Select>
      </div>
      {byTrack.length === 0 ? <Notice tone="warning">{t('admin.ui.lgRowsMissing')}</Notice> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-fg-muted">
            <tr>
              <th className="py-1 text-start">{t('admin.ui.sourceLanguage')}</th>
              <th className="py-1 text-start">{t('enrollment.coverage.label')}</th>
              <th className="py-1 text-start">{t('admin.ui.lgMetrics')}</th>
              <th className="py-1 text-start">{t('admin.ui.lgFallback')}</th>
              <th className="py-1 text-start">{t('admin.ui.lgNoteKey')}</th>
              <th className="py-1 text-start" />
            </tr>
          </thead>
          <tbody>
            {byTrack.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1">
                  {languages.find((l) => l.code === r.source_language_code)?.name ?? r.source_language_code} <span className="font-mono text-xs text-fg-muted">{r.source_language_code}</span>
                </td>
                <td className="py-1">
                  <CoverageBadge status={r.status} nativeReviewed={r.native_reviewed} />
                </td>
                <td className="py-1 text-xs tabular-nums text-fg-muted">{METRIC_KEYS.map((k) => `${k.replace('_pct', '')} ${Number(r.metrics?.[k] ?? 0)}%`).join(' · ')}</td>
                <td className="py-1 text-xs">{r.fallback_source_language_code ?? '—'}</td>
                <td className="py-1 font-mono text-[11px] text-fg-muted">{r.editorial_note_key ?? '—'}</td>
                <td className="py-1 text-end">
                  {canEdit ? (
                    <Button size="sm" onClick={() => open(r)}>
                      {t('admin.languages.setStatus')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog
        open={Boolean(editing && form)}
        onClose={() => setEditing(null)}
        title={`${t('admin.ui.lgCoverageEditor')} · ${editing?.course_track_id} × ${editing?.source_language_code}`}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>{t('admin.ui.cancel')}</Button>
            <Button variant="primary" loading={save.busy} onClick={() => void save.run().then((r) => r && setEditing(null))}>
              {t('admin.ui.save')}
            </Button>
          </>
        }
      >
        {form ? (
          <div className="space-y-3">
            <Notice tone="info">{t('admin.ui.lgStatusHint')}</Notice>
            <Field label={t('enrollment.coverage.label')}>
              {(id) => (
                <Select id={id} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CoverageUpdateRequest['status'] })}>
                  {COVERAGE_STATUS_VALUES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              {METRIC_KEYS.map((k) => (
                <Field key={k} label={k}>
                  {(id) => <Input id={id} type="number" min={0} max={100} value={form.metrics[k]} onChange={(e) => setForm({ ...form, metrics: { ...form.metrics, [k]: Number(e.target.value) } })} />}
                </Field>
              ))}
            </div>
            <Checkbox label={t('admin.ui.lgNativeReviewed')} checked={form.nativeReviewed} onChange={(e) => setForm({ ...form, nativeReviewed: e.target.checked })} />
            <Field
              label={t('admin.ui.lgFallback')}
              hint={
                form.fallbackSourceLanguageCode
                  ? t('enrollment.coverage.optInFallbackHint', { fallback: languages.find((l) => l.code === form.fallbackSourceLanguageCode)?.name ?? form.fallbackSourceLanguageCode, source: languages.find((l) => l.code === form.sourceLanguageCode)?.name ?? form.sourceLanguageCode })
                  : t('admin.ui.lgNoFallback', { source: languages.find((l) => l.code === form.sourceLanguageCode)?.name ?? form.sourceLanguageCode })
              }
            >
              {(id) => <LanguageSelect id={id} value={form.fallbackSourceLanguageCode} onChange={(v) => setForm({ ...form, fallbackSourceLanguageCode: v as CoverageUpdateRequest['fallbackSourceLanguageCode'] })} />}
            </Field>
            <Field label={t('admin.ui.lgNoteKey')}>{(id) => <Input id={id} value={form.editorialNoteKey ?? ''} onChange={(e) => setForm({ ...form, editorialNoteKey: e.target.value || null })} placeholder="enrollment.coverage.draftAvailable" />}</Field>
            {save.error ? <Notice tone="error">{save.error}</Notice> : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
