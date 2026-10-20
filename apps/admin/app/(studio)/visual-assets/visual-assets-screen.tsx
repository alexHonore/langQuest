'use client';
/**
 * §10.2A visual assets: upload (image-only multipart) → register (type, alt text, focal point,
 * crop, license, origin) → assign to a course cover / audio cover / scene / character portrait,
 * edit metadata and review status, replace bytes under a NEW immutable key, unassign. Every
 * write goes to the LangQuest API through the contracts client; the list is API-paged. Honest
 * states: API unreachable, media storage (R2) not configured on the deployment (server message
 * shown verbatim), no preview for stored assets (the Studio has no signed URL route for them).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CONTENT_ORIGIN_VALUES,
  REVIEW_STATUS_VALUES,
  VISUAL_ASSET_TYPE_VALUES,
  type ContentOrigin,
  type FocalPoint,
  type JsonObject,
  type ReviewStatus,
  type VisualAssetAssignRequest,
  type VisualAssetDto,
  type VisualAssetPatchRequest,
  type VisualAssetRegisterRequest,
  type VisualAssetReplaceRequest,
  type VisualAssetType,
  type VisualAssetsListQuery,
} from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { ApiClientError, describeApiError, isUnreachable } from '@/src/lib/api';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { formatBytes, formatDateTime, newIdempotencyKey, pickLocalized, shortId } from '@/src/lib/format';
import type { ChapterOption, CollectionOption, RightsOption } from '@/src/lib/queries/library';
import { useImageUpload } from '@/src/lib/upload/use-image-upload';
import { PICKABLE_ENTITY_TABLES, UPLOAD_ORIGINS, VISUAL_ENTITY_TABLES, slotsFor, suggestedTypeForSlot, type CropRect, type VisualAssetEntityTable, type VisualAssetSlot } from '@/src/lib/visual/slots';
import { Badge } from '@/src/components/badges';
import { DataTable, type Column } from '@/src/components/data-table';
import { Dialog } from '@/src/components/dialog';
import { FocalPointPicker } from '@/src/components/focal-point';
import { LocalizedTextEditor } from '@/src/components/forms';
import { ImageUploadField } from '@/src/components/image-upload';
import { SetupCard } from '@/src/components/setup-card';
import { useDeployment } from '@/src/lib/setup/context';
import { Button, Checkbox, ErrorState, Field, Input, Mono, Notice, Select, Textarea } from '@/src/components/ui';

export interface LessonPick {
  id: string;
  title_translations: unknown;
}

interface Props {
  options: { collections: CollectionOption[]; chapters: ChapterOption[]; rights: RightsOption[] };
  lessons: LessonPick[];
  canEdit: boolean;
}

type Filters = { type: string; reviewStatus: string; origin: string; unassigned: '' | 'true' | 'false'; entityTable: string; entityId: string; q: string };
const EMPTY_FILTERS: Filters = { type: '', reviewStatus: '', origin: '', unassigned: '', entityTable: '', entityId: '', q: '' };

const REVIEW_TONE: Record<ReviewStatus, 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'accent'> = { draft: 'neutral', review_needed: 'warning', in_review: 'info', approved: 'success', rejected: 'error' };

function toQuery(f: Filters, cursor: string | null): VisualAssetsListQuery {
  return {
    type: (f.type || undefined) as VisualAssetsListQuery['type'],
    reviewStatus: (f.reviewStatus || undefined) as VisualAssetsListQuery['reviewStatus'],
    origin: (f.origin || undefined) as VisualAssetsListQuery['origin'],
    entityTable: (f.entityTable || undefined) as VisualAssetsListQuery['entityTable'],
    entityId: f.entityId.length === 36 ? f.entityId : undefined,
    unassigned: f.unassigned === '' ? undefined : f.unassigned === 'true',
    q: f.q || undefined,
    cursor: cursor ?? undefined,
    limit: 50,
  };
}

export function VisualAssetsScreen({ options, lessons, canEdit }: Props) {
  const { t, locale } = useI18n();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; page: { items: VisualAssetDto[]; nextCursor: string | null } | null; error: { unreachable: boolean; message: string } | null } | null>(null);
  const [selected, setSelected] = useState<VisualAssetDto | null>(null);
  const [creating, setCreating] = useState(false);
  const { mediaAvailable } = useDeployment();
  const canUpload = canEdit && mediaAvailable;
  const cursor = cursors[cursors.length - 1] ?? null;
  // One request per (filters, cursor, nonce); `loading` is derived, so the effect never sets state synchronously.
  const key = useMemo(() => JSON.stringify([filters, cursor, nonce]), [filters, cursor, nonce]);
  useEffect(() => {
    let cancelled = false;
    browserApi()
      .call('adminVisualAssetsList', { query: toQuery(filters, cursor) as Record<string, string | number | boolean | undefined> })
      .then((res) => {
        if (!cancelled) setResult({ key, page: { items: res.items, nextCursor: res.nextCursor }, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setResult((prev) => ({ key, page: prev?.page ?? null, error: { unreachable: isUnreachable(err), message: describeApiError(err).message } }));
      });
    return () => {
      cancelled = true;
    };
  }, [key, filters, cursor]);
  const loading = result?.key !== key;
  const page = result?.page ?? null;
  const error = result?.key === key ? result.error : null;
  const load = useCallback(async () => setNonce((n) => n + 1), []);

  const setFilter = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setCursors([null]);
  };

  const columns: Column<VisualAssetDto>[] = [
    { key: 'id', header: t('admin.ui.id'), render: (a) => <button type="button" className="font-mono text-xs text-accent-text hover:underline" onClick={() => setSelected(a)}>{shortId(a.id)}</button> },
    { key: 'type', header: t('admin.ui.type'), render: (a) => <span className="text-xs">{a.type}</span> },
    { key: 'origin', header: t('admin.ui.vaOrigin'), render: (a) => <Badge>{a.origin}</Badge> },
    { key: 'review', header: t('admin.ui.status'), render: (a) => <Badge tone={REVIEW_TONE[a.reviewStatus]}>{t(`admin.ui.reviewStatus.${a.reviewStatus}`)}</Badge> },
    { key: 'dims', header: t('admin.ui.vaDimensions'), className: 'tabular-nums whitespace-nowrap', render: (a) => `${a.dimensions.width}×${a.dimensions.height}` },
    { key: 'file', header: t('admin.ui.size'), className: 'whitespace-nowrap text-fg-muted', render: (a) => `${a.mimeType} · ${formatBytes(a.byteLength, locale)}` },
    {
      key: 'alt',
      header: t('admin.ui.vaAltText'),
      render: (a) => {
        const langs = Object.keys(a.altTextTranslations);
        return langs.length === 0 ? <span className="text-xs text-warning">{t('admin.ui.vaAltMissing')}</span> : <span className="text-xs">{pickLocalized(a.altTextTranslations, locale)} <span className="text-fg-muted">({langs.join(', ')})</span></span>;
      },
    },
    {
      key: 'assignments',
      header: t('admin.ui.vaAssignments'),
      render: (a) => (a.assignments.length === 0 ? <span className="text-xs text-fg-muted">{t('admin.ui.vaUnassigned')}</span> : <span className="text-xs">{a.assignments.map((x) => `${x.entityTable}/${x.slot}:${shortId(x.entityId)}`).join(', ')}</span>),
    },
    { key: 'replaced', header: t('admin.ui.vaReplacedBy'), render: (a) => (a.replacedByAssetId ? <code className="font-mono text-xs">{shortId(a.replacedByAssetId)}</code> : '—') },
    { key: 'updated', header: t('admin.ui.updated'), className: 'whitespace-nowrap text-fg-muted', render: (a) => formatDateTime(a.updatedAt, locale) },
  ];

  return (
    <div className="space-y-3">
      <div role="search" className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <Field label={t('admin.ui.type')}>
          {(id) => (
            <Select id={id} className="w-auto py-1 text-xs" value={filters.type} onChange={(e) => setFilter({ type: e.target.value })}>
              <option value="">{t('admin.ui.all')}</option>
              {VISUAL_ASSET_TYPE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.status')}>
          {(id) => (
            <Select id={id} className="w-auto py-1 text-xs" value={filters.reviewStatus} onChange={(e) => setFilter({ reviewStatus: e.target.value })}>
              <option value="">{t('admin.ui.all')}</option>
              {REVIEW_STATUS_VALUES.map((v) => (
                <option key={v} value={v}>
                  {t(`admin.ui.reviewStatus.${v}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.vaOrigin')}>
          {(id) => (
            <Select id={id} className="w-auto py-1 text-xs" value={filters.origin} onChange={(e) => setFilter({ origin: e.target.value })}>
              <option value="">{t('admin.ui.all')}</option>
              {CONTENT_ORIGIN_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.vaAssignments')}>
          {(id) => (
            <Select id={id} className="w-auto py-1 text-xs" value={filters.unassigned} onChange={(e) => setFilter({ unassigned: e.target.value as Filters['unassigned'] })}>
              <option value="">{t('admin.ui.all')}</option>
              <option value="true">{t('admin.ui.vaUnassigned')}</option>
              <option value="false">{t('admin.ui.vaAssigned')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.vaEntityTable')}>
          {(id) => (
            <Select id={id} className="w-auto py-1 text-xs" value={filters.entityTable} onChange={(e) => setFilter({ entityTable: e.target.value })}>
              <option value="">{t('admin.ui.all')}</option>
              {VISUAL_ENTITY_TABLES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.vaEntityId')}>{(id) => <Input id={id} className="w-72 py-1 font-mono text-xs" placeholder="uuid" value={filters.entityId} onChange={(e) => setFilter({ entityId: e.target.value.trim() })} />}</Field>
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({ q: String(new FormData(e.currentTarget).get('q') ?? '') });
          }}
        >
          <span className="text-xs font-medium text-fg-secondary">{t('common.search')}</span>
          <Input name="q" type="search" defaultValue={filters.q} className="w-48 py-1 text-xs" />
        </form>
        <span className="ms-auto flex gap-2">
          <Button size="sm" onClick={() => void load()} loading={loading}>
            {t('admin.ui.refresh')}
          </Button>
          {canUpload && (page?.items.length ?? 0) > 0 ? (
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              {t('admin.ui.vaNew')}
            </Button>
          ) : null}
        </span>
      </div>
      <p className="text-xs text-fg-muted">{t('admin.ui.vaFilterNote')}</p>
      {canEdit && !mediaAvailable ? <SetupCard keys={['api', 'media']} /> : null}
      {error ? <ErrorState title={error.unreachable ? t('admin.ui.apiUnreachableTitle') : t('admin.ui.errorTitle')} message={error.message} onRetry={() => void load()} retryLabel={t('common.retry')} /> : null}
      <DataTable
        columns={columns}
        rows={page?.items ?? []}
        rowKey={(a) => a.id}
        loading={loading && !page}
        empty={t('admin.ui.vaEmptyHint')}
        emptyAction={
          canUpload ? (
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              {t('admin.ui.vaNew')}
            </Button>
          ) : null
        }
        caption={t('admin.sections.visualAssets')}
        pagination={{
          page: cursors.length,
          hasPrev: cursors.length > 1,
          hasNext: Boolean(page?.nextCursor),
          onPrev: () => setCursors((c) => c.slice(0, -1)),
          onNext: () => page?.nextCursor && setCursors((c) => [...c, page.nextCursor]),
        }}
      />
      <NewAssetDialog
        open={creating}
        onClose={() => setCreating(false)}
        rights={options.rights}
        onCreated={(asset) => {
          setCreating(false);
          void load();
          setSelected(asset);
        }}
      />
      {selected ? (
        <AssetDetailDialog
          asset={selected}
          onClose={() => setSelected(null)}
          onChanged={(next) => {
            setSelected(next);
            void load();
          }}
          options={options}
          lessons={lessons}
          canEdit={canEdit}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------- new asset

interface RegisterForm {
  type: VisualAssetType;
  styleVersion: string;
  altTextTranslations: Record<string, string>;
  focalPoint: FocalPoint | null;
  crop: CropRect | null;
  localeNeutral: boolean;
  origin: ContentOrigin;
  contentRightsId: string | null;
  generationBrief: string;
}

const EMPTY_REGISTER: RegisterForm = { type: 'audio_cover', styleVersion: 'v1', altTextTranslations: { en: '' }, focalPoint: null, crop: null, localeNeutral: true, origin: 'original_upload', contentRightsId: null, generationBrief: '' };

function parseBrief(text: string): JsonObject | null | 'invalid' {
  if (!text.trim()) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : 'invalid';
  } catch {
    return 'invalid';
  }
}

function RightsSelect({ id, value, onChange, rights }: { id: string; value: string | null; onChange: (v: string | null) => void; rights: RightsOption[] }) {
  const { t } = useI18n();
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{t('admin.ui.none')}</option>
      {rights.map((r) => (
        <option key={r.id} value={r.id}>
          {r.license_id} {r.verified ? '✓' : `(${t('admin.ui.libRightsUnverified')})`} · {shortId(r.id)}
        </option>
      ))}
    </Select>
  );
}

function CropFields({ value, onChange }: { value: CropRect | null; onChange: (v: CropRect | null) => void }) {
  const { t } = useI18n();
  const set = (k: keyof CropRect, n: number) => onChange({ ...(value ?? { x: 0, y: 0, width: 1, height: 1 }), [k]: Math.min(1, Math.max(0, n)) });
  return (
    <div className="space-y-1">
      <Checkbox label={t('admin.ui.vaCrop')} checked={value !== null} onChange={(e) => onChange(e.target.checked ? { x: 0, y: 0, width: 1, height: 1 } : null)} />
      {value ? (
        <div className="flex flex-wrap gap-2">
          {(['x', 'y', 'width', 'height'] as const).map((k) => (
            <Field key={k} label={k}>
              {(id) => <Input id={id} type="number" min={0} max={1} step={0.01} className="w-24" value={value[k]} onChange={(e) => set(k, Number(e.target.value))} />}
            </Field>
          ))}
          {value.x + value.width > 1 || value.y + value.height > 1 ? <p className="w-full text-xs text-error">{t('admin.ui.vaCropOutside')}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function RegisterFields({ form, setForm, rights, previewUrl, showOrigin }: { form: RegisterForm; setForm: (f: RegisterForm) => void; rights: RightsOption[]; previewUrl: string | null; showOrigin: boolean }) {
  const { t } = useI18n();
  const brief = parseBrief(form.generationBrief);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('admin.ui.type')} required>
        {(id) => (
          <Select id={id} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as VisualAssetType })}>
            {VISUAL_ASSET_TYPE_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('admin.ui.vaStyleVersion')} required>{(id) => <Input id={id} value={form.styleVersion} onChange={(e) => setForm({ ...form, styleVersion: e.target.value })} />}</Field>
      <div className="sm:col-span-2">
        <LocalizedTextEditor label={t('admin.ui.vaAltText')} value={form.altTextTranslations} onChange={(v) => setForm({ ...form, altTextTranslations: v })} />
        <p className="mt-1 text-xs text-fg-muted">{t('admin.ui.vaAltHint')}</p>
      </div>
      <div className="sm:col-span-2">
        <FocalPointPicker label={t('admin.ui.vaFocal')} value={form.focalPoint} onChange={(v) => setForm({ ...form, focalPoint: v })} previewUrl={previewUrl} />
      </div>
      <div className="sm:col-span-2">
        <CropFields value={form.crop} onChange={(v) => setForm({ ...form, crop: v })} />
      </div>
      {showOrigin ? (
        <Field label={t('admin.ui.vaOrigin')} required hint={t('admin.ui.vaOriginHint')}>
          {(id) => (
            <Select id={id} value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value as ContentOrigin })}>
              {UPLOAD_ORIGINS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <Field label={t('admin.ui.colRightsLink')} hint={t('admin.ui.vaRightsHint')}>
        {(id) => <RightsSelect id={id} value={form.contentRightsId} onChange={(v) => setForm({ ...form, contentRightsId: v })} rights={rights} />}
      </Field>
      <Checkbox label={t('admin.ui.vaLocaleNeutral')} checked={form.localeNeutral} onChange={(e) => setForm({ ...form, localeNeutral: e.target.checked })} />
      {form.origin === 'ai_generated' || form.generationBrief ? (
        <Field label={t('admin.ui.vaBrief')} className="sm:col-span-2" hint={t('admin.ui.vaBriefHint')} error={brief === 'invalid' ? t('admin.ui.vaBriefInvalid') : undefined}>
          {(id) => <Textarea id={id} value={form.generationBrief} onChange={(e) => setForm({ ...form, generationBrief: e.target.value })} className="font-mono text-xs" />}
        </Field>
      ) : null}
    </div>
  );
}

function NewAssetDialog({ open, onClose, rights, onCreated }: { open: boolean; onClose: () => void; rights: RightsOption[]; onCreated: (asset: VisualAssetDto) => void }) {
  const { t } = useI18n();
  const upload = useImageUpload();
  const [form, setForm] = useState<RegisterForm>(EMPTY_REGISTER);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const keyRef = useRef<{ uploadId: string; key: string } | null>(null);
  const uploadId = upload.verifiedUploadId;
  const brief = parseBrief(form.generationBrief);
  const altOk = typeof form.altTextTranslations.en === 'string' && form.altTextTranslations.en.trim().length > 0;
  const cropOk = !form.crop || (form.crop.width > 0 && form.crop.height > 0 && form.crop.x + form.crop.width <= 1 && form.crop.y + form.crop.height <= 1);
  const register = useAction(
    async () => {
      if (!uploadId) throw new Error('no verified upload');
      // One idempotency key per verified upload: a retry after a network error replays the same registration.
      if (keyRef.current?.uploadId !== uploadId) keyRef.current = { uploadId, key: newIdempotencyKey('vis') };
      const body: VisualAssetRegisterRequest = {
        uploadId,
        type: form.type,
        styleVersion: form.styleVersion.trim(),
        altTextTranslations: form.altTextTranslations,
        focalPoint: form.focalPoint,
        crop: form.crop,
        localeNeutral: form.localeNeutral,
        origin: form.origin,
        contentRightsId: form.contentRightsId,
        generationBrief: brief === 'invalid' ? null : brief,
        idempotencyKey: keyRef.current.key,
      };
      try {
        return await browserApi().call('adminVisualAssetRegister', { body, idempotencyKey: body.idempotencyKey });
      } catch (err) {
        const dup = err instanceof ApiClientError && err.code === 'conflict' ? (err.details as { duplicateOfAssetId?: string } | undefined)?.duplicateOfAssetId : undefined;
        setDuplicateOf(dup ?? null);
        throw err;
      }
    },
    { successMessage: t('admin.ui.vaRegistered'), refresh: false },
  );
  const close = () => {
    upload.reset();
    setForm(EMPTY_REGISTER);
    setDuplicateOf(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      wide
      title={t('admin.ui.vaNew')}
      footer={
        <>
          <Button onClick={close}>{t('admin.ui.cancel')}</Button>
          <Button variant="primary" disabled={!uploadId || !altOk || !form.styleVersion.trim() || brief === 'invalid' || !cropOk} loading={register.busy} onClick={() => void register.run().then((asset) => asset && onCreated(asset))}>
            {t('admin.ui.vaRegister')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ol className="flex flex-wrap gap-3 text-xs text-fg-muted">
          <li>1. {t('admin.ui.vaStepUpload')}</li>
          <li>2. {t('admin.ui.vaStepDescribe')}</li>
          <li>3. {t('admin.ui.vaStepAssign')}</li>
        </ol>
        <ImageUploadField upload={upload} />
        {!uploadId ? <p className="text-xs text-fg-muted">{t('admin.ui.vaNeedsVerified')}</p> : null}
        <RegisterFields form={form} setForm={setForm} rights={rights} previewUrl={upload.state.previewUrl} showOrigin />
        {duplicateOf ? (
          <Notice tone="warning">
            {t('admin.ui.vaDuplicateRegistered')} <Mono>{duplicateOf}</Mono>
          </Notice>
        ) : null}
        {register.error ? <Notice tone="error">{register.error}</Notice> : null}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------- detail

function AssetDetailDialog({ asset, onClose, onChanged, options, lessons, canEdit }: { asset: VisualAssetDto; onClose: () => void; onChanged: (next: VisualAssetDto) => void; options: Props['options']; lessons: LessonPick[]; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const { mediaAvailable } = useDeployment();
  const editable = canEdit && !asset.replacedByAssetId;
  const [form, setForm] = useState<RegisterForm & { reviewStatus: ReviewStatus }>({
    type: asset.type,
    styleVersion: asset.styleVersion,
    altTextTranslations: { ...asset.altTextTranslations },
    focalPoint: asset.focalPoint,
    crop: null,
    localeNeutral: asset.localeNeutral,
    origin: asset.origin,
    contentRightsId: asset.licenseId,
    generationBrief: asset.generationBrief ? JSON.stringify(asset.generationBrief, null, 2) : '',
    reviewStatus: asset.reviewStatus,
  });
  const brief = parseBrief(form.generationBrief);
  const reload = useCallback(async () => {
    const fresh = await browserApi().call('adminVisualAssetGet', { params: { id: asset.id } });
    onChanged(fresh);
    return fresh;
  }, [asset.id, onChanged]);

  const save = useAction(
    async () => {
      const body: VisualAssetPatchRequest = {
        type: form.type,
        styleVersion: form.styleVersion.trim(),
        altTextTranslations: form.altTextTranslations,
        focalPoint: form.focalPoint,
        localeNeutral: form.localeNeutral,
        contentRightsId: form.contentRightsId,
        generationBrief: brief === 'invalid' ? null : brief,
        ...(form.reviewStatus !== asset.reviewStatus ? { reviewStatus: form.reviewStatus } : {}),
        expectedRevision: asset.revision,
      };
      const res = await browserApi().call('adminVisualAssetPatch', { params: { id: asset.id }, body });
      onChanged(res);
      return res;
    },
    { successMessage: (res) => t('admin.ui.vaSaved', { revision: res.revision }), refresh: false },
  );

  // Assignment
  const [entityTable, setEntityTable] = useState<VisualAssetEntityTable>('audio_course_collections');
  const [slot, setSlot] = useState<VisualAssetSlot>('cover');
  const [entityId, setEntityId] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const slots = slotsFor(entityTable);
  const pickable = PICKABLE_ENTITY_TABLES.includes(entityTable);
  const pickOptions = useMemo(() => {
    if (entityTable === 'audio_course_collections') return options.collections.map((c) => ({ id: c.id, label: pickLocalized(c.title_translations, locale) || shortId(c.id) }));
    if (entityTable === 'audio_chapters') return options.chapters.map((c) => ({ id: c.id, label: `${pickLocalized(options.collections.find((col) => col.id === c.collection_id)?.title_translations, locale)} › ${c.sort_order}. ${pickLocalized(c.title_translations, locale) || shortId(c.id)}` }));
    if (entityTable === 'audio_lessons') return lessons.map((l) => ({ id: l.id, label: pickLocalized(l.title_translations, locale) || shortId(l.id) }));
    return [];
  }, [entityTable, options, lessons, locale]);
  const assign = useAction(
    async () => {
      const body: VisualAssetAssignRequest = { entityTable, entityId, slot, replaceExisting, expectedRevision: asset.revision, idempotencyKey: newIdempotencyKey('asg') };
      const res = await browserApi().call('adminVisualAssetAssign', { params: { id: asset.id }, body, idempotencyKey: body.idempotencyKey });
      await reload();
      return res;
    },
    { successMessage: (res) => `${t('admin.ui.vaAssignedOk', { slot: res.assignment.slot })}${res.replacedAssetId ? ` · ${t('admin.ui.vaReplacedPrevious', { id: shortId(res.replacedAssetId) })}` : ''}${res.manifestInvalidated ? ` · ${t('admin.publish.manifestInvalidated')}` : ''}`, refresh: false },
  );
  const unassign = useAction(
    async (target: { entityTable: VisualAssetEntityTable; entityId: string; slot: VisualAssetSlot }) => {
      const res = await browserApi().call('adminVisualAssetUnassign', { params: { id: asset.id }, body: { ...target, expectedRevision: asset.revision } });
      await reload();
      return res;
    },
    { successMessage: (res) => (res.removed ? t('admin.ui.vaUnassignedOk') : t('admin.ui.vaUnassignNoop')), refresh: false },
  );

  // Replacement (new bytes under a NEW immutable key)
  const replacement = useImageUpload();
  const [keepFocalPoint, setKeepFocalPoint] = useState(true);
  const [keepCrop, setKeepCrop] = useState(false);
  const [replaceNote, setReplaceNote] = useState('');
  const replaceKey = useRef<{ uploadId: string; key: string } | null>(null);
  const replace = useAction(
    async () => {
      const uploadId = replacement.verifiedUploadId;
      if (!uploadId) throw new Error('no verified upload');
      if (replaceKey.current?.uploadId !== uploadId) replaceKey.current = { uploadId, key: newIdempotencyKey('rep') };
      const body: VisualAssetReplaceRequest = { uploadId, keepFocalPoint, keepCrop, note: replaceNote || undefined, expectedRevision: asset.revision, idempotencyKey: replaceKey.current.key };
      const res = await browserApi().call('adminVisualAssetReplace', { params: { id: asset.id }, body, idempotencyKey: body.idempotencyKey });
      replacement.reset();
      onChanged(res.asset);
      return res;
    },
    { successMessage: (res) => t('admin.ui.vaReplacedOk', { id: shortId(res.asset.id), moved: res.movedAssignments, key: res.asset.storageKey }), refresh: false },
  );

  return (
    <Dialog open onClose={onClose} wide title={`${t('admin.ui.vaAsset')} ${shortId(asset.id)} · ${asset.type}`}>
      <div className="space-y-5">
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          <dt className="text-fg-muted">{t('admin.ui.id')}</dt>
          <dd><Mono>{asset.id}</Mono></dd>
          <dt className="text-fg-muted">{t('admin.ui.vaStorageKey')}</dt>
          <dd><Mono>{asset.storageKey}</Mono></dd>
          <dt className="text-fg-muted">{t('admin.library.contentHash')}</dt>
          <dd><Mono>{asset.contentHash}</Mono></dd>
          <dt className="text-fg-muted">{t('admin.ui.vaDimensions')}</dt>
          <dd>{asset.dimensions.width}×{asset.dimensions.height} · {asset.mimeType} · {formatBytes(asset.byteLength, locale)}</dd>
          <dt className="text-fg-muted">{t('admin.ui.vaModeration')}</dt>
          <dd>{asset.moderationStatus}</dd>
          <dt className="text-fg-muted">{t('admin.ui.vaRevision')}</dt>
          <dd>{asset.revision} · {t('admin.ui.updated')} {formatDateTime(asset.updatedAt, locale)}</dd>
        </dl>
        {asset.replacedByAssetId ? (
          <Notice tone="warning">
            {t('admin.ui.vaReplacedNotice')} <Mono>{asset.replacedByAssetId}</Mono>
          </Notice>
        ) : null}

        <section className="space-y-3 rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold">{t('admin.ui.vaMetadata')}</h3>
          <RegisterFields form={form} setForm={(f) => setForm({ ...form, ...f })} rights={options.rights} previewUrl={null} showOrigin={false} />
          <Field label={t('admin.ui.vaReviewStatus')} hint={t('admin.ui.vaReviewHint')}>
            {(id) => (
              <Select id={id} value={form.reviewStatus} disabled={!editable} onChange={(e) => setForm({ ...form, reviewStatus: e.target.value as ReviewStatus })}>
                {REVIEW_STATUS_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {t(`admin.ui.reviewStatus.${v}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex items-center gap-2">
            <Button variant="primary" disabled={!editable || brief === 'invalid' || !form.styleVersion.trim()} loading={save.busy} onClick={() => void save.run()}>
              {t('admin.ui.save')}
            </Button>
            {!canEdit ? <span className="text-xs text-fg-muted">{t('admin.ui.vaReadOnly')}</span> : null}
          </div>
          {save.error ? <Notice tone="error">{save.error}</Notice> : null}
        </section>

        <section className="space-y-3 rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold">{t('admin.ui.vaAssignments')}</h3>
          {asset.assignments.length === 0 ? <p className="text-xs text-fg-muted">{t('admin.ui.vaUnassigned')}</p> : null}
          <ul className="space-y-1 text-sm">
            {asset.assignments.map((a) => (
              <li key={`${a.entityTable}:${a.entityId}:${a.slot}`} className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{a.slot}</Badge>
                <span className="text-xs">{a.entityTable}</span>
                {a.entityTable === 'audio_course_collections' ? <Link href={`/collections/${a.entityId}`} className="font-mono text-xs text-accent-text hover:underline">{shortId(a.entityId)}</Link> : a.entityTable === 'audio_chapters' ? <Link href={`/chapters/${a.entityId}`} className="font-mono text-xs text-accent-text hover:underline">{shortId(a.entityId)}</Link> : a.entityTable === 'audio_lessons' ? <Link href={`/lessons/${a.entityId}`} className="font-mono text-xs text-accent-text hover:underline">{shortId(a.entityId)}</Link> : <Mono>{a.entityId}</Mono>}
                <span className="text-xs text-fg-muted">{a.assignedAt ? formatDateTime(a.assignedAt, locale) : ''}</span>
                {editable ? (
                  <Button size="sm" variant="ghost" className="ms-auto" loading={unassign.busy} onClick={() => void unassign.run({ entityTable: a.entityTable, entityId: a.entityId, slot: a.slot })}>
                    {t('admin.ui.vaUnassign')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {editable ? (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-2">
              <Field label={t('admin.ui.vaEntityTable')}>
                {(id) => (
                  <Select
                    id={id}
                    value={entityTable}
                    onChange={(e) => {
                      const table = e.target.value as VisualAssetEntityTable;
                      setEntityTable(table);
                      setSlot(slotsFor(table)[0]!);
                      setEntityId('');
                    }}
                  >
                    {VISUAL_ENTITY_TABLES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('admin.ui.vaSlot')} hint={form.type !== suggestedTypeForSlot(slot, entityTable) ? t('admin.ui.vaSlotTypeHint', { type: suggestedTypeForSlot(slot, entityTable) }) : undefined}>
                {(id) => (
                  <Select id={id} value={slot} onChange={(e) => setSlot(e.target.value as VisualAssetSlot)}>
                    {slots.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('admin.ui.vaEntityId')} className="min-w-64 flex-1">
                {(id) =>
                  pickable ? (
                    <Select id={id} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                      <option value="">{t('admin.ui.none')}</option>
                      {pickOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input id={id} className="font-mono text-xs" placeholder="uuid" value={entityId} onChange={(e) => setEntityId(e.target.value.trim())} />
                  )
                }
              </Field>
              <Checkbox label={t('admin.ui.vaReplaceExisting')} checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
              <Button disabled={entityId.length !== 36} loading={assign.busy} onClick={() => void assign.run()}>
                {t('admin.ui.vaAssign')}
              </Button>
            </div>
          ) : null}
          {assign.error ? <Notice tone="error">{assign.error}</Notice> : null}
        </section>

        {editable && mediaAvailable ? (
          <section className="space-y-3 rounded-md border border-border p-3">
            <h3 className="text-sm font-semibold">{t('admin.ui.vaReplace')}</h3>
            <p className="text-xs text-fg-muted">{t('admin.ui.vaReplaceHint')}</p>
            <ImageUploadField upload={replacement} />
            <div className="flex flex-wrap items-end gap-3">
              <Checkbox label={t('admin.ui.vaKeepFocal')} checked={keepFocalPoint} onChange={(e) => setKeepFocalPoint(e.target.checked)} />
              <Checkbox label={t('admin.ui.vaKeepCrop')} checked={keepCrop} onChange={(e) => setKeepCrop(e.target.checked)} />
              <Field label={t('admin.ui.pbNote')} className="flex-1">{(id) => <Input id={id} value={replaceNote} onChange={(e) => setReplaceNote(e.target.value)} />}</Field>
              <Button variant="danger" disabled={!replacement.verifiedUploadId} loading={replace.busy} onClick={() => void replace.run()}>
                {t('admin.ui.vaReplace')}
              </Button>
            </div>
            {replace.error ? <Notice tone="error">{replace.error}</Notice> : null}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
