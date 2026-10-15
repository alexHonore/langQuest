'use client';
import { useState } from 'react';
import type { AudioLessonPatchRequest } from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { shortId } from '@/src/lib/format';
import type { ChapterOption, CollectionOption, RightsOption, SpeakerOption } from '@/src/lib/queries/library';
import { Button, Card, Field, Input, Notice, Select } from '@/src/components/ui';
import { LanguageSelect, LevelSelect, LocalizedTextEditor, TagListInput, VarietySelect } from '@/src/components/forms';

export interface LessonFormValue {
  id: string;
  chapterId: string;
  titleTranslations: Record<string, string>;
  descriptionTranslations: Record<string, string>;
  sortOrder: number;
  episodeNumber: number | null;
  level: string | null;
  targetVarietyId: string | null;
  instructionLanguageCode: string | null;
  spokenLanguageCodes: string[];
  regionalDialect: string | null;
  topic: string | null;
  tags: string[];
  scene: string | null;
  speakerIds: string[];
  coverVisualAssetId: string | null;
  contentRightsId: string | null;
  visibility: 'private' | 'authenticated';
  qualityReviewStatus: 'unreviewed' | 'approved' | 'rejected';
  expectedRevision: number;
}

export function LessonEditor({ lesson, options, canReview }: { lesson: LessonFormValue; options: { collections: CollectionOption[]; chapters: ChapterOption[]; speakers: SpeakerOption[]; rights: RightsOption[] }; canReview: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = useState<LessonFormValue>(lesson);
  const set = <K extends keyof LessonFormValue>(k: K, v: LessonFormValue[K]) => setValue((s) => ({ ...s, [k]: v }));
  const save = useAction(
    async () => {
      const body: AudioLessonPatchRequest = {
        titleTranslations: value.titleTranslations,
        descriptionTranslations: value.descriptionTranslations,
        chapterId: value.chapterId,
        sortOrder: value.sortOrder,
        episodeNumber: value.episodeNumber,
        level: value.level as AudioLessonPatchRequest['level'],
        targetVarietyId: value.targetVarietyId as AudioLessonPatchRequest['targetVarietyId'],
        instructionLanguageCode: value.instructionLanguageCode as AudioLessonPatchRequest['instructionLanguageCode'],
        spokenLanguageCodes: value.spokenLanguageCodes,
        regionalDialect: value.regionalDialect,
        topic: value.topic,
        tags: value.tags,
        scene: value.scene,
        speakerIds: value.speakerIds,
        coverVisualAssetId: value.coverVisualAssetId,
        contentRightsId: value.contentRightsId,
        visibility: value.visibility,
        qualityReviewStatus: canReview ? value.qualityReviewStatus : undefined,
        expectedRevision: value.expectedRevision,
      };
      const res = await browserApi().call('adminAudioLessonPatch', { params: { id: lesson.id }, body });
      set('expectedRevision', res.revision);
      return res;
    },
    { successMessage: (res) => `${t('admin.ui.saved')} · ${t('admin.ui.lsRevision', { revision: res.revision })}` },
  );
  return (
    <Card
      title={t('admin.ui.edit')}
      actions={
        <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
          {t('admin.ui.save')}
        </Button>
      }
    >
      <div className="space-y-3">
        <LocalizedTextEditor label={t('admin.ui.title')} value={value.titleTranslations} onChange={(v) => set('titleTranslations', v)} />
        <LocalizedTextEditor label={t('admin.ui.lsDescription')} multiline value={value.descriptionTranslations} onChange={(v) => set('descriptionTranslations', v)} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('admin.sections.chapters')}>
            {(id) => (
              <Select id={id} value={value.chapterId} onChange={(e) => set('chapterId', e.target.value)}>
                {options.chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.sort_order}. {shortId(c.id)} · {String((c.title_translations as Record<string, string>)?.en ?? (c.title_translations as Record<string, string>)?.fr ?? '')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('admin.ui.order')}>{(id) => <Input id={id} type="number" min={0} value={value.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />}</Field>
          <Field label={t('admin.ui.lsEpisode')}>{(id) => <Input id={id} type="number" min={0} value={value.episodeNumber ?? ''} onChange={(e) => set('episodeNumber', e.target.value === '' ? null : Number(e.target.value))} />}</Field>
          <Field label={t('admin.ui.lsLevel')}>{(id) => <LevelSelect id={id} value={value.level} onChange={(v) => set('level', v)} />}</Field>
          <Field label={t('admin.ui.targetVariety')}>{(id) => <VarietySelect id={id} value={value.targetVarietyId} onChange={(v) => set('targetVarietyId', v)} />}</Field>
          <Field label={t('admin.ui.sourceLanguage')}>{(id) => <LanguageSelect id={id} value={value.instructionLanguageCode} onChange={(v) => set('instructionLanguageCode', v)} />}</Field>
          <Field label={t('admin.ui.lsSpoken')}>{() => <TagListInput label={t('admin.ui.lsSpoken')} value={value.spokenLanguageCodes} onChange={(v) => set('spokenLanguageCodes', v)} />}</Field>
          <Field label={t('admin.ui.lsDialect')}>{(id) => <Input id={id} value={value.regionalDialect ?? ''} onChange={(e) => set('regionalDialect', e.target.value || null)} />}</Field>
          <Field label={t('admin.ui.lsTopic')}>{(id) => <Input id={id} value={value.topic ?? ''} onChange={(e) => set('topic', e.target.value || null)} />}</Field>
          <Field label={t('admin.ui.lsTags')}>{() => <TagListInput label={t('admin.ui.lsTags')} value={value.tags} onChange={(v) => set('tags', v)} />}</Field>
          <Field label={t('admin.ui.lsScene')}>{(id) => <Input id={id} value={value.scene ?? ''} onChange={(e) => set('scene', e.target.value || null)} />}</Field>
          <Field label={t('admin.library.speaker')}>
            {(id) => (
              <Select id={id} multiple value={value.speakerIds} onChange={(e) => set('speakerIds', Array.from(e.target.selectedOptions).map((o) => o.value))} size={4}>
                {options.speakers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('admin.ui.colCover')}>{(id) => <Input id={id} placeholder="visual asset uuid" value={value.coverVisualAssetId ?? ''} onChange={(e) => set('coverVisualAssetId', e.target.value || null)} />}</Field>
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
          <Field label={t('admin.ui.lsVisibility')}>
            {(id) => (
              <Select id={id} value={value.visibility} onChange={(e) => set('visibility', e.target.value as LessonFormValue['visibility'])}>
                <option value="private">private</option>
                <option value="authenticated">authenticated</option>
              </Select>
            )}
          </Field>
          <Field label={t('admin.ui.lsQuality')}>
            {(id) => (
              <Select id={id} disabled={!canReview} value={value.qualityReviewStatus} onChange={(e) => set('qualityReviewStatus', e.target.value as LessonFormValue['qualityReviewStatus'])}>
                <option value="unreviewed">unreviewed</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
              </Select>
            )}
          </Field>
          <Field label={t('admin.ui.lsRevision', { revision: value.expectedRevision })}>{(id) => <Input id={id} readOnly value={value.expectedRevision} />}</Field>
        </div>
        {save.error ? <Notice tone="error">{save.error}</Notice> : null}
      </div>
    </Card>
  );
}
