'use client';
/**
 * Focal point editor (§10.2A crop / focal point): click or drag on the preview to place the
 * point, or type the 0–1 coordinates. Without a preview (existing assets have no signed URL in
 * the Studio) the numeric inputs alone are offered — nothing is faked.
 */
import { useRef, type MouseEvent } from 'react';
import type { FocalPoint } from '@langquest/contracts';
import { useI18n } from '@/src/lib/i18n/client';
import { clampUnit } from '@/src/lib/visual/slots';
import { Button, Field, Input } from './ui';

export function FocalPointPicker({ value, onChange, previewUrl, label }: { value: FocalPoint | null; onChange: (next: FocalPoint | null) => void; previewUrl: string | null; label: string }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const place = (e: MouseEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onChange({ x: clampUnit((e.clientX - rect.left) / rect.width), y: clampUnit((e.clientY - rect.top) / rect.height) });
  };
  return (
    <div className="space-y-2">
      {previewUrl ? (
        <div
          ref={box}
          role="button"
          tabIndex={0}
          aria-label={t('admin.ui.vaFocalPick')}
          onClick={place}
          onMouseMove={(e) => e.buttons === 1 && place(e)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.01;
            const cur = value ?? { x: 0.5, y: 0.5 };
            if (e.key === 'ArrowLeft') onChange({ ...cur, x: clampUnit(cur.x - step) });
            else if (e.key === 'ArrowRight') onChange({ ...cur, x: clampUnit(cur.x + step) });
            else if (e.key === 'ArrowUp') onChange({ ...cur, y: clampUnit(cur.y - step) });
            else if (e.key === 'ArrowDown') onChange({ ...cur, y: clampUnit(cur.y + step) });
            else return;
            e.preventDefault();
          }}
          className="relative inline-block max-w-full cursor-crosshair select-none overflow-hidden rounded-md border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="" draggable={false} className="block max-h-72 max-w-full object-contain" />
          {value ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent/80 shadow"
              style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }}
            />
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-fg-muted">{t('admin.ui.vaNoPreview')}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={`${label} · x`}>
          {(id) => <Input id={id} type="number" min={0} max={1} step={0.01} className="w-24" value={value?.x ?? ''} onChange={(e) => onChange({ x: clampUnit(Number(e.target.value)), y: value?.y ?? 0.5 })} />}
        </Field>
        <Field label={`${label} · y`}>
          {(id) => <Input id={id} type="number" min={0} max={1} step={0.01} className="w-24" value={value?.y ?? ''} onChange={(e) => onChange({ x: value?.x ?? 0.5, y: clampUnit(Number(e.target.value)) })} />}
        </Field>
        <Button size="sm" variant="ghost" disabled={!value} onClick={() => onChange(null)}>
          {t('admin.ui.vaFocalClear')}
        </Button>
      </div>
    </div>
  );
}
