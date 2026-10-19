'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ASSET_KIND_VALUES, AUDIO_ASSET_TYPE_VALUES, CONTENT_STATE_VALUES, LANGUAGES, LANGUAGE_VARIETIES, type AudioAssetType, type BulkLabelPatch, type ChapterCreateRequest } from '@langquest/contracts';
import { parseCsvManifest } from '@langquest/media';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { formatBytes, formatDateTime, formatDurationMs, newIdempotencyKey, pickLocalized, shortId } from '@/src/lib/format';
import { useAction } from '@/src/lib/use-action';
import type { LibraryAssetRow, CollectionOption, ChapterOption, SpeakerOption, RightsOption } from '@/src/lib/queries/library';
import { DataTable, BulkActionBar, type Column } from '@/src/components/data-table';
import { FilterBar, FilterSearch, FilterSelect, UrlPager, useUrlFilters } from '@/src/components/filters';
import { Badge, JobBadge, StatusBadge } from '@/src/components/badges';
import { Button, Checkbox, ErrorState, Field, Input, Notice, Select, TextField, Textarea } from '@/src/components/ui';
import { Dialog } from '@/src/components/dialog';
import { LanguageSelect, LevelSelect, TagListInput, VarietySelect } from '@/src/components/forms';

export interface LessonOption {
  id: string;
  title_translations: unknown;
  chapter_id: string;
  sort_order: number;
  chapter: { title_translations: unknown; collection: { title_translations: unknown } | null } | null;
}

interface Props {
  page: number;
  result: { rows: LibraryAssetRow[]; hasNext: boolean } | null;
  error: string | null;
  options: { collections: CollectionOption[]; chapters: ChapterOption[]; speakers: SpeakerOption[]; rights: RightsOption[] };
  lessonOptions: LessonOption[];
  canEdit: boolean;
}

type DialogKind = null | 'bulk' | 'attach' | 'move' | 'split' | 'merge' | 'process' | 'csv';

export function LibraryScreen({ page, result, error, options, lessonOptions, canEdit }: Props) {
  const { t, locale } = useI18n();
  const { set } = useUrlFilters();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogKind>(null);
  const rows = useMemo(() => result?.rows ?? [], [result]);
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  const columns: Column<LibraryAssetRow>[] = [
    {
      key: 'file',
      header: t('admin.ui.filename'),
      render: (r) => (
        <div className="min-w-0">
          <Link href={`/library/${r.id}`} className="block truncate font-medium text-accent hover:underline" title={r.legacy_path ?? r.storage_key}>
            {r.legacy_filename ?? r.storage_key.split('/').pop()}
          </Link>
          <div className="truncate text-[11px] text-fg-muted" title={r.legacy_path ?? ''}>
            {r.legacy_path ?? '—'}
          </div>
        </div>
      ),
    },
    { key: 'kind', header: t('admin.library.kind'), render: (r) => <span>{r.kind}{r.source_asset_id ? <Badge tone="neutral">{t('admin.ui.libDerived')}{r.derivation ? ` · ${r.derivation}` : ''}</Badge> : null}</span> },
    { key: 'state', header: t('admin.library.state'), render: (r) => <StatusBadge state={r.state} /> },
    { key: 'size', header: t('admin.ui.size'), className: 'text-end tabular-nums', render: (r) => formatBytes(r.byte_length, locale) },
    { key: 'duration', header: t('admin.library.duration'), className: 'text-end tabular-nums', render: (r) => formatDurationMs(r.duration_ms) },
    {
      key: 'lesson',
      header: t('admin.sections.lessons'),
      render: (r) => {
        const lessons = r.lessonLinks.map((l) => l.lesson).filter((l): l is NonNullable<typeof l> => Boolean(l));
        if (lessons.length === 0) return <span className="text-fg-muted">—</span>;
        return (
          <ul className="space-y-0.5">
            {lessons.map((l) => (
              <li key={l.id}>
                <Link href={`/lessons/${l.id}`} className="text-accent hover:underline">
                  {pickLocalized(l.title_translations, locale) || shortId(l.id)}
                </Link>
                <span className="ms-1 text-[11px] text-fg-muted">{[l.target_variety_id, l.instruction_language_code].filter(Boolean).join(' / ')}</span>
              </li>
            ))}
          </ul>
        );
      },
    },
    {
      key: 'rights',
      header: t('admin.library.rightsState'),
      render: (r) => (r.rights ? <Badge tone={r.rights.verified ? 'success' : 'warning'}>{r.rights.verified ? t('admin.ui.libRightsVerified') : t('admin.ui.libRightsUnverified')} · {r.rights.license_id}</Badge> : <Badge tone="warning">{t('admin.ui.none')}</Badge>),
    },
    { key: 'hash', header: t('admin.library.contentHash'), render: (r) => <code className="font-mono text-[11px]" title={r.checksum_sha256}>{r.checksum_sha256.slice(0, 10)}…</code> },
    { key: 'created', header: t('admin.ui.created'), className: 'text-fg-muted whitespace-nowrap', render: (r) => formatDateTime(r.created_at, locale) },
  ];

  const exportCsv = () => {
    const header = ['id', 'filename', 'legacy_path', 'kind', 'mime_type', 'byte_length', 'duration_ms', 'checksum_sha256', 'state', 'visibility', 'lesson_ids', 'content_rights_id', 'created_at'];
    const source = selectedRows.length > 0 ? selectedRows : rows;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.join(','), ...source.map((r) => [r.id, r.legacy_filename, r.legacy_path, r.kind, r.mime_type, r.byte_length, r.duration_ms, r.checksum_sha256, r.state, r.visibility, r.lessonLinks.map((l) => l.lesson?.id).filter(Boolean).join('|'), r.content_rights_id, r.created_at].map(esc).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `langquest-library-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <FilterBar onClear={() => set({ status: null, kind: null, variety: null, source: null, speaker: null, collection: null, q: null, derived: null })}>
        <FilterSearch name="q" label={t('common.search')} />
        <FilterSelect name="status" label={t('admin.library.state')} options={CONTENT_STATE_VALUES.map((s) => ({ value: s, label: t(`admin.publish.state.${s}`) }))} />
        <FilterSelect name="kind" label={t('admin.library.kind')} options={ASSET_KIND_VALUES.map((k) => ({ value: k, label: k }))} />
        <FilterSelect name="derived" label={t('admin.library.originalVsDerived')} options={[{ value: 'original', label: t('admin.library.original') }, { value: 'derived', label: t('admin.library.derived') }]} />
        <FilterSelect name="variety" label={t('admin.models.variety')} options={LANGUAGE_VARIETIES.map((v) => ({ value: v.id, label: `${v.name} (${v.id})` }))} />
        <FilterSelect name="source" label={t('admin.ui.sourceLanguage')} options={LANGUAGES.map((l) => ({ value: l.code, label: `${l.englishName} (${l.code})` }))} />
        <FilterSelect name="speaker" label={t('admin.library.speaker')} options={options.speakers.map((s) => ({ value: s.id, label: s.display_name }))} />
        <FilterSelect name="collection" label={t('admin.ui.upCollection')} options={options.collections.map((c) => ({ value: c.id, label: pickLocalized(c.title_translations, locale) || shortId(c.id) }))} />
        <span className="ms-auto flex gap-2">
          {canEdit ? (
            <Button size="sm" onClick={() => setDialog('csv')}>
              {t('admin.ui.libCsvImport')}
            </Button>
          ) : null}
          <Button size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            {t('admin.ui.libCsvExport')}
          </Button>
        </span>
      </FilterBar>

      {error ? <ErrorState title={t('admin.ui.errorTitle')} message={error} /> : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} selectable={canEdit} selected={selected} onSelectionChange={setSelected} empty={t('admin.library.noResults')} caption={t('admin.library.title')} />
      <UrlPager page={page} hasNext={result?.hasNext ?? false} />

      {canEdit ? (
        <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" variant="primary" onClick={() => setDialog('bulk')}>
            {t('admin.ui.libBulkLabel')}
          </Button>
          <Button size="sm" onClick={() => setDialog('attach')}>
            {t('admin.ui.libAttachToLesson')}
          </Button>
          <Button size="sm" onClick={() => setDialog('move')}>
            {t('admin.ui.libMove')}
          </Button>
          <Button size="sm" onClick={() => setDialog('split')}>
            {t('admin.ui.libSplit')}
          </Button>
          <Button size="sm" onClick={() => setDialog('merge')}>
            {t('admin.ui.libMerge')}
          </Button>
          <Button size="sm" onClick={() => setDialog('process')}>
            {t('admin.ui.libProcess')}
          </Button>
        </BulkActionBar>
      ) : null}

      <BulkLabelDialog open={dialog === 'bulk'} onClose={() => setDialog(null)} rows={selectedRows} options={options} />
      <AttachDialog open={dialog === 'attach'} onClose={() => setDialog(null)} rows={selectedRows} lessons={lessonOptions} />
      <MoveDialog open={dialog === 'move'} onClose={() => setDialog(null)} rows={selectedRows} chapters={options.chapters} collections={options.collections} />
      <SplitDialog open={dialog === 'split'} onClose={() => setDialog(null)} rows={selectedRows} chapters={options.chapters} />
      <MergeDialog open={dialog === 'merge'} onClose={() => setDialog(null)} rows={selectedRows} />
      <ProcessDialog open={dialog === 'process'} onClose={() => setDialog(null)} rows={selectedRows} />
      <CsvImportDialog open={dialog === 'csv'} onClose={() => setDialog(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------------- bulk label

type PatchKey = keyof BulkLabelPatch;
const PATCH_FIELDS: PatchKey[] = ['targetVarietyId', 'instructionLanguage', 'spokenLanguageCodes', 'regionalDialect', 'speakerId', 'collectionId', 'chapterId', 'chapterOrder', 'lessonOrder', 'level', 'topic', 'addTags', 'removeTags', 'scene', 'description', 'coverVisualAssetId', 'contentRightsId', 'state', 'visibility'];

function BulkLabelDialog({ open, onClose, rows, options }: { open: boolean; onClose: () => void; rows: LibraryAssetRow[]; options: Props['options'] }) {
  const { t, locale } = useI18n();
  const [enabled, setEnabled] = useState<Set<PatchKey>>(new Set());
  const [patch, setPatch] = useState<BulkLabelPatch>({});
  const [applyToChildren, setApplyToChildren] = useState(false);
  const [lastResult, setLastResult] = useState<{ affected: number; skipped: number } | null>(null);
  const action = useAction(async () => {
    const body: BulkLabelPatch = {};
    for (const key of enabled) (body as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key] ?? null;
    const res = await browserApi().call('adminAssetsBulkLabel', { body: { assetIds: rows.map((r) => r.id), patch: body, applyToChildren, idempotencyKey: newIdempotencyKey('bulk') } });
    setLastResult({ affected: res.affected, skipped: res.skipped.length });
    return res;
  }, { successMessage: (res) => t('admin.bulkEdit.applied', { count: res.affected }) });

  const toggle = (key: PatchKey) =>
    setEnabled((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setValue = <K extends PatchKey>(key: K, value: BulkLabelPatch[K]) => setPatch((p) => ({ ...p, [key]: value }));
  const row = (key: PatchKey, label: string, control: React.ReactNode) => (
    <div key={key} className="grid grid-cols-[1.5rem_11rem_1fr] items-center gap-2">
      <input type="checkbox" aria-label={label} checked={enabled.has(key)} onChange={() => toggle(key)} className="h-4 w-4 accent-accent" />
      <span className="text-xs text-fg-secondary">{label}</span>
      <div className={enabled.has(key) ? '' : 'opacity-50'}>{control}</div>
    </div>
  );
  const lessonCount = rows.reduce((n, r) => n + r.lessonLinks.length, 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={t('admin.bulkEdit.applyTo', { count: rows.length })}
      footer={
        <>
          <Button onClick={onClose}>{t('admin.ui.cancel')}</Button>
          <Button variant="primary" loading={action.busy} disabled={enabled.size === 0 || rows.length === 0} onClick={() => void action.run()}>
            {t('admin.bulkEdit.apply')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-2">
          {row('targetVarietyId', t('admin.bulkEdit.setLanguage'), <VarietySelect value={patch.targetVarietyId ?? null} onChange={(v) => setValue('targetVarietyId', v as BulkLabelPatch['targetVarietyId'])} />)}
          {row('instructionLanguage', t('admin.bulkEdit.setSourceLanguage'), <LanguageSelect value={patch.instructionLanguage ?? null} onChange={(v) => setValue('instructionLanguage', v as BulkLabelPatch['instructionLanguage'])} />)}
          {row('spokenLanguageCodes', t('admin.ui.lsSpoken'), <TagListInput label={t('admin.ui.lsSpoken')} value={patch.spokenLanguageCodes ?? []} onChange={(v) => setValue('spokenLanguageCodes', v)} />)}
          {row('regionalDialect', t('admin.ui.lsDialect'), <Input value={patch.regionalDialect ?? ''} onChange={(e) => setValue('regionalDialect', e.target.value || null)} />)}
          {row(
            'speakerId',
            t('admin.bulkEdit.setSpeaker'),
            <Select value={patch.speakerId ?? ''} onChange={(e) => setValue('speakerId', e.target.value || null)}>
              <option value="">{t('admin.ui.none')}</option>
              {options.speakers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </Select>,
          )}
          {row(
            'collectionId',
            t('admin.bulkEdit.setCollection'),
            <Select value={patch.collectionId ?? ''} onChange={(e) => setValue('collectionId', e.target.value || null)}>
              <option value="">{t('admin.ui.none')}</option>
              {options.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {pickLocalized(c.title_translations, locale) || shortId(c.id)}
                </option>
              ))}
            </Select>,
          )}
          {row(
            'chapterId',
            t('admin.bulkEdit.setChapter'),
            <Select value={patch.chapterId ?? ''} onChange={(e) => setValue('chapterId', e.target.value || null)}>
              <option value="">{t('admin.ui.none')}</option>
              {options.chapters
                .filter((c) => !patch.collectionId || c.collection_id === patch.collectionId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.sort_order}. {pickLocalized(c.title_translations, locale) || shortId(c.id)}
                  </option>
                ))}
            </Select>,
          )}
          {row('chapterOrder', t('admin.ui.order') + ' (chapter)', <Input type="number" min={0} value={patch.chapterOrder ?? ''} onChange={(e) => setValue('chapterOrder', e.target.value === '' ? null : Number(e.target.value))} />)}
          {row('lessonOrder', t('admin.ui.order') + ' (lesson)', <Input type="number" min={0} value={patch.lessonOrder ?? ''} onChange={(e) => setValue('lessonOrder', e.target.value === '' ? null : Number(e.target.value))} />)}
          {row('level', t('admin.bulkEdit.setLevel'), <LevelSelect value={patch.level ?? null} onChange={(v) => setValue('level', v as BulkLabelPatch['level'])} />)}
          {row('topic', t('admin.ui.lsTopic'), <Input value={patch.topic ?? ''} onChange={(e) => setValue('topic', e.target.value || null)} />)}
          {row('addTags', t('admin.bulkEdit.addTags'), <TagListInput label={t('admin.bulkEdit.addTags')} value={patch.addTags ?? []} onChange={(v) => setValue('addTags', v)} />)}
          {row('removeTags', t('admin.bulkEdit.removeTags'), <TagListInput label={t('admin.bulkEdit.removeTags')} value={patch.removeTags ?? []} onChange={(v) => setValue('removeTags', v)} />)}
          {row('scene', t('admin.ui.lsScene'), <Input value={patch.scene ?? ''} onChange={(e) => setValue('scene', e.target.value || null)} />)}
          {row('description', t('admin.ui.lsDescription'), <TextField multiline contentLanguage={patch.instructionLanguage ?? null} value={patch.description ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue('description', e.target.value || null)} />)}
          {row('coverVisualAssetId', t('admin.ui.colCover'), <Input placeholder="visual asset uuid" value={patch.coverVisualAssetId ?? ''} onChange={(e) => setValue('coverVisualAssetId', e.target.value || null)} />)}
          {row(
            'contentRightsId',
            t('admin.bulkEdit.setLicense'),
            <Select value={patch.contentRightsId ?? ''} onChange={(e) => setValue('contentRightsId', e.target.value || null)}>
              <option value="">{t('admin.ui.none')}</option>
              {options.rights.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.license_id} {r.verified ? '✓' : '(unverified)'} · {shortId(r.id)}
                </option>
              ))}
            </Select>,
          )}
          {row(
            'state',
            t('admin.library.state'),
            <Select value={patch.state ?? ''} onChange={(e) => setValue('state', (e.target.value || undefined) as BulkLabelPatch['state'])}>
              <option value="">—</option>
              {CONTENT_STATE_VALUES.filter((s) => s !== 'published').map((s) => (
                <option key={s} value={s}>
                  {t(`admin.publish.state.${s}`)}
                </option>
              ))}
            </Select>,
          )}
          {row(
            'visibility',
            t('admin.ui.lsVisibility'),
            <Select value={patch.visibility ?? ''} onChange={(e) => setValue('visibility', (e.target.value || undefined) as BulkLabelPatch['visibility'])}>
              <option value="">—</option>
              <option value="private">private</option>
              <option value="authenticated">authenticated</option>
            </Select>,
          )}
        </div>
        <aside className="space-y-2 rounded-md border border-border bg-surface-muted p-3 text-xs">
          <h3 className="font-semibold">{t('admin.ui.libInheritance')}</h3>
          <p className="text-fg-muted">{t('admin.ui.libInheritanceHint')}</p>
          <Checkbox label={t('admin.ui.libApplyChildren')} checked={applyToChildren} onChange={(e) => setApplyToChildren(e.target.checked)} />
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt>{t('admin.ui.upFiles', { count: rows.length })}</dt>
              <dd className="tabular-nums">{rows.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t('admin.sections.lessons')}</dt>
              <dd className="tabular-nums">{applyToChildren ? lessonCount : 0}</dd>
            </div>
          </dl>
          <ul className="space-y-0.5">
            {PATCH_FIELDS.filter((k) => enabled.has(k)).map((k) => (
              <li key={k} className="flex justify-between gap-2">
                <span className="font-mono">{k}</span>
                <span className="truncate text-fg-secondary">{JSON.stringify((patch as Record<string, unknown>)[k] ?? null)}</span>
              </li>
            ))}
            {enabled.size === 0 ? <li className="text-fg-muted">{t('admin.ui.none')}</li> : null}
          </ul>
          {lastResult ? (
            <Notice tone="success">
              {t('admin.ui.libAffected', { count: lastResult.affected })} · {t('admin.ui.libSkipped', { count: lastResult.skipped })}
            </Notice>
          ) : null}
          {action.error ? <Notice tone="error">{action.error}</Notice> : null}
        </aside>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------- attach

function AttachDialog({ open, onClose, rows, lessons }: { open: boolean; onClose: () => void; rows: LibraryAssetRow[]; lessons: LessonOption[] }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [assetType, setAssetType] = useState<AudioAssetType>('master');
  const filtered = lessons.filter((l) => !q || JSON.stringify(l.title_translations).toLowerCase().includes(q.toLowerCase()));
  const action = useAction(
    async () => {
      let n = 0;
      let moved = 0;
      for (const r of rows) {
        // 201 = fresh link; 200 + movedFromLessonId = moved from another lesson (both lessons get a revision).
        const res = await browserApi().call('adminLessonAssetAttach', { params: { id: lessonId }, body: { assetId: r.id, assetType, sortOrder: n } });
        if (res.movedFromLessonId) moved += 1;
        n += 1;
      }
      return { n, moved };
    },
    { successMessage: ({ n, moved }) => `${t('admin.ui.libAffected', { count: n })}${moved > 0 ? ` · ${t('admin.ui.libMovedLinks', { count: moved })}` : ''}` },
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('admin.ui.libAttachToLesson')}
      footer={
        <>
          <Button onClick={onClose}>{t('admin.ui.cancel')}</Button>
          <Button variant="primary" disabled={!lessonId || rows.length === 0} loading={action.busy} onClick={() => void action.run().then(onClose)}>
            {t('admin.ui.apply')}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Field label={t('common.search')}>{(id) => <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <Field label={t('admin.ui.upLesson')}>
          {(id) => (
            <Select id={id} value={lessonId} onChange={(e) => setLessonId(e.target.value)} size={8}>
              {filtered.map((l) => (
                <option key={l.id} value={l.id}>
                  {[pickLocalized(l.chapter?.collection?.title_translations, locale), pickLocalized(l.chapter?.title_translations, locale), `${l.sort_order}. ${pickLocalized(l.title_translations, locale) || shortId(l.id)}`].filter(Boolean).join(' › ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.type')}>
          {(id) => (
            <Select id={id} value={assetType} onChange={(e) => setAssetType(e.target.value as AudioAssetType)}>
              {AUDIO_ASSET_TYPE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------- move / renumber

function lessonIdsOf(rows: LibraryAssetRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) for (const l of r.lessonLinks) if (l.lesson) ids.add(l.lesson.id);
  return [...ids];
}

function MoveDialog({ open, onClose, rows, chapters, collections }: { open: boolean; onClose: () => void; rows: LibraryAssetRow[]; chapters: ChapterOption[]; collections: CollectionOption[] }) {
  const { t, locale } = useI18n();
  const [chapterId, setChapterId] = useState('');
  const [start, setStart] = useState(1);
  const [step, setStep] = useState(1);
  const lessonIds = lessonIdsOf(rows);
  // Field updates (chapter move + renumber) go through `adminAudioLessonPatch`, one lesson at a time; each gets a revision.
  const action = useAction(
    async () => {
      let updated = 0;
      for (const [i, id] of lessonIds.entries()) {
        await browserApi().call('adminAudioLessonPatch', { params: { id }, body: { sortOrder: start + i * step, ...(chapterId ? { chapterId } : {}) } });
        updated += 1;
      }
      return updated;
    },
    { successMessage: (n) => t('admin.ui.libAffected', { count: n }) },
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('admin.ui.libMove')}
      footer={
        <>
          <Button onClick={onClose}>{t('admin.ui.cancel')}</Button>
          <Button variant="primary" disabled={lessonIds.length === 0} loading={action.busy} onClick={() => void action.run().then(onClose)}>
            {t('admin.ui.apply')}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-xs text-fg-muted">{t('admin.sections.lessons')}: {lessonIds.length}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label={t('admin.ui.libMoveTarget')} className="sm:col-span-3">
          {(id) => (
            <Select id={id} value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
              <option value="">{t('admin.ui.none')} (keep chapter)</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {pickLocalized(collections.find((col) => col.id === c.collection_id)?.title_translations, locale)} › {c.sort_order}. {pickLocalized(c.title_translations, locale) || shortId(c.id)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.libRenumberStart')}>{(id) => <Input id={id} type="number" min={0} value={start} onChange={(e) => setStart(Number(e.target.value))} />}</Field>
        <Field label={t('admin.ui.libRenumberStep')}>{(id) => <Input id={id} type="number" min={1} value={step} onChange={(e) => setStep(Number(e.target.value))} />}</Field>
      </div>
    </Dialog>
  );
}

function SplitDialog({ open, onClose, rows, chapters }: { open: boolean; onClose: () => void; rows: LibraryAssetRow[]; chapters: ChapterOption[] }) {
  const { t, locale } = useI18n();
  const [title, setTitle] = useState('');
  const lessons = rows.flatMap((r) => r.lessonLinks.map((l) => l.lesson)).filter((l): l is NonNullable<typeof l> => Boolean(l));
  const sourceChapter = chapters.find((c) => c.id === lessons[0]?.chapter_id);
  const action = useAction(
    async () => {
      if (!sourceChapter) throw new Error('No source chapter');
      const body: ChapterCreateRequest = { collectionId: sourceChapter.collection_id, titleTranslations: { [locale]: title }, summaryTranslations: {}, sortOrder: sourceChapter.sort_order + 1, coverVisualAssetId: null, idempotencyKey: newIdempotencyKey('chp') };
      const created = await browserApi().call('adminChapterCreate', { body, idempotencyKey: body.idempotencyKey });
      const ids = [...new Set(lessons.map((l) => l.id))];
      for (const [i, id] of ids.entries()) await browserApi().call('adminAudioLessonPatch', { params: { id }, body: { chapterId: created.id, sortOrder: i + 1 } });
      return ids.length;
    },
    { successMessage: (n) => t('admin.ui.libAffected', { count: n }) },
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('admin.ui.libSplit')}
      footer={
        <>
          <Button onClick={onClose}>{t('admin.ui.cancel')}</Button>
          <Button variant="primary" disabled={!title || !sourceChapter} loading={action.busy} onClick={() => void action.run().then(onClose)}>
            {t('admin.ui.apply')}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-xs text-fg-muted">{t('admin.ui.libSplitHint')}</p>
      {!sourceChapter ? <Notice tone="warning">{t('admin.ui.lsNoAssets')}</Notice> : null}
      <Field label={t('admin.ui.title')} required>
        {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

function MergeDialog({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: LibraryAssetRow[] }) {
  const { t } = useI18n();
  const groups = useMemo(() => {
    const byHash = new Map<string, LibraryAssetRow[]>();
    for (const r of rows) byHash.set(r.checksum_sha256, [...(byHash.get(r.checksum_sha256) ?? []), r]);
    return [...byHash.values()].filter((g) => g.length > 1);
  }, [rows]);
  const action = useAction(
    async () => {
      let relinked = 0;
      for (const group of groups) {
        const lessons = group.flatMap((r) => r.lessonLinks.map((l) => ({ lessonId: l.lesson?.id, assetId: r.id, assetType: l.asset_type as AudioAssetType }))).filter((x): x is { lessonId: string; assetId: string; assetType: AudioAssetType } => Boolean(x.lessonId));
        const primaryLesson = lessons[0]?.lessonId;
        if (!primaryLesson) continue;
        for (const link of lessons.slice(1)) {
          if (link.lessonId === primaryLesson) continue;
          // Attaching an asset that is linked elsewhere moves it (200 + movedFromLessonId); no separate detach needed.
          await browserApi().call('adminLessonAssetAttach', { params: { id: primaryLesson }, body: { assetId: link.assetId, assetType: link.assetType, sortOrder: relinked } });
          relinked += 1;
        }
      }
      return relinked;
    },
    { successMessage: (n) => t('admin.ui.libAffected', { count: n }) },
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('admin.ui.libMerge')}
      footer={
        <>
          <Button onClick={onClose}>{t('admin.ui.cancel')}</Button>
          <Button variant="primary" disabled={groups.length === 0} loading={action.busy} onClick={() => void action.run().then(onClose)}>
            {t('admin.ui.apply')}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-xs text-fg-muted">{t('admin.ui.libMergeHint')}</p>
      {groups.length === 0 ? (
        <Notice tone="info">{t('admin.ui.emptyFiltered')}</Notice>
      ) : (
        <ul className="space-y-1 text-xs">
          {groups.map((g) => (
            <li key={g[0]!.checksum_sha256}>
              <code className="font-mono">{g[0]!.checksum_sha256.slice(0, 12)}…</code> × {g.length}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------- process

const PROCESS_OPS = ['verify', 'extract_metadata', 'transcode', 'transcribe', 'align', 'detect_language', 'describe', 'segment_lessons', 'generate_cover'] as const;

function ProcessDialog({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: LibraryAssetRow[] }) {
  const { t } = useI18n();
  const [ops, setOps] = useState<Set<(typeof PROCESS_OPS)[number]>>(new Set(['extract_metadata']));
  const [force, setForce] = useState(false);
  const [priority, setPriority] = useState(5);
  const [queued, setQueued] = useState<Array<{ id: string; type: string; state: string; reused: boolean }>>([]);
  const action = useAction(
    async () => {
      const out: typeof queued = [];
      for (const r of rows) {
        const res = await browserApi().call('adminAssetProcess', { params: { id: r.id }, body: { operations: [...ops], priority, force, idempotencyKey: newIdempotencyKey('proc') } });
        for (const j of res.jobs) out.push({ id: j.id, type: j.type, state: j.state, reused: res.reusedFromHash });
      }
      setQueued(out);
      return out.length;
    },
    { successMessage: (n) => t('admin.jobs.state.pending') + ` × ${n}` },
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('admin.jobs.process')}
      footer={
        <>
          <Button onClick={onClose}>{t('admin.ui.close')}</Button>
          <Button variant="primary" disabled={ops.size === 0 || rows.length === 0} loading={action.busy} onClick={() => void action.run()}>
            {t('admin.jobs.runNow')}
          </Button>
        </>
      }
    >
      <div className="grid gap-1 sm:grid-cols-3">
        {PROCESS_OPS.map((op) => (
          <Checkbox
            key={op}
            label={op}
            checked={ops.has(op)}
            onChange={(e) =>
              setOps((s) => {
                const next = new Set(s);
                if (e.target.checked) next.add(op);
                else next.delete(op);
                return next;
              })
            }
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Checkbox label={t('admin.ui.libForce')} checked={force} onChange={(e) => setForce(e.target.checked)} />
        <Field label="priority">{(id) => <Input id={id} type="number" min={0} max={10} className="w-20" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />}</Field>
      </div>
      {queued.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs">
          {queued.map((j) => (
            <li key={j.id} className="flex items-center gap-2">
              <Link href={`/jobs?assetId=&q=${j.id}`} className="font-mono text-accent">
                {j.id.slice(0, 8)}
              </Link>
              <span>{j.type}</span>
              <JobBadge state={j.state} />
              {j.reused ? <Badge tone="info">cached by hash</Badge> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {action.error ? <Notice tone="error">{action.error}</Notice> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------- CSV import

function CsvImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const parsed = useMemo(() => (text.trim() ? parseCsvManifest(text) : null), [text]);
  const [report, setReport] = useState<{ jobId: string; rowCount: number; matched: number; unmatched: number; validationErrors: number; dryRun: boolean } | null>(null);
  const action = useAction(
    async () => {
      if (!parsed) throw new Error('Nothing to import');
      const res = await browserApi().call('adminImportManifest', { body: { format: 'csv', rows: parsed.rows, dryRun, idempotencyKey: newIdempotencyKey('csv') } });
      setReport({ jobId: res.jobId, rowCount: res.rowCount, matched: res.matched, unmatched: res.unmatched.length, validationErrors: res.validationErrors.length, dryRun: res.dryRun });
      return res;
    },
    { successMessage: (res) => `${res.matched}/${res.rowCount}` },
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={t('admin.upload.importManifest')}
      footer={
        <>
          <Button onClick={onClose}>{t('admin.ui.close')}</Button>
          <Button variant="primary" disabled={!parsed || parsed.rows.length === 0} loading={action.busy} onClick={() => void action.run()}>
            {dryRun ? t('admin.ui.libDryRun') : t('admin.ui.apply')}
          </Button>
        </>
      }
    >
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label={t('admin.upload.importManifest')}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setText(await f.text());
        }}
      />
      <Textarea className="mt-2 font-mono text-xs" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="legacy_path,collection_title,chapter_title,chapter_order,lesson_title,lesson_order,target_variety_id,instruction_language,speaker_name,level,topic,tags,description,license_id,rights_owner" />
      <div className="mt-2 flex items-center gap-3 text-xs">
        <Checkbox label={t('admin.ui.libDryRun')} checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
        <span className="text-fg-muted">{t('admin.ui.libDryRunHint')}</span>
      </div>
      {parsed ? (
        <div className="mt-2 text-xs">
          <p>
            {t('admin.ui.libCsvRows', { count: parsed.rows.length })} · {t('admin.ui.libCsvErrors', { count: parsed.errors.length })}
            {parsed.unknownColumns.length ? ` · unknown columns: ${parsed.unknownColumns.join(', ')}` : ''}
          </p>
          {parsed.errors.length > 0 ? (
            <ul className="mt-1 max-h-32 overflow-auto text-error">
              {parsed.errors.slice(0, 50).map((e, i) => (
                <li key={i}>
                  row {e.row} · {e.field}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {report ? (
        <Notice tone={report.dryRun ? 'info' : 'success'}>
          job {report.jobId.slice(0, 8)} · {report.matched}/{report.rowCount} matched · {report.unmatched} unmatched · {report.validationErrors} invalid {report.dryRun ? '(dry run)' : ''}
        </Notice>
      ) : null}
      {action.error ? <Notice tone="error">{action.error}</Notice> : null}
    </Dialog>
  );
}
