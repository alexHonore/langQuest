'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { localCall } from '@/src/lib/local-api/client';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { pickLocalized, shortId } from '@/src/lib/format';
import { Button, Field, Input } from '@/src/components/ui';
import { Dialog } from '@/src/components/dialog';
import { LanguageSelect, LevelSelect, LocalizedTextEditor, VarietySelect } from '@/src/components/forms';
import { StatusBadge } from '@/src/components/badges';

interface LessonRow {
  id: string;
  title_translations: unknown;
  sort_order: number;
  state: string;
  transcript_status: string;
  level: string | null;
  target_variety_id: string | null;
  instruction_language_code: string | null;
}

export function LessonList({ chapterId, lessons, defaults }: { chapterId: string; lessons: LessonRow[]; defaults: { targetVarietyId: string | null; instructionLanguageCode: string | null } }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState<Record<string, string>>({ [locale]: '' });
  const [level, setLevel] = useState<string | null>(null);
  const [variety, setVariety] = useState<string | null>(defaults.targetVarietyId);
  const [source, setSource] = useState<string | null>(defaults.instructionLanguageCode);
  const create = useAction(
    async () =>
      localCall<{ id: string }>('/api/admin/lessons', {
        method: 'POST',
        body: { chapterId, titleTranslations: title, sortOrder: lessons.length + 1, level, targetVarietyId: variety, instructionLanguageCode: source },
      }),
    { successMessage: t('admin.ui.saved') },
  );
  const reorder = useAction(async (items: Array<{ id: string; sortOrder: number }>) => localCall('/api/admin/lessons/reorder', { method: 'POST', body: { items } }), { successMessage: t('admin.ui.saved') });
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= lessons.length) return;
    const a = lessons[index]!;
    const b = lessons[target]!;
    void reorder.run([
      { id: a.id, sortOrder: b.sort_order === a.sort_order ? b.sort_order + (dir > 0 ? 1 : -1) : b.sort_order },
      { id: b.id, sortOrder: a.sort_order },
    ]);
  };
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          {t('admin.ui.lsNew')}
        </Button>
      </div>
      {lessons.length === 0 ? <p className="text-sm text-fg-muted">{t('admin.ui.empty')}</p> : null}
      <ol className="divide-y divide-border">
        {lessons.map((l, i) => (
          <li key={l.id} className="flex items-center gap-2 py-1.5 text-sm">
            <span className="w-8 tabular-nums text-fg-muted">{l.sort_order}.</span>
            <Link href={`/lessons/${l.id}`} className="flex-1 truncate font-medium text-accent hover:underline">
              {pickLocalized(l.title_translations, locale) || shortId(l.id)}
            </Link>
            <span className="text-xs text-fg-muted">{[l.target_variety_id, l.instruction_language_code, l.level].filter(Boolean).join(' · ')}</span>
            <span className="text-xs text-fg-muted">{t(`admin.transcripts.status.${l.transcript_status}`)}</span>
            <StatusBadge state={l.state} />
            <Button size="sm" variant="ghost" aria-label={t('admin.ui.lsMoveUp')} disabled={i === 0 || reorder.busy} onClick={() => move(i, -1)} icon={<ArrowUp size={14} />} />
            <Button size="sm" variant="ghost" aria-label={t('admin.ui.lsMoveDown')} disabled={i === lessons.length - 1 || reorder.busy} onClick={() => move(i, 1)} icon={<ArrowDown size={14} />} />
          </li>
        ))}
      </ol>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('admin.ui.lsNew')}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('admin.ui.cancel')}</Button>
            <Button variant="primary" loading={create.busy} onClick={() => void create.run().then((r) => r && setOpen(false))}>
              {t('admin.ui.create')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <LocalizedTextEditor label={t('admin.ui.title')} value={title} onChange={setTitle} />
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label={t('admin.ui.lsLevel')}>{(id) => <LevelSelect id={id} value={level} onChange={setLevel} />}</Field>
            <Field label={t('admin.ui.targetVariety')}>{(id) => <VarietySelect id={id} value={variety} onChange={setVariety} />}</Field>
            <Field label={t('admin.ui.sourceLanguage')}>{(id) => <LanguageSelect id={id} value={source} onChange={setSource} />}</Field>
          </div>
          <Field label={t('admin.ui.order')}>{(id) => <Input id={id} readOnly value={lessons.length + 1} />}</Field>
        </div>
      </Dialog>
    </div>
  );
}
