'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { courseCoverSvgString } from '@art/covers';
import { COURSE_TRACKS, type CollectionCreateRequest, type CollectionPatchRequest } from '@langquest/contracts';
import Link from 'next/link';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import type { CollectionOption, ChapterOption, SpeakerOption, RightsOption } from '@/src/lib/queries/library';
import { Button, Field, Input, Select } from '@/src/components/ui';
import { Dialog } from '@/src/components/dialog';
import { LanguageSelect, LocalizedTextEditor, TrackSelect, VarietySelect } from '@/src/components/forms';
import { SvgArt } from '@/src/components/asset-preview';
import { newIdempotencyKey, shortId } from '@/src/lib/format';

export interface CollectionFormValue {
  id?: string;
  titleTranslations: Record<string, string>;
  descriptionTranslations: Record<string, string>;
  courseTrackId: string | null;
  targetVarietyId: string | null;
  instructionLanguageCode: string | null;
  region: string | null;
  instructorSpeakerId: string | null;
  coverVisualAssetId: string | null;
  contentRightsId: string | null;
  sortOrder: number;
}

/** Catalog ids are validated by the contract schema server-side; the form holds plain strings until then. */
type Fields = Omit<CollectionCreateRequest, 'idempotencyKey'>;
function toFields(v: CollectionFormValue): Fields {
  return {
    titleTranslations: v.titleTranslations,
    descriptionTranslations: v.descriptionTranslations,
    courseTrackId: v.courseTrackId as Fields['courseTrackId'],
    targetVarietyId: v.targetVarietyId as Fields['targetVarietyId'],
    instructionLanguageCode: v.instructionLanguageCode as Fields['instructionLanguageCode'],
    region: v.region,
    instructorSpeakerId: v.instructorSpeakerId,
    coverVisualAssetId: v.coverVisualAssetId,
    contentRightsId: v.contentRightsId,
    sortOrder: v.sortOrder,
  };
}

const empty: CollectionFormValue = { titleTranslations: { en: '' }, descriptionTranslations: {}, courseTrackId: null, targetVarietyId: null, instructionLanguageCode: null, region: null, instructorSpeakerId: null, coverVisualAssetId: null, contentRightsId: null, sortOrder: 0 };

export function CollectionEditor({ mode, initial, options }: { mode: 'create' | 'edit'; initial?: CollectionFormValue; options: { collections?: CollectionOption[]; chapters?: ChapterOption[]; speakers: SpeakerOption[]; rights: RightsOption[] } }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<CollectionFormValue>(initial ?? empty);
  const action = useAction(
    async () => {
      if (mode === 'edit' && value.id) {
        const body: CollectionPatchRequest = toFields(value);
        return browserApi().call('adminCollectionPatch', { params: { id: value.id }, body });
      }
      const body: CollectionCreateRequest = { ...toFields(value), idempotencyKey: newIdempotencyKey('col') };
      const res = await browserApi().call('adminCollectionCreate', { body, idempotencyKey: body.idempotencyKey });
      router.push(`/collections/${res.id}`);
      return res;
    },
    { successMessage: t('admin.ui.saved') },
  );
  const track = COURSE_TRACKS.find((tr) => tr.id === value.courseTrackId);
  const set = <K extends keyof CollectionFormValue>(k: K, v: CollectionFormValue[K]) => setValue((s) => ({ ...s, [k]: v }));
  return (
    <>
      <Button variant={mode === 'create' ? 'primary' : 'secondary'} onClick={() => setOpen(true)}>
        {mode === 'create' ? t('admin.ui.colNew') : t('admin.ui.edit')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={mode === 'create' ? t('admin.ui.colNew') : t('admin.ui.edit')}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('admin.ui.cancel')}</Button>
            <Button variant="primary" loading={action.busy} onClick={() => void action.run().then((r) => r && setOpen(false))}>
              {t('admin.ui.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 lg:grid-cols-[1fr_14rem]">
          <div className="space-y-3">
            <LocalizedTextEditor label={t('admin.ui.title')} value={value.titleTranslations} onChange={(v) => set('titleTranslations', v)} />
            <LocalizedTextEditor label={t('admin.ui.lsDescription')} multiline value={value.descriptionTranslations} onChange={(v) => set('descriptionTranslations', v)} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={t('admin.ui.colTrack')}>
                {(id) => (
                  <TrackSelect
                    id={id}
                    value={value.courseTrackId}
                    onChange={(v) => {
                      set('courseTrackId', v);
                      const tr = COURSE_TRACKS.find((x) => x.id === v);
                      if (tr && !value.targetVarietyId) set('targetVarietyId', tr.targetVarietyId);
                    }}
                  />
                )}
              </Field>
              <Field label={t('admin.ui.targetVariety')}>{(id) => <VarietySelect id={id} value={value.targetVarietyId} onChange={(v) => set('targetVarietyId', v)} />}</Field>
              <Field label={t('admin.ui.sourceLanguage')}>{(id) => <LanguageSelect id={id} value={value.instructionLanguageCode} onChange={(v) => set('instructionLanguageCode', v)} />}</Field>
              <Field label={t('admin.ui.colRegion')}>{(id) => <Input id={id} value={value.region ?? ''} onChange={(e) => set('region', e.target.value || null)} />}</Field>
              <Field label={t('admin.ui.colInstructor')}>
                {(id) => (
                  <Select id={id} value={value.instructorSpeakerId ?? ''} onChange={(e) => set('instructorSpeakerId', e.target.value || null)}>
                    <option value="">{t('admin.ui.none')}</option>
                    {options.speakers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.display_name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('admin.ui.colRightsLink')}>
                {(id) => (
                  <Select id={id} value={value.contentRightsId ?? ''} onChange={(e) => set('contentRightsId', e.target.value || null)}>
                    <option value="">{t('admin.ui.none')}</option>
                    {options.rights.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.license_id} {r.verified ? '✓' : '(unverified)'} · {shortId(r.id)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('admin.ui.order')}>{(id) => <Input id={id} type="number" min={0} value={value.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />}</Field>
              <Field
                label={t('admin.ui.colCover')}
                hint={
                  <>
                    {t('admin.ui.colCoverUpload')}:{' '}
                    <Link href="/visual-assets" className="text-accent-text hover:underline">
                      {t('admin.sections.visualAssets')}
                    </Link>
                  </>
                }
              >
                {(id) => <Input id={id} placeholder="visual asset uuid" value={value.coverVisualAssetId ?? ''} onChange={(e) => set('coverVisualAssetId', e.target.value || null)} />}
              </Field>
            </div>
          </div>
          <aside>
            <p className="mb-1 text-xs text-fg-muted">{t('admin.ui.colCoverGenerated')}</p>
            {track ? <SvgArt svg={courseCoverSvgString(track.id, { width: 220 })} label={track.displayName} className="w-full rounded-md border border-border" /> : <p className="text-xs text-fg-muted">{t('admin.ui.none')}</p>}
          </aside>
        </div>
      </Dialog>
    </>
  );
}
