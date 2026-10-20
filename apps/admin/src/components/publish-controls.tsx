'use client';
/**
 * Publish / unpublish / request-review controls shared by editors and the Publishing screen.
 * Publishing goes through the API (`adminContentPublish`), which runs the §7.6 gate; when
 * blocked, the checklist and `blockedBy` reasons are shown verbatim so the editor knows why.
 */
import { useState } from 'react';
import { ContentDecisionTableSchema, type ContentPublishResponse, type PublishChecklist } from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { Button, Notice, Select, Input } from './ui';
import { Badge } from './badges';

type EntityTable = 'audio_lessons' | 'audio_course_collections' | 'missions' | 'lesson_courses' | 'expressions' | 'characters' | 'visual_assets';

const CHECK_LABEL: Record<keyof PublishChecklist, string> = {
  titlePresent: 'admin.ui.title',
  languagePresent: 'admin.models.variety',
  fileIntegrityVerified: 'admin.library.contentHash',
  audioAccessible: 'admin.library.preview',
  speakerMetadataPresent: 'admin.library.speaker',
  chapterLinked: 'admin.sections.chapters',
  rightsVerified: 'admin.publish.check.rightsVerified',
  nativeReviewed: 'admin.publish.check.nativeReviewed',
  altTextPresent: 'admin.publish.check.licenseAttribution',
};

export function PublishControls({ entityTable, entityId, state, revision, canDecide }: { entityTable: EntityTable; entityId: string; state: string; revision: number; canDecide?: boolean }) {
  const { t } = useI18n();
  const [result, setResult] = useState<ContentPublishResponse | null>(null);
  const [unpublishReason, setUnpublishReason] = useState<'rights_revoked' | 'quality' | 'takedown' | 'editorial' | 'other'>('editorial');
  const [note, setNote] = useState('');
  const publish = useAction(
    async () => {
      const res = await browserApi().call('adminContentPublish', { params: { id: entityId }, body: { entityTable, expectedRevision: revision, note: note || undefined } });
      setResult(res);
      return res;
    },
    { successMessage: (res) => (res.blockedBy.length > 0 ? t('admin.publish.blockedItems', { count: res.blockedBy.length }) : t('admin.publish.state.published')) },
  );
  const unpublish = useAction(
    async () => browserApi().call('adminContentUnpublish', { params: { id: entityId }, body: { entityTable, reason: unpublishReason, note: note || undefined } }),
    { successMessage: (res) => `${t('admin.publish.state.unpublished')}${res.manifestInvalidated ? ` · ${t('admin.publish.manifestInvalidated')}` : ''}` },
  );
  const requestReview = useAction(async () => browserApi().call('adminContentRequestReview', { params: { id: entityId }, body: { note: note || undefined } }), { successMessage: t('admin.publish.state.review_needed') });
  // Approve / reject exist for the content tables the decision route moves; other tables never show the controls.
  const decisionTable = ContentDecisionTableSchema.safeParse(entityTable).data;
  const decide = useAction(async (table: NonNullable<typeof decisionTable>, decision: 'approve' | 'reject') => browserApi().call('adminContentDecision', { params: { id: entityId }, body: { entityTable: table, decision, note: note || undefined } }), { successMessage: t('admin.ui.saved') });

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={t('admin.ui.pbNote')} value={note} onChange={(e) => setNote(e.target.value)} className="w-56" />
        {state !== 'published' ? (
          <Button variant="primary" loading={publish.busy} onClick={() => void publish.run()}>
            {t('admin.publish.publish')}
          </Button>
        ) : null}
        {state === 'published' ? (
          <>
            <Select value={unpublishReason} onChange={(e) => setUnpublishReason(e.target.value as typeof unpublishReason)} className="w-auto">
              {['rights_revoked', 'quality', 'takedown', 'editorial', 'other'].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <Button variant="danger" loading={unpublish.busy} onClick={() => void unpublish.run()}>
              {t('admin.publish.unpublish')}
            </Button>
          </>
        ) : null}
        {state !== 'published' && state !== 'review_needed' ? (
          <Button loading={requestReview.busy} onClick={() => void requestReview.run()}>
            {t('admin.publish.requestReview')}
          </Button>
        ) : null}
        {/* rejected → approved is not a §7.6 transition (send it back to review first), so approve shows in review only. */}
        {canDecide && decisionTable && state === 'review_needed' ? (
          <Button loading={decide.busy} onClick={() => void decide.run(decisionTable, 'approve')}>
            {t('admin.review.approve')}
          </Button>
        ) : null}
        {canDecide && decisionTable && state === 'review_needed' ? (
          <Button variant="danger" loading={decide.busy} onClick={() => void decide.run(decisionTable, 'reject')}>
            {t('admin.review.reject')}
          </Button>
        ) : null}
      </div>
      {result ? (
        <div className="space-y-1 text-xs">
          <p className="font-medium">
            {t('admin.publish.checklist')} · {result.blockedBy.length === 0 ? t('admin.ui.pbPublished', { revision: result.revision }) : t('admin.ui.pbBlocked')}
          </p>
          <ul className="flex flex-wrap gap-1">
            {(Object.keys(result.checklist) as Array<keyof PublishChecklist>).map((k) => (
              <li key={k}>
                <Badge tone={result.checklist[k] ? 'success' : 'error'}>{t(CHECK_LABEL[k])}</Badge>
              </li>
            ))}
          </ul>
          {result.blockedBy.length > 0 ? (
            <Notice tone="warning">
              {t('admin.publish.blockedBy')}: {result.blockedBy.join(', ')}
            </Notice>
          ) : null}
          {result.manifestInvalidated ? <p className="text-fg-muted">{t('admin.publish.manifestInvalidated')}</p> : null}
        </div>
      ) : null}
      {publish.error || unpublish.error ? <Notice tone="error">{publish.error ?? unpublish.error}</Notice> : null}
    </div>
  );
}
