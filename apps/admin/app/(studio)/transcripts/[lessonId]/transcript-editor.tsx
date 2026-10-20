'use client';
/**
 * Transcript editor (§7.5): segment list with a time ruler (no waveform — none is fabricated),
 * play/seek through a signed playback URL, retime / split / merge, speaker + language labels,
 * side-by-side translations per instruction language, review state, SRT/VTT import/export.
 * Saving writes a NEW transcript revision through the local adapter route.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Download, Merge, Pause, Play, Scissors, SkipBack, Trash2, Upload } from 'lucide-react';
import { LANGUAGES, TRANSLATION_QA_STATE_VALUES } from '@langquest/contracts';
import { activeSegmentAt, detectLanguageMix, mergeSegments, normalizeSegments, parseSubtitles, retimeSegment, splitSegment, toSrt, toVtt, transcriptCoveragePct, type Segment } from '@langquest/media';
import { localCall } from '@/src/lib/local-api/client';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { formatTimecode } from '@/src/lib/format';
import type { TranscriptBundle } from '@/src/lib/queries/transcripts';
import type { TranscriptReplace, TranscriptSegmentInput } from '@/src/lib/local-api/schemas';
import { usePlaybackUrl } from '@/src/components/asset-preview';
import { useDeployment } from '@/src/lib/setup/context';
import { Button, Checkbox, Field, Input, Notice, Select, TextField } from '@/src/components/ui';
import { Badge } from '@/src/components/badges';
import { LanguageSelect, VarietySelect } from '@/src/components/forms';

type Translation = { languageCode: string; text: string; qaState: string };
type TranslationMap = Record<string, Translation[]>; // keyed by segment id

const newId = () => `local-${globalThis.crypto.randomUUID()}`;

function fromBundle(bundle: TranscriptBundle): { segments: Segment[]; translations: TranslationMap } {
  const translations: TranslationMap = {};
  const segments = normalizeSegments(
    bundle.segments.map((s) => {
      translations[s.id] = s.translations.map((tr) => ({ languageCode: tr.language_code, text: tr.text, qaState: tr.qa_state }));
      return { id: s.id, index: s.sort_index, startMs: s.start_ms, endMs: s.end_ms, text: s.text, speakerLabel: s.speaker_label, languageCode: s.language_code, varietyId: s.target_variety_id, confidence: s.confidence, reviewed: s.reviewed };
    }),
  );
  return { segments, translations };
}

export function TranscriptEditor({ bundle, canReview }: { bundle: TranscriptBundle; canReview: boolean }) {
  const { t, locale } = useI18n();
  const initial = useMemo(() => fromBundle(bundle), [bundle]);
  const [segments, setSegments] = useState<Segment[]>(() => initial.segments.map((s) => ({ ...s, id: s.id ?? newId() })));
  const [translations, setTranslations] = useState<TranslationMap>(initial.translations);
  const [translationLangs, setTranslationLangs] = useState<string[]>(() => {
    const present = new Set<string>();
    for (const list of Object.values(initial.translations)) for (const tr of list) present.add(tr.languageCode);
    if (present.size === 0 && bundle.lesson.instruction_language_code) present.add(bundle.lesson.instruction_language_code);
    return [...present];
  });
  const [speakerIds, setSpeakerIds] = useState<Record<string, string | null>>(() => Object.fromEntries(bundle.segments.map((s) => [s.id, s.speaker_id])));
  const [status, setStatus] = useState<'edited' | 'reviewed'>(bundle.transcript?.status === 'reviewed' ? 'reviewed' : 'edited');
  const [qaState, setQaState] = useState<string>(bundle.transcript?.qa_state ?? 'needs_review');
  const [accessRights, setAccessRights] = useState<string>(bundle.transcript?.access_rights ?? 'internal_only');
  const [primaryLanguage, setPrimaryLanguage] = useState<string>(bundle.transcript?.primary_language_code ?? bundle.lesson.target_variety_id ?? bundle.lesson.spoken_language_codes[0] ?? 'en');
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const { mediaAvailable } = useDeployment();
  const playback = usePlaybackUrl(bundle.lesson.masterAssetId);
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const durationMs = bundle.lesson.masterDurationMs ?? bundle.lesson.listen_length_ms ?? Math.max(0, ...segments.map((s) => s.endMs));

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setPositionMs(Math.round(el.currentTime * 1000));
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onPause);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onPause);
    };
  }, [playback.url]);

  const seek = (ms: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    setPositionMs(ms);
  };
  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const active = useMemo(() => activeSegmentAt(segments, positionMs), [segments, positionMs]);
  const mix = useMemo(() => detectLanguageMix(segments), [segments]);
  const coverage = useMemo(() => transcriptCoveragePct(segments, durationMs), [segments, durationMs]);

  const update = (next: Segment[]) => {
    setSegments(next.map((s) => ({ ...s, id: s.id ?? newId() })));
    setDirty(true);
  };
  const patch = (index: number, p: Partial<Segment>) => update(segments.map((s, i) => (i === index ? { ...s, ...p } : s)));
  const doSplit = (index: number) => {
    try {
      update(splitSegment(segments, index, { atMs: positionMs }));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };
  const doMerge = (index: number) => {
    if (index >= segments.length - 1) return;
    const removed = segments[index + 1]!;
    update(mergeSegments(segments, index, index + 1));
    setTranslations((m) => {
      const next = { ...m };
      delete next[removed.id!];
      return next;
    });
  };
  const doRemove = (index: number) => update(segments.filter((_, i) => i !== index).map((s, i) => ({ ...s, index: i })));
  const addAtPlayhead = () => {
    const startMs = positionMs;
    const endMs = Math.min(durationMs || startMs + 3000, startMs + 3000);
    update(normalizeSegments([...segments, { id: newId(), index: segments.length, startMs, endMs, text: '', speakerLabel: null, languageCode: primaryLanguage, varietyId: bundle.lesson.target_variety_id, reviewed: false }]));
  };
  const setTranslation = (segId: string, lang: string, value: Partial<Translation>) => {
    setTranslations((m) => {
      const list = m[segId] ?? [];
      const idx = list.findIndex((tr) => tr.languageCode === lang);
      const next = idx === -1 ? [...list, { languageCode: lang, text: '', qaState: 'needs_review', ...value }] : list.map((tr, i) => (i === idx ? { ...tr, ...value } : tr));
      return { ...m, [segId]: next };
    });
    setDirty(true);
  };

  const save = useAction(
    async () => {
      const body: TranscriptReplace = {
        primaryLanguageCode: primaryLanguage,
        languageMode: mix.mixed ? 'mixed' : primaryLanguage === bundle.lesson.instruction_language_code ? 'source' : 'target',
        status,
        qaState: qaState as TranscriptReplace['qaState'],
        accessRights: accessRights as TranscriptReplace['accessRights'],
        durationMs: durationMs || null,
        segments: segments.map<TranscriptSegmentInput>((s, i) => ({
          sortIndex: i,
          startMs: s.startMs,
          endMs: s.endMs,
          text: s.text,
          speakerLabel: s.speakerLabel,
          speakerId: speakerIds[s.id!] ?? null,
          languageCode: s.languageCode,
          targetVarietyId: s.varietyId as TranscriptSegmentInput['targetVarietyId'],
          confidence: s.confidence,
          reviewed: s.reviewed,
          translations: (translations[s.id!] ?? []).filter((tr) => tr.text.trim()).map((tr) => ({ languageCode: tr.languageCode as TranscriptSegmentInput['translations'][number]['languageCode'], text: tr.text, qaState: tr.qaState as TranscriptSegmentInput['translations'][number]['qaState'] })),
        })),
      };
      const res = await localCall<{ transcriptId: string; revision: number }>(`/api/admin/transcripts/${bundle.lesson.id}`, { method: 'PUT', body });
      setDirty(false);
      return res;
    },
    { successMessage: (res) => t('admin.ui.trSaved', { revision: res.revision }) },
  );

  const exportFile = (kind: 'srt' | 'vtt') => {
    const text = kind === 'srt' ? toSrt(segments, { includeSpeaker: true }) : toVtt(segments, { includeSpeaker: true });
    const blob = new Blob([text], { type: kind === 'srt' ? 'application/x-subrip' : 'text/vtt' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bundle.lesson.id}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importFile = async (file: File) => {
    const parsed = parseSubtitles(await file.text());
    update(parsed.map((s) => ({ ...s, languageCode: s.languageCode ?? primaryLanguage, varietyId: s.varietyId ?? bundle.lesson.target_variety_id })));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
        {bundle.transcript ? (
          <>
            <Badge tone="info">{t('admin.ui.trRevision', { revision: bundle.transcript.revision })}</Badge>
            <Badge>{t(`admin.transcripts.status.${bundle.transcript.status}`)}</Badge>
            <Badge>{t(`admin.review.translationQa.${bundle.transcript.qa_state}`)}</Badge>
            {bundle.transcript.provider ? <span className="text-fg-muted">{bundle.transcript.provider} · {bundle.transcript.model}</span> : null}
          </>
        ) : (
          <Badge tone="warning">{t('admin.ui.trNoTranscript')}</Badge>
        )}
        <span className="text-fg-muted">{t('admin.ui.trSegments', { count: segments.length })}</span>
        <span className="text-fg-muted">{t('admin.ui.trCoverage', { pct: coverage / 100 })}</span>
        <span className="text-fg-muted">
          {t('admin.ui.trMix')}: {mix.languages.map((l) => `${l.code} ${Math.round(l.share * 100)}%`).join(', ') || '—'}
          {mix.mixed ? ' (code-switched)' : ''}
        </span>
        {bundle.revisions.length > 1 ? (
          <span className="ms-auto flex items-center gap-1">
            {t('admin.ui.pbRevisions')}:
            {bundle.revisions.map((r) => (
              <Link key={r.id} href={`/transcripts/${bundle.lesson.id}?revision=${r.revision}`} className={clsx('rounded px-1 hover:underline', bundle.transcript?.revision === r.revision ? 'bg-accent-soft text-accent-text' : 'text-accent-text')}>
                v{r.revision}
              </Link>
            ))}
          </span>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        {playback.url ? (
          <audio ref={audioRef} src={playback.url} preload="metadata" className="hidden">
            <track kind="captions" />
          </audio>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {mediaAvailable && playback.url ? (
            <>
              <Button size="sm" onClick={togglePlay} icon={playing ? <Pause size={14} /> : <Play size={14} />}>
                {playing ? t('admin.ui.trPause') : t('admin.ui.trPlay')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => seek(0)} icon={<SkipBack size={14} />} aria-label={t('admin.ui.trSeek')} />
            </>
          ) : null}
          <span className="font-mono text-xs tabular-nums">
            {formatTimecode(positionMs)} / {formatTimecode(durationMs)}
          </span>
          {mediaAvailable && !playback.url && !playback.loading ? <Notice tone="warning">{bundle.lesson.masterAssetId ? t('admin.ui.playbackUrlUnavailable', { reason: playback.error ?? 'unknown' }) : t('admin.ui.trAudioMissing')}</Notice> : null}
          <span className="ms-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={addAtPlayhead}>
              + {t('admin.transcripts.editSegment')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => exportFile('srt')} icon={<Download size={14} />}>
              {t('admin.ui.trExportSrt')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => exportFile('vtt')} icon={<Download size={14} />}>
              {t('admin.ui.trExportVtt')}
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs text-fg-secondary hover:bg-surface-muted">
              <Upload size={14} /> {t('admin.ui.trImport')}
              <input type="file" accept=".srt,.vtt,text/vtt" className="sr-only" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
            </label>
          </span>
        </div>
        {/* Time ruler: segments positioned by time; click to seek. No waveform is drawn because none is computed here. */}
        <div
          role="slider"
          aria-label={t('admin.ui.trTimeline')}
          aria-valuemin={0}
          aria-valuemax={durationMs}
          aria-valuenow={positionMs}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') seek(Math.min(durationMs, positionMs + 1000));
            if (e.key === 'ArrowLeft') seek(Math.max(0, positionMs - 1000));
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            seek(Math.round(ratio * durationMs));
          }}
          className="relative mt-2 h-8 w-full cursor-pointer overflow-hidden rounded bg-surface-muted"
        >
          {durationMs > 0
            ? segments.map((s, i) => (
                <div
                  key={s.id}
                  title={`${formatTimecode(s.startMs)} – ${formatTimecode(s.endMs)}`}
                  className={clsx('absolute top-1 h-6 rounded-sm border', active?.id === s.id ? 'border-accent bg-accent/60' : selected === i ? 'border-accent-strong bg-accent-soft' : 'border-border-strong bg-accent-soft/60')}
                  style={{ left: `${(s.startMs / durationMs) * 100}%`, width: `${Math.max(0.2, ((s.endMs - s.startMs) / durationMs) * 100)}%` }}
                />
              ))
            : null}
          {durationMs > 0 ? <div className="absolute top-0 h-full w-0.5 bg-error" style={{ left: `${(positionMs / durationMs) * 100}%` }} /> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <Field label={t('admin.ui.trLanguage')}>{(id) => <Input id={id} className="w-28" value={primaryLanguage} onChange={(e) => setPrimaryLanguage(e.target.value)} />}</Field>
        <Field label={t('admin.ui.status')}>
          {(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} disabled={!canReview}>
              <option value="edited">{t('admin.transcripts.status.edited')}</option>
              <option value="reviewed">{t('admin.transcripts.status.reviewed')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.trQa')}>
          {(id) => (
            <Select id={id} value={qaState} onChange={(e) => setQaState(e.target.value)}>
              {TRANSLATION_QA_STATE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {t(`admin.review.translationQa.${v}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.trAccess')}>
          {(id) => (
            <Select id={id} value={accessRights} onChange={(e) => setAccessRights(e.target.value)}>
              <option value="internal_only">internal_only</option>
              <option value="learners">learners</option>
              <option value="public">public</option>
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.trTranslation', { language: '…' })}>
          {(id) => (
            <Select id={id} multiple size={3} value={translationLangs} onChange={(e) => setTranslationLangs(Array.from(e.target.selectedOptions).map((o) => o.value))} className="w-40">
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code} · {l.englishName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button variant="primary" className="ms-auto" loading={save.busy} disabled={!dirty && segments.length === bundle.segments.length} onClick={() => void save.run()}>
          {t('admin.ui.trSaveSegments')}
        </Button>
      </div>
      {save.error ? <Notice tone="error">{save.error}</Notice> : null}

      <ol className="space-y-2">
        {segments.map((s, i) => (
          <li key={s.id} className={clsx('rounded-lg border bg-surface p-2', active?.id === s.id ? 'border-accent' : 'border-border')} onFocus={() => setSelected(i)}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" className="font-mono text-accent-text hover:underline" onClick={() => seek(s.startMs)} title={t('admin.ui.trSeek')}>
                {formatTimecode(s.startMs)}
              </button>
              <span>→</span>
              <span className="font-mono">{formatTimecode(s.endMs)}</span>
              <Button size="sm" variant="ghost" title={t('admin.ui.trRetime')} onClick={() => update(retimeSegment(segments, i, { startMs: Math.min(positionMs, s.endMs - 1) }))}>
                ⇤ {formatTimecode(positionMs)}
              </Button>
              <Button size="sm" variant="ghost" title={t('admin.ui.trRetime')} onClick={() => update(retimeSegment(segments, i, { endMs: Math.max(positionMs, s.startMs + 1) }))}>
                {formatTimecode(positionMs)} ⇥
              </Button>
              <Button size="sm" variant="ghost" icon={<Scissors size={12} />} onClick={() => doSplit(i)} disabled={positionMs <= s.startMs || positionMs >= s.endMs}>
                {t('admin.ui.trSplitHere')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Merge size={12} />} onClick={() => doMerge(i)} disabled={i >= segments.length - 1}>
                {t('admin.ui.trMerge')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => doRemove(i)} aria-label={t('admin.ui.delete')} />
              <span className="ms-auto flex items-center gap-2">
                {s.confidence != null ? <Badge tone={s.confidence < 0.6 ? 'warning' : 'neutral'}>conf {Math.round(s.confidence * 100)}%</Badge> : null}
                <Checkbox label={t('admin.ui.trReviewed')} checked={s.reviewed} disabled={!canReview} onChange={(e) => patch(i, { reviewed: e.target.checked })} />
              </span>
            </div>
            <div className="mt-1 grid gap-2 lg:grid-cols-[1fr_1fr]">
              <TextField multiline contentLanguage={s.varietyId ?? s.languageCode} value={s.text} aria-label={`segment ${i + 1}`} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => patch(i, { text: e.target.value })} />
              <div className="grid gap-1 sm:grid-cols-3">
                <Select aria-label={t('admin.ui.trSpeaker')} value={speakerIds[s.id!] ?? ''} onChange={(e) => { setSpeakerIds((m) => ({ ...m, [s.id!]: e.target.value || null })); setDirty(true); }}>
                  <option value="">{t('admin.ui.trSpeaker')}: —</option>
                  {bundle.speakers.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.display_name}
                    </option>
                  ))}
                </Select>
                <Input aria-label={t('admin.ui.trSpeaker')} placeholder="label" value={s.speakerLabel ?? ''} onChange={(e) => patch(i, { speakerLabel: e.target.value || null })} />
                <LanguageSelect value={s.languageCode} onChange={(v) => patch(i, { languageCode: v })} emptyLabel={t('admin.ui.trLanguage') + ': —'} />
                <div className="sm:col-span-3">
                  <VarietySelect value={s.varietyId} onChange={(v) => patch(i, { varietyId: v })} />
                </div>
              </div>
            </div>
            {translationLangs.length > 0 ? (
              <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, translationLangs.length)}, minmax(0, 1fr))` }}>
                {translationLangs.map((lang) => {
                  const tr = (translations[s.id!] ?? []).find((x) => x.languageCode === lang);
                  return (
                    <div key={lang} className="rounded-md border border-dashed border-border p-1.5">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-fg-muted">
                        <span>{t('admin.ui.trTranslation', { language: lang })}</span>
                        <Select className="w-auto py-0 text-[11px]" value={tr?.qaState ?? 'needs_review'} onChange={(e) => setTranslation(s.id!, lang, { qaState: e.target.value })}>
                          {TRANSLATION_QA_STATE_VALUES.map((v) => (
                            <option key={v} value={v}>
                              {t(`admin.review.translationQa.${v}`)}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <TextField multiline contentLanguage={lang} value={tr?.text ?? ''} aria-label={`${lang} ${i + 1}`} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setTranslation(s.id!, lang, { text: e.target.value })} />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {segments.length === 0 ? <Notice tone="info">{t('admin.ui.trNoTranscript')} — {t('admin.transcripts.runTranscription')}: {t('admin.sections.library')} → {t('admin.ui.libProcess')} · {locale}</Notice> : null}
    </div>
  );
}
