'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { localCall } from '@/src/lib/local-api/client';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { Button, Field, Input } from '@/src/components/ui';
import { Dialog } from '@/src/components/dialog';
import { LocalizedTextEditor } from '@/src/components/forms';

export interface ChapterFormValue {
  id?: string;
  collectionId: string;
  titleTranslations: Record<string, string>;
  summaryTranslations: Record<string, string>;
  sortOrder: number;
  coverVisualAssetId: string | null;
}

export function ChapterEditor({ mode, collectionId, initial, nextOrder }: { mode: 'create' | 'edit'; collectionId: string; initial?: ChapterFormValue; nextOrder?: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<ChapterFormValue>(initial ?? { collectionId, titleTranslations: { en: '' }, summaryTranslations: {}, sortOrder: nextOrder ?? 1, coverVisualAssetId: null });
  const action = useAction(
    async () => {
      const res = await localCall<{ id: string }>('/api/admin/chapters', { method: 'POST', body: value });
      if (mode === 'create') router.push(`/chapters/${res.id}`);
      return res;
    },
    { successMessage: t('admin.ui.saved') },
  );
  return (
    <>
      <Button size={mode === 'create' ? 'sm' : 'md'} onClick={() => setOpen(true)}>
        {mode === 'create' ? t('admin.ui.chNew') : t('admin.ui.edit')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={mode === 'create' ? t('admin.ui.chNew') : t('admin.ui.edit')}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('admin.ui.cancel')}</Button>
            <Button variant="primary" loading={action.busy} onClick={() => void action.run().then((r) => r && setOpen(false))}>
              {t('admin.ui.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <LocalizedTextEditor label={t('admin.ui.title')} value={value.titleTranslations} onChange={(v) => setValue((s) => ({ ...s, titleTranslations: v }))} />
          <LocalizedTextEditor label={t('admin.ui.chSummary')} multiline value={value.summaryTranslations} onChange={(v) => setValue((s) => ({ ...s, summaryTranslations: v }))} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('admin.ui.order')}>{(id) => <Input id={id} type="number" min={0} value={value.sortOrder} onChange={(e) => setValue((s) => ({ ...s, sortOrder: Number(e.target.value) }))} />}</Field>
            <Field label={t('admin.ui.colCover')}>{(id) => <Input id={id} placeholder="visual asset uuid" value={value.coverVisualAssetId ?? ''} onChange={(e) => setValue((s) => ({ ...s, coverVisualAssetId: e.target.value || null }))} />}</Field>
          </div>
        </div>
      </Dialog>
    </>
  );
}
