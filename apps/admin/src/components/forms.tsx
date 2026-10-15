'use client';
/**
 * Higher-level form pieces: localized text editors for `*_translations` JSON columns
 * (per-locale rows, RTL-aware), tag lists, catalog pickers for tracks / varieties / languages.
 */
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { COURSE_TRACKS, LANGUAGES, LANGUAGE_VARIETIES, LEARNER_LEVEL_VALUES } from '@langquest/contracts';
import { useI18n } from '@/src/lib/i18n/client';
import { Button, Select, TextField, type TextFieldProps } from './ui';

export type LocalizedMap = Record<string, string>;

export function LocalizedTextEditor({ value, onChange, multiline, label }: { value: LocalizedMap; onChange: (next: LocalizedMap) => void; multiline?: boolean; label: string }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState('');
  const entries = Object.entries(value);
  const unused = LANGUAGES.filter((l) => !(l.code in value));
  return (
    <fieldset className="rounded-md border border-border p-2">
      <legend className="px-1 text-xs font-medium text-fg-secondary">
        {label} · {t('admin.ui.localized')}
      </legend>
      {entries.length === 0 ? <p className="text-xs text-fg-muted">{t('admin.ui.none')}</p> : null}
      <div className="space-y-1.5">
        {entries.map(([code, text]) => (
          <div key={code} className="flex items-start gap-2">
            <span className="w-10 pt-1.5 font-mono text-xs text-fg-muted">{code}</span>
            <TextField
              contentLanguage={code}
              multiline={multiline}
              value={text}
              aria-label={`${label} (${code})`}
              onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [code]: e.target.value })}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('admin.ui.removeLocale')}
              icon={<X size={12} />}
              onClick={() => {
                const next = { ...value };
                delete next[code];
                onChange(next);
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Select aria-label={t('admin.ui.addLocale')} className="w-auto py-1 text-xs" value={adding} onChange={(e) => setAdding(e.target.value)}>
          <option value="">{t('admin.ui.addLocale')}</option>
          {unused.map((l) => (
            <option key={l.code} value={l.code}>
              {l.code} · {l.englishName}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          icon={<Plus size={12} />}
          disabled={!adding}
          onClick={() => {
            if (!adding) return;
            onChange({ ...value, [adding]: '' });
            setAdding('');
          }}
        >
          {t('admin.ui.addLocale')}
        </Button>
      </div>
    </fieldset>
  );
}

export function TagListInput({ value, onChange, label }: { value: string[]; onChange: (next: string[]) => void; label: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const tag = draft.trim();
    if (!tag || value.includes(tag)) return;
    onChange([...value, tag]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs">
            {tag}
            <button type="button" aria-label={`remove ${tag}`} onClick={() => onChange(value.filter((v) => v !== tag))}>
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <input
        aria-label={label}
        className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1 text-sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

export function TrackSelect({ value, onChange, allowEmpty = true, id }: { value: string | null; onChange: (next: string | null) => void; allowEmpty?: boolean; id?: string }) {
  const { t } = useI18n();
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty ? <option value="">{t('admin.ui.none')}</option> : null}
      {COURSE_TRACKS.map((tr) => (
        <option key={tr.id} value={tr.id}>
          {tr.displayName} ({tr.targetVarietyId})
        </option>
      ))}
    </Select>
  );
}

export function VarietySelect({ value, onChange, allowEmpty = true, id }: { value: string | null; onChange: (next: string | null) => void; allowEmpty?: boolean; id?: string }) {
  const { t } = useI18n();
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty ? <option value="">{t('admin.ui.none')}</option> : null}
      {LANGUAGE_VARIETIES.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name} ({v.id})
        </option>
      ))}
    </Select>
  );
}

export function LanguageSelect({ value, onChange, allowEmpty = true, id, emptyLabel }: { value: string | null; onChange: (next: string | null) => void; allowEmpty?: boolean; id?: string; emptyLabel?: string }) {
  const { t } = useI18n();
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty ? <option value="">{emptyLabel ?? t('admin.ui.none')}</option> : null}
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.englishName} ({l.code})
        </option>
      ))}
    </Select>
  );
}

export function LevelSelect({ value, onChange, id }: { value: string | null; onChange: (next: string | null) => void; id?: string }) {
  const { t } = useI18n();
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{t('admin.ui.none')}</option>
      {LEARNER_LEVEL_VALUES.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </Select>
  );
}

export type { TextFieldProps };
