'use client';
import { useMemo, useState } from 'react';
import { LICENSE_NAMES, buildAttributionText, canPublish } from '@langquest/media';
import type { ContentRightsCreateRequest, ContentRightsPatchRequest, ContentRightsRevokeRequest } from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { formatDateTime, newIdempotencyKey, shortId } from '@/src/lib/format';
import { Button, Checkbox, Field, Input, Notice, Select, Textarea } from '@/src/components/ui';
import { Dialog } from '@/src/components/dialog';
import { Badge, StatusBadge } from '@/src/components/badges';
import { DataTable, type Column } from '@/src/components/data-table';
import { FilterBar, UrlPager, useUrlFilters } from '@/src/components/filters';
import { TagListInput } from '@/src/components/forms';

export interface RightsRow {
  id: string;
  origin_url: string | null;
  authors: string[];
  speakers: string[];
  permission_grant: string;
  license_id: string;
  license_version: string | null;
  commercial_redistribution: boolean;
  attribution_required: boolean;
  attribution_text: string | null;
  alterations_permitted: boolean;
  ai_processing_permitted: boolean;
  voice_rights: 'none' | 'playback_only' | 'synthesis_permitted';
  expires_at: string | null;
  revoked_at: string | null;
  evidence_asset_id: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  verified: boolean;
  created_at: string;
  assets: { id: string }[];
  lessons: { id: string; state: string }[];
  collections: { id: string; state: string }[];
}

/** Form = contract create body minus its idempotency key; `revokedAt` is read-only (revocation is its own API call). */
type RightsUpsert = Omit<ContentRightsCreateRequest, 'idempotencyKey'> & { id?: string; revokedAt: string | null };

const REVOKE_REASONS: ContentRightsRevokeRequest['reason'][] = ['rights_revoked', 'takedown', 'expired', 'other'];

const emptyForm: RightsUpsert = {
  originUrl: null,
  authors: [],
  speakers: [],
  permissionGrant: '',
  licenseId: 'proprietary',
  licenseVersion: null,
  commercialRedistribution: false,
  attributionRequired: true,
  attributionText: null,
  alterationsPermitted: false,
  aiProcessingPermitted: false,
  voiceRights: 'none',
  expiresAt: null,
  revokedAt: null,
  evidenceAssetId: null,
  verified: false,
};

function toForm(r: RightsRow): RightsUpsert {
  return {
    id: r.id,
    originUrl: r.origin_url,
    authors: r.authors,
    speakers: r.speakers,
    permissionGrant: r.permission_grant,
    licenseId: r.license_id,
    licenseVersion: r.license_version,
    commercialRedistribution: r.commercial_redistribution,
    attributionRequired: r.attribution_required,
    attributionText: r.attribution_text,
    alterationsPermitted: r.alterations_permitted,
    aiProcessingPermitted: r.ai_processing_permitted,
    voiceRights: r.voice_rights,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    evidenceAssetId: r.evidence_asset_id,
    verified: r.verified,
  };
}

/** Explain the §7.6 gate for a rights record as if attached to a published-ready lesson. */
function gateFor(form: RightsUpsert) {
  return canPublish({
    entityKind: 'audio_lesson',
    currentState: 'approved',
    title: 'lesson',
    languageCode: 'xx',
    asset: { checksumVerified: true, disposition: 'active', accessible: true, byteLength: 1 },
    speakers: { known: true, entries: [{ name: 'speaker', consentState: 'granted' }] },
    chapterId: 'chapter',
    rights: {
      licenseId: form.licenseId,
      licenseVersion: form.licenseVersion,
      verified: form.verified,
      commercialRedistribution: form.commercialRedistribution,
      attributionRequired: form.attributionRequired,
      attributionText: form.attributionText,
      authors: form.authors,
      originUrl: form.originUrl,
      expiresAt: form.expiresAt,
      revokedAt: form.revokedAt,
      permissionGrant: form.permissionGrant,
    },
    nativeReviewed: true,
  });
}

export function RightsScreen({ rows, page, hasNext, highlightId, canVerify }: { rows: RightsRow[]; page: number; hasNext: boolean; highlightId: string | null; canVerify: boolean }) {
  const { t, locale } = useI18n();
  const { get, set } = useUrlFilters();
  const [form, setForm] = useState<RightsUpsert | null>(null);
  const [revokeReason, setRevokeReason] = useState<ContentRightsRevokeRequest['reason']>('rights_revoked');
  const [revokeNote, setRevokeNote] = useState('');
  const [report, setReport] = useState<{ items: Array<{ contentRightsId: string; licenseId: string; attributionText: string | null; usedBy: Array<{ entityTable: string; entityId: string; state: string }>; verified: boolean }>; total: number | null } | null>(null);
  const save = useAction(
    async () => {
      if (!form) return null;
      const { id, revokedAt: _revokedAt, ...fields } = form;
      void _revokedAt;
      if (id) {
        const body: ContentRightsPatchRequest = fields;
        return browserApi().call('adminContentRightsPatch', { params: { id }, body });
      }
      const body: ContentRightsCreateRequest = { ...fields, idempotencyKey: newIdempotencyKey('rts') };
      return browserApi().call('adminContentRightsCreate', { body, idempotencyKey: body.idempotencyKey });
    },
    { successMessage: t('admin.ui.saved') },
  );
  // One transaction server-side: unpublishes every dependent entity and revokes offline packs (§7.5).
  const revoke = useAction(
    async (id: string) => {
      const body: ContentRightsRevokeRequest = { reason: revokeReason, note: revokeNote || undefined, idempotencyKey: newIdempotencyKey('rvk') };
      return browserApi().call('adminContentRightsRevoke', { params: { id }, body, idempotencyKey: body.idempotencyKey });
    },
    { successMessage: (res) => t('admin.ui.rtRevokedResult', { count: res.affected.length, manifest: res.manifestInvalidated ? t('admin.ui.yes') : t('admin.ui.no') }) },
  );
  const loadReport = useAction(
    async () => {
      const res = await browserApi().call('adminLicensesAttributions', { query: { limit: 200 } });
      setReport({ items: res.items, total: res.total });
      return res;
    },
    { refresh: false },
  );
  const gate = useMemo(() => (form ? gateFor(form) : null), [form]);

  const columns: Column<RightsRow>[] = [
    { key: 'license', header: t('admin.rights.license'), render: (r) => <button type="button" className={`font-medium text-accent hover:underline ${highlightId === r.id ? 'underline' : ''}`} onClick={() => setForm(toForm(r))}>{LICENSE_NAMES[r.license_id] ?? r.license_id}{r.license_version ? ` ${r.license_version}` : ''}</button> },
    { key: 'owner', header: t('admin.rights.owner'), render: (r) => r.authors.join(', ') || '—' },
    { key: 'verified', header: t('admin.ui.rtVerified'), render: (r) => <Badge tone={r.verified ? 'success' : 'warning'}>{r.verified ? t('admin.ui.yes') : t('admin.ui.no')}</Badge> },
    { key: 'commercial', header: t('admin.rights.commercialUse'), render: (r) => <Badge tone={r.commercial_redistribution ? 'success' : 'neutral'}>{r.commercial_redistribution ? t('admin.ui.yes') : t('admin.ui.no')}</Badge> },
    { key: 'ai', header: t('admin.ui.rtAiProcessing'), render: (r) => (r.ai_processing_permitted ? t('admin.ui.yes') : t('admin.ui.no')) },
    { key: 'expiry', header: t('admin.ui.rtExpires'), render: (r) => (r.revoked_at ? <Badge tone="error">{t('admin.ui.rtRevoked')} {formatDateTime(r.revoked_at, locale)}</Badge> : r.expires_at ? formatDateTime(r.expires_at, locale) : '—') },
    {
      key: 'used',
      header: t('admin.ui.rtUsedBy'),
      render: (r) => (
        <span className="flex flex-wrap gap-1 text-xs">
          <Badge>{r.assets.length} assets</Badge>
          {r.lessons.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1">
              <a href={`/lessons/${l.id}`} className="text-accent hover:underline">
                {shortId(l.id)}
              </a>
              <StatusBadge state={l.state} />
            </span>
          ))}
          {r.collections.map((c) => (
            <a key={c.id} href={`/collections/${c.id}`} className="text-accent hover:underline">
              {shortId(c.id)}
            </a>
          ))}
        </span>
      ),
    },
    { key: 'id', header: t('admin.ui.id'), render: (r) => <code className="font-mono text-[11px]">{shortId(r.id)}</code> },
  ];

  return (
    <div>
      <FilterBar>
        <Checkbox label={t('admin.ui.rtOnlyUnverified')} checked={get('unverified') === '1'} onChange={(e) => set({ unverified: e.target.checked ? '1' : null })} />
        <span className="ms-auto flex gap-2">
          <Button size="sm" loading={loadReport.busy} onClick={() => void loadReport.run()}>
            {t('admin.ui.rtAttributions')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => setForm(emptyForm)}>
            {t('admin.ui.rtNew')}
          </Button>
        </span>
      </FilterBar>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t('admin.rights.title')} />
      <UrlPager page={page} hasNext={hasNext} />
      {loadReport.error ? <Notice tone="error">{loadReport.error}</Notice> : null}
      {report ? (
        <section className="mt-4 rounded-lg border border-border bg-surface p-3">
          <h2 className="mb-2 text-sm font-semibold">
            {t('admin.rights.report')} {report.total != null ? `(${report.total})` : ''}
          </h2>
          {report.items.length === 0 ? <p className="text-sm text-fg-muted">{t('admin.ui.empty')}</p> : null}
          <ul className="space-y-1 text-xs">
            {report.items.map((item) => (
              <li key={item.contentRightsId} className="flex flex-wrap items-center gap-2">
                <code className="font-mono">{shortId(item.contentRightsId)}</code>
                <span>{LICENSE_NAMES[item.licenseId] ?? item.licenseId}</span>
                <Badge tone={item.verified ? 'success' : 'warning'}>{item.verified ? t('admin.ui.rtVerified') : t('admin.ui.libRightsUnverified')}</Badge>
                <span className="text-fg-secondary">{item.attributionText ?? '—'}</span>
                <span className="text-fg-muted">{item.usedBy.map((u) => `${u.entityTable}:${shortId(u.entityId)} (${u.state})`).join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        wide
        title={form?.id ? t('admin.ui.edit') : t('admin.ui.rtNew')}
        footer={
          <>
            <Button onClick={() => setForm(null)}>{t('admin.ui.cancel')}</Button>
            <Button variant="primary" disabled={!form?.permissionGrant.trim() || !form?.licenseId.trim()} loading={save.busy} onClick={() => void save.run().then((r) => r && setForm(null))}>
              {t('admin.ui.save')}
            </Button>
          </>
        }
      >
        {form ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={t('admin.rights.license')} required>
                {(id) => (
                  <Select id={id} value={form.licenseId} onChange={(e) => setForm({ ...form, licenseId: e.target.value })}>
                    {Object.entries(LICENSE_NAMES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v} ({k})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('admin.ui.rtLicenseVersion')}>{(id) => <Input id={id} value={form.licenseVersion ?? ''} onChange={(e) => setForm({ ...form, licenseVersion: e.target.value || null })} />}</Field>
              <Field label={t('admin.ui.rtPermissionGrant')} required className="sm:col-span-2" hint={t('admin.rights.provenance')}>
                {(id) => <Textarea id={id} value={form.permissionGrant} onChange={(e) => setForm({ ...form, permissionGrant: e.target.value })} />}
              </Field>
              <Field label={t('admin.rights.sourceUrl')}>{(id) => <Input id={id} type="url" value={form.originUrl ?? ''} onChange={(e) => setForm({ ...form, originUrl: e.target.value || null })} />}</Field>
              <Field label={t('admin.ui.rtEvidenceLink')}>{(id) => <Input id={id} placeholder="media asset uuid" value={form.evidenceAssetId ?? ''} onChange={(e) => setForm({ ...form, evidenceAssetId: e.target.value || null })} />}</Field>
              <Field label={t('admin.ui.rtAuthors')}>{() => <TagListInput label={t('admin.ui.rtAuthors')} value={form.authors} onChange={(v) => setForm({ ...form, authors: v })} />}</Field>
              <Field label={t('admin.ui.rtSpeakers')}>{() => <TagListInput label={t('admin.ui.rtSpeakers')} value={form.speakers} onChange={(v) => setForm({ ...form, speakers: v })} />}</Field>
              <Field label={t('admin.rights.attributionText')} className="sm:col-span-2">
                {(id) => <Textarea id={id} value={form.attributionText ?? ''} onChange={(e) => setForm({ ...form, attributionText: e.target.value || null })} placeholder={buildAttributionText({ licenseId: form.licenseId, licenseVersion: form.licenseVersion, verified: form.verified, commercialRedistribution: form.commercialRedistribution, attributionRequired: true, authors: form.authors, originUrl: form.originUrl, title: null }) ?? ''} />}
              </Field>
              <Field label={t('admin.ui.rtVoiceRights')}>
                {(id) => (
                  <Select id={id} value={form.voiceRights} onChange={(e) => setForm({ ...form, voiceRights: e.target.value as RightsUpsert['voiceRights'] })}>
                    <option value="none">none</option>
                    <option value="playback_only">playback_only</option>
                    <option value="synthesis_permitted">synthesis_permitted</option>
                  </Select>
                )}
              </Field>
              <Field label={t('admin.ui.rtExpires')}>{(id) => <Input id={id} type="datetime-local" value={form.expiresAt ? form.expiresAt.slice(0, 16) : ''} onChange={(e) => setForm({ ...form, expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />}</Field>
              <Field label={t('admin.ui.rtRevoked')}>{(id) => <Input id={id} readOnly value={form.revokedAt ? formatDateTime(form.revokedAt, locale) : '—'} />}</Field>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Checkbox label={t('admin.rights.commercialUse')} checked={form.commercialRedistribution} onChange={(e) => setForm({ ...form, commercialRedistribution: e.target.checked })} />
                <Checkbox label={t('admin.rights.attributionRequired')} checked={form.attributionRequired} onChange={(e) => setForm({ ...form, attributionRequired: e.target.checked })} />
                <Checkbox label={t('admin.ui.rtAlterations')} checked={form.alterationsPermitted} onChange={(e) => setForm({ ...form, alterationsPermitted: e.target.checked })} />
                <Checkbox label={t('admin.ui.rtAiProcessing')} checked={form.aiProcessingPermitted} onChange={(e) => setForm({ ...form, aiProcessingPermitted: e.target.checked })} />
                <Checkbox label={t('admin.ui.rtVerified')} checked={form.verified} disabled={!canVerify} onChange={(e) => setForm({ ...form, verified: e.target.checked })} />
                {!canVerify ? <p className="text-xs text-fg-muted">{t('admin.ui.rtVerifyNeedsAdmin')}</p> : null}
              </div>
              {form.id && !form.revokedAt ? (
                <div className="space-y-2 rounded-md border border-error/40 bg-error-soft p-2 sm:col-span-2">
                  <p className="text-xs font-semibold text-error">{t('admin.ui.rtRevokeTitle')}</p>
                  <p className="text-xs text-fg-muted">{t('admin.ui.rtRevokeHint')}</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label={t('admin.ui.rtRevokeReason')}>
                      {(id) => (
                        <Select id={id} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value as ContentRightsRevokeRequest['reason'])}>
                          {REVOKE_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label={t('admin.ui.pbNote')} className="flex-1">
                      {(id) => <Input id={id} value={revokeNote} onChange={(e) => setRevokeNote(e.target.value)} />}
                    </Field>
                    <Button variant="danger" loading={revoke.busy} onClick={() => window.confirm(t('admin.ui.confirmTitle')) && void revoke.run(form.id!).then((r) => r && setForm(null))}>
                      {t('admin.ui.rtRevokeAction')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            <aside className="space-y-2 rounded-md border border-border bg-surface-muted p-3 text-xs">
              <h3 className="font-semibold">{t('admin.ui.rtGateTitle')}</h3>
              <p className="text-fg-muted">{t('admin.ui.rtGateHint')}</p>
              {gate ? (
                gate.allowed ? (
                  <Notice tone="success">{t('admin.ui.rtGateOk')}</Notice>
                ) : (
                  <Notice tone="warning">
                    {t('admin.ui.rtGateBlocked', { reasons: gate.blockedBy.join(', ') })}
                    <ul className="mt-1 list-disc ps-4">
                      {gate.reasons.map((r) => (
                        <li key={r.code}>{r.message}</li>
                      ))}
                    </ul>
                  </Notice>
                )
              ) : null}
              {!form.verified ? <p className="text-warning">{t('admin.rights.unclear')}</p> : null}
              {save.error ? <Notice tone="error">{save.error}</Notice> : null}
            </aside>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
